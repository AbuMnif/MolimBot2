import crypto from "crypto";
import { supabase } from "./supabase";

export function verifyTelegramWebAppData(initData) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !initData) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;
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

  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

export async function getAuthenticatedAccount(initData) {
  const telegramUser = verifyTelegramWebAppData(initData);
  if (!telegramUser?.id) {
    const error = new Error("INVALID_TELEGRAM_AUTH");
    error.code = "INVALID_TELEGRAM_AUTH";
    throw error;
  }

  const telegramUserId = String(telegramUser.id);

  const { data: allowedUser, error: allowedError } = await supabase
    .from("allowed_users")
    .select("id, telegram_user_id, status")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (allowedError) throw allowedError;
  if (!allowedUser || allowedUser.status !== "active") {
    const error = new Error("ACCESS_DENIED");
    error.code = "ACCESS_DENIED";
    throw error;
  }

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (accountError) throw accountError;
  if (!account) {
    const error = new Error("ACCOUNT_NOT_FOUND");
    error.code = "ACCOUNT_NOT_FOUND";
    throw error;
  }

  if (account.status !== "active") {
    const error = new Error("ACCOUNT_INACTIVE");
    error.code = "ACCOUNT_INACTIVE";
    throw error;
  }

  return { telegramUser, telegramUserId, account };
}
