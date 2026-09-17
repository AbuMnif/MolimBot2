import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "../../../../../lib/supabase";

function verifyTelegramWebAppData(initData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken || !initData) {
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get("hash");

        if (!hash) return null;

        params.delete("hash");

        const dataCheckString = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        const secretKey = crypto
            .createHmac("sha256", "WebAppData")
            .update(botToken)
            .digest();

        const calculatedHash = crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        if (calculatedHash.length !== hash.length) {
            return null;
        }

        if (
            !crypto.timingSafeEqual(
                Buffer.from(calculatedHash, "hex"),
                Buffer.from(hash, "hex")
            )
        ) {
            return null;
        }

        const userRaw = params.get("user");

        if (!userRaw) return null;

        return JSON.parse(userRaw);
    } catch {
        return null;
    }
}

async function getPermissions(accountId) {
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
                management_level
            )
        `)
        .eq("id", accountId)
        .maybeSingle();

    if (accountError || !account) {
        return {
            account: null,
            permissions: [],
            isSystemAdmin: false,
        };
    }

    const role = Array.isArray(account.roles)
        ? account.roles[0]
        : account.roles;

    const isSystemAdmin =
        role?.name === "system_admin" ||
        role?.name === "admin" ||
        role?.management_level === "system";

    if (isSystemAdmin) {
        return {
            account,
            permissions: ["*"],
            isSystemAdmin: true,
        };
    }

    if (!account.role_id) {
        return {
            account,
            permissions: [],
            isSystemAdmin: false,
        };
    }

    const { data: rolePermissions } = await supabase
        .from("role_permissions")
        .select(`
            permission_id,
            permissions (
                key
            )
        `)
        .eq("role_id", account.role_id);

    const permissions = (rolePermissions || [])
        .map((item) => item.permissions?.key)
        .filter(Boolean);

    return {
        account,
        permissions,
        isSystemAdmin: false,
    };
}

function hasPermission(permissions, ...keys) {
    return (
        permissions.includes("*") ||
        keys.some((key) => permissions.includes(key))
    );
}

async function authenticateAdmin(initData) {
    const telegramUser = verifyTelegramWebAppData(initData);

    if (!telegramUser?.id) {
        return {
            ok: false,
            error: "بيانات Telegram غير صالحة",
        };
    }

    const telegramUserId = String(telegramUser.id);

    const { data: allowedUser, error: allowedError } = await supabase
        .from("allowed_users")
        .select("telegram_user_id, status")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

    if (allowedError || !allowedUser) {
        return {
            ok: false,
            error: "هذا المستخدم غير مصرح له",
        };
    }

    if (
        allowedUser.status &&
        !["active", "enabled"].includes(
            String(allowedUser.status).toLowerCase()
        )
    ) {
        return {
            ok: false,
            error: "هذا المستخدم غير نشط",
        };
    }

    const { data: account, error: accountError } = await supabase
        .from("accounts")
        .select("id, status, role_id")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

    if (accountError || !account) {
        return {
            ok: false,
            error: "لا يوجد حساب مرتبط بهذا المستخدم",
        };
    }

    if (account.status !== "active") {
        return {
            ok: false,
            error: "الحساب غير نشط",
        };
    }

    const permissionData = await getPermissions(account.id);

    if (
        !hasPermission(
            permissionData.permissions,
            "manage_departments",
            "departments.manage",
            "departments.manage_members",
            "departments.edit",
            "admin.departments"
        )
    ) {
        return {
            ok: false,
            error: "ليس لديك صلاحية إدارة أعضاء الأقسام",
        };
    }

    return {
        ok: true,
        account,
        permissions: permissionData.permissions,
        isSystemAdmin: permissionData.isSystemAdmin,
    };
}

export async function POST(request) {
    try {
        const body = await request.json();

        const auth = await authenticateAdmin(body.initData);

        if (!auth.ok) {
            return NextResponse.json(
                {
                    success: false,
                    error: auth.error,
                },
                { status: 403 }
            );
        }

        const departmentId = Number(body.departmentId);
        const accountId = Number(body.accountId);
        const positionTitle =
            typeof body.positionTitle === "string"
                ? body.positionTitle.trim() || null
                : null;

        if (!departmentId || !accountId) {
            return NextResponse.json(
                {
                    success: false,
                    error: "بيانات القسم والعضو مطلوبة",
                },
                { status: 400 }
            );
        }

        const { data: department, error: departmentError } =
            await supabase
                .from("departments")
                .select("id, name")
                .eq("id", departmentId)
                .maybeSingle();

        if (departmentError || !department) {
            return NextResponse.json(
                {
                    success: false,
                    error: "القسم غير موجود",
                },
                { status: 404 }
            );
        }

        const { data: account, error: accountError } = await supabase
            .from("accounts")
            .select(
                "id, telegram_user_id, username, display_name, status"
            )
            .eq("id", accountId)
            .maybeSingle();

        if (accountError || !account) {
            return NextResponse.json(
                {
                    success: false,
                    error: "المستخدم غير موجود",
                },
                { status: 404 }
            );
        }

        if (account.status !== "active") {
            return NextResponse.json(
                {
                    success: false,
                    error: "لا يمكن إضافة حساب غير نشط",
                },
                { status: 400 }
            );
        }

        const { data: existing } = await supabase
            .from("department_members")
            .select("id")
            .eq("department_id", departmentId)
            .eq("account_id", accountId)
            .maybeSingle();

        if (existing) {
            return NextResponse.json(
                {
                    success: false,
                    error: "هذا المستخدم عضو بالفعل في القسم",
                },
                { status: 409 }
            );
        }

        const { data: membership, error: insertError } = await supabase
            .from("department_members")
            .insert({
                account_id: accountId,
                department_id: departmentId,
                position_title: positionTitle,
                is_head: false,
            })
            .select(`
                id,
                account_id,
                department_id,
                position_title,
                is_head,
                joined_at
            `)
            .single();

        if (insertError) {
            console.error(insertError);

            return NextResponse.json(
                {
                    success: false,
                    error: "تعذر إضافة العضو إلى القسم",
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            membership,
        });
    } catch (error) {
        console.error(error);

        return NextResponse.json(
            {
                success: false,
                error: "حدث خطأ غير متوقع",
            },
            { status: 500 }
        );
    }
}

export async function PATCH(request) {
    try {
        const body = await request.json();

        const auth = await authenticateAdmin(body.initData);

        if (!auth.ok) {
            return NextResponse.json(
                {
                    success: false,
                    error: auth.error,
                },
                { status: 403 }
            );
        }

        const membershipId = Number(body.membershipId);
        const action = body.action;

        if (!membershipId) {
            return NextResponse.json(
                {
                    success: false,
                    error: "معرف العضوية مطلوب",
                },
                { status: 400 }
            );
        }

        const { data: membership, error: membershipError } =
            await supabase
                .from("department_members")
                .select(
                    "id, account_id, department_id, position_title, is_head"
                )
                .eq("id", membershipId)
                .maybeSingle();

        if (membershipError || !membership) {
            return NextResponse.json(
                {
                    success: false,
                    error: "عضوية القسم غير موجودة",
                },
                { status: 404 }
            );
        }

        if (action === "set_head") {
            const { error: clearError } = await supabase
                .from("department_members")
                .update({
                    is_head: false,
                })
                .eq("department_id", membership.department_id)
                .eq("is_head", true);

            if (clearError) {
                console.error(clearError);

                return NextResponse.json(
                    {
                        success: false,
                        error: "تعذر تحديث رئيس القسم الحالي",
                    },
                    { status: 500 }
                );
            }

            const { data: updated, error: updateError } =
                await supabase
                    .from("department_members")
                    .update({
                        is_head: true,
                    })
                    .eq("id", membershipId)
                    .select()
                    .single();

            if (updateError) {
                console.error(updateError);

                return NextResponse.json(
                    {
                        success: false,
                        error: "تعذر تعيين رئيس القسم",
                    },
                    { status: 500 }
                );
            }

            return NextResponse.json({
                success: true,
                membership: updated,
            });
        }

        if (action === "remove_head") {
            const { data: updated, error: updateError } =
                await supabase
                    .from("department_members")
                    .update({
                        is_head: false,
                    })
                    .eq("id", membershipId)
                    .select()
                    .single();

            if (updateError) {
                console.error(updateError);

                return NextResponse.json(
                    {
                        success: false,
                        error: "تعذر إلغاء رئاسة القسم",
                    },
                    { status: 500 }
                );
            }

            return NextResponse.json({
                success: true,
                membership: updated,
            });
        }

        if (action === "update_position") {
            const positionTitle =
                typeof body.positionTitle === "string"
                    ? body.positionTitle.trim() || null
                    : null;

            const { data: updated, error: updateError } =
                await supabase
                    .from("department_members")
                    .update({
                        position_title: positionTitle,
                    })
                    .eq("id", membershipId)
                    .select()
                    .single();

            if (updateError) {
                console.error(updateError);

                return NextResponse.json(
                    {
                        success: false,
                        error: "تعذر تحديث المسمى الوظيفي",
                    },
                    { status: 500 }
                );
            }

            return NextResponse.json({
                success: true,
                membership: updated,
            });
        }

        return NextResponse.json(
            {
                success: false,
                error: "الإجراء غير معروف",
            },
            { status: 400 }
        );
    } catch (error) {
        console.error(error);

        return NextResponse.json(
            {
                success: false,
                error: "حدث خطأ غير متوقع",
            },
            { status: 500 }
        );
    }
}

export async function DELETE(request) {
    try {
        const body = await request.json();

        const auth = await authenticateAdmin(body.initData);

        if (!auth.ok) {
            return NextResponse.json(
                {
                    success: false,
                    error: auth.error,
                },
                { status: 403 }
            );
        }

        const membershipId = Number(body.membershipId);

        if (!membershipId) {
            return NextResponse.json(
                {
                    success: false,
                    error: "معرف العضوية مطلوب",
                },
                { status: 400 }
            );
        }

        const { data: membership, error: membershipError } =
            await supabase
                .from("department_members")
                .select("id, account_id, department_id")
                .eq("id", membershipId)
                .maybeSingle();

        if (membershipError || !membership) {
            return NextResponse.json(
                {
                    success: false,
                    error: "عضوية القسم غير موجودة",
                },
                { status: 404 }
            );
        }

        const { error: deleteError } = await supabase
            .from("department_members")
            .delete()
            .eq("id", membershipId);

        if (deleteError) {
            console.error(deleteError);

            return NextResponse.json(
                {
                    success: false,
                    error: "تعذر إزالة العضو من القسم",
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "تمت إزالة العضو من القسم بنجاح",
        });
    } catch (error) {
        console.error(error);

        return NextResponse.json(
            {
                success: false,
                error: "حدث خطأ غير متوقع",
            },
            { status: 500 }
        );
    }
}
