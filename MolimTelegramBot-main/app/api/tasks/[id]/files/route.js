import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { getAuthenticatedAccount } from "../../../../../lib/telegram-auth";
import { getTask, hasAnyPermission, addTaskHistory, addAuditLog } from "../../../../../lib/task-service";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function responseError(message, status = 500) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function GET(request, { params }) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { account } = await getAuthenticatedAccount(initData);
    const { id } = await params;
    const task = await getTask(Number(id), account.id);

    if (!task) return responseError("المهمة غير موجودة.", 404);

    const canView = await hasAnyPermission(account.id, ["tasks.files.view"]);
    const ownFile = (task.task_files || []).some((file) => Number(file.account_id) === Number(account.id));
    if (!canView && !ownFile) return responseError("لا تملك صلاحية مشاهدة ملفات المهمة.", 403);

    const files = [];
    for (const file of task.task_files || []) {
      const { data: signed } = await supabase.storage
        .from("task-files")
        .createSignedUrl(file.storage_path, 60 * 60);

      files.push({ ...file, signedUrl: signed?.signedUrl || null });
    }

    return NextResponse.json({ success: true, files });
  } catch (error) {
    console.error("Task files GET error:", error);
    return responseError(error?.code === "TASK_ACCESS_DENIED" ? "لا تملك صلاحية مشاهدة هذه المهمة." : "حدث خطأ غير متوقع.", error?.code === "TASK_ACCESS_DENIED" ? 403 : 500);
  }
}

export async function POST(request, { params }) {
  try {
    const form = await request.formData();
    const initData = String(form.get("initData") || request.headers.get("x-telegram-init-data") || "");
    const { account } = await getAuthenticatedAccount(initData);
    const { id } = await params;
    const taskId = Number(id);
    const task = await getTask(taskId, account.id);

    if (!task) return responseError("المهمة غير موجودة.", 404);

    const canUploadByPermission = await hasAnyPermission(account.id, ["tasks.files.upload"]);
    const isAssignee = (task.task_assignees || []).some(
      (row) => Number(row.account_id) === Number(account.id) && !row.removed_at
    );
    const isDepartmentResponsible = (task.task_departments || []).some(
      (row) => Number(row.responsible_account_id) === Number(account.id)
    );

    if (!canUploadByPermission && !isAssignee && !isDepartmentResponsible) {
      return responseError("لا تملك صلاحية رفع ملفات المهمة.", 403);
    }

    if (task.due_at && new Date(task.due_at).getTime() <= Date.now()) {
      return responseError("انتهى موعد المهمة، ولا يمكن رفع ملفات جديدة.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) return responseError("اختر ملفًا أولًا.", 400);
    if (file.size <= 0) return responseError("الملف فارغ.", 400);
    if (file.size > MAX_FILE_SIZE) return responseError("حجم الملف يتجاوز 20 ميجابايت.", 400);

    const cleanName = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "file";
    const path = `${taskId}/${account.id}/${Date.now()}-${cleanName}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("task-files")
      .upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false
      });

    if (uploadError) throw uploadError;

    const title = String(form.get("title") || "").trim() || null;
    const details = String(form.get("details") || "").trim() || null;

    const { data: savedFile, error: dbError } = await supabase
      .from("task_files")
      .insert({
        task_id: taskId,
        account_id: account.id,
        file_name: cleanName,
        storage_path: path,
        mime_type: file.type || null,
        file_size: file.size,
        title,
        details
      })
      .select(`
        id,
        task_id,
        account_id,
        file_name,
        storage_path,
        mime_type,
        file_size,
        title,
        details,
        created_at
      `)
      .single();

    if (dbError) {
      await supabase.storage.from("task-files").remove([path]);
      throw dbError;
    }

    await addTaskHistory({
      taskId,
      accountId: account.id,
      action: "file.uploaded",
      newValue: cleanName,
      metadata: { file_id: savedFile.id, file_size: file.size }
    });

    await addAuditLog({
      accountId: account.id,
      actionType: "task.file.uploaded",
      entityType: "task",
      entityId: taskId,
      description: `تم رفع ملف على المهمة #${taskId}`,
      metadata: { file_id: savedFile.id, file_name: cleanName }
    });

    const { data: signed } = await supabase.storage
      .from("task-files")
      .createSignedUrl(path, 60 * 60);

    return NextResponse.json({
      success: true,
      file: { ...savedFile, signedUrl: signed?.signedUrl || null }
    });
  } catch (error) {
    console.error("Task files POST error:", error);
    return responseError(error?.code === "TASK_ACCESS_DENIED" ? "لا تملك صلاحية مشاهدة هذه المهمة." : "تعذر رفع الملف.", error?.code === "TASK_ACCESS_DENIED" ? 403 : 500);
  }
}
