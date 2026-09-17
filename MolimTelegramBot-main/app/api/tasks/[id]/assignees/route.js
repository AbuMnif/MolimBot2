import { NextResponse } from "next/server";
import { getAuthenticatedAccount } from "../../../../../lib/telegram-auth";
import { getTask, removeTaskAssignee } from "../../../../../lib/task-service";

function errorResponse(error) {
  const map = {
    PERMISSION_DENIED: [403, "لا تملك صلاحية إدارة المكلفين."],
    TASK_NOT_FOUND: [404, "المهمة غير موجودة."],
    TASK_ASSIGNEE_NOT_FOUND: [404, "المكلف غير موجود في المهمة."],
    REMOVAL_REASON_REQUIRED: [400, "سبب الاستبعاد مطلوب."]
  };
  const [status, message] = map[error?.code] || [500, "حدث خطأ غير متوقع."];
  return NextResponse.json({ success: false, message }, { status });
}

export async function GET(request, { params }) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { account } = await getAuthenticatedAccount(initData);
    const { id } = await params;
    const task = await getTask(Number(id), account.id);

    if (!task) {
      return NextResponse.json({ success: false, message: "المهمة غير موجودة." }, { status: 404 });
    }

    return NextResponse.json({ success: true, assignees: task.task_assignees || [] });
  } catch (error) {
    console.error("Task assignees GET error:", error);
    return errorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const body = await request.json();
    const initData = body?.initData || request.headers.get("x-telegram-init-data") || "";
    const { account } = await getAuthenticatedAccount(initData);
    const { id } = await params;

    const task = await removeTaskAssignee({
      actorId: account.id,
      taskId: Number(id),
      assigneeId: Number(body.assigneeId),
      reason: body.reason
    });

    return NextResponse.json({ success: true, task });
  } catch (error) {
    console.error("Task assignee DELETE error:", error);
    return errorResponse(error);
  }
}
