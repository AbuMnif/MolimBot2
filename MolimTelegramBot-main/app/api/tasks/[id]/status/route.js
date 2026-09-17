import { NextResponse } from "next/server";
import {
  updateAssigneeStatus,
  updateDepartmentStatus,
  reopenTask,
  reviewTask
} from "../../../../../lib/task-service";
import { getAuthenticatedAccount } from "../../../../../lib/telegram-auth";

function errorResponse(error) {
  const map = {
    PERMISSION_DENIED: [403, "لا تملك الصلاحية المطلوبة."],
    TASK_NOT_FOUND: [404, "المهمة غير موجودة."],
    TASK_ASSIGNEE_NOT_FOUND: [404, "المكلف غير موجود في هذه المهمة."],
    TASK_DEPARTMENT_NOT_FOUND: [404, "القسم غير موجود في هذه المهمة."],
    REJECTION_REASON_REQUIRED: [400, "سبب الرفض مطلوب."],
    REOPEN_REASON_REQUIRED: [400, "سبب إعادة فتح المهمة مطلوب."],
    TASK_ITEMS_NOT_COMPLETED: [400, "لا يمكن إغلاق المهمة قبل إكمال جميع المكلفين أو الأقسام."],
    REVIEW_REASON_REQUIRED: [400, "سبب إعادة المهمة للتنفيذ مطلوب."]
  };
  const [status, message] = map[error?.code] || [500, "حدث خطأ غير متوقع."];
  return NextResponse.json({ success: false, message }, { status });
}

export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const { account } = await getAuthenticatedAccount(body?.initData || "");
    const { id } = await params;
    const taskId = Number(id);

    if (body?.reviewDecision) {
      const task = await reviewTask({
        actorId: account.id,
        taskId,
        decision: body.reviewDecision,
        reason: body.reason
      });
      return NextResponse.json({ success: true, task });
    }

    if (body?.reopen) {
      const task = await reopenTask({
        actorId: account.id,
        taskId,
        reason: body.reason
      });
      return NextResponse.json({ success: true, task });
    }

    if (body?.target === "department") {
      const task = await updateDepartmentStatus({
        actorId: account.id,
        taskId,
        departmentId: Number(body.departmentId),
        status: body.status,
        reason: body.reason
      });
      return NextResponse.json({ success: true, task });
    }

    const task = await updateAssigneeStatus({
      actorId: account.id,
      taskId,
      assigneeId: Number(body.assigneeId || account.id),
      status: body.status,
      reason: body.reason
    });

    return NextResponse.json({ success: true, task });
  } catch (error) {
    console.error("Task status PATCH error:", error);
    return errorResponse(error);
  }
}
