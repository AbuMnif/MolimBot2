import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "../../../../lib/supabase";

/*
========================================================
VERIFY TELEGRAM WEB APP DATA
========================================================
*/

function verifyTelegramWebAppData(initData) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken || !initData) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
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

  if (
    receivedHash.length !== calculatedHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash, "hex"),
      Buffer.from(receivedHash, "hex")
    )
  ) {
    return null;
  }

  const userData = params.get("user");

  if (!userData) {
    return null;
  }

  try {
    return JSON.parse(userData);
  } catch {
    return null;
  }
}

/*
========================================================
GET USER PERMISSIONS
========================================================

مصدر الصلاحيات:

1. صلاحيات الدور role_permissions
2. صلاحيات الحساب المباشرة account_permissions
   - allow
   - deny

الـdeny المباشر يلغي الصلاحية القادمة من الدور.
========================================================
*/

async function getUserPermissions(accountId) {
  const {
    data: account,
    error: accountError
  } = await supabase
    .from("accounts")
    .select("id, role_id, status")
    .eq("id", accountId)
    .maybeSingle();

  if (accountError || !account) {
    return {
      account: null,
      permissions: []
    };
  }

  if (account.status !== "active") {
    return {
      account,
      permissions: []
    };
  }

  /*
  ------------------------------------------
  Role permissions
  ------------------------------------------
  */

  let rolePermissions = [];

  if (account.role_id) {
    const {
      data,
      error
    } = await supabase
      .from("role_permissions")
      .select(`
        permission_id,
        permissions (
          id,
          name,
          code
        )
      `)
      .eq(
        "role_id",
        account.role_id
      );

    if (error) {
      console.error(
        "Role permissions error:",
        error
      );
    } else {
      rolePermissions =
        (data || [])
          .map(
            (item) =>
              item.permissions
          )
          .filter(Boolean);
    }
  }

  /*
  ------------------------------------------
  Account-specific permissions
  ------------------------------------------
  */

  const {
    data: accountPermissions,
    error: accountPermissionsError
  } = await supabase
    .from("account_permissions")
    .select(`
      permission_id,
      effect,
      permissions (
        id,
        name,
        code
      )
    `)
    .eq(
      "account_id",
      accountId
    );

  if (accountPermissionsError) {
    console.error(
      "Account permissions error:",
      accountPermissionsError
    );
  }

  /*
  ------------------------------------------
  Build effective permissions
  ------------------------------------------
  */

  const permissionMap = new Map();

  /*
  Role permissions first
  */

  for (const permission of rolePermissions) {
    if (!permission) continue;

    const key =
      permission.id ??
      permission.code ??
      permission.name;

    permissionMap.set(
      key,
      permission
    );
  }

  /*
  Account overrides
  */

  for (const item of accountPermissions || []) {
    const permission =
      item.permissions;

    if (!permission) continue;

    const key =
      permission.id ??
      permission.code ??
      permission.name;

    if (item.effect === "allow") {
      permissionMap.set(
        key,
        permission
      );
    }

    if (item.effect === "deny") {
      permissionMap.delete(key);
    }
  }

  return {
    account,
    permissions:
      [...permissionMap.values()]
  };
}

/*
========================================================
CHECK SYSTEM ADMIN
========================================================
*/

async function isSystemAdminRole(roleId) {
  if (!roleId) {
    return false;
  }

  const {
    data: role,
    error
  } = await supabase
    .from("roles")
    .select(
      "id, name, label, management_level"
    )
    .eq(
      "id",
      roleId
    )
    .maybeSingle();

  if (error) {
    console.error(
      "System admin role check error:",
      error
    );

    return false;
  }

  return (
    role?.name ===
    "system_admin"
  );
}

/*
========================================================
CHECK ADMIN ACCESS
========================================================
*/

async function authenticateAdmin(initData) {
  const telegramUser =
    verifyTelegramWebAppData(
      initData
    );

  if (!telegramUser?.id) {
    return {
      success: false,
      status: 401,
      message:
        "Invalid Telegram authentication."
    };
  }

  const telegramUserId =
    String(telegramUser.id);

  /*
  ------------------------------------------
  Check allowed user
  ------------------------------------------
  */

  const {
    data: allowedUser,
    error: allowedError
  } = await supabase
    .from("allowed_users")
    .select(
      "id, telegram_user_id, status"
    )
    .eq(
      "telegram_user_id",
      telegramUserId
    )
    .maybeSingle();

  if (allowedError) {
    console.error(
      "Allowed user error:",
      allowedError
    );

    return {
      success: false,
      status: 500,
      message:
        "Database error."
    };
  }

  if (
    !allowedUser ||
    allowedUser.status !==
      "active"
  ) {
    return {
      success: false,
      status: 403,
      message:
        "Access denied."
    };
  }

  /*
  ------------------------------------------
  Get account
  ------------------------------------------
  */

  const {
    data: account,
    error: accountError
  } = await supabase
    .from("accounts")
    .select(`
      id,
      telegram_user_id,
      role_id,
      status
    `)
    .eq(
      "telegram_user_id",
      telegramUserId
    )
    .maybeSingle();

  if (accountError) {
    console.error(
      "Account error:",
      accountError
    );

    return {
      success: false,
      status: 500,
      message:
        "Database error."
    };
  }

  if (!account) {
    return {
      success: false,
      status: 403,
      message:
        "Account not found."
    };
  }

  if (
    account.status !==
    "active"
  ) {
    return {
      success: false,
      status: 403,
      message:
        "Account is inactive."
    };
  }

  /*
  ------------------------------------------
  Get effective permissions
  ------------------------------------------
  */

  const {
    permissions
  } = await getUserPermissions(
    account.id
  );

  /*
  ------------------------------------------
  Check user management permission
  ------------------------------------------
  */

  const hasUserManagementPermission =
    permissions.some(
      (permission) =>
        permission.code ===
          "manage_users" ||
        permission.code ===
          "users.manage" ||
        permission.code ===
          "admin.users"
    );

  /*
  ------------------------------------------
  Check permissions management permission
  ------------------------------------------
  */

  const hasPermissionManagementPermission =
    permissions.some(
      (permission) =>
        permission.code ===
          "manage_permissions" ||
        permission.code ===
          "permissions.manage" ||
        permission.code ===
          "admin.permissions" ||
        permission.code ===
          "system.permissions"
    );

  /*
  ------------------------------------------
  System admin fallback
  ------------------------------------------
  */

  const isSystemAdmin =
    await isSystemAdminRole(
      account.role_id
    );

  /*
  ------------------------------------------
  Final access
  ------------------------------------------
  */

  if (
    !hasUserManagementPermission &&
    !hasPermissionManagementPermission &&
    !isSystemAdmin
  ) {
    return {
      success: false,
      status: 403,
      message:
        "ليس لديك صلاحية إدارة المستخدمين."
    };
  }

  return {
    success: true,
    telegramUser,
    account,
    isSystemAdmin,
    hasUserManagementPermission,
    hasPermissionManagementPermission
  };
}

/*
========================================================
FORMAT USER
========================================================
*/

async function formatUser(
  account
) {
  if (!account) {
    return null;
  }

  let department = null;
  let role = null;

  /*
  ------------------------------------------
  Department
  ------------------------------------------
  */

  if (account.department_id) {
    const {
      data: departmentData
    } = await supabase
      .from("departments")
      .select(
        "id, name"
      )
      .eq(
        "id",
        account.department_id
      )
      .maybeSingle();

    department =
      departmentData ||
      null;
  }

  /*
  ------------------------------------------
  Role
  ------------------------------------------
  */

  if (account.role_id) {
    const {
      data: roleData
    } = await supabase
      .from("roles")
      .select(`
        id,
        name,
        label,
        management_level
      `)
      .eq(
        "id",
        account.role_id
      )
      .maybeSingle();

    if (roleData) {
      role = {
        id:
          roleData.id,

        name:
          roleData.name,

        label:
          roleData.label ||
          roleData.name ||
          "",

        managementLevel:
          roleData.management_level ||
          null,

        code:
          roleData.name ||
          null
      };
    }
  }

  return {
    id:
      account.id,

    telegramUserId:
      account.telegram_user_id,

    username:
      account.username,

    displayName:
      account.display_name,

    status:
      account.status,

    createdAt:
      account.created_at,

    department,

    role
  };
}

/*
========================================================
POST = LOAD USERS
========================================================
*/

export async function POST(
  request
) {
  try {
    const body =
      await request.json();

    const auth =
      await authenticateAdmin(
        body?.initData
      );

    if (!auth.success) {
      return NextResponse.json(
        {
          success: false,
          message:
            auth.message
        },
        {
          status:
            auth.status
        }
      );
    }

    const {
      data: accounts,
      error: accountsError
    } = await supabase
      .from("accounts")
      .select(`
        id,
        telegram_user_id,
        username,
        display_name,
        department_id,
        role_id,
        status,
        created_at
      `)
      .order(
        "created_at",
        {
          ascending: false
        }
      );

    if (accountsError) {
      console.error(
        "Accounts error:",
        accountsError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر تحميل المستخدمين."
        },
        {
          status: 500
        }
      );
    }

    const {
      data: departments,
      error:
        departmentsError
    } = await supabase
      .from("departments")
      .select(
        "id, name"
      )
      .order(
        "name",
        {
          ascending: true
        }
      );

    if (departmentsError) {
      console.error(
        "Departments error:",
        departmentsError
      );
    }

    const {
      data: roles,
      error: rolesError
    } = await supabase
      .from("roles")
      .select(`
        id,
        name,
        label,
        management_level
      `)
      .order(
        "name",
        {
          ascending: true
        }
      );

    if (rolesError) {
      console.error(
        "Roles error:",
        rolesError
      );
    }

    const departmentMap =
      new Map(
        (departments || []).map(
          (department) => [
            department.id,
            department
          ]
        )
      );

    const roleMap =
      new Map(
        (roles || []).map(
          (role) => [
            role.id,
            role
          ]
        )
      );

    const users =
      (accounts || []).map(
        (account) => {
          const department =
            departmentMap.get(
              account.department_id
            ) || null;

          const roleData =
            roleMap.get(
              account.role_id
            ) || null;

          const role =
            roleData
              ? {
                  id:
                    roleData.id,

                  name:
                    roleData.name,

                  label:
                    roleData.label ||
                    roleData.name ||
                    "",

                  managementLevel:
                    roleData.management_level ||
                    null,

                  code:
                    roleData.name ||
                    null
                }
              : null;

          return {
            id:
              account.id,

            telegramUserId:
              account.telegram_user_id,

            username:
              account.username,

            displayName:
              account.display_name,

            status:
              account.status,

            createdAt:
              account.created_at,

            department,

            role
          };
        }
      );

    /*
    ------------------------------------------
    Format roles for permissions page
    ------------------------------------------
    */

    const formattedRoles =
      (roles || []).map(
        (role) => ({
          id:
            role.id,

          name:
            role.name,

          label:
            role.label ||
            role.name ||
            "",

          managementLevel:
            role.management_level ||
            null,

          code:
            role.name ||
            null
        })
      );

    return NextResponse.json({
      success: true,

      users,

      departments:
        departments || [],

      roles:
        formattedRoles
    });
  } catch (error) {
    console.error(
      "Admin users error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "حدث خطأ غير متوقع."
      },
      {
        status: 500
      }
    );
  }
}

/*
========================================================
PUT = ADD TELEGRAM USER
========================================================

هذا لا ينشئ الحساب نفسه.

فقط يضيف Telegram ID إلى allowed_users
حتى يستطيع صاحب الحساب فتح النظام وإنشاء
حسابه من شاشة التسجيل.
========================================================
*/

export async function PUT(
  request
) {
  try {
    const body =
      await request.json();

    const auth =
      await authenticateAdmin(
        body?.initData
      );

    if (!auth.success) {
      return NextResponse.json(
        {
          success: false,
          message:
            auth.message
        },
        {
          status:
            auth.status
        }
      );
    }

    const telegramUserId =
      String(
        body?.telegramUserId ||
          ""
      ).trim();

    /*
    ------------------------------------------
    Validate Telegram ID
    ------------------------------------------
    */

    if (!telegramUserId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "يرجى إدخال Telegram ID."
        },
        {
          status: 400
        }
      );
    }

    if (
      !/^\d+$/.test(
        telegramUserId
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Telegram ID يجب أن يحتوي على أرقام فقط."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Check existing allowed user
    ------------------------------------------
    */

    const {
      data: existingAllowed,
      error:
        existingAllowedError
    } = await supabase
      .from("allowed_users")
      .select(
        "id, telegram_user_id, status"
      )
      .eq(
        "telegram_user_id",
        telegramUserId
      )
      .maybeSingle();

    if (existingAllowedError) {
      console.error(
        "Existing allowed check error:",
        existingAllowedError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر التحقق من Telegram ID."
        },
        {
          status: 500
        }
      );
    }

    if (existingAllowed) {
      return NextResponse.json(
        {
          success: false,
          message:
            existingAllowed.status ===
            "active"
              ? "Telegram ID مضاف بالفعل."
              : "Telegram ID موجود بالفعل ولكنه غير نشط."
        },
        {
          status: 409
        }
      );
    }

    /*
    ------------------------------------------
    Check existing account
    ------------------------------------------
    */

    const {
      data: existingAccount,
      error:
        existingAccountError
    } = await supabase
      .from("accounts")
      .select("id")
      .eq(
        "telegram_user_id",
        telegramUserId
      )
      .maybeSingle();

    if (existingAccountError) {
      console.error(
        "Existing account check error:",
        existingAccountError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر التحقق من الحساب."
        },
        {
          status: 500
        }
      );
    }

    if (existingAccount) {
      return NextResponse.json(
        {
          success: false,
          message:
            "يوجد حساب مرتبط بهذا Telegram ID بالفعل."
        },
        {
          status: 409
        }
      );
    }

    /*
    ------------------------------------------
    Add to allowed_users
    ------------------------------------------
    */

    const {
      data: insertedAllowed,
      error:
        insertAllowedError
    } = await supabase
      .from("allowed_users")
      .insert({
        telegram_user_id:
          telegramUserId,

        status:
          "active"
      })
      .select(
        "id, telegram_user_id, status"
      )
      .single();

    if (insertAllowedError) {
      console.error(
        "Insert allowed user error:",
        insertAllowedError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر إضافة Telegram ID إلى قاعدة البيانات."
        },
        {
          status: 500
        }
      );
    }

    return NextResponse.json({
      success: true,

      message:
        "تمت إضافة Telegram ID بنجاح. أصبح بإمكان المستخدم فتح النظام وإنشاء حسابه.",

      allowedUser:
        insertedAllowed
    });
  } catch (error) {
    console.error(
      "Admin add Telegram user error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "حدث خطأ غير متوقع أثناء إضافة المستخدم."
      },
      {
        status: 500
      }
    );
  }
}

/*
========================================================
PATCH = EDIT USER / CHANGE ROLE
========================================================

يدعم الآن نوعين:

1. تعديل المستخدم كاملًا:
   userId
   displayName
   username
   departmentId
   roleId
   status

2. تغيير الدور فقط:
   accountId
   roleId

وهذا هو المطلوب من صفحة إدارة الصلاحيات.
========================================================
*/

export async function PATCH(
  request
) {
  try {
    const body =
      await request.json();

    const auth =
      await authenticateAdmin(
        body?.initData
      );

    if (!auth.success) {
      return NextResponse.json(
        {
          success: false,
          message:
            auth.message
        },
        {
          status:
            auth.status
        }
      );
    }

    /*
    ------------------------------------------
    Support accountId from permissions page
    ------------------------------------------
    */

    const userId =
      body?.userId ??
      body?.accountId;

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "معرف المستخدم مطلوب."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Detect which fields were actually sent
    ------------------------------------------
    */

    const hasDisplayName =
      Object.prototype.hasOwnProperty.call(
        body,
        "displayName"
      );

    const hasUsername =
      Object.prototype.hasOwnProperty.call(
        body,
        "username"
      );

    const hasDepartmentId =
      Object.prototype.hasOwnProperty.call(
        body,
        "departmentId"
      );

    const hasRoleId =
      Object.prototype.hasOwnProperty.call(
        body,
        "roleId"
      );

    const hasStatus =
      Object.prototype.hasOwnProperty.call(
        body,
        "status"
      );

    /*
    ------------------------------------------
    Values
    ------------------------------------------
    */

    const displayName =
      hasDisplayName
        ? typeof body.displayName ===
          "string"
          ? body.displayName.trim()
          : ""
        : undefined;

    const username =
      hasUsername
        ? typeof body.username ===
          "string"
          ? body.username.trim()
          : ""
        : undefined;

    const departmentId =
      hasDepartmentId
        ? body.departmentId ||
          null
        : undefined;

    const roleId =
      hasRoleId
        ? body.roleId ||
          null
        : undefined;

    const status =
      hasStatus
        ? body.status
        : undefined;

    /*
    ------------------------------------------
    At least one editable field
    ------------------------------------------
    */

    if (
      !hasDisplayName &&
      !hasUsername &&
      !hasDepartmentId &&
      !hasRoleId &&
      !hasStatus
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "لم يتم إرسال أي بيانات للتعديل."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Validate display name
    ------------------------------------------
    */

    if (
      hasDisplayName &&
      displayName.length >
        100
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "الاسم طويل جدًا."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Validate username
    ------------------------------------------
    */

    if (hasUsername) {
      if (
        username.length < 3 ||
        username.length > 30
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "اسم المستخدم يجب أن يكون بين 3 و30 حرفًا."
          },
          {
            status: 400
          }
        );
      }

      if (
        !/^[a-zA-Z0-9_]+$/.test(
          username
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "اسم المستخدم يسمح فقط بالحروف الإنجليزية والأرقام والشرطة السفلية."
          },
          {
            status: 400
          }
        );
      }
    }

    /*
    ------------------------------------------
    Validate status
    ------------------------------------------
    */

    const allowedStatuses = [
      "active",
      "inactive",
      "blocked"
    ];

    if (
      hasStatus &&
      !allowedStatuses.includes(
        status
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "حالة الحساب غير صحيحة."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Get target user
    ------------------------------------------
    */

    const {
      data: targetUser,
      error: targetUserError
    } = await supabase
      .from("accounts")
      .select(`
        id,
        telegram_user_id,
        username,
        display_name,
        department_id,
        role_id,
        status,
        created_at
      `)
      .eq(
        "id",
        userId
      )
      .maybeSingle();

    if (targetUserError) {
      console.error(
        "Target user error:",
        targetUserError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر العثور على المستخدم."
        },
        {
          status: 500
        }
      );
    }

    if (!targetUser) {
      return NextResponse.json(
        {
          success: false,
          message:
            "المستخدم غير موجود."
        },
        {
          status: 404
        }
      );
    }

    /*
    ------------------------------------------
    Duplicate username
    ------------------------------------------
    */

    if (
      hasUsername &&
      username &&
      username !==
        targetUser.username
    ) {
      const {
        data: existingUsername,
        error: usernameError
      } = await supabase
        .from("accounts")
        .select("id")
        .eq(
          "username",
          username
        )
        .neq(
          "id",
          userId
        )
        .maybeSingle();

      if (usernameError) {
        console.error(
          "Username check error:",
          usernameError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر التحقق من اسم المستخدم."
          },
          {
            status: 500
          }
        );
      }

      if (existingUsername) {
        return NextResponse.json(
          {
            success: false,
            message:
              "اسم المستخدم مستخدم بالفعل."
          },
          {
            status: 409
          }
        );
      }
    }

    /*
    ------------------------------------------
    Validate department
    ------------------------------------------
    */

    if (
      hasDepartmentId &&
      departmentId
    ) {
      const {
        data: department,
        error:
          departmentError
      } = await supabase
        .from("departments")
        .select("id")
        .eq(
          "id",
          departmentId
        )
        .maybeSingle();

      if (departmentError) {
        console.error(
          "Department validation error:",
          departmentError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر التحقق من القسم."
          },
          {
            status: 500
          }
        );
      }

      if (!department) {
        return NextResponse.json(
          {
            success: false,
            message:
              "القسم المحدد غير موجود."
          },
          {
            status: 400
          }
        );
      }
    }

    /*
    ====================================================
    ROLE CHANGE
    ====================================================
    */

    let currentRoleIsSystemAdmin =
      false;

    let targetRoleIsSystemAdmin =
      false;

    let targetRole = null;

    /*
    ------------------------------------------
    Get current role
    ------------------------------------------
    */

    if (targetUser.role_id) {
      currentRoleIsSystemAdmin =
        await isSystemAdminRole(
          targetUser.role_id
        );
    }

    /*
    ------------------------------------------
    Validate target role
    ------------------------------------------
    */

    if (hasRoleId) {
      if (roleId) {
        const {
          data: role,
          error: roleError
        } = await supabase
          .from("roles")
          .select(`
            id,
            name,
            label,
            management_level
          `)
          .eq(
            "id",
            roleId
          )
          .maybeSingle();

        if (roleError) {
          console.error(
            "Role validation error:",
            roleError
          );

          return NextResponse.json(
            {
              success: false,
              message:
                "تعذر التحقق من الدور."
            },
            {
              status: 500
            }
          );
        }

        if (!role) {
          return NextResponse.json(
            {
              success: false,
              message:
                "الدور المحدد غير موجود."
            },
            {
              status: 400
            }
          );
        }

        targetRole =
          role;

        targetRoleIsSystemAdmin =
          role.name ===
          "system_admin";
      }
    }

    /*
    ====================================================
    SELF PROTECTION
    ====================================================
    */

    /*
    ------------------------------------------
    Prevent self disable / block
    ------------------------------------------
    */

    if (
      targetUser.id ===
        auth.account.id &&
      hasStatus &&
      status !== "active"
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "لا يمكنك تعطيل أو حظر حسابك الحالي."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Prevent self role removal
    ------------------------------------------
    */

    if (
      targetUser.id ===
        auth.account.id &&
      hasRoleId &&
      currentRoleIsSystemAdmin &&
      !targetRoleIsSystemAdmin
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "لا يمكنك إزالة صلاحية مدير النظام من حسابك الحالي."
        },
        {
          status: 400
        }
      );
    }

    /*
    ====================================================
    LAST SYSTEM ADMIN PROTECTION
    ====================================================
    */

    if (
      hasRoleId &&
      currentRoleIsSystemAdmin &&
      !targetRoleIsSystemAdmin
    ) {
      /*
      ------------------------------------------
      Count active system admins
      ------------------------------------------
      */

      const {
        data: systemAdminRoles,
        error:
          systemAdminRolesError
      } = await supabase
        .from("roles")
        .select("id")
        .eq(
          "name",
          "system_admin"
        );

      if (systemAdminRolesError) {
        console.error(
          "System admin roles error:",
          systemAdminRolesError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر التحقق من مديري النظام."
          },
          {
            status: 500
          }
        );
      }

      const systemAdminRoleIds =
        (systemAdminRoles || []).map(
          (role) =>
            role.id
        );

      if (
        systemAdminRoleIds.length >
        0
      ) {
        const {
          data: activeSystemAdmins,
          error:
            activeSystemAdminsError
        } = await supabase
          .from("accounts")
          .select(
            "id"
          )
          .in(
            "role_id",
            systemAdminRoleIds
          )
          .eq(
            "status",
            "active"
          );

        if (
          activeSystemAdminsError
        ) {
          console.error(
            "Active system admins error:",
            activeSystemAdminsError
          );

          return NextResponse.json(
            {
              success: false,
              message:
                "تعذر التحقق من عدد مديري النظام."
            },
            {
              status: 500
            }
          );
        }

        const activeAdminCount =
          (
            activeSystemAdmins ||
            []
          ).length;

        if (
          activeAdminCount <=
          1
        ) {
          return NextResponse.json(
            {
              success: false,
              message:
                "لا يمكن خفض هذا المستخدم لأنه آخر مدير نظام نشط. يجب وجود مدير نظام نشط آخر على الأقل."
            },
            {
              status: 400
            }
          );
        }
      }
    }

    /*
    ====================================================
    BUILD UPDATE
    ====================================================
    */

    const updateData = {};

    if (hasDisplayName) {
      updateData.display_name =
        displayName;
    }

    if (hasUsername) {
      updateData.username =
        username;
    }

    if (hasDepartmentId) {
      updateData.department_id =
        departmentId;
    }

    if (hasRoleId) {
      updateData.role_id =
        roleId;
    }

    if (hasStatus) {
      updateData.status =
        status;
    }

    /*
    ------------------------------------------
    Nothing to update
    ------------------------------------------
    */

    if (
      Object.keys(updateData)
        .length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "لا توجد بيانات قابلة للتحديث."
        },
        {
          status: 400
        }
      );
    }

    /*
    ====================================================
    UPDATE ACCOUNT
    ====================================================
    */

    const {
      data: updatedAccount,
      error: updateError
    } = await supabase
      .from("accounts")
      .update(
        updateData
      )
      .eq(
        "id",
        userId
      )
      .select(`
        id,
        telegram_user_id,
        username,
        display_name,
        department_id,
        role_id,
        status,
        created_at
      `)
      .single();

    if (updateError) {
      console.error(
        "Update account error:",
        updateError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر تحديث بيانات المستخدم."
        },
        {
          status: 500
        }
      );
    }

    /*
    ====================================================
    FORMAT UPDATED USER
    ====================================================
    */

    const user =
      await formatUser(
        updatedAccount
      );

    /*
    ====================================================
    RESPONSE MESSAGE
    ====================================================
    */

    let message =
      "تم تحديث بيانات المستخدم بنجاح.";

    if (
      hasRoleId &&
      targetRole
    ) {
      if (
        targetRoleIsSystemAdmin &&
        !currentRoleIsSystemAdmin
      ) {
        message =
          `تم رفع ${updatedAccount.display_name || updatedAccount.username} إلى مدير نظام بنجاح.`;
      } else if (
        currentRoleIsSystemAdmin &&
        !targetRoleIsSystemAdmin
      ) {
        message =
          `تم خفض ${updatedAccount.display_name || updatedAccount.username} من مدير نظام إلى ${targetRole.label || targetRole.name} بنجاح.`;
      } else if (
        String(
          targetUser.role_id
        ) !==
        String(
          updatedAccount.role_id
        )
      ) {
        message =
          `تم تغيير دور المستخدم إلى ${targetRole.label || targetRole.name} بنجاح.`;
      } else {
        message =
          "تم تحديث دور المستخدم بنجاح.";
      }
    }

    return NextResponse.json({
      success: true,

      message,

      user,

      roleChanged:
        hasRoleId,

      role:
        user?.role ||
        null
    });
  } catch (error) {
    console.error(
      "Admin update user error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "حدث خطأ غير متوقع أثناء تحديث المستخدم."
      },
      {
        status: 500
      }
    );
  }
}

/*
========================================================
DELETE = DELETE USER COMPLETELY
========================================================

يحذف:
1. accounts
2. allowed_users

ولا يسمح للأدمن بحذف حسابه الحالي.

ولا يسمح بحذف آخر مدير نظام نشط.
========================================================
*/

export async function DELETE(
  request
) {
  try {
    const body =
      await request.json();

    const auth =
      await authenticateAdmin(
        body?.initData
      );

    if (!auth.success) {
      return NextResponse.json(
        {
          success: false,
          message:
            auth.message
        },
        {
          status:
            auth.status
        }
      );
    }

    const userId =
      body?.userId;

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "معرف المستخدم مطلوب."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Get target account
    ------------------------------------------
    */

    const {
      data: targetUser,
      error: targetUserError
    } = await supabase
      .from("accounts")
      .select(`
        id,
        telegram_user_id,
        username,
        display_name,
        role_id,
        status
      `)
      .eq(
        "id",
        userId
      )
      .maybeSingle();

    if (targetUserError) {
      console.error(
        "Delete target lookup error:",
        targetUserError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر العثور على المستخدم."
        },
        {
          status: 500
        }
      );
    }

    if (!targetUser) {
      return NextResponse.json(
        {
          success: false,
          message:
            "المستخدم غير موجود."
        },
        {
          status: 404
        }
      );
    }

    /*
    ------------------------------------------
    Prevent self deletion
    ------------------------------------------
    */

    if (
      targetUser.id ===
      auth.account.id
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "لا يمكنك حذف حسابك الحالي."
        },
        {
          status: 400
        }
      );
    }

    /*
    ====================================================
    LAST SYSTEM ADMIN PROTECTION
    ====================================================
    */

    const targetIsSystemAdmin =
      await isSystemAdminRole(
        targetUser.role_id
      );

    if (
      targetIsSystemAdmin &&
      targetUser.status ===
        "active"
    ) {
      const {
        data: systemAdminRoles,
        error:
          systemAdminRolesError
      } = await supabase
        .from("roles")
        .select("id")
        .eq(
          "name",
          "system_admin"
        );

      if (systemAdminRolesError) {
        console.error(
          "Delete system admin role lookup error:",
          systemAdminRolesError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر التحقق من مديري النظام."
          },
          {
            status: 500
          }
        );
      }

      const roleIds =
        (systemAdminRoles || []).map(
          (role) =>
            role.id
        );

      if (
        roleIds.length > 0
      ) {
        const {
          data: activeAdmins,
          error:
            activeAdminsError
        } = await supabase
          .from("accounts")
          .select("id")
          .in(
            "role_id",
            roleIds
          )
          .eq(
            "status",
            "active"
          );

        if (
          activeAdminsError
        ) {
          console.error(
            "Delete active admins error:",
            activeAdminsError
          );

          return NextResponse.json(
            {
              success: false,
              message:
                "تعذر التحقق من مديري النظام."
            },
            {
              status: 500
            }
          );
        }

        if (
          (
            activeAdmins ||
            []
          ).length <= 1
        ) {
          return NextResponse.json(
            {
              success: false,
              message:
                "لا يمكن حذف آخر مدير نظام نشط. يجب وجود مدير نظام نشط آخر."
            },
            {
              status: 400
            }
          );
        }
      }
    }

    const telegramUserId =
      String(
        targetUser.telegram_user_id
      );

    /*
    ------------------------------------------
    Save allowed row before deletion
    ------------------------------------------
    */

    const {
      data: existingAllowed
    } = await supabase
      .from("allowed_users")
      .select(`
        id,
        telegram_user_id,
        status
      `)
      .eq(
        "telegram_user_id",
        telegramUserId
      )
      .maybeSingle();

    /*
    ------------------------------------------
    Delete allowed_users first
    ------------------------------------------
    */

    const {
      error:
        deleteAllowedError
    } = await supabase
      .from("allowed_users")
      .delete()
      .eq(
        "telegram_user_id",
        telegramUserId
      );

    if (deleteAllowedError) {
      console.error(
        "Delete allowed user error:",
        deleteAllowedError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر حذف Telegram ID من قاعدة البيانات."
        },
        {
          status: 500
        }
      );
    }

    /*
    ------------------------------------------
    Delete account
    ------------------------------------------
    */

    const {
      error:
        deleteAccountError
    } = await supabase
      .from("accounts")
      .delete()
      .eq(
        "id",
        userId
      );

    if (deleteAccountError) {
      console.error(
        "Delete account error:",
        deleteAccountError
      );

      /*
      Try to restore allowed user
      */

      if (existingAllowed) {
        await supabase
          .from("allowed_users")
          .insert({
            telegram_user_id:
              existingAllowed.telegram_user_id,

            status:
              existingAllowed.status ||
              "active"
          });
      }

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر حذف حساب المستخدم. قد توجد سجلات مرتبطة بهذا الحساب في جداول أخرى."
        },
        {
          status: 409
        }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "تم حذف حساب المستخدم وTelegram ID بنجاح."
    });
  } catch (error) {
    console.error(
      "Admin delete user error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "حدث خطأ غير متوقع أثناء حذف المستخدم."
      },
      {
        status: 500
      }
    );
  }
}
