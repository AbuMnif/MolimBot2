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

export async function POST(request) {
  try {
    const body = await request.json();
    const initData = body?.initData;

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

    const { data: account, error: accountError } =
      await supabase
        .from("accounts")
        .select("id, username")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

    if (accountError) {
      console.error(accountError);

      return NextResponse.json(
        {
          success: false,
          message: "Database error."
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,

      user: {
        id: telegramUser.id,
        username: telegramUser.username || null,
        firstName: telegramUser.first_name || null,
        lastName: telegramUser.last_name || null
      },

      account: account
        ? {
            exists: true,
            username: account.username
          }
        : {
            exists: false
          }
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        message: "Unexpected server error."
      },
      { status: 500 }
    );
  }
}
