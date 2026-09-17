import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { markOverdueTasks } from "../../../../lib/task-service";

async function sendTelegramMessage(botToken, chatId, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    }
  );

  return response.json();
}

async function getAdminChatId() {
  const { data, error } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "admin_telegram_chat_id")
    .maybeSingle();

  if (error) {
    console.error("Admin chat setting error:", error);
    return null;
  }

  return data?.setting_value || null;
}

async function notifyOverdueTasks(botToken) {
  const now = new Date().toISOString();
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(`
      id,
      title,
      due_at,
      status,
      task_departments (
        department_id,
        departments (
          id,
          name,
          telegram_chat_id
        )
      )
    `)
    .eq("status", "overdue")
    .not("overdue_at", "is", null)
    .order("overdue_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Overdue tasks query error:", error);
    return 0;
  }

  const adminChatId = await getAdminChatId();
  let sent = 0;

  for (const task of tasks || []) {
    /*
     * لا نرسل التنبيه في كل تشغيل للـ cron.
     * نستخدم metadata في audit_logs كعلامة إرسال.
     */
    const { data: existing } = await supabase
      .from("audit_logs")
      .select("id")
      .eq("action_type", "task.overdue.notified")
      .eq("entity_type", "task")
      .eq("entity_id", task.id)
      .limit(1);

    if (existing?.length) continue;

    const departments = (task.task_departments || [])
      .map((row) => row.departments)
      .filter(Boolean);

    const message =
      "⚠️ مهمة متأخرة\n\n" +
      `📋 المهمة: ${task.title}\n` +
      `🔢 رقم المهمة: #${task.id}\n` +
      `📅 الموعد: ${new Date(task.due_at).toLocaleString("ar-SA", {
        timeZone: "Asia/Riyadh",
        dateStyle: "medium",
        timeStyle: "short"
      })}\n\n` +
      "يرجى متابعة المهمة واتخاذ الإجراء المناسب.";

    if (adminChatId) {
      const result = await sendTelegramMessage(
        botToken,
        adminChatId,
        message
      );
      if (result?.ok) sent++;
    }

    const notifiedChats = new Set();
    for (const department of departments) {
      if (!department.telegram_chat_id) continue;
      if (notifiedChats.has(String(department.telegram_chat_id))) continue;
      notifiedChats.add(String(department.telegram_chat_id));

      const result = await sendTelegramMessage(
        botToken,
        department.telegram_chat_id,
        message + `\n\n🏢 القسم: ${department.name}`
      );
      if (result?.ok) sent++;
    }

    await supabase.from("audit_logs").insert({
      account_id: null,
      action_type: "task.overdue.notified",
      entity_type: "task",
      entity_id: task.id,
      description: `تم إرسال تنبيه تأخر المهمة #${task.id}`,
      metadata: {
        admin_notified: Boolean(adminChatId),
        department_count: departments.length,
        processed_at: now
      },
      source: "cron"
    });
  }

  return sent;
}

export async function GET() {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return NextResponse.json(
        { success: false, message: "TELEGRAM_BOT_TOKEN is missing." },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();

    /* =====================================================
       1. إلغاء جلسات Telegram المنتهية
    ===================================================== */

    const { data: expiredSessions, error: expiredError } = await supabase
      .from("bot_sessions")
      .select("id, telegram_user_id")
      .not("expires_at", "is", null)
      .lte("expires_at", now);

    if (expiredError) {
      console.error("Expired sessions error:", expiredError);
    }

    let cancelledSessions = 0;

    for (const session of expiredSessions || []) {
      const telegramResult = await sendTelegramMessage(
        botToken,
        session.telegram_user_id,
        "⏱️ تم إلغاء العملية بسبب عدم التجاوب لمدة دقيقتين.\n\nلم يتم حفظ أي جزء من العملية."
      );

      if (telegramResult?.ok) {
        await supabase.from("bot_sessions").delete().eq("id", session.id);
        cancelledSessions++;
      }
    }

    /* =====================================================
       2. تحويل المهام المنتهية إلى متأخرة
    ===================================================== */

    const overdueTasks = await markOverdueTasks();

    /* =====================================================
       3. التذكيرات التلقائية
    ===================================================== */

    const { data: reminders, error: remindersError } = await supabase
      .from("task_reminders")
      .select(`
        id,
        task_id,
        account_id,
        remind_at,
        reminder_type,
        tasks (
          id,
          title,
          due_at,
          status
        ),
        accounts (
          id,
          telegram_user_id,
          display_name,
          username,
          status
        )
      `)
      .eq("sent", false)
      .lte("remind_at", now)
      .order("remind_at", { ascending: true })
      .limit(200);

    if (remindersError) {
      console.error("Reminders error:", remindersError);
    }

    let sentReminders = 0;

    for (const reminder of reminders || []) {
      const account = reminder.accounts;
      const task = reminder.tasks;

      if (!account?.telegram_user_id || account.status !== "active" || !task) {
        continue;
      }

      if (["completed", "cancelled"].includes(task.status)) {
        await supabase
          .from("task_reminders")
          .update({ sent: true, sent_at: now })
          .eq("id", reminder.id)
          .eq("sent", false);
        continue;
      }

      const labels = {
        before_7_days: "بقي 7 أيام على انتهاء المهمة.",
        before_3_days: "بقي 3 أيام على انتهاء المهمة.",
        before_1_day: "بقي يوم واحد على انتهاء المهمة."
      };

      const message =
        "🔔 تذكير بمهمة\n\n" +
        `📌 ${task.title}\n` +
        `🔢 رقم المهمة: #${task.id}\n\n` +
        (labels[reminder.reminder_type] || "اقترب موعد انتهاء المهمة.") +
        "\n\n📱 افتح نظام Molim لمتابعة المهمة.";

      const telegramResult = await sendTelegramMessage(
        botToken,
        account.telegram_user_id,
        message
      );

      if (!telegramResult?.ok) {
        console.error("Telegram reminder error:", telegramResult);
        continue;
      }

      const { error: updateError } = await supabase
        .from("task_reminders")
        .update({ sent: true, sent_at: now })
        .eq("id", reminder.id)
        .eq("sent", false);

      if (updateError) {
        console.error("Reminder update error:", updateError);
        continue;
      }

      await supabase.from("notifications").insert({
        account_id: account.id,
        type: "task_reminder",
        title: "🔔 تذكير بمهمة",
        message,
        task_id: task.id,
        is_read: false
      });

      sentReminders++;
    }

    /* =====================================================
       4. تنبيهات المهام المتأخرة
    ===================================================== */

    const overdueNotifications = await notifyOverdueTasks(botToken);

    return NextResponse.json({
      success: true,
      processedAt: new Date().toISOString(),
      cancelledSessions,
      overdueTasks,
      sentReminders,
      overdueNotifications
    });
  } catch (error) {
    console.error("Cron error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Cron processing failed."
      },
      { status: 500 }
    );
  }
}
