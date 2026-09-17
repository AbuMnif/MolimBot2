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
GET ROLE
========================================================
*/

async function getRole(roleId) {
  if (!roleId) {
    return null;
  }

  const {
    data: role,
    error
  } = await supabase
    .from("roles")
    .select(`
      id,
      name,
      label,
      management_level
    `)
    .eq("id", roleId)
    .maybeSingle();

  if (error) {
    console.error(
      "Get role error:",
      error
    );

    return null;
  }

  return role || null;
}

/*
========================================================
GET ACCOUNT PERMISSIONS
========================================================
*/

async function getEffectivePermissions(accountId) {
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
    .eq("id", accountId)
    .maybeSingle();

  if (
    accountError ||
    !account
  ) {
    return {
      account: null,
      permissions: [],
      isSystemAdmin: false
    };
  }

  /*
  ------------------------------------------
  Get role
  ------------------------------------------
  */

  const role =
    await getRole(
      account.role_id
    );

  const isSystemAdmin =
    role?.name === "system_admin";

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
          key,
          label
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
  Individual overrides
  ------------------------------------------
  */

  const {
    data: overrides,
    error: overridesError
  } = await supabase
    .from("account_permissions")
    .select(`
      permission_id,
      effect,
      permissions (
        id,
        key,
        label
      )
    `)
    .eq(
      "account_id",
      account.id
    );

  if (overridesError) {
    console.error(
      "Account permissions error:",
      overridesError
    );
  }

  /*
  ------------------------------------------
  Build effective permissions
  ------------------------------------------
  */

  const permissionMap =
    new Map();

  for (
    const permission of rolePermissions
  ) {
    permissionMap.set(
      String(permission.id),
      {
        ...permission,
        source: "role"
      }
    );
  }

  for (
    const override of
      overrides || []
  ) {
    if (
      !override.permissions
    ) {
      continue;
    }

    const permissionId =
      String(
        override.permission_id
      );

    if (
      override.effect ===
      "allow"
    ) {
      permissionMap.set(
        permissionId,
        {
          ...override.permissions,
          source: "user"
        }
      );
    }

    if (
      override.effect ===
      "deny"
    ) {
      permissionMap.delete(
        permissionId
      );
    }
  }

  /*
  ------------------------------------------
  System admin
  ------------------------------------------
  */

  if (isSystemAdmin) {
    return {
      account,
      role,
      permissions: ["*"],
      isSystemAdmin: true
    };
  }

  return {
    account,
    role,
    permissions: [
      ...permissionMap.values()
    ],
    isSystemAdmin: false
  };
}

/*
========================================================
CHECK PERMISSION MANAGEMENT ACCESS
========================================================
*/

async function authenticatePermissionAdmin(
  initData
) {
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
    String(
      telegramUser.id
    );

  /*
  ------------------------------------------
  Allowed user
  ------------------------------------------
  */

  const {
    data: allowedUser,
    error: allowedError
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
  Account
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
  Effective permissions
  ------------------------------------------
  */

  const access =
    await getEffectivePermissions(
      account.id
    );

  if (
    access.isSystemAdmin
  ) {
    return {
      success: true,
      account,
      telegramUser,
      isSystemAdmin: true
    };
  }

  const permissionCodes =
    access.permissions
      .map(
        (permission) =>
          permission?.key
      )
      .filter(Boolean);

  const allowed =
    permissionCodes.includes(
      "system.permissions"
    ) ||
    permissionCodes.includes(
      "permissions.manage"
    ) ||
    permissionCodes.includes(
      "manage_permissions"
    ) ||
    permissionCodes.includes(
      "admin.permissions"
    );

  if (!allowed) {
    return {
      success: false,
      status: 403,
      message:
        "ليس لديك صلاحية إدارة الصلاحيات."
    };
  }

  return {
    success: true,
    account,
    telegramUser,
    isSystemAdmin: false
  };
}

/*
========================================================
FORMAT PERMISSION
========================================================
*/

function formatPermission(
  permission
) {
  if (!permission) {
    return null;
  }

  return {
    id: permission.id,

    name:
      permission.label ||
      permission.name ||
      permission.key ||
      "",

    label:
      permission.label ||
      "",

    code:
      permission.key ||
      permission.code ||
      "",

    key:
      permission.key ||
      ""
  };
}

/*
========================================================
LOAD ALL DATA
========================================================
*/

async function loadAllData() {
  /*
  ------------------------------------------
  Users
  ------------------------------------------
  */

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
      role_id,
      status
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

    throw new Error(
      "تعذر تحميل المستخدمين."
    );
  }

  /*
  ------------------------------------------
  Roles
  ------------------------------------------
  */

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
      "id",
      {
        ascending: true
      }
    );

  if (rolesError) {
    console.error(
      "Roles error:",
      rolesError
    );

    throw new Error(
      "تعذر تحميل الأدوار."
    );
  }

  /*
  ------------------------------------------
  Permissions
  ------------------------------------------
  */

  const {
    data: permissionsData,
    error: permissionsError
  } = await supabase
    .from("permissions")
    .select(`
      id,
      key,
      label
    `)
    .order(
      "id",
      {
        ascending: true
      }
    );

  if (permissionsError) {
    console.error(
      "Permissions error:",
      permissionsError
    );

    throw new Error(
      "تعذر تحميل الصلاحيات."
    );
  }

  /*
  ------------------------------------------
  Format users
  ------------------------------------------
  */

  const roleMap =
    new Map(
      (roles || []).map(
        (role) => [
          String(role.id),
          role
        ]
      )
    );

  const users =
    (accounts || []).map(
      (account) => {
        const role =
          roleMap.get(
            String(
              account.role_id
            )
          ) || null;

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

          role: role
            ? {
                id:
                  role.id,

                name:
                  role.name,

                label:
                  role.label,

                managementLevel:
                  role.management_level
              }
            : null
        };
      }
    );

  return {
    users,

    roles:
      roles || [],

    permissions:
      (permissionsData || [])
        .map(
          formatPermission
        )
        .filter(Boolean)
  };
}

/*
========================================================
POST
========================================================

No action:
  load page data

action=user:
  load selected user's overrides

action=role:
  load selected role permissions
========================================================
*/

export async function POST(
  request
) {
  try {
    const body =
      await request.json();

    const auth =
      await authenticatePermissionAdmin(
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

    const action =
      body?.action;

    /*
    ========================================
    USER
    ========================================
    */

    if (
      action === "user"
    ) {
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
      --------------------------------------
      Check user
      --------------------------------------
      */

      const {
        data: account,
        error: accountError
      } = await supabase
        .from("accounts")
        .select(`
          id,
          role_id
        `)
        .eq(
          "id",
          userId
        )
        .maybeSingle();

      if (accountError) {
        console.error(
          "Permission user lookup error:",
          accountError
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

      if (!account) {
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
      --------------------------------------
      Overrides
      --------------------------------------
      */

      const {
        data: overrides,
        error: overridesError
      } = await supabase
        .from("account_permissions")
        .select(`
          permission_id,
          effect
        `)
        .eq(
          "account_id",
          userId
        );

      if (overridesError) {
        console.error(
          "User overrides error:",
          overridesError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر تحميل صلاحيات المستخدم."
          },
          {
            status: 500
          }
        );
      }

      /*
      --------------------------------------
      Role permissions
      --------------------------------------
      */

      let rolePermissionIds =
        [];

      if (account.role_id) {
        const {
          data: rolePermissions,
          error:
            rolePermissionsError
        } = await supabase
          .from("role_permissions")
          .select(
            "permission_id"
          )
          .eq(
            "role_id",
            account.role_id
          );

        if (
          rolePermissionsError
        ) {
          console.error(
            "Role permission lookup error:",
            rolePermissionsError
          );
        } else {
          rolePermissionIds =
            (
              rolePermissions ||
              []
            ).map(
              (item) =>
                String(
                  item.permission_id
                )
            );
        }
      }

      return NextResponse.json({
        success: true,

        overrides:
          overrides || [],

        rolePermissionIds
      });
    }

    /*
    ========================================
    ROLE
    ========================================
    */

    if (
      action === "role"
    ) {
      const roleId =
        body?.roleId;

      if (!roleId) {
        return NextResponse.json(
          {
            success: false,
            message:
              "معرف الدور مطلوب."
          },
          {
            status: 400
          }
        );
      }

      const {
        data: role,
        error: roleError
      } = await supabase
        .from("roles")
        .select("id")
        .eq(
          "id",
          roleId
        )
        .maybeSingle();

      if (roleError) {
        console.error(
          "Role lookup error:",
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
              "الدور غير موجود."
          },
          {
            status: 404
          }
        );
      }

      const {
        data: rolePermissions,
        error:
          rolePermissionsError
      } = await supabase
        .from("role_permissions")
        .select(
          "permission_id"
        )
        .eq(
          "role_id",
          roleId
        );

      if (
        rolePermissionsError
      ) {
        console.error(
          "Role permissions error:",
          rolePermissionsError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر تحميل صلاحيات الدور."
          },
          {
            status: 500
          }
        );
      }

      return NextResponse.json({
        success: true,

        permissionIds:
          (
            rolePermissions ||
            []
          ).map(
            (item) =>
              String(
                item.permission_id
              )
          )
      });
    }

    /*
    ========================================
    DEFAULT PAGE DATA
    ========================================
    */

    const data =
      await loadAllData();

    return NextResponse.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error(
      "Admin permissions POST error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error?.message ||
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
PATCH
========================================================

تعديل صلاحية مستخدم:

allow  = سماح مباشر
deny   = منع مباشر
inherit = حذف التخصيص والاعتماد على الدور
========================================================
*/

export async function PATCH(
  request
) {
  try {
    const body =
      await request.json();

    const auth =
      await authenticatePermissionAdmin(
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

    if (
      body?.action !==
      "user"
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "إجراء غير صحيح."
        },
        {
          status: 400
        }
      );
    }

    const userId =
      body?.userId;

    const permissionId =
      body?.permissionId;

    const effect =
      body?.effect;

    if (
      !userId ||
      !permissionId
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "معرف المستخدم والصلاحية مطلوبان."
        },
        {
          status: 400
        }
      );
    }

    if (
      ![
        "allow",
        "deny",
        "inherit"
      ].includes(effect)
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "نوع الصلاحية غير صحيح."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Check account
    ------------------------------------------
    */

    const {
      data: account,
      error: accountError
    } = await supabase
      .from("accounts")
      .select("id")
      .eq(
        "id",
        userId
      )
      .maybeSingle();

    if (accountError) {
      console.error(
        "Target account error:",
        accountError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر التحقق من المستخدم."
        },
        {
          status: 500
        }
      );
    }

    if (!account) {
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
    Check permission
    ------------------------------------------
    */

    const {
      data: permission,
      error: permissionError
    } = await supabase
      .from("permissions")
      .select(`
        id,
        key,
        label
      `)
      .eq(
        "id",
        permissionId
      )
      .maybeSingle();

    if (permissionError) {
      console.error(
        "Permission lookup error:",
        permissionError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر التحقق من الصلاحية."
        },
        {
          status: 500
        }
      );
    }

    if (!permission) {
      return NextResponse.json(
        {
          success: false,
          message:
            "الصلاحية غير موجودة."
        },
        {
          status: 404
        }
      );
    }

    /*
    ------------------------------------------
    Inherit = delete override
    ------------------------------------------
    */

    if (
      effect === "inherit"
    ) {
      const {
        error:
          deleteError
      } = await supabase
        .from("account_permissions")
        .delete()
        .eq(
          "account_id",
          userId
        )
        .eq(
          "permission_id",
          permissionId
        );

      if (deleteError) {
        console.error(
          "Delete override error:",
          deleteError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر إزالة التخصيص."
          },
          {
            status: 500
          }
        );
      }

      return NextResponse.json({
        success: true,
        message:
          "تمت إعادة الصلاحية إلى إعداد الدور."
      });
    }

    /*
    ------------------------------------------
    Upsert override
    ------------------------------------------
    */

    const {
      data: saved,
      error: saveError
    } = await supabase
      .from("account_permissions")
      .upsert(
        {
          account_id:
            userId,

          permission_id:
            permissionId,

          effect
        },
        {
          onConflict:
            "account_id,permission_id"
        }
      )
      .select(`
        id,
        account_id,
        permission_id,
        effect
      `)
      .single();

    if (saveError) {
      console.error(
        "Save account permission error:",
        saveError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر حفظ صلاحية المستخدم."
        },
        {
          status: 500
        }
      );
    }

    return NextResponse.json({
      success: true,

      message:
        effect === "allow"
          ? "تم منح الصلاحية للمستخدم."
          : "تم منع الصلاحية عن المستخدم.",

      override:
        saved
    });
  } catch (error) {
    console.error(
      "Admin permissions PATCH error:",
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
PUT
========================================================

تحديث صلاحيات الدور بالكامل.
========================================================
*/

export async function PUT(
  request
) {
  try {
    const body =
      await request.json();

    const auth =
      await authenticatePermissionAdmin(
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

    if (
      body?.action !==
      "role"
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "إجراء غير صحيح."
        },
        {
          status: 400
        }
      );
    }

    const roleId =
      body?.roleId;

    const permissionIds =
      Array.isArray(
        body?.permissionIds
      )
        ? body.permissionIds
        : [];

    if (!roleId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "معرف الدور مطلوب."
        },
        {
          status: 400
        }
      );
    }

    /*
    ------------------------------------------
    Check role
    ------------------------------------------
    */

    const {
      data: role,
      error: roleError
    } = await supabase
      .from("roles")
      .select(`
        id,
        name,
        label
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
            "الدور غير موجود."
        },
        {
          status: 404
        }
      );
    }

    /*
    ------------------------------------------
    Normalize permission IDs
    ------------------------------------------
    */

    const normalizedIds = [
      ...new Set(
        permissionIds
          .map(
            (id) =>
              String(id)
          )
          .filter(
            Boolean
          )
      )
    ];

    /*
    ------------------------------------------
    Validate permissions
    ------------------------------------------
    */

    let validPermissionIds =
      [];

    if (
      normalizedIds.length
    ) {
      const {
        data: validPermissions,
        error:
          validPermissionsError
      } = await supabase
        .from("permissions")
        .select("id")
        .in(
          "id",
          normalizedIds
        );

      if (
        validPermissionsError
      ) {
        console.error(
          "Validate permissions error:",
          validPermissionsError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر التحقق من الصلاحيات."
          },
          {
            status: 500
          }
        );
      }

      validPermissionIds =
        (
          validPermissions ||
          []
        ).map(
          (permission) =>
            permission.id
        );
    }

    /*
    ------------------------------------------
    Delete existing role permissions
    ------------------------------------------
    */

    const {
      error:
        deleteError
    } = await supabase
      .from("role_permissions")
      .delete()
      .eq(
        "role_id",
        roleId
      );

    if (deleteError) {
      console.error(
        "Delete role permissions error:",
        deleteError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر تحديث صلاحيات الدور."
        },
        {
          status: 500
        }
      );
    }

    /*
    ------------------------------------------
    Insert new permissions
    ------------------------------------------
    */

    if (
      validPermissionIds.length
    ) {
      const rows =
        validPermissionIds.map(
          (permissionId) => ({
            role_id:
              roleId,

            permission_id:
              permissionId
          })
        );

      const {
        error:
          insertError
      } = await supabase
        .from("role_permissions")
        .insert(rows);

      if (insertError) {
        console.error(
          "Insert role permissions error:",
          insertError
        );

        return NextResponse.json(
          {
            success: false,
            message:
              "تعذر حفظ صلاحيات الدور."
          },
          {
            status: 500
          }
        );
      }
    }

    return NextResponse.json({
      success: true,

      message:
        `تم حفظ صلاحيات الدور "${role.label || role.name}" بنجاح.`,

      permissionIds:
        validPermissionIds.map(
          (id) =>
            String(id)
        )
    });
  } catch (error) {
    console.error(
      "Admin permissions PUT error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "حدث خطأ غير متوقع أثناء حفظ صلاحيات الدور."
      },
      {
        status: 500
      }
    );
  }
}
