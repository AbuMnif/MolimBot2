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

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    );

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error("Webhook info error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to get webhook information."
      },
      { status: 500 }
    );
  }
}
