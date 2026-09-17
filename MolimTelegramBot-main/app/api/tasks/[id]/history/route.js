import { NextResponse } from "next/server";
import { getTask } from "../../../../../lib/task-service";
import { getAuthenticatedAccount } from "../../../../../lib/telegram-auth";

export async function GET(request, { params }) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { account } = await getAuthenticatedAccount(initData);
    const { id } = await params;
    const task = await getTask(Number(id), account.id);

    if (!task) {
      return NextResponse.json({ success: false, message: "المهمة غير موجودة." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      history: task.task_history || []
    });
  } catch (error) {
    console.error("Task history GET error:", error);
    return NextResponse.json(
      { success: false, message: error?.code === "TASK_ACCESS_DENIED" ? "لا تملك صلاحية مشاهدة سجل هذه المهمة." : "حدث خطأ غير متوقع." },
      { status: error?.code === "TASK_ACCESS_DENIED" ? 403 : 500 }
    );
  }
}
