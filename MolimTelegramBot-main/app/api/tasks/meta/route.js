import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { getAuthenticatedAccount } from "../../../../lib/telegram-auth";
import { hasAnyPermission } from "../../../../lib/task-service";

export async function GET(request) {
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const { account } = await getAuthenticatedAccount(initData);

    const canCreate = await hasAnyPermission(account.id, ["tasks.create"]);
    if (!canCreate) {
      return NextResponse.json({ success: false, message: "لا تملك صلاحية إنشاء المهام." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const departmentIds = [...new Set(
      (searchParams.get("departmentIds") || "")
        .split(",")
        .map(Number)
        .filter(Number.isFinite)
    )];

    const { data: departments, error: departmentsError } = await supabase
      .from("departments")
      .select("id, name, description")
      .order("name", { ascending: true });

    if (departmentsError) throw departmentsError;

    let people = [];
    if (departmentIds.length) {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, display_name, username, telegram_user_id, status, department_id")
        .in("department_id", departmentIds)
        .eq("status", "active")
        .order("display_name", { ascending: true });

      if (error) throw error;
      people = data || [];
    }

    return NextResponse.json({ success: true, departments: departments || [], people });
  } catch (error) {
    console.error("Task meta GET error:", error);
    return NextResponse.json({ success: false, message: "تعذر تحميل بيانات المهام." }, { status: 500 });
  }
}
