import { NextResponse } from "next/server";

export async function GET() {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return NextResponse.json(
        {
          success: false,
          message: "TELEGRAM_BOT_TOKEN is missing."
        },
        { status: 500 }
      );
    }

    const webhookUrl =
      "https://molimbot.vercel.app/api/telegram/webhook";

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: webhookUrl
        })
      }
    );

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error("Webhook setup error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to setup webhook."
      },
      { status: 500 }
    );
  }
}
