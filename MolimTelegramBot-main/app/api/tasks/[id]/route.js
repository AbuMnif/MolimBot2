import { NextResponse } from "next/server";
import {
  getTask,
  hasAnyPermission,
  isDepartmentHeadForTask,
  addTaskHistory,
  addAuditLog,
  createAutomaticReminders
} from "../../../../lib/task-service";
import { supabase } from "../../../../lib/supabase";
import { getAuthenticatedAccount } from "../../../../lib/telegram-auth";

function errorResponse(error) {
  const status = error?.code === "TASK_ACCESS_DENIED" ? 403 : error?.code === "TASK_NOT_FOUND" ? 404 : 500;
  const message = error?.code === "TASK_ACCESS_DENIED" ? "لا تملك صلاحية مشاهدة هذه المهمة." : error?.code === "TASK_NOT_FOUND" ? "المهمة غير موجودة." : "حدث خطأ غير متوقع.";
  return NextResponse.json({ success: false, message }, { status });
}

export async function GET(request, { params }) {
  try {
    const body = request.headers.get("x-telegram-init-data") || "";
    const { account } = await getAuthenticatedAccount(body);
    const { id } = await params;
    const task = await getTask(Number(id), account.id);

    if (!task) {
      return NextResponse.json({ success: false, message: "المهمة غير موجودة." }, { status: 404 });
    }

    return NextResponse.json({ success: true, task });
  } catch (error) {
    console.error("Task GET error:", error);
    return errorResponse(error);
  }
}


export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const { account } = await getAuthenticatedAccount(
      body?.initData || request.headers.get("x-telegram-init-data") || ""
    );
    const { id } = await params;
    const taskId = Number(id);
    const task = await getTask(taskId, account.id);

    if (!task) {
      return NextResponse.json({ success: false, message: "المهمة غير موجودة." }, { status: 404 });
    }

    const canEdit = await hasAnyPermission(account.id, ["tasks.edit"]);
    const isHead = await isDepartmentHeadForTask(account.id, task);

    if (!canEdit && !isHead) {
      return NextResponse.json({ success: false, message: "لا تملك صلاحية تعديل المهمة." }, { status: 403 });
    }

    const patch = {};
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) return NextResponse.json({ success: false, message: "عنوان المهمة مطلوب." }, { status: 400 });
      patch.title = title;
    }
    if (typeof body.description === "string") patch.description = body.description.trim();
    if (typeof body.priority === "string" && ["low", "normal", "high", "urgent"].includes(body.priority)) {
      patch.priority = body.priority;
    }
    if (body.dueAt) {
      const due = new Date(body.dueAt);
      if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) {
        return NextResponse.json({ success: false, message: "موعد التسليم يجب أن يكون في المستقبل." }, { status: 400 });
      }
      patch.due_at = due.toISOString();
    }
    if (body.startAt) {
      const start = new Date(body.startAt);
      if (Number.isNaN(start.getTime())) {
        return NextResponse.json({ success: false, message: "موعد بداية المهمة غير صالح." }, { status: 400 });
      }
      patch.start_at = start.toISOString();
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ success: false, message: "لا توجد تعديلات." }, { status: 400 });
    }

    patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", taskId)
      .select("*")
      .single();

    if (error) throw error;

    await addTaskHistory({
      taskId,
      accountId: account.id,
      action: "edited",
      oldValue: JSON.stringify({
        title: task.title,
        description: task.description,
        priority: task.priority,
        start_at: task.start_at,
        due_at: task.due_at
      }),
      newValue: JSON.stringify(patch)
    });

    await addAuditLog({
      accountId: account.id,
      actionType: "task.edited",
      entityType: "task",
      entityId: taskId,
      description: `تم تعديل المهمة #${taskId}`,
      oldValue: {
        title: task.title,
        priority: task.priority,
        due_at: task.due_at
      },
      newValue: patch
    });

    if (patch.due_at || patch.start_at) {
      await supabase
        .from("task_reminders")
        .delete()
        .eq("task_id", taskId)
        .eq("sent", false);

      const accountIds = (task.task_type === "distributed"
        ? (task.task_assignees || []).filter((row) => !row.removed_at).map((row) => row.account_id)
        : (task.task_departments || []).map((row) => row.responsible_account_id)
      ).filter(Boolean);

      await createAutomaticReminders(
        taskId,
        updated.due_at,
        updated.start_at,
        accountIds
      );
    }

    return NextResponse.json({ success: true, task: updated });
  } catch (error) {
    console.error("Task PATCH error:", error);
    return errorResponse(error);
  }
}
