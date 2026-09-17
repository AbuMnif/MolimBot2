import { NextResponse } from "next/server";
import {
  createTask,
  listTasks,
  TASK_TYPES,
  PRIORITIES
} from "../../../lib/task-service";
import { getAuthenticatedAccount } from "../../../lib/telegram-auth";

function errorResponse(error) {
  const map = {
    INVALID_TELEGRAM_AUTH: [401, "بيانات Telegram غير صالحة."],
    ACCESS_DENIED: [403, "ليس لديك صلاحية الدخول."],
    ACCOUNT_NOT_FOUND: [404, "الحساب غير موجود."],
    ACCOUNT_INACTIVE: [403, "الحساب غير نشط."],
    PERMISSION_DENIED: [403, "لا تملك الصلاحية المطلوبة."],
    TASK_TITLE_REQUIRED: [400, "عنوان المهمة مطلوب."],
    TASK_DUE_REQUIRED: [400, "موعد انتهاء المهمة مطلوب."],
    TASK_DEPARTMENT_REQUIRED: [400, "يجب تحديد قسم واحد على الأقل."],
    TASK_ASSIGNEE_REQUIRED: [400, "يجب تحديد مسؤول واحد على الأقل."],
    REJECTION_REASON_REQUIRED: [400, "سبب الرفض مطلوب."],
    REOPEN_REASON_REQUIRED: [400, "سبب إعادة فتح المهمة مطلوب."]
  };

  const [status, message] = map[error?.code] || [500, "حدث خطأ غير متوقع."];
  return NextResponse.json({ success: false, message }, { status });
}

export async function GET(request) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { account } = await getAuthenticatedAccount(initData);
    const { searchParams } = new URL(request.url);

    const tasks = await listTasks(account.id, {
      status: searchParams.get("status") || null,
      taskType: searchParams.get("taskType") || null,
      priority: searchParams.get("priority") || null,
      limit: searchParams.get("limit") || 100
    });

    return NextResponse.json({ success: true, tasks });
  } catch (error) {
    console.error("Tasks GET error:", error);
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { account } = await getAuthenticatedAccount(body?.initData || "");

    if (body?.taskType && !Object.values(TASK_TYPES).includes(body.taskType)) {
      return NextResponse.json({ success: false, message: "نوع المهمة غير صالح." }, { status: 400 });
    }

    if (body?.priority && !PRIORITIES.includes(body.priority)) {
      return NextResponse.json({ success: false, message: "أولوية المهمة غير صالحة." }, { status: 400 });
    }

    const result = await createTask({
      actorId: account.id,
      title: body.title,
      description: body.description,
      taskType: body.taskType,
      priority: body.priority,
      startAt: body.startAt,
      dueAt: body.dueAt,
      departmentIds: body.departmentIds,
      assignees: body.assignees,
      assigneeIds: body.assigneeIds
    });

    return NextResponse.json({
      success: true,
      task: result.task,
      assignees: result.assignees,
      departments: result.departments
    });
  } catch (error) {
    console.error("Tasks POST error:", error);
    return errorResponse(error);
  }
}
