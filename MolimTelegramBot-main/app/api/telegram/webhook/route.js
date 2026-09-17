import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { createTask as createTaskCore, taskTypeLabel } from "../../../../lib/task-service";

/*
=========================================================
TELEGRAM HELPERS
=========================================================
*/

async function telegramRequest(botToken, method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  return response.json();
}

async function sendMessage(
  botToken,
  chatId,
  text,
  replyMarkup = null
) {
  const body = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  return telegramRequest(
    botToken,
    "sendMessage",
    body
  );
}

async function editMessage(
  botToken,
  chatId,
  messageId,
  text,
  replyMarkup = null
) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  } else {
    body.reply_markup = {
      inline_keyboard: []
    };
  }

  return telegramRequest(
    botToken,
    "editMessageText",
    body
  );
}

async function answerCallback(
  botToken,
  callbackQueryId
) {
  return telegramRequest(
    botToken,
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId
    }
  );
}

/*
=========================================================
EDIT CURRENT BOT MESSAGE
=========================================================
*/

async function editCurrentBotMessage(
  botToken,
  chatId,
  session,
  text,
  replyMarkup = null
) {
  const messageId =
    session?.data?.messageId;

  if (!messageId) {
    return sendMessage(
      botToken,
      chatId,
      text,
      replyMarkup
    );
  }

  const result =
    await editMessage(
      botToken,
      chatId,
      messageId,
      text,
      replyMarkup
    );

  /*
   * إذا كانت الرسالة لم تعد قابلة للتعديل
   * نرسل رسالة جديدة كحل احتياطي.
   */
  if (!result?.ok) {
    console.error(
      "Edit message error:",
      result
    );

    return sendMessage(
      botToken,
      chatId,
      text,
      replyMarkup
    );
  }

  return result;
}

/*
=========================================================
BOT SESSION
=========================================================
*/

async function getBotSession(telegramUserId) {
  const { data, error } = await supabase
    .from("bot_sessions")
    .select("*")
    .eq(
      "telegram_user_id",
      String(telegramUserId)
    )
    .maybeSingle();

  if (error) {
    console.error(
      "Get bot session error:",
      error
    );

    return null;
  }

  if (!data) {
    return null;
  }

  if (
    data.expires_at &&
    new Date(data.expires_at).getTime() <=
      Date.now()
  ) {
    await supabase
      .from("bot_sessions")
      .delete()
      .eq(
        "telegram_user_id",
        String(telegramUserId)
      );

    return {
      expired: true
    };
  }

  return data;
}

async function createBotSession(
  telegramUserId,
  state,
  data = {}
) {
  const expiresAt = new Date(
    Date.now() + 2 * 60 * 1000
  ).toISOString();

  const { data: session, error } =
    await supabase
      .from("bot_sessions")
      .upsert(
        {
          telegram_user_id:
            String(telegramUserId),

          state,

          data,

          expires_at: expiresAt,

          updated_at:
            new Date().toISOString()
        },
        {
          onConflict:
            "telegram_user_id"
        }
      )
      .select()
      .single();

  if (error) {
    console.error(
      "Create bot session error:",
      error
    );

    return null;
  }

  return session;
}

async function updateBotSession(
  telegramUserId,
  state,
  data
) {
  const expiresAt = new Date(
    Date.now() + 2 * 60 * 1000
  ).toISOString();

  const { data: session, error } =
    await supabase
      .from("bot_sessions")
      .update({
        state,

        data,

        expires_at: expiresAt,

        updated_at:
          new Date().toISOString()
      })
      .eq(
        "telegram_user_id",
        String(telegramUserId)
      )
      .select()
      .single();

  if (error) {
    console.error(
      "Update bot session error:",
      error
    );

    return null;
  }

  return session;
}

async function deleteBotSession(
  telegramUserId
) {
  await supabase
    .from("bot_sessions")
    .delete()
    .eq(
      "telegram_user_id",
      String(telegramUserId)
    );
}

/*
=========================================================
USER ACCESS
=========================================================
*/

async function getUserAccess(
  telegramUserId
) {
  const { data: account, error } =
    await supabase
      .from("accounts")
      .select(`
        id,
        telegram_user_id,
        username,
        display_name,
        status,
        role_id,
        department_id,
        roles (
          id,
          name,
          label,
          management_level
        ),
        departments (
          id,
          name
        )
      `)
      .eq(
        "telegram_user_id",
        String(telegramUserId)
      )
      .maybeSingle();

  if (error) {
    console.error(
      "Account access error:",
      error
    );

    return null;
  }

  if (
    !account ||
    account.status !== "active"
  ) {
    return null;
  }

  let permissions = [];

  if (account.role_id) {
    const {
      data: rolePermissions,
      error: permissionError
    } = await supabase
      .from("role_permissions")
      .select(`
        permissions (
          key
        )
      `)
      .eq(
        "role_id",
        account.role_id
      );

    if (permissionError) {
      console.error(
        "Permission error:",
        permissionError
      );
    } else {
      permissions =
        (rolePermissions || [])
          .map(
            (item) =>
              item.permissions?.key
          )
          .filter(Boolean);
    }
  }

  return {
    ...account,
    permissions
  };
}

function hasPermission(
  user,
  permission
) {
  return (
    user?.permissions?.includes(
      permission
    ) || false
  );
}

/*
=========================================================
KEYBOARDS
=========================================================
*/

function cancelKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "❌ إلغاء العملية",
          callback_data:
            "cancel_operation"
        }
      ]
    ]
  };
}

function mainKeyboard(user) {
  const rows = [];

  if (
    hasPermission(
      user,
      "tasks.view"
    ) ||
    hasPermission(
      user,
      "tasks.create"
    ) ||
    hasPermission(
      user,
      "tasks.edit"
    ) ||
    hasPermission(
      user,
      "tasks.assign"
    )
  ) {
    rows.push([
      {
        text: "📋 المهام",
        callback_data: "tasks"
      }
    ]);
  }

  if (
    hasPermission(
      user,
      "announcements.view"
    ) ||
    hasPermission(
      user,
      "announcements.create"
    )
  ) {
    rows.push([
      {
        text: "📢 الإعلانات",
        callback_data:
          "announcements"
      }
    ]);
  }

  if (
    hasPermission(
      user,
      "users.view"
    ) ||
    hasPermission(
      user,
      "department.members.view"
    )
  ) {
    rows.push([
      {
        text: "👥 الفريق",
        callback_data: "team"
      }
    ]);
  }

  if (
    hasPermission(
      user,
      "departments.view"
    ) ||
    hasPermission(
      user,
      "departments.manage"
    )
  ) {
    rows.push([
      {
        text: "🏢 الأقسام",
        callback_data:
          "departments"
      }
    ]);
  }

  rows.push([
    {
      text: "🔔 التنبيهات",
      callback_data:
        "notifications"
    }
  ]);

  if (
    hasPermission(
      user,
      "statistics.view"
    )
  ) {
    rows.push([
      {
        text: "📊 الإحصائيات",
        callback_data:
          "statistics"
      }
    ]);
  }

  if (
    hasPermission(
      user,
      "system.manage"
    ) ||
    hasPermission(
      user,
      "users.manage"
    ) ||
    hasPermission(
      user,
      "roles.manage"
    )
  ) {
    rows.push([
      {
        text: "⚙️ إدارة النظام",
        callback_data:
          "system"
      }
    ]);
  }

  rows.push([
    {
      text: "❓ عن النظام",
      callback_data: "about"
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

/*
=========================================================
ABOUT
=========================================================
*/

const ABOUT_TEXT =
  "📋 عن نظام Molim\n\n" +
  "Molim هو نظام إداري متكامل لإدارة فرق العمل والأقسام والمهام والإعلانات والمتابعة اليومية من خلال Telegram وواجهة النظام.\n\n" +
  "🎯 ماذا يوفر النظام؟\n\n" +
  "• إنشاء المهام وتوزيعها على الأقسام والأشخاص.\n" +
  "• متابعة حالة المهام ونسبة الإنجاز.\n" +
  "• إضافة الملاحظات ومتابعة تفاصيل المهام.\n" +
  "• التذكيرات والتنبيهات الخاصة بالمهام.\n" +
  "• إنشاء الإعلانات وتوجيهها للأقسام المحددة.\n" +
  "• إدارة أعضاء الفريق والأقسام.\n" +
  "• نظام أدوار وصلاحيات حسب مسؤولية كل مستخدم.\n" +
  "• إحصائيات وتقارير عن أداء الفريق والمهام.\n" +
  "• ربط كل قسم بمجموعته الخاصة في Telegram.\n\n" +
  "🤖 يمكن تنفيذ العديد من الإجراءات مباشرة من البوت دون الحاجة إلى فتح النظام.\n\n" +
  "🔐 تظهر لكل مستخدم الإجراءات التي يمتلك صلاحية استخدامها فقط.";

function aboutKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🔙 رجوع",
          callback_data:
            "main_menu"
        }
      ]
    ]
  };
}

/*
=========================================================
TASK DEPARTMENTS
=========================================================
*/

async function getDepartments() {
  const { data, error } =
    await supabase
      .from("departments")
      .select(
        "id, name, telegram_chat_id"
      )
      .order(
        "id",
        {
          ascending: true
        }
      );

  if (error) {
    console.error(
      "Departments error:",
      error
    );

    return [];
  }

  return data || [];
}

function buildDepartmentKeyboard(
  departments,
  selectedIds
) {
  const rows = [];

  for (
    let i = 0;
    i < departments.length;
    i += 2
  ) {
    const row = [];

    for (
      let j = i;
      j < i + 2 &&
      j < departments.length;
      j++
    ) {
      const department =
        departments[j];

      const selected =
        selectedIds.includes(
          department.id
        );

      row.push({
        text:
          selected
            ? `🟢 ${department.name}`
            : `🔴 ${department.name}`,

        callback_data:
          `task_dept_toggle:${department.id}`
      });
    }

    rows.push(row);
  }

  rows.push([
    {
      text: "➡️ التالي",
      callback_data:
        "task_departments_next"
    }
  ]);

  rows.push([
    {
      text: "❌ إلغاء",
      callback_data:
        "cancel_operation"
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

/*
=========================================================
TASK PEOPLE
=========================================================
*/

async function getPeopleForDepartments(
  departmentIds
) {
  if (!departmentIds.length) {
    return [];
  }

  const {
    data: members,
    error
  } = await supabase
    .from("department_members")
    .select(`
      account_id,
      department_id,
      accounts (
        id,
        username,
        display_name,
        telegram_user_id,
        status
      ),
      departments (
        id,
        name
      )
    `)
    .in(
      "department_id",
      departmentIds
    );

  if (error) {
    console.error(
      "Department members error:",
      error
    );

    return [];
  }

  const map =
    new Map();

  for (
    const member of members || []
  ) {
    const account =
      member.accounts;

    if (
      !account ||
      account.status !==
        "active"
    ) {
      continue;
    }

    if (
      !map.has(
        account.id
      )
    ) {
      map.set(
        account.id,
        {
          id: account.id,
          name:
            account.display_name ||
            account.username ||
            `مستخدم ${account.id}`
        }
      );
    }
  }

  return Array.from(
    map.values()
  );
}

function buildPeopleKeyboard(
  people,
  selectedIds
) {
  const rows = [];

  for (
    let i = 0;
    i < people.length;
    i += 2
  ) {
    const row = [];

    for (
      let j = i;
      j < i + 2 &&
      j < people.length;
      j++
    ) {
      const person =
        people[j];

      const selected =
        selectedIds.includes(
          person.id
        );

      row.push({
        text:
          selected
            ? `🟢 ${person.name}`
            : `🔴 ${person.name}`,

        callback_data:
          `task_person_toggle:${person.id}`
      });
    }

    rows.push(row);
  }

  rows.push([
    {
      text: "➡️ التالي",
      callback_data:
        "task_people_next"
    }
  ]);

  rows.push([
    {
      text: "🔙 الأقسام",
      callback_data:
        "task_back_departments"
    }
  ]);

  rows.push([
    {
      text: "❌ إلغاء",
      callback_data:
        "cancel_operation"
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

/*
=========================================================
TASK PRIORITY
=========================================================
*/

function priorityKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🟢 منخفضة",
          callback_data:
            "task_priority:low"
        },
        {
          text: "🔵 عادية",
          callback_data:
            "task_priority:normal"
        }
      ],
      [
        {
          text: "🟠 عالية",
          callback_data:
            "task_priority:high"
        },
        {
          text: "🔴 عاجلة",
          callback_data:
            "task_priority:urgent"
        }
      ],
      [
        {
          text: "❌ إلغاء",
          callback_data:
            "cancel_operation"
        }
      ]
    ]
  };
}

function taskTypeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "👥 موزعة على الأشخاص", callback_data: "task_type:distributed" }
      ],
      [
        { text: "🏢 مهمة قسم", callback_data: "task_type:department" }
      ],
      [
        { text: "🏢🏢 متعددة الأقسام", callback_data: "task_type:multi_department" }
      ],
      [
        { text: "❌ إلغاء", callback_data: "cancel_operation" }
      ]
    ]
  };
}

/*
=========================================================
TASK PERIOD
=========================================================
*/

function periodKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "🌅 صباحًا",
          callback_data:
            "task_period:am"
        },
        {
          text: "🌙 مساءً",
          callback_data:
            "task_period:pm"
        }
      ],
      [
        {
          text: "🔙 تعديل الساعة",
          callback_data:
            "task_back_hour"
        }
      ],
      [
        {
          text: "❌ إلغاء",
          callback_data:
            "cancel_operation"
        }
      ]
    ]
  };
}

/*
=========================================================
TASK REMINDER
=========================================================
*/

function automaticReminderText() {
  return "🔔 التذكيرات تلقائية:

• قبل 7 أيام إذا كانت مدة المهمة أكثر من أسبوع.
• قبل 3 أيام.
• قبل يوم من انتهاء المهمة.";
}

/*
=========================================================
TASK NOTIFICATION MESSAGE
=========================================================
*/

function buildTaskNotificationMessage(
  task,
  data
) {
  const priorityNames = {
    low: "⚪ منخفضة",
    normal: "🟢 عادية",
    high: "🟡 عالية",
    urgent: "🔴 عاجلة"
  };

  const dueText =
    data.dueAt
      ? new Date(
          data.dueAt
        ).toLocaleString(
          "ar-SA",
          {
            timeZone:
              "Asia/Riyadh",
            dateStyle:
              "medium",
            timeStyle:
              "short"
          }
        )
      : "غير محدد";

  return (
    "📋 مهمة جديدة\n\n" +
    `📌 العنوان:\n${task.title}\n\n` +
    `📝 الوصف:\n${data.description || "لا يوجد وصف"}\n\n` +
    `⚡ الأولوية:\n${
      priorityNames[
        data.priority
      ] || "🔵 عادية"
    }\n\n` +
    `📅 موعد التسليم:\n${dueText}\n\n` +
    `🔢 رقم المهمة: #${task.id}\n\n` +
    "📱 افتح نظام Molim لعرض التفاصيل ومتابعة المهمة."
  );
}

function buildDepartmentTaskMessage(
  task,
  data,
  departmentName
) {
  const priorityNames = {
    low: "⚪ منخفضة",
    normal: "🟢 عادية",
    high: "🟡 عالية",
    urgent: "🔴 عاجلة"
  };

  const dueText =
    data.dueAt
      ? new Date(
          data.dueAt
        ).toLocaleString(
          "ar-SA",
          {
            timeZone:
              "Asia/Riyadh",
            dateStyle:
              "medium",
            timeStyle:
              "short"
          }
        )
      : "غير محدد";

  return (
    "📋 مهمة جديدة\n\n" +
    `🏢 القسم: ${departmentName}\n\n` +
    `📌 ${task.title}\n\n` +
    `📝 ${data.description || "لا يوجد وصف"}\n\n` +
    `⚡ الأولوية: ${
      priorityNames[
        data.priority
      ] || "🔵 عادية"
    }\n\n` +
    `📅 موعد التسليم: ${dueText}\n\n` +
    `🔢 رقم المهمة: #${task.id}\n\n` +
    "📱 افتح نظام Molim لعرض التفاصيل ومتابعة المهمة."
  );
}

/*
=========================================================
CREATE TASK
=========================================================
*/

async function createTaskFromSession(
  user,
  sessionData,
  botToken
) {
  const {
    title,
    description,
    departmentIds,
    assigneeIds,
    assignees,
    priority,
    dueAt,
    startAt,
    taskType
  } = sessionData;

  try {
    const result = await createTaskCore({
      actorId: user.id,
      title,
      description,
      taskType,
      priority,
      startAt,
      dueAt,
      departmentIds,
      assignees,
      assigneeIds
    });

    const task = result.task;
    const activeAssignees = result.assignees || [];

    const taskMessage = buildTaskNotificationMessage(
      task,
      sessionData
    );

    for (const account of activeAssignees) {
      if (account.telegram_user_id) {
        const telegramResult = await sendMessage(
          botToken,
          account.telegram_user_id,
          taskMessage
        );

        if (!telegramResult?.ok) {
          console.error(
            "Assignee Telegram notification error:",
            telegramResult
          );
        }
      }

      const { error: notificationError } = await supabase
        .from("notifications")
        .insert({
          account_id: account.id,
          type: "task_assigned",
          title: "📋 مهمة جديدة",
          message: taskMessage,
          task_id: task.id,
          is_read: false
        });

      if (notificationError) {
        console.error(
          "Assignee notification error:",
          notificationError
        );
      }
    }

    if (departmentIds?.length) {
      const { data: departments, error: departmentsError } = await supabase
        .from("departments")
        .select("id, name, telegram_chat_id")
        .in("id", departmentIds);

      if (departmentsError) {
        console.error(
          "Get task departments error:",
          departmentsError
        );
      } else {
        for (const department of departments || []) {
          if (!department.telegram_chat_id) continue;

          const groupMessage = buildDepartmentTaskMessage(
            task,
            sessionData,
            department.name
          );

          const telegramResult = await sendMessage(
            botToken,
            department.telegram_chat_id,
            groupMessage
          );

          if (!telegramResult?.ok) {
            console.error(
              `Department group notification error for ${department.name}:`,
              telegramResult
            );
          }
        }
      }
    }

    return {
      success: true,
      task
    };
  } catch (error) {
    console.error("Create task service error:", error);
    return {
      success: false,
      error
    };
  }
}

/*
=========================================================
TASK REVIEW
=========================================================
*/

async function getDepartmentNames(
  ids
) {
  if (!ids?.length) {
    return [];
  }

  const {
    data
  } = await supabase
    .from("departments")
    .select(
      "id, name, telegram_chat_id"
    )
    .in(
      "id",
      ids
    );

  return data || [];
}

async function getPersonNames(
  ids
) {
  if (!ids?.length) {
    return [];
  }

  const {
    data
  } = await supabase
    .from("accounts")
    .select(
      "id, display_name, username, telegram_user_id"
    )
    .in(
      "id",
      ids
    );

  return data || [];
}

async function buildTaskReview(
  data
) {
  const departments =
    await getDepartmentNames(
      data.departmentIds
    );

  const people =
    await getPersonNames(
      data.assigneeIds
    );

  const priorityNames = {
    low: "منخفضة",
    normal: "عادية",
    high: "عالية",
    urgent: "عاجلة"
  };

  const departmentText =
    departments.length
      ? departments
          .map(
            (item) =>
              `• ${item.name}`
          )
          .join("\n")
      : "لا يوجد";

  const peopleText =
    people.length
      ? people
          .map(
            (item) =>
              `• ${
                item.display_name ||
                item.username
              }`
          )
          .join("\n")
      : "لا يوجد";

  const dueText =
    data.dueAt
      ? new Date(
          data.dueAt
        ).toLocaleString(
          "ar-SA",
          {
            timeZone:
              "Asia/Riyadh",
            dateStyle:
              "medium",
            timeStyle:
              "short"
          }
        )
      : "غير محدد";

  return (
    "👀 مراجعة المهمة\n\n" +

    `📌 العنوان:\n${data.title}\n\n` +

    `📝 الوصف:\n${data.description || "لا يوجد وصف"}\n\n` +

    `🧩 نوع المهمة:\n${taskTypeLabel(data.taskType)}\n\n` +

    `🏢 الأقسام:\n${departmentText}\n\n` +

    `👥 الأشخاص:\n${peopleText}\n\n` +

    `⚡ الأولوية:\n${
      priorityNames[
        data.priority
      ] || "عادية"
    }\n\n` +

    `📅 الموعد:\n${dueText}\n\n` +

    `🔔 التذكيرات:\nتلقائية حسب موعد التسليم`
  );
}

function reviewKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ إنشاء المهمة",
          callback_data:
            "task_confirm"
        }
      ],
      [
        {
          text: "❌ إلغاء",
          callback_data:
            "cancel_operation"
        }
      ]
    ]
  };
}

/*
=========================================================
WEBHOOK
=========================================================
*/

export async function POST(
  request
) {
  try {
    const update =
      await request.json();

    const botToken =
      process.env
        .TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error(
        "TELEGRAM_BOT_TOKEN is missing."
      );

      return NextResponse.json(
        {
          ok: false
        },
        {
          status: 500
        }
      );
    }

    /*
    =====================================================
    CALLBACK QUERY
    =====================================================
    */

    if (
      update?.callback_query
    ) {
      const callback =
        update.callback_query;

      const telegramUserId =
        callback.from?.id;

      const chatId =
        callback.message
          ?.chat?.id;

      const messageId =
        callback.message
          ?.message_id;

      const action =
        callback.data;

      if (
        !telegramUserId ||
        !chatId
      ) {
        return NextResponse.json({
          ok: true
        });
      }

      await answerCallback(
        botToken,
        callback.id
      );

      const user =
        await getUserAccess(
          telegramUserId
        );

      if (!user) {
        if (
          messageId
        ) {
          await editMessage(
            botToken,
            chatId,
            messageId,
            "🚫 عذرًا، لا تمتلك صلاحية الوصول إلى نظام Molim."
          );
        } else {
          await sendMessage(
            botToken,
            chatId,
            "🚫 عذرًا، لا تمتلك صلاحية الوصول إلى نظام Molim."
          );
        }

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      MAIN MENU
      ===================================================
      */

      if (
        action ===
        "main_menu"
      ) {
        const name =
          user.display_name ||
          user.username ||
          "المستخدم";

        const text =
          `مرحبًا ${name} 👋\n\nاختر الإجراء الذي تريد تنفيذه:`;

        if (messageId) {
          await editMessage(
            botToken,
            chatId,
            messageId,
            text,
            mainKeyboard(user)
          );
        } else {
          await sendMessage(
            botToken,
            chatId,
            text,
            mainKeyboard(user)
          );
        }

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      ABOUT
      ===================================================
      */

      if (
        action === "about"
      ) {
        if (messageId) {
          await editMessage(
            botToken,
            chatId,
            messageId,
            ABOUT_TEXT,
            aboutKeyboard()
          );
        } else {
          await sendMessage(
            botToken,
            chatId,
            ABOUT_TEXT,
            aboutKeyboard()
          );
        }

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      CANCEL
      ===================================================
      */

      if (
        action ===
        "cancel_operation"
      ) {
        await deleteBotSession(
          telegramUserId
        );

        if (messageId) {
          await editMessage(
            botToken,
            chatId,
            messageId,
            "❌ تم إلغاء العملية بالكامل.",
            {
              inline_keyboard: [
                [
                  {
                    text: "🏠 الرئيسية",
                    callback_data:
                      "main_menu"
                  }
                ]
              ]
            }
          );
        } else {
          await sendMessage(
            botToken,
            chatId,
            "❌ تم إلغاء العملية بالكامل."
          );
        }

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      TASKS MENU
      ===================================================
      */

      if (
        action === "tasks"
      ) {
        if (
          !hasPermission(
            user,
            "tasks.view"
          ) &&
          !hasPermission(
            user,
            "tasks.create"
          )
        ) {
          if (messageId) {
            await editMessage(
              botToken,
              chatId,
              messageId,
              "🚫 لا تمتلك صلاحية الوصول إلى المهام.",
              {
                inline_keyboard: [
                  [
                    {
                      text: "🔙 الرئيسية",
                      callback_data:
                        "main_menu"
                    }
                  ]
                ]
              }
            );
          } else {
            await sendMessage(
              botToken,
              chatId,
              "🚫 لا تمتلك صلاحية الوصول إلى المهام."
            );
          }

          return NextResponse.json({
            ok: true
          });
        }

        const buttons = [];

        if (
          hasPermission(
            user,
            "tasks.create"
          )
        ) {
          buttons.push([
            {
              text: "➕ مهمة جديدة",
              callback_data:
                "task_new"
            }
          ]);
        }

        buttons.push([
          {
            text: "📋 مهامي",
            callback_data:
              "my_tasks"
          }
        ]);

        if (
          hasPermission(
            user,
            "department.tasks.view"
          )
        ) {
          buttons.push([
            {
              text: "🏢 مهام القسم",
              callback_data:
                "department_tasks"
            }
          ]);
        }

        buttons.push([
          {
            text: "📊 متابعة المهام",
            callback_data:
              "task_tracking"
          }
        ]);

        buttons.push([
          {
            text: "🔙 الرئيسية",
            callback_data:
              "main_menu"
          }
        ]);

        const taskMenuText =
          "📋 قسم المهام\n\nاختر الإجراء:";

        if (messageId) {
          await editMessage(
            botToken,
            chatId,
            messageId,
            taskMenuText,
            {
              inline_keyboard:
                buttons
            }
          );
        } else {
          await sendMessage(
            botToken,
            chatId,
            taskMenuText,
            {
              inline_keyboard:
                buttons
            }
          );
        }

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      START NEW TASK
      ===================================================
      */

      if (
        action === "task_new"
      ) {
        if (
          !hasPermission(
            user,
            "tasks.create"
          )
        ) {
          if (messageId) {
            await editMessage(
              botToken,
              chatId,
              messageId,
              "🚫 لا تمتلك صلاحية إنشاء المهام.",
              {
                inline_keyboard: [
                  [
                    {
                      text: "🔙 الرئيسية",
                      callback_data:
                        "main_menu"
                    }
                  ]
                ]
              }
            );
          } else {
            await sendMessage(
              botToken,
              chatId,
              "🚫 لا تمتلك صلاحية إنشاء المهام."
            );
          }

          return NextResponse.json({
            ok: true
          });
        }

        const session =
          await createBotSession(
            telegramUserId,
            "creating_task_title",
            {
              title: "",
              description: "",
              departmentIds: [],
              assigneeIds: [],
              priority:
                "normal",
              dueAt: null,
              dueDate: null,
              dueHour: null,
              dueMinute: 0,
              duePeriod: null,
              taskType: "distributed",

              /*
              * رقم رسالة الواجهة
              * التي سيتم تعديلها
              */
              messageId:
                messageId || null
            }
          );

        if (!session) {
          if (messageId) {
            await editMessage(
              botToken,
              chatId,
              messageId,
              "❌ تعذر بدء إنشاء المهمة.",
              {
                inline_keyboard: [
                  [
                    {
                      text: "🔙 الرئيسية",
                      callback_data:
                        "main_menu"
                    }
                  ]
                ]
              }
            );
          }

          return NextResponse.json({
            ok: true
          });
        }

        const text =
          "➕ إنشاء مهمة جديدة\n\n✏️ أرسل عنوان المهمة:";

        if (messageId) {
          await editMessage(
            botToken,
            chatId,
            messageId,
            text,
            cancelKeyboard()
          );
        } else {
          await sendMessage(
            botToken,
            chatId,
            text,
            cancelKeyboard()
          );
        }

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      GET SESSION
      ===================================================
      */

      let session =
        await getBotSession(
          telegramUserId
        );

      /*
      ===================================================
      EXPIRED SESSION
      ===================================================
      */

      if (
        session?.expired
      ) {
        if (messageId) {
          await editMessage(
            botToken,
            chatId,
            messageId,
            "⏱️ تم إلغاء العملية بسبب عدم التجاوب لمدة دقيقتين.\n\nلم يتم حفظ أي جزء من المهمة.",
            {
              inline_keyboard: [
                [
                  {
                    text: "🏠 الرئيسية",
                    callback_data:
                      "main_menu"
                  }
                ]
              ]
            }
          );
        } else {
          await sendMessage(
            botToken,
            chatId,
            "⏱️ تم إلغاء العملية بسبب عدم التجاوب لمدة دقيقتين.\n\nلم يتم حفظ أي جزء من المهمة."
          );
        }

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      DEPARTMENT TOGGLE
      ===================================================
      */

      if (
        action.startsWith(
          "task_dept_toggle:"
        )
      ) {
        if (
          !session ||
          session.state !==
            "creating_task_departments"
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const departmentId =
          Number(
            action.split(
              ":"
            )[1]
          );

        const data =
          session.data || {};

        const selected =
          Array.isArray(
            data.departmentIds
          )
            ? [
                ...data.departmentIds
              ]
            : [];

        const index =
          selected.indexOf(
            departmentId
          );

        if (index >= 0) {
          selected.splice(
            index,
            1
          );
        } else {
          selected.push(
            departmentId
          );
        }

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_departments",
            {
              ...data,
              departmentIds:
                selected
            }
          );

        if (!updated) {
          await editCurrentBotMessage(
            botToken,
            chatId,
            session,
            "حدث خطأ أثناء حفظ الاختيار."
          );

          return NextResponse.json({
            ok: true
          });
        }

        const departments =
          await getDepartments();

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "🏢 اختر الأقسام التي ستشارك في المهمة:",
          buildDepartmentKeyboard(
            departments,
            selected
          )
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      DEPARTMENT NEXT
      ===================================================
      */

      if (
        action ===
        "task_departments_next"
      ) {
        if (
          !session ||
          session.state !==
            "creating_task_departments"
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const data =
          session.data || {};

        if (
          !data.departmentIds
            ?.length
        ) {
          await editCurrentBotMessage(
            botToken,
            chatId,
            session,
            "⚠️ اختر قسمًا واحدًا على الأقل أولًا.",
            buildDepartmentKeyboard(
              await getDepartments(),
              data.departmentIds ||
                []
            )
          );

          return NextResponse.json({
            ok: true
          });
        }

        const updated = await updateBotSession(
          telegramUserId,
          "creating_task_type",
          {
            ...data,
            taskType: data.taskType || "distributed",
            assigneeIds: []
          }
        );

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "🧩 اختر نوع المهمة:",
          taskTypeKeyboard()
        );

        return NextResponse.json({ ok: true });

      /*
      ===================================================
      BACK TO DEPARTMENTS
      ===================================================
      */

      if (
        action ===
        "task_back_departments"
      ) {
        const data =
          session?.data || {};

        if (!session) {
          return NextResponse.json({
            ok: true
          });
        }

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_departments",
            data
          );

        const departments =
          await getDepartments();

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "🏢 اختر الأقسام التي ستشارك في المهمة:",
          buildDepartmentKeyboard(
            departments,
            data.departmentIds ||
              []
          )
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      TASK TYPE
      ===================================================
      */

      if (action.startsWith("task_type:")) {
        if (!session || session.state !== "creating_task_type") {
          return NextResponse.json({ ok: true });
        }

        const taskType = action.split(":")[1];
        const allowedTypes = [
          "distributed",
          "department",
          "multi_department"
        ];

        if (!allowedTypes.includes(taskType)) {
          return NextResponse.json({ ok: true });
        }

        const data = session.data || {};
        const nextData = {
          ...data,
          taskType,
          assigneeIds: taskType === "distributed" ? (data.assigneeIds || []) : []
        };

        if (taskType === "distributed") {
          const people = await getPeopleForDepartments(data.departmentIds || []);
          const updated = await updateBotSession(
            telegramUserId,
            "creating_task_people",
            nextData
          );

          await editCurrentBotMessage(
            botToken,
            chatId,
            updated,
            "👥 اختر الأشخاص المسؤولين عن المهمة:",
            buildPeopleKeyboard(people, [])
          );
        } else {
          const updated = await updateBotSession(
            telegramUserId,
            "creating_task_priority",
            nextData
          );

          await editCurrentBotMessage(
            botToken,
            chatId,
            updated,
            "⚡ اختر أولوية المهمة:",
            priorityKeyboard()
          );
        }

        return NextResponse.json({ ok: true });
      }

      /*
      ===================================================
      PEOPLE TOGGLE
      ===================================================
      */

      if (
        action.startsWith(
          "task_person_toggle:"
        )
      ) {
        if (
          !session ||
          session.state !==
            "creating_task_people"
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const personId =
          Number(
            action.split(
              ":"
            )[1]
          );

        const data =
          session.data || {};

        const selected =
          Array.isArray(
            data.assigneeIds
          )
            ? [
                ...data.assigneeIds
              ]
            : [];

        const index =
          selected.indexOf(
            personId
          );

        if (index >= 0) {
          selected.splice(
            index,
            1
          );
        } else {
          selected.push(
            personId
          );
        }

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_people",
            {
              ...data,
              assigneeIds:
                selected
            }
          );

        const people =
          await getPeopleForDepartments(
            data.departmentIds ||
              []
          );

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "👥 اختر الأشخاص المسؤولين عن المهمة:",
          buildPeopleKeyboard(
            people,
            selected
          )
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      PEOPLE NEXT
      ===================================================
      */

      if (
        action ===
        "task_people_next"
      ) {
        if (
          !session ||
          session.state !==
            "creating_task_people"
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const data =
          session.data || {};

        if (data.taskType === "distributed" && !data.assigneeIds?.length) {
          await editCurrentBotMessage(
            botToken,
            chatId,
            session,
            "⚠️ اختر شخصًا واحدًا على الأقل للمهمة.",
            buildPeopleKeyboard(
              await getPeopleForDepartments(data.departmentIds || []),
              []
            )
          );
          return NextResponse.json({ ok: true });
        }

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_priority",
            data
          );

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "⚡ اختر أولوية المهمة:",
          priorityKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      PRIORITY
      ===================================================
      */

      if (
        action.startsWith(
          "task_priority:"
        )
      ) {
        if (
          !session ||
          session.state !==
            "creating_task_priority"
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const priority =
          action.split(
            ":"
          )[1];

        const allowed = [
          "low",
          "normal",
          "high",
          "urgent"
        ];

        if (
          !allowed.includes(
            priority
          )
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_due_date",
            {
              ...session.data,
              priority,
              dueDate: null,
              dueHour: null,
              dueMinute: 0,
              duePeriod: null,
              dueAt: null
            }
          );

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "📅 أرسل تاريخ التسليم.\n\nمثال:\n2026-09-20",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      BACK DUE
      ===================================================
      */

      if (
        action ===
        "task_back_due"
      ) {
        const data =
          session?.data || {};

        if (!session) {
          return NextResponse.json({
            ok: true
          });
        }

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_due_date",
            data
          );

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "📅 أرسل تاريخ التسليم.\n\nمثال:\n2026-09-20",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      BACK HOUR
      ===================================================
      */

      if (
        action ===
        "task_back_hour"
      ) {
        const data =
          session?.data || {};

        if (!session) {
          return NextResponse.json({
            ok: true
          });
        }

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_due_hour",
            data
          );

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          "🕐 أرسل ساعة التسليم.\n\nمثال:\n8\nأو:\n8:30",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      PERIOD
      ===================================================
      */

      if (
        action.startsWith(
          "task_period:"
        )
      ) {
        if (
          !session ||
          session.state !==
            "creating_task_due_period"
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const period =
          action.split(
            ":"
          )[1];

        if (
          !["am", "pm"].includes(
            period
          )
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const data =
          session.data || {};

        if (
          !data.dueDate ||
          !data.dueHour
        ) {
          await editCurrentBotMessage(
            botToken,
            chatId,
            session,
            "⚠️ بيانات الموعد غير مكتملة. أعد إدخال الموعد.",
            cancelKeyboard()
          );

          return NextResponse.json({
            ok: true
          });
        }

        let hour =
          Number(
            data.dueHour
          );

        const minute =
          Number(
            data.dueMinute || 0
          );

        if (
          period === "am"
        ) {
          if (hour === 12) {
            hour = 0;
          }
        } else {
          if (hour !== 12) {
            hour += 12;
          }
        }

        /*
        * توقيت السعودية / اليمن / +03
        */
        const dueAt =
          new Date(
            `${data.dueDate}T${String(
              hour
            ).padStart(
              2,
              "0"
            )}:${String(
              minute
            ).padStart(
              2,
              "0"
            )}:00+03:00`
          );

        if (
          Number.isNaN(
            dueAt.getTime()
          )
        ) {
          await editCurrentBotMessage(
            botToken,
            chatId,
            session,
            "⚠️ تعذر إنشاء الموعد. أعد المحاولة.",
            cancelKeyboard()
          );

          return NextResponse.json({
            ok: true
          });
        }

        if (
          dueAt.getTime() <=
          Date.now()
        ) {
          const updated =
            await updateBotSession(
              telegramUserId,
              "creating_task_due_date",
              {
                ...data,
                dueAt: null
              }
            );

          await editCurrentBotMessage(
            botToken,
            chatId,
            updated,
            "⚠️ موعد التسليم يجب أن يكون في المستقبل.\n\nأعد إدخال التاريخ والساعة.",
            cancelKeyboard()
          );

          return NextResponse.json({
            ok: true
          });
        }

        const updatedData =
          {
            ...data,
            duePeriod:
              period,
            dueAt:
              dueAt.toISOString()
          };

        const updated =
          await updateBotSession(
            telegramUserId,
            "creating_task_review",
            updatedData
          );

        const review = await buildTaskReview(updatedData);

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          `${review}\n\n${automaticReminderText()}`,
          reviewKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      LEGACY REMINDER CALLBACK
      ===================================================
      */

      if (action.startsWith("task_reminder:")) {
        if (!session) {
          return NextResponse.json({ ok: true });
        }

        const data = session.data || {};
        const updated = await updateBotSession(
          telegramUserId,
          "creating_task_review",
          data
        );
        const review = await buildTaskReview(data);

        await editCurrentBotMessage(
          botToken,
          chatId,
          updated,
          `${review}\n\n${automaticReminderText()}`,
          reviewKeyboard()
        );

        return NextResponse.json({ ok: true });
      }

      /*
      ===================================================
      CONFIRM TASK
      ===================================================
      */

      if (
        action ===
        "task_confirm"
      ) {
        if (
          !session ||
          session.state !==
            "creating_task_review"
        ) {
          return NextResponse.json({
            ok: true
          });
        }

        const data =
          session.data || {};

        /*
        * نعرض حالة الإنشاء داخل نفس الرسالة
        */
        await editCurrentBotMessage(
          botToken,
          chatId,
          session,
          "⏳ جاري إنشاء المهمة وتوزيعها..."
        );

        const result =
          await createTaskFromSession(
            user,
            data,
            botToken
          );

        if (
          !result.success
        ) {
          await editCurrentBotMessage(
            botToken,
            chatId,
            session,
            "❌ حدث خطأ أثناء إنشاء المهمة.\n\nلم يتم حفظ المهمة.",
            {
              inline_keyboard: [
                [
                  {
                    text: "🏠 الرئيسية",
                    callback_data:
                      "main_menu"
                  }
                ]
              ]
            }
          );

          return NextResponse.json({
            ok: true
          });
        }

        await deleteBotSession(
          telegramUserId
        );

        await editMessage(
          botToken,
          chatId,
          data.messageId ||
            messageId,
          `✅ تم إنشاء المهمة بنجاح.\n\n📌 ${result.task.title}\n\nرقم المهمة: #${result.task.id}`,
          {
            inline_keyboard: [
              [
                {
                  text: "📋 المهام",
                  callback_data:
                    "tasks"
                }
              ],
              [
                {
                  text: "🏠 الرئيسية",
                  callback_data:
                    "main_menu"
                }
              ]
            ]
          }
        );

        return NextResponse.json({
          ok: true
        });
      }

      /*
      ===================================================
      UNKNOWN CALLBACK
      ===================================================
      */

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    NORMAL MESSAGE
    =====================================================
    */

    const message =
      update?.message;

    if (!message) {
      return NextResponse.json({
        ok: true
      });
    }

    const chatId =
      message.chat?.id;

    const text =
      message.text;

    const telegramUserId =
      message.from?.id;

    if (
      !chatId ||
      !telegramUserId ||
      !text
    ) {
      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    START
    =====================================================
    */

    if (
      text === "/start"
    ) {
      const user =
        await getUserAccess(
          telegramUserId
        );

      if (!user) {
        await sendMessage(
          botToken,
          chatId,
          "🚫 عذرًا، لا تمتلك صلاحية الوصول إلى نظام Molim.\n\nإذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع إدارة النظام."
        );

        return NextResponse.json({
          ok: true
        });
      }

      const name =
        user.display_name ||
        user.username ||
        "المستخدم";

      await sendMessage(
        botToken,
        chatId,
        `مرحبًا ${name} 👋\n\nاختر الإجراء الذي تريد تنفيذه:`,
        mainKeyboard(user)
      );

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    USER ACCESS
    =====================================================
    */

    const user =
      await getUserAccess(
        telegramUserId
      );

    if (!user) {
      await sendMessage(
        botToken,
        chatId,
        "🚫 عذرًا، لا تمتلك صلاحية الوصول إلى نظام Molim."
      );

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    SESSION
    =====================================================
    */

    const session =
      await getBotSession(
        telegramUserId
      );

    /*
    =====================================================
    EXPIRED
    =====================================================
    */

    if (
      session?.expired
    ) {
      await sendMessage(
        botToken,
        chatId,
        "⏱️ تم إلغاء العملية بسبب عدم التجاوب لمدة دقيقتين.\n\nلم يتم حفظ أي جزء من المهمة."
      );

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    NO ACTIVE SESSION
    =====================================================
    */

    if (!session) {
      if (
        text ===
        "لوحة التحكم"
      ) {
        await sendMessage(
          botToken,
          chatId,
          "🏠 لوحة التحكم\n\nاختر الإجراء:",
          mainKeyboard(user)
        );
      }

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    TASK TITLE
    =====================================================
    */

    if (
      session.state ===
      "creating_task_title"
    ) {
      const title =
        text.trim();

      if (!title) {
        await editCurrentBotMessage(
          botToken,
          chatId,
          session,
          "⚠️ أرسل عنوانًا صحيحًا للمهمة:",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      const updated =
        await updateBotSession(
          telegramUserId,
          "creating_task_description",
          {
            ...session.data,
            title
          }
        );

      await editCurrentBotMessage(
        botToken,
        chatId,
        updated,
        "📝 ممتاز.\n\nالآن أرسل وصف المهمة:",
        cancelKeyboard()
      );

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    TASK DESCRIPTION
    =====================================================
    */

    if (
      session.state ===
      "creating_task_description"
    ) {
      const description =
        text.trim();

      if (!description) {
        await editCurrentBotMessage(
          botToken,
          chatId,
          session,
          "⚠️ أرسل وصفًا للمهمة:",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      const data = {
        ...session.data,
        description
      };

      const updated =
        await updateBotSession(
          telegramUserId,
          "creating_task_departments",
          data
        );

      const departments =
        await getDepartments();

      await editCurrentBotMessage(
        botToken,
        chatId,
        updated,
        "🏢 اختر الأقسام التي ستشارك في المهمة:",
        buildDepartmentKeyboard(
          departments,
          []
        )
      );

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    TASK DUE DATE
    =====================================================
    */

    if (
      session.state ===
      "creating_task_due_date"
    ) {
      const value =
        text.trim();

      const match =
        value.match(
          /^(\d{4})-(\d{2})-(\d{2})$/
        );

      if (!match) {
        await editCurrentBotMessage(
          botToken,
          chatId,
          session,
          "⚠️ صيغة التاريخ غير صحيحة.\n\nاستخدم مثلًا:\n2026-09-20",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      const year =
        Number(match[1]);

      const month =
        Number(match[2]);

      const day =
        Number(match[3]);

      const testDate =
        new Date(
          Date.UTC(
            year,
            month - 1,
            day
          )
        );

      if (
        testDate.getUTCFullYear() !==
          year ||
        testDate.getUTCMonth() !==
          month - 1 ||
        testDate.getUTCDate() !==
          day
      ) {
        await editCurrentBotMessage(
          botToken,
          chatId,
          session,
          "⚠️ التاريخ غير صحيح.\n\nأرسل تاريخًا صحيحًا مثل:\n2026-09-20",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      const updated =
        await updateBotSession(
          telegramUserId,
          "creating_task_due_hour",
          {
            ...session.data,
            dueDate: value,
            dueHour: null,
            dueMinute: 0,
            duePeriod: null,
            dueAt: null
          }
        );

      await editCurrentBotMessage(
        botToken,
        chatId,
        updated,
        "🕐 الآن أرسل ساعة التسليم.\n\nمثال:\n8\nأو:\n8:30",
        cancelKeyboard()
      );

      return NextResponse.json({
        ok: true
      });
    }

    /*
    =====================================================
    TASK DUE HOUR
    =====================================================
    */

    if (
      session.state ===
      "creating_task_due_hour"
    ) {
      const value =
        text.trim();

      const match =
        value.match(
          /^(\d{1,2})(?::(\d{1,2}))?$/
        );

      if (!match) {
        await editCurrentBotMessage(
          botToken,
          chatId,
          session,
          "⚠️ صيغة الساعة غير صحيحة.\n\nاكتب مثلًا:\n8\nأو:\n8:30",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      const hour =
        Number(match[1]);

      const minute =
        Number(
          match[2] || 0
        );

      if (
        hour < 1 ||
        hour > 12 ||
        minute < 0 ||
        minute > 59
      ) {
        await editCurrentBotMessage(
          botToken,
          chatId,
          session,
          "⚠️ الساعة يجب أن تكون من 1 إلى 12، والدقائق من 00 إلى 59.\n\nمثال:\n8:30",
          cancelKeyboard()
        );

        return NextResponse.json({
          ok: true
        });
      }

      const updated =
        await updateBotSession(
          telegramUserId,
          "creating_task_due_period",
          {
            ...session.data,
            dueHour: hour,
            dueMinute: minute,
            duePeriod: null,
            dueAt: null
          }
        );

      await editCurrentBotMessage(
        botToken,
        chatId,
        updated,
        `🕐 الوقت الذي أدخلته: ${hour}:${String(
          minute
        ).padStart(
          2,
          "0"
        )}\n\nاختر الفترة:`,
        periodKeyboard()
      );

      return NextResponse.json({
        ok: true
      });
    }

    return NextResponse.json({
      ok: true
    });

  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    return NextResponse.json(
      {
        ok: false
      },
      {
        status: 500
      }
    );
  }
}
