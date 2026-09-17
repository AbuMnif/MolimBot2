import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "../../../../lib/supabase";

/* =========================================================
   TELEGRAM WEB APP AUTH
========================================================= */

function verifyTelegramWebAppData(initData) {
    try {
        if (!initData || typeof initData !== "string") {
            return null;
        }

        const params = new URLSearchParams(initData);
        const hash = params.get("hash");

        if (!hash) {
            return null;
        }

        const dataCheckString = [...params.entries()]
            .filter(([key]) => key !== "hash")
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        if (!botToken) {
            console.error("TELEGRAM_BOT_TOKEN is missing");
            return null;
        }

        const secretKey = crypto
            .createHmac("sha256", "WebAppData")
            .update(botToken)
            .digest();

        const calculatedHash = crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        if (
            calculatedHash.length !== hash.length ||
            !crypto.timingSafeEqual(
                Buffer.from(calculatedHash),
                Buffer.from(hash)
            )
        ) {
            return null;
        }

        const userRaw = params.get("user");

        if (!userRaw) {
            return null;
        }

        return JSON.parse(userRaw);
    } catch (error) {
        console.error("Telegram auth error:", error);
        return null;
    }
}

/* =========================================================
   PERMISSIONS
========================================================= */

async function getUserPermissions(accountId) {
    const { data: account, error: accountError } = await supabase
        .from("accounts")
        .select(`
            id,
            telegram_user_id,
            status,
            role_id,
            roles (
                id,
                name,
                label,
                management_level
            )
        `)
        .eq("id", accountId)
        .maybeSingle();

    if (accountError || !account) {
        return {
            account: null,
            permissions: [],
        };
    }

    const roleName = account.roles?.name || "";

    // مسؤول النظام لديه جميع الصلاحيات
    if (
        roleName === "system_admin" ||
        roleName === "admin" ||
        account.roles?.management_level === "system"
    ) {
        return {
            account,
            permissions: ["*"],
        };
    }

    if (!account.role_id) {
        return {
            account,
            permissions: [],
        };
    }

    const { data: rolePermissions, error } = await supabase
        .from("role_permissions")
        .select(`
            permissions (
                key
            )
        `)
        .eq("role_id", account.role_id);

    if (error) {
        console.error("Permissions error:", error);

        return {
            account,
            permissions: [],
        };
    }

    const permissions = (rolePermissions || [])
        .map((item) => item.permissions?.key)
        .filter(Boolean);

    return {
        account,
        permissions,
    };
}

function hasPermission(permissions, keys) {
    if (!Array.isArray(permissions)) {
        return false;
    }

    if (permissions.includes("*")) {
        return true;
    }

    const required = Array.isArray(keys) ? keys : [keys];

    return required.some((key) => permissions.includes(key));
}

/* =========================================================
   ADMIN AUTHENTICATION
========================================================= */

async function authenticateAdmin(initData) {
    const telegramUser = verifyTelegramWebAppData(initData);

    if (!telegramUser?.id) {
        return null;
    }

    const telegramUserId = String(telegramUser.id);

    const { data: allowedUser, error: allowedError } = await supabase
        .from("allowed_users")
        .select("telegram_user_id, status")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

    if (allowedError || !allowedUser) {
        return null;
    }

    if (allowedUser.status !== "active") {
        return null;
    }

    const { data: account, error: accountError } = await supabase
        .from("accounts")
        .select(`
            id,
            telegram_user_id,
            username,
            display_name,
            status,
            role_id,
            roles (
                id,
                name,
                label,
                management_level
            )
        `)
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

    if (accountError || !account) {
        return null;
    }

    if (account.status !== "active") {
        return null;
    }

    const permissionData = await getUserPermissions(account.id);

    const permissions = permissionData.permissions;

    const isSystemAdmin =
        account.roles?.name === "system_admin" ||
        account.roles?.name === "admin" ||
        account.roles?.management_level === "system";

    const canManageDepartments =
        isSystemAdmin ||
        hasPermission(permissions, [
            "manage_departments",
            "departments.manage",
            "departments.view",
        ]);

    if (!canManageDepartments) {
        return null;
    }

    return {
        telegramUser,
        account,
        permissions,
        isSystemAdmin,
    };
}

/* =========================================================
   GET DEPARTMENTS
========================================================= */

export async function GET(request) {
    try {
        const initData = request.headers.get("x-telegram-init-data") || "";

        const admin = await authenticateAdmin(initData);

        if (!admin) {
            return NextResponse.json(
                {
                    success: false,
                    message: "غير مصرح لك بإدارة الأقسام.",
                },
                { status: 403 }
            );
        }

        /* =====================================================
           LOAD DEPARTMENTS
        ===================================================== */

        const { data: departments, error: departmentsError } = await supabase
            .from("departments")
            .select(`
                id,
                name,
                description,
                telegram_chat_id,
                created_at,
                updated_at
            `)
            .order("name", { ascending: true });

        if (departmentsError) {
            console.error("Departments load error:", departmentsError);

            return NextResponse.json(
                {
                    success: false,
                    message: "تعذر تحميل الأقسام.",
                },
                { status: 500 }
            );
        }

        const departmentIds = (departments || []).map(
            (department) => department.id
        );

        /* =====================================================
           LOAD DEPARTMENT MEMBERS
        ===================================================== */

        let members = [];

        if (departmentIds.length > 0) {
            const { data: memberRows, error: membersError } = await supabase
                .from("department_members")
                .select(`
                    id,
                    account_id,
                    department_id,
                    position_title,
                    is_head,
                    joined_at,
                    accounts (
                        id,
                        telegram_user_id,
                        username,
                        display_name,
                        status
                    )
                `)
                .in("department_id", departmentIds)
                .order("joined_at", { ascending: true });

            if (membersError) {
                console.error(
                    "Department members load error:",
                    membersError
                );

                return NextResponse.json(
                    {
                        success: false,
                        message: "تعذر تحميل أعضاء الأقسام.",
                    },
                    { status: 500 }
                );
            }

            members = memberRows || [];
        }

        /* =====================================================
           LOAD ACTIVE ACCOUNTS

           هذه القائمة تستخدمها صفحة تفاصيل القسم
           لإضافة أعضاء جدد.

           نحمّل جميع الحسابات النشطة، ثم نستبعد فقط
           الحسابات الموجودة بالفعل في نفس القسم.

           يسمح ذلك للشخص بأن يكون عضوًا في أكثر من قسم.
        ===================================================== */

        const { data: activeAccounts, error: accountsError } = await supabase
            .from("accounts")
            .select(`
                id,
                telegram_user_id,
                username,
                display_name,
                status,
                department_id,
                role_id,
                roles (
                    id,
                    name,
                    label,
                    management_level
                )
            `)
            .eq("status", "active")
            .order("display_name", { ascending: true });

        if (accountsError) {
            console.error("Active accounts load error:", accountsError);

            return NextResponse.json(
                {
                    success: false,
                    message: "تعذر تحميل حسابات المستخدمين.",
                },
                { status: 500 }
            );
        }

        /* =====================================================
           FORMAT DEPARTMENTS
        ===================================================== */

        const formattedDepartments = (departments || []).map((department) => {
            const departmentMembers = members.filter(
                (member) => member.department_id === department.id
            );

            const head = departmentMembers.find(
                (member) => member.is_head === true
            );

            return {
                id: department.id,
                name: department.name,
                description: department.description || "",
                telegramChatId: department.telegram_chat_id || "",
                createdAt: department.created_at,
                updatedAt: department.updated_at,

                memberCount: departmentMembers.length,

                head: head
                    ? {
                          id: head.account_id,
                          membershipId: head.id,
                          displayName:
                              head.accounts?.display_name ||
                              head.accounts?.username ||
                              "بدون اسم",
                          username: head.accounts?.username || "",
                          positionTitle: head.position_title || "",
                      }
                    : null,

                members: departmentMembers.map((member) => ({
                    id: member.id,
                    accountId: member.account_id,
                    departmentId: member.department_id,
                    positionTitle: member.position_title || "",
                    isHead: Boolean(member.is_head),
                    joinedAt: member.joined_at,

                    account: member.accounts
                        ? {
                              id: member.accounts.id,
                              telegramUserId:
                                  member.accounts.telegram_user_id,
                              username: member.accounts.username,
                              displayName:
                                  member.accounts.display_name ||
                                  member.accounts.username,
                              status: member.accounts.status,
                          }
                        : null,
                })),
            };
        });

        /* =====================================================
           AVAILABLE ACCOUNTS

           الحسابات التي ليست عضوًا بالفعل في القسم
           يمكن إضافتها من صفحة تفاصيل القسم.

           لا نستبعد الأشخاص المنتمين إلى قسم آخر،
           لأن النظام يسمح للشخص بالانضمام لأكثر من قسم.
        ===================================================== */

        const formattedAccounts = (activeAccounts || []).map((account) => ({
            id: account.id,
            telegramUserId: account.telegram_user_id,
            username: account.username,
            displayName:
                account.display_name ||
                account.username ||
                "بدون اسم",
            status: account.status,
            departmentId: account.department_id || null,
            role: account.roles
                ? {
                      id: account.roles.id,
                      name: account.roles.name,
                      label: account.roles.label,
                      managementLevel:
                          account.roles.management_level,
                  }
                : null,
        }));

        return NextResponse.json({
            success: true,
            departments: formattedDepartments,
            accounts: formattedAccounts,
        });
    } catch (error) {
        console.error("Departments GET error:", error);

        return NextResponse.json(
            {
                success: false,
                message: "حدث خطأ غير متوقع.",
            },
            { status: 500 }
        );
    }
}

/* =========================================================
   CREATE DEPARTMENT
========================================================= */

export async function POST(request) {
    try {
        const body = await request.json();

        const initData = String(body?.initData || "").trim();
        const name = String(body?.name || "").trim();
        const description = String(body?.description || "").trim();
        const telegramChatId = String(
            body?.telegramChatId || ""
        ).trim();

        const admin = await authenticateAdmin(initData);

        if (!admin) {
            return NextResponse.json(
                {
                    success: false,
                    message: "غير مصرح لك.",
                },
                { status: 403 }
            );
        }

        if (
            !admin.isSystemAdmin &&
            !hasPermission(admin.permissions, [
                "manage_departments",
                "departments.manage",
                "departments.create",
            ])
        ) {
            return NextResponse.json(
                {
                    success: false,
                    message: "لا تملك صلاحية إضافة الأقسام.",
                },
                { status: 403 }
            );
        }

        if (!name) {
            return NextResponse.json(
                {
                    success: false,
                    message: "اسم القسم مطلوب.",
                },
                { status: 400 }
            );
        }

        if (name.length > 100) {
            return NextResponse.json(
                {
                    success: false,
                    message: "اسم القسم طويل جدًا.",
                },
                { status: 400 }
            );
        }

        const { data: existingDepartment, error: existingError } =
            await supabase
                .from("departments")
                .select("id, name")
                .eq("name", name)
                .maybeSingle();

        if (existingError) {
            console.error("Existing department error:", existingError);

            return NextResponse.json(
                {
                    success: false,
                    message: "تعذر التحقق من اسم القسم.",
                },
                { status: 500 }
            );
        }

        if (existingDepartment) {
            return NextResponse.json(
                {
                    success: false,
                    message: "يوجد قسم بهذا الاسم بالفعل.",
                },
                { status: 409 }
            );
        }

        if (telegramChatId) {
            const { data: existingTelegramDepartment } = await supabase
                .from("departments")
                .select("id, name")
                .eq("telegram_chat_id", telegramChatId)
                .maybeSingle();

            if (existingTelegramDepartment) {
                return NextResponse.json(
                    {
                        success: false,
                        message: `مجموعة Telegram مرتبطة مسبقًا بالقسم: ${existingTelegramDepartment.name}`,
                    },
                    { status: 409 }
                );
            }
        }

        const { data: department, error } = await supabase
            .from("departments")
            .insert({
                name,
                description: description || null,
                telegram_chat_id: telegramChatId || null,
            })
            .select(`
                id,
                name,
                description,
                telegram_chat_id,
                created_at,
                updated_at
            `)
            .single();

        if (error) {
            console.error("Department create error:", error);

            return NextResponse.json(
                {
                    success: false,
                    message: "تعذر إنشاء القسم.",
                },
                { status: 500 }
            );
        }

        return NextResponse.json(
            {
                success: true,
                message: "تم إنشاء القسم بنجاح.",
                department,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error("Departments POST error:", error);

        return NextResponse.json(
            {
                success: false,
                message: "حدث خطأ غير متوقع.",
            },
            { status: 500 }
        );
    }
}

/* =========================================================
   UPDATE DEPARTMENT
========================================================= */

export async function PATCH(request) {
    try {
        const body = await request.json();

        const initData = String(body?.initData || "").trim();
        const departmentId = Number(body?.departmentId);

        const name =
            body?.name !== undefined
                ? String(body.name).trim()
                : undefined;

        const description =
            body?.description !== undefined
                ? String(body.description).trim()
                : undefined;

        const telegramChatId =
            body?.telegramChatId !== undefined
                ? String(body.telegramChatId).trim()
                : undefined;

        const admin = await authenticateAdmin(initData);

        if (!admin) {
            return NextResponse.json(
                {
                    success: false,
                    message: "غير مصرح لك.",
                },
                { status: 403 }
            );
        }

        if (
            !admin.isSystemAdmin &&
            !hasPermission(admin.permissions, [
                "manage_departments",
                "departments.manage",
                "departments.edit",
            ])
        ) {
            return NextResponse.json(
                {
                    success: false,
                    message: "لا تملك صلاحية تعديل الأقسام.",
                },
                { status: 403 }
            );
        }

        if (!Number.isInteger(departmentId) || departmentId <= 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: "معرف القسم غير صحيح.",
                },
                { status: 400 }
            );
        }

        const { data: currentDepartment, error: currentError } =
            await supabase
                .from("departments")
                .select(`
                    id,
                    name,
                    description,
                    telegram_chat_id
                `)
                .eq("id", departmentId)
                .maybeSingle();

        if (currentError) {
            console.error("Department lookup error:", currentError);

            return NextResponse.json(
                {
                    success: false,
                    message: "تعذر تحميل القسم.",
                },
                { status: 500 }
            );
        }

        if (!currentDepartment) {
            return NextResponse.json(
                {
                    success: false,
                    message: "القسم غير موجود.",
                },
                { status: 404 }
            );
        }

        if (name !== undefined && !name) {
            return NextResponse.json(
                {
                    success: false,
                    message: "اسم القسم مطلوب.",
                },
                { status: 400 }
            );
        }

        if (name !== undefined && name.length > 100) {
            return NextResponse.json(
                {
                    success: false,
                    message: "اسم القسم طويل جدًا.",
                },
                { status: 400 }
            );
        }

        if (name !== undefined && name !== currentDepartment.name) {
            const { data: duplicateName } = await supabase
                .from("departments")
                .select("id")
                .eq("name", name)
                .neq("id", departmentId)
                .maybeSingle();

            if (duplicateName) {
                return NextResponse.json(
                    {
                        success: false,
                        message: "يوجد قسم آخر بهذا الاسم.",
                    },
                    { status: 409 }
                );
            }
        }

        if (
            telegramChatId !== undefined &&
            telegramChatId &&
            telegramChatId !== currentDepartment.telegram_chat_id
        ) {
            const { data: duplicateTelegram } = await supabase
                .from("departments")
                .select("id, name")
                .eq("telegram_chat_id", telegramChatId)
                .neq("id", departmentId)
                .maybeSingle();

            if (duplicateTelegram) {
                return NextResponse.json(
                    {
                        success: false,
                        message: `مجموعة Telegram مرتبطة بالقسم: ${duplicateTelegram.name}`,
                    },
                    { status: 409 }
                );
            }
        }

        const updates = {};

        if (name !== undefined) {
            updates.name = name;
        }

        if (description !== undefined) {
            updates.description = description || null;
        }

        if (telegramChatId !== undefined) {
            updates.telegram_chat_id = telegramChatId || null;
        }

        const { data: department, error } = await supabase
            .from("departments")
            .update(updates)
            .eq("id", departmentId)
            .select(`
                id,
                name,
                description,
                telegram_chat_id,
                created_at,
                updated_at
            `)
            .single();

        if (error) {
            console.error("Department update error:", error);

            return NextResponse.json(
                {
                    success: false,
                    message: "تعذر تعديل القسم.",
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "تم تعديل القسم بنجاح.",
            department,
        });
    } catch (error) {
        console.error("Departments PATCH error:", error);

        return NextResponse.json(
            {
                success: false,
                message: "حدث خطأ غير متوقع.",
            },
            { status: 500 }
        );
    }
}

/* =========================================================
   DELETE DEPARTMENT
========================================================= */

export async function DELETE(request) {
    try {
        const body = await request.json();

        const initData = String(body?.initData || "").trim();
        const departmentId = Number(body?.departmentId);

        const admin = await authenticateAdmin(initData);

        if (!admin) {
            return NextResponse.json(
                {
                    success: false,
                    message: "غير مصرح لك.",
                },
                { status: 403 }
            );
        }

        if (
            !admin.isSystemAdmin &&
            !hasPermission(admin.permissions, [
                "manage_departments",
                "departments.manage",
                "departments.delete",
            ])
        ) {
            return NextResponse.json(
                {
                    success: false,
                    message: "لا تملك صلاحية حذف الأقسام.",
                },
                { status: 403 }
            );
        }

        if (!Number.isInteger(departmentId) || departmentId <= 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: "معرف القسم غير صحيح.",
                },
                { status: 400 }
            );
        }

        const { data: department, error: departmentError } = await supabase
            .from("departments")
            .select("id, name")
            .eq("id", departmentId)
            .maybeSingle();

        if (departmentError) {
            console.error(
                "Department delete lookup error:",
                departmentError
            );

            return NextResponse.json(
                {
                    success: false,
                    message: "تعذر تحميل القسم.",
                },
                { status: 500 }
            );
        }

        if (!department) {
            return NextResponse.json(
                {
                    success: false,
                    message: "القسم غير موجود.",
                },
                { status: 404 }
            );
        }

        // إزالة عضويات القسم أولًا
        const { error: membersDeleteError } = await supabase
            .from("department_members")
            .delete()
            .eq("department_id", departmentId);

        if (membersDeleteError) {
            console.error(
                "Department members delete error:",
                membersDeleteError
            );

            return NextResponse.json(
                {
                    success: false,
                    message:
                        "تعذر حذف أعضاء القسم المرتبطين به. لم يتم حذف القسم.",
                },
                { status: 409 }
            );
        }

        // إزالة القسم الرئيسي من الحسابات التي تستخدمه
        const { error: accountsUpdateError } = await supabase
            .from("accounts")
            .update({
                department_id: null,
            })
            .eq("department_id", departmentId);

        if (accountsUpdateError) {
            console.error(
                "Department account relation cleanup error:",
                accountsUpdateError
            );

            return NextResponse.json(
                {
                    success: false,
                    message:
                        "تعذر إزالة ارتباط القسم من حسابات المستخدمين.",
                },
                { status: 409 }
            );
        }

        const { error: deleteError } = await supabase
            .from("departments")
            .delete()
            .eq("id", departmentId);

        if (deleteError) {
            console.error("Department delete error:", deleteError);

            return NextResponse.json(
                {
                    success: false,
                    message:
                        "تعذر حذف القسم. قد توجد سجلات أخرى مرتبطة به.",
                },
                { status: 409 }
            );
        }

        return NextResponse.json({
            success: true,
            message: `تم حذف قسم ${department.name} بنجاح.`,
        });
    } catch (error) {
        console.error("Departments DELETE error:", error);

        return NextResponse.json(
            {
                success: false,
                message: "حدث خطأ غير متوقع.",
            },
            { status: 500 }
        );
    }
}
