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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return `${salt}:${hash}`;
}

export async function POST(request) {
  try {
    const body = await request.json();

    const initData = body?.initData;
    const username = body?.username?.trim();
    const password = body?.password;

    const telegramUser = verifyTelegramWebAppData(initData);

    if (!telegramUser?.id) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid Telegram authentication."
        },
        { status: 401 }
      );
    }

    const telegramUserId = String(telegramUser.id);

    const { data: allowedUser, error: allowedUserError } =
      await supabase
        .from("allowed_users")
        .select("id, telegram_user_id, status")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

    if (allowedUserError) {
      console.error(allowedUserError);

      return NextResponse.json(
        {
          success: false,
          message: "Database error."
        },
        { status: 500 }
      );
    }

    if (!allowedUser || allowedUser.status !== "active") {
      return NextResponse.json(
        {
          success: false,
          message: "Access denied."
        },
        { status: 403 }
      );
    }

    if (!username || username.length < 3 || username.length > 30) {
      return NextResponse.json(
        {
          success: false,
          message: "اسم المستخدم يجب أن يكون بين 3 و30 حرفًا."
        },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json(
        {
          success: false,
          message: "اسم المستخدم يسمح فقط بالحروف الإنجليزية والأرقام والشرطة السفلية."
        },
        { status: 400 }
      );
    }

    if (!password || password.length < 8) {
      return NextResponse.json(
        {
          success: false,
          message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل."
        },
        { status: 400 }
      );
    }

    const { data: existingTelegramAccount } =
      await supabase
        .from("accounts")
        .select("id")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

    if (existingTelegramAccount) {
      return NextResponse.json(
        {
          success: false,
          message: "لديك حساب بالفعل."
        },
        { status: 409 }
      );
    }

    const { data: existingUsername } =
      await supabase
        .from("accounts")
        .select("id")
        .eq("username", username)
        .maybeSingle();

    if (existingUsername) {
      return NextResponse.json(
        {
          success: false,
          message: "اسم المستخدم مستخدم بالفعل."
        },
        { status: 409 }
      );
    }

    const passwordHash = hashPassword(password);

    const { data: account, error: accountError } =
      await supabase
        .from("accounts")
        .insert({
          telegram_user_id: telegramUserId,
          username,
          password_hash: passwordHash
        })
        .select("id, username")
        .single();

    if (accountError) {
      console.error(accountError);

      return NextResponse.json(
        {
          success: false,
          message: "تعذر إنشاء الحساب."
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "تم إنشاء الحساب بنجاح.",
      account: {
        id: account.id,
        username: account.username
      }
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        message: "حدث خطأ أثناء إنشاء الحساب."
      },
      { status: 500 }
    );
  }
}
