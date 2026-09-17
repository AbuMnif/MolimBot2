import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "../../../../lib/supabase";

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

async function getAuthenticatedAccount(initData) {
  const telegramUser = verifyTelegramWebAppData(initData);

  if (!telegramUser?.id) {
    return {
      error: NextResponse.json(
        {
          success: false,
          message: "Invalid Telegram authentication."
        },
        { status: 401 }
      )
    };
  }

  const telegramUserId = String(telegramUser.id);

  const {
    data: allowedUser,
    error: allowedUserError
  } = await supabase
    .from("allowed_users")
    .select("id, telegram_user_id, status")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (allowedUserError) {
    console.error(
      "Allowed user error:",
      allowedUserError
    );

    return {
      error: NextResponse.json(
        {
          success: false,
          message: "Database error."
        },
        { status: 500 }
      )
    };
  }

  if (
    !allowedUser ||
    allowedUser.status !== "active"
  ) {
    return {
      error: NextResponse.json(
        {
          success: false,
          message: "Access denied."
        },
        { status: 403 }
      )
    };
  }

  const {
    data: account,
    error: accountError
  } = await supabase
    .from("accounts")
    .select(`
      id,
      telegram_user_id,
      username,
      display_name,
      department_id,
      role_id,
      status
    `)
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (accountError) {
    console.error(
      "Account error:",
      accountError
    );

    return {
      error: NextResponse.json(
        {
          success: false,
          message: "Database error."
        },
        { status: 500 }
      )
    };
  }

  if (!account) {
    return {
      error: NextResponse.json(
        {
          success: false,
          message: "Account not found."
        },
        { status: 404 }
      )
    };
  }

  if (account.status !== "active") {
    return {
      error: NextResponse.json(
        {
          success: false,
          message: "الحساب غير نشط."
        },
        { status: 403 }
      )
    };
  }

  return {
    telegramUser,
    telegramUserId,
    account
  };
}

async function getAccountDetails(account) {
  let department = null;
  let role = null;

  if (account.department_id) {
    const {
      data: departmentData,
      error: departmentError
    } = await supabase
      .from("departments")
      .select("id, name")
      .eq("id", account.department_id)
      .maybeSingle();

    if (departmentError) {
      console.error(
        "Department error:",
        departmentError
      );
    }

    department = departmentData || null;
  }

  if (account.role_id) {
    const {
      data: roleData,
      error: roleError
    } = await supabase
      .from("roles")
      .select("id, name")
      .eq("id", account.role_id)
      .maybeSingle();

    if (roleError) {
      console.error(
        "Role error:",
        roleError
      );
    }

    role = roleData || null;
  }

  return {
    department,
    role
  };
}

function buildAccountResponse(
  telegramUser,
  account,
  department,
  role
) {
  return {
    success: true,

    user: {
      id: telegramUser.id,
      username: telegramUser.username || null,
      firstName: telegramUser.first_name || null,
      lastName: telegramUser.last_name || null
    },

    account: {
      id: account.id,
      telegramUserId: account.telegram_user_id,
      username: account.username,
      displayName: account.display_name || null,

      department: department
        ? {
            id: department.id,
            name: department.name
          }
        : null,

      role: role
        ? {
            id: role.id,
            name: role.name
          }
        : null,

      status: account.status
    }
  };
}

export async function POST(request) {
  try {
    const body = await request.json();

    const auth = await getAuthenticatedAccount(
      body?.initData
    );

    if (auth.error) {
      return auth.error;
    }

    const {
      telegramUser,
      account
    } = auth;

    const {
      department,
      role
    } = await getAccountDetails(account);

    return NextResponse.json(
      buildAccountResponse(
        telegramUser,
        account,
        department,
        role
      )
    );
  } catch (error) {
    console.error(
      "Account me error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected server error."
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    const auth = await getAuthenticatedAccount(
      body?.initData
    );

    if (auth.error) {
      return auth.error;
    }

    const {
      telegramUser,
      account
    } = auth;

    const displayName =
      typeof body?.displayName === "string"
        ? body.displayName.trim()
        : account.display_name || "";

    const username =
      typeof body?.username === "string"
        ? body.username.trim()
        : account.username || "";

    if (
      displayName.length < 1 ||
      displayName.length > 100
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "الاسم يجب أن يكون بين حرف واحد و100 حرف."
        },
        { status: 400 }
      );
    }

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
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "اسم المستخدم يسمح فقط بالحروف الإنجليزية والأرقام والشرطة السفلية."
        },
        { status: 400 }
      );
    }

    const {
      data: duplicateUser,
      error: duplicateError
    } = await supabase
      .from("accounts")
      .select("id")
      .eq("username", username)
      .neq("id", account.id)
      .maybeSingle();

    if (duplicateError) {
      console.error(
        "Duplicate username check error:",
        duplicateError
      );

      return NextResponse.json(
        {
          success: false,
          message: "تعذر التحقق من اسم المستخدم."
        },
        { status: 500 }
      );
    }

    if (duplicateUser) {
      return NextResponse.json(
        {
          success: false,
          message:
            "اسم المستخدم مستخدم بالفعل، اختر اسمًا آخر."
        },
        { status: 409 }
      );
    }

    const {
      data: updatedAccount,
      error: updateError
    } = await supabase
      .from("accounts")
      .update({
        display_name: displayName,
        username
      })
      .eq("id", account.id)
      .select(`
        id,
        telegram_user_id,
        username,
        display_name,
        department_id,
        role_id,
        status
      `)
      .single();

    if (updateError) {
      console.error(
        "Profile update error:",
        updateError
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "تعذر حفظ تعديلات الملف الشخصي."
        },
        { status: 500 }
      );
    }

    const {
      department,
      role
    } = await getAccountDetails(
      updatedAccount
    );

    return NextResponse.json({
      ...buildAccountResponse(
        telegramUser,
        updatedAccount,
        department,
        role
      ),
      message:
        "تم تحديث الملف الشخصي بنجاح."
    });
  } catch (error) {
    console.error(
      "Profile PATCH error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "حدث خطأ أثناء تحديث الملف الشخصي."
      },
      { status: 500 }
    );
  }
}
