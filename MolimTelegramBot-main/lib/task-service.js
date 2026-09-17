import { supabase } from "./supabase";

export const TASK_TYPES = {
  DISTRIBUTED: "distributed",
  DEPARTMENT: "department",
  MULTI_DEPARTMENT: "multi_department"
};

export const TASK_STATUSES = {
  WAITING_ACCEPTANCE: "waiting_acceptance",
  IN_PROGRESS: "in_progress",
  WAITING_REVIEW: "waiting_review",
  COMPLETED: "completed",
  REJECTED: "rejected",
  OVERDUE: "overdue",
  CANCELLED: "cancelled"
};

export const ASSIGNEE_STATUSES = TASK_STATUSES;
export const DEPARTMENT_STATUSES = TASK_STATUSES;

export const PRIORITIES = ["low", "normal", "high", "urgent"];

const PERMISSION_ALIASES = {
  view: ["tasks.view"],
  create: ["tasks.create"],
  edit: ["tasks.edit"],
  assign: ["tasks.assign", "tasks.assignees.manage"],
  complete: ["tasks.complete"],
  review: ["tasks.review"],
  reopen: ["tasks.reopen"],
  filesView: ["tasks.files.view"],
  filesUpload: ["tasks.files.upload"],
  historyView: ["tasks.history.view"]
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueNumbers(values) {
  return [...new Set(
    asArray(values)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
  )];
}

export function normalizeTaskType(value) {
  if (value === TASK_TYPES.DEPARTMENT) return value;
  if (value === TASK_TYPES.MULTI_DEPARTMENT) return value;
  return TASK_TYPES.DISTRIBUTED;
}

export function normalizePriority(value) {
  return PRIORITIES.includes(value) ? value : "normal";
}

export function priorityLabel(priority) {
  const labels = {
    low: "منخفضة",
    normal: "عادية",
    high: "عالية",
    urgent: "عاجلة"
  };

  return labels[priority] || labels.normal;
}

export function taskTypeLabel(type) {
  const labels = {
    distributed: "موزعة على الأشخاص",
    department: "مهمة قسم",
    multi_department: "مهمة متعددة الأقسام"
  };

  return labels[type] || labels.distributed;
}

export function statusLabel(status) {
  const labels = {
    waiting_acceptance: "بانتظار القبول",
    in_progress: "قيد التنفيذ",
    waiting_review: "بانتظار المراجعة",
    completed: "مكتملة",
    rejected: "مرفوضة",
    overdue: "متأخرة",
    cancelled: "ملغاة"
  };

  return labels[status] || status || "غير محددة";
}

export function statusColorKey(status) {
  if (status === "completed") return "success";
  if (status === "rejected" || status === "cancelled") return "danger";
  if (status === "overdue") return "overdue";
  if (status === "waiting_review") return "review";
  if (status === "in_progress") return "progress";
  return "waiting";
}

async function getRolePermissionIds(roleId) {
  if (!roleId) return [];

  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_id")
    .eq("role_id", roleId);

  if (error) throw error;
  return (data || []).map((row) => Number(row.permission_id));
}

async function getAccountOverrides(accountId) {
  const { data, error } = await supabase
    .from("account_permissions")
    .select("permission_id, effect")
    .eq("account_id", accountId);

  if (error) throw error;
  return data || [];
}

async function getPermissionKeys(ids) {
  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from("permissions")
    .select("id, key");

  if (error) throw error;

  const wanted = new Set(ids);
  return new Map(
    (data || [])
      .filter((row) => wanted.has(Number(row.id)))
      .map((row) => [Number(row.id), row.key])
  );
}

export async function getEffectivePermissions(accountId) {
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, role_id, status")
    .eq("id", accountId)
    .maybeSingle();

  if (accountError) throw accountError;
  if (!account) return [];
  if (account.status !== "active") return [];

  const [rolePermissionIds, overrides] = await Promise.all([
    getRolePermissionIds(account.role_id),
    getAccountOverrides(account.id)
  ]);

  const overrideMap = new Map(
    overrides.map((row) => [Number(row.permission_id), row.effect])
  );

  const ids = new Set(rolePermissionIds);

  for (const row of overrides) {
    const permissionId = Number(row.permission_id);
    if (row.effect === "allow") ids.add(permissionId);
    if (row.effect === "deny") ids.delete(permissionId);
  }

  const keys = await getPermissionKeys([...ids]);
  return [...ids].map((id) => keys.get(id)).filter(Boolean);
}

export async function hasPermission(accountId, permissionKey) {
  const permissions = await getEffectivePermissions(accountId);
  return permissions.includes("*") || permissions.includes(permissionKey);
}

export async function hasAnyPermission(accountId, permissionKeys) {
  const permissions = await getEffectivePermissions(accountId);
  if (permissions.includes("*")) return true;
  return asArray(permissionKeys).some((key) => permissions.includes(key));
}

async function ensurePermission(accountId, alias) {
  const keys = PERMISSION_ALIASES[alias] || [alias];
  const allowed = await hasAnyPermission(accountId, keys);
  if (!allowed) {
    const error = new Error("PERMISSION_DENIED");
    error.code = "PERMISSION_DENIED";
    throw error;
  }
}

async function getDepartmentHeads(departmentIds) {
  const ids = uniqueNumbers(departmentIds);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("department_members")
    .select(`
      account_id,
      department_id,
      is_head,
      accounts (
        id,
        display_name,
        username,
        telegram_user_id,
        status
      )
    `)
    .in("department_id", ids)
    .eq("is_head", true);

  if (error) throw error;

  return (data || []).filter(
    (row) => row.accounts?.status === "active"
  );
}

function normalizeAssignees(assignees, assigneeIds) {
  if (Array.isArray(assignees)) {
    return assignees
      .map((item) => ({
        accountId: Number(item?.accountId ?? item?.account_id),
        workDescription:
          typeof item?.workDescription === "string"
            ? item.workDescription.trim() || null
            : typeof item?.work_description === "string"
              ? item.work_description.trim() || null
              : null
      }))
      .filter((item) => Number.isFinite(item.accountId));
  }

  return uniqueNumbers(assigneeIds).map((accountId) => ({
    accountId,
    workDescription: null
  }));
}

async function getActiveAccounts(accountIds) {
  const ids = uniqueNumbers(accountIds);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("accounts")
    .select("id, display_name, username, telegram_user_id, status")
    .in("id", ids);

  if (error) throw error;
  return (data || []).filter((account) => account.status === "active");
}

function uniqueAssigneeRows(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!Number.isFinite(Number(row.accountId))) continue;
    if (!map.has(Number(row.accountId))) {
      map.set(Number(row.accountId), {
        accountId: Number(row.accountId),
        workDescription: row.workDescription || null
      });
    } else if (row.workDescription) {
      map.get(Number(row.accountId)).workDescription = row.workDescription;
    }
  }

  return [...map.values()];
}

function reminderDates(dueAt, startAt = null) {
  if (!dueAt) return [];

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return [];

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const oneDay = 24 * 60 * 60 * 1000;

  const candidates = [];

  const start = startAt ? new Date(startAt) : new Date();
  const duration = due.getTime() - (Number.isNaN(start.getTime()) ? now : start.getTime());

  if (duration > sevenDays) {
    candidates.push({
      type: "before_7_days",
      at: new Date(due.getTime() - sevenDays)
    });
  }

  candidates.push({
    type: "before_3_days",
    at: new Date(due.getTime() - threeDays)
  });

  candidates.push({
    type: "before_1_day",
    at: new Date(due.getTime() - oneDay)
  });

  return candidates.filter((item) => item.at.getTime() > now);
}

export async function createAutomaticReminders(taskId, dueAt, startAt, accountIds) {
  const dates = reminderDates(dueAt, startAt);
  const recipients = uniqueNumbers(accountIds);

  if (!dates.length || !recipients.length) return;

  const rows = [];

  for (const recipient of recipients) {
    for (const reminder of dates) {
      rows.push({
        task_id: taskId,
        account_id: recipient,
        remind_at: reminder.at.toISOString(),
        reminder_type: reminder.type,
        sent: false
      });
    }
  }

  const { error } = await supabase
    .from("task_reminders")
    .insert(rows);

  if (error) throw error;
}

export async function createTask({
  actorId,
  title,
  description = "",
  taskType = TASK_TYPES.DISTRIBUTED,
  priority = "normal",
  startAt = null,
  dueAt,
  departmentIds = [],
  assignees = [],
  assigneeIds = []
}) {
  await ensurePermission(actorId, "create");

  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new Error("TASK_TITLE_REQUIRED");
  if (!dueAt) throw new Error("TASK_DUE_REQUIRED");

  const normalizedType = normalizeTaskType(taskType);
  const normalizedPriority = normalizePriority(priority);
  const departments = uniqueNumbers(departmentIds);

  if (!departments.length) {
    throw new Error("TASK_DEPARTMENT_REQUIRED");
  }

  if (normalizedType === TASK_TYPES.DEPARTMENT && departments.length !== 1) {
    throw new Error("DEPARTMENT_TASK_REQUIRES_ONE_DEPARTMENT");
  }

  if (
    normalizedType === TASK_TYPES.MULTI_DEPARTMENT &&
    departments.length < 2
  ) {
    throw new Error("MULTI_DEPARTMENT_TASK_REQUIRES_MULTIPLE_DEPARTMENTS");
  }

  let requestedAssignees = normalizeAssignees(assignees, assigneeIds);

  if (
    normalizedType === TASK_TYPES.DEPARTMENT ||
    normalizedType === TASK_TYPES.MULTI_DEPARTMENT
  ) {
    const heads = await getDepartmentHeads(departments);
    requestedAssignees = uniqueAssigneeRows([
      ...heads.map((row) => ({
        accountId: row.account_id,
        workDescription: null
      })),
      ...requestedAssignees
    ]);
  }

  const activeAccounts = await getActiveAccounts(
    requestedAssignees.map((item) => item.accountId)
  );
  const activeIds = new Set(activeAccounts.map((account) => Number(account.id)));
  requestedAssignees = requestedAssignees.filter((item) => activeIds.has(item.accountId));

  if (!requestedAssignees.length) {
    throw new Error("TASK_ASSIGNEE_REQUIRED");
  }

  const headRows = await getDepartmentHeads(departments);
  const headByDepartment = new Map(
    headRows.map((row) => [Number(row.department_id), Number(row.account_id)])
  );

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      title: cleanTitle,
      description: String(description || "").trim(),
      task_type: normalizedType,
      priority: normalizedPriority,
      status: TASK_STATUSES.WAITING_ACCEPTANCE,
      created_by: actorId,
      start_at: startAt || new Date().toISOString(),
      due_at: new Date(dueAt).toISOString(),
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (taskError) throw taskError;

  try {
    const departmentRows = departments.map((departmentId) => ({
      task_id: task.id,
      department_id: departmentId,
      status: TASK_STATUSES.WAITING_ACCEPTANCE,
      responsible_account_id: headByDepartment.get(departmentId) || null
    }));

    const { error: departmentError } = await supabase
      .from("task_departments")
      .insert(departmentRows);

    if (departmentError) throw departmentError;

    const assigneeRows = requestedAssignees.map((item) => ({
      task_id: task.id,
      account_id: item.accountId,
      work_description: item.workDescription,
      status: TASK_STATUSES.WAITING_ACCEPTANCE
    }));

    const { error: assigneeError } = await supabase
      .from("task_assignees")
      .insert(assigneeRows);

    if (assigneeError) throw assigneeError;

    await createAutomaticReminders(
      task.id,
      task.due_at,
      task.start_at,
      requestedAssignees.map((item) => item.accountId)
    );

    await addTaskHistory({
      taskId: task.id,
      accountId: actorId,
      action: "created",
      newValue: "تم إنشاء المهمة",
      metadata: {
        task_type: normalizedType,
        priority: normalizedPriority,
        department_ids: departments,
        assignee_ids: requestedAssignees.map((item) => item.accountId)
      }
    });

    await addAuditLog({
      accountId: actorId,
      actionType: "task.created",
      entityType: "task",
      entityId: task.id,
      description: `تم إنشاء المهمة #${task.id}`,
      newValue: {
        title: task.title,
        task_type: normalizedType,
        priority: normalizedPriority
      }
    });

    return {
      task,
      assignees: activeAccounts.filter((account) =>
        requestedAssignees.some((item) => item.accountId === Number(account.id))
      ),
      departments: departments.map((id) => ({
        id,
        responsible_account_id: headByDepartment.get(id) || null
      }))
    };
  } catch (error) {
    await supabase.from("tasks").delete().eq("id", task.id);
    throw error;
  }
}

export async function addTaskHistory({
  taskId,
  accountId = null,
  action,
  oldValue = null,
  newValue = null,
  reason = null,
  metadata = null
}) {
  const { error } = await supabase
    .from("task_history")
    .insert({
      task_id: taskId,
      account_id: accountId,
      action,
      old_value: oldValue,
      new_value: newValue,
      reason,
      metadata,
      created_at: new Date().toISOString()
    });

  if (error) throw error;
}

export async function addAuditLog({
  accountId = null,
  actionType,
  entityType = null,
  entityId = null,
  description = null,
  oldValue = null,
  newValue = null,
  metadata = null,
  source = null
}) {
  const { error } = await supabase
    .from("audit_logs")
    .insert({
      account_id: accountId,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      description,
      old_value: oldValue,
      new_value: newValue,
      metadata,
      source
    });

  if (error) throw error;
}

export async function getTask(taskId, actorId = null) {
  const { data: task, error } = await supabase
    .from("tasks")
    .select(`
      *,
      task_departments (
        task_id,
        department_id,
        status,
        status_reason,
        responsible_account_id,
        accepted_at,
        completed_at,
        completed_by,
        waiting_review_at,
        reviewed_at,
        reviewed_by,
        rejection_reason,
        reopened_at,
        reopened_by,
        reopen_reason,
        departments (
          id,
          name
        )
      ),
      task_assignees (
        task_id,
        account_id,
        assigned_at,
        completed_at,
        work_description,
        status,
        accepted_at,
        rejected_at,
        rejection_reason,
        started_at,
        waiting_review_at,
        reviewed_at,
        reviewed_by,
        review_reason,
        removed_at,
        removed_by,
        removal_reason,
        accounts (
          id,
          display_name,
          username,
          telegram_user_id,
          status,
          department_id
        )
      ),
      task_files (
        id,
        account_id,
        file_name,
        storage_path,
        mime_type,
        file_size,
        title,
        details,
        created_at,
        accounts (
          id,
          display_name,
          username
        )
      ),
      task_history (
        id,
        account_id,
        action,
        old_value,
        new_value,
        reason,
        metadata,
        created_at,
        accounts (
          id,
          display_name,
          username
        )
      )
    `)
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw error;
  if (!task) return null;

  if (actorId) {
    await ensureTaskVisibility(actorId, task);
  }

  return task;
}

export async function ensureTaskVisibility(actorId, task) {
  const permissions = await getEffectivePermissions(actorId);
  if (permissions.includes("*")) return true;

  if (permissions.includes("tasks.view")) return true;

  const ownAssignee = (task.task_assignees || []).some(
    (row) => Number(row.account_id) === Number(actorId) && !row.removed_at
  );
  if (ownAssignee) return true;

  const { data: account, error } = await supabase
    .from("accounts")
    .select("department_id")
    .eq("id", actorId)
    .maybeSingle();

  if (error) throw error;

  if (
    permissions.includes("department.tasks.view") &&
    account?.department_id &&
    (task.task_departments || []).some(
      (row) => Number(row.department_id) === Number(account.department_id)
    )
  ) {
    return true;
  }

  const errorObject = new Error("TASK_ACCESS_DENIED");
  errorObject.code = "TASK_ACCESS_DENIED";
  throw errorObject;
}

export async function listTasks(actorId, filters = {}) {
  const permissions = await getEffectivePermissions(actorId);
  if (!permissions.includes("*") && !permissions.includes("tasks.view") && !permissions.includes("department.tasks.view")) {
    const own = await supabase
      .from("task_assignees")
      .select("task_id")
      .eq("account_id", actorId)
      .is("removed_at", null);

    if (own.error) throw own.error;
    const ids = (own.data || []).map((row) => row.task_id);
    if (!ids.length) return [];
    filters.taskIds = ids;
  }

  let query = supabase
    .from("tasks")
    .select(`
      *,
      task_departments (
        department_id,
        status,
        responsible_account_id,
        departments (id, name)
      ),
      task_assignees (
        account_id,
        status,
        work_description,
        accounts (id, display_name, username)
      )
    `)
    .order("created_at", { ascending: false });

  if (filters.taskIds?.length) query = query.in("id", filters.taskIds);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.taskType) query = query.eq("task_type", filters.taskType);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.limit) query = query.limit(Math.min(Number(filters.limit), 100));

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

export async function updateAssigneeStatus({
  actorId,
  taskId,
  assigneeId,
  status,
  reason = null
}) {
  const task = await getTask(taskId);
  if (!task) throw new Error("TASK_NOT_FOUND");

  const row = (task.task_assignees || []).find(
    (item) => Number(item.account_id) === Number(assigneeId) && !item.removed_at
  );
  if (!row) throw new Error("TASK_ASSIGNEE_NOT_FOUND");

  const actorIsOwner = Number(actorId) === Number(assigneeId);
  const canAssign = await hasAnyPermission(actorId, PERMISSION_ALIASES.assign);
  const canComplete = await hasAnyPermission(actorId, ["tasks.complete"]);
  const canReview = await hasAnyPermission(actorId, ["tasks.review"]);

  const patch = {};
  let action = `assignee.${status}`;

  if (status === "accepted") {
    if (!actorIsOwner && !canAssign) throw new Error("PERMISSION_DENIED");
    patch.status = TASK_STATUSES.IN_PROGRESS;
    patch.accepted_at = new Date().toISOString();
    patch.started_at = new Date().toISOString();
    action = "assignee.accepted";
  } else if (status === "rejected") {
    if (!actorIsOwner && !canAssign) throw new Error("PERMISSION_DENIED");
    if (!String(reason || "").trim()) throw new Error("REJECTION_REASON_REQUIRED");
    patch.status = TASK_STATUSES.REJECTED;
    patch.rejected_at = new Date().toISOString();
    patch.rejection_reason = String(reason).trim();
    action = "assignee.rejected";
  } else if (status === "in_progress") {
    if (!actorIsOwner && !canAssign) throw new Error("PERMISSION_DENIED");
    patch.status = TASK_STATUSES.IN_PROGRESS;
    patch.started_at = patch.started_at || new Date().toISOString();
  } else if (status === "waiting_review") {
    if (!actorIsOwner && !canComplete) throw new Error("PERMISSION_DENIED");
    patch.status = TASK_STATUSES.WAITING_REVIEW;
    patch.waiting_review_at = new Date().toISOString();
    patch.completed_at = new Date().toISOString();
  } else if (status === "completed") {
    if (!canReview) throw new Error("PERMISSION_DENIED");
    patch.status = TASK_STATUSES.COMPLETED;
    patch.reviewed_at = new Date().toISOString();
    patch.reviewed_by = actorId;
    patch.review_reason = reason ? String(reason).trim() : null;
  } else if (status === "reopened") {
    if (!canReview) throw new Error("PERMISSION_DENIED");
    if (!String(reason || "").trim()) throw new Error("REOPEN_REASON_REQUIRED");
    patch.status = TASK_STATUSES.IN_PROGRESS;
    patch.review_reason = String(reason).trim();
  } else {
    throw new Error("INVALID_ASSIGNEE_STATUS");
  }

  const { error } = await supabase
    .from("task_assignees")
    .update(patch)
    .eq("task_id", taskId)
    .eq("account_id", assigneeId)
    .is("removed_at", null);

  if (error) throw error;

  await addTaskHistory({
    taskId,
    accountId: actorId,
    action,
    oldValue: row.status,
    newValue: patch.status,
    reason,
    metadata: { assignee_id: assigneeId }
  });

  await addAuditLog({
    accountId: actorId,
    actionType: `task.${action}`,
    entityType: "task",
    entityId: taskId,
    description: `تغيير حالة المكلف في المهمة #${taskId}`,
    oldValue: { status: row.status },
    newValue: { status: patch.status, assignee_id: assigneeId },
    metadata: { reason }
  });

  await refreshOverallTaskStatus(taskId, actorId);

  return getTask(taskId);
}

export async function updateDepartmentStatus({
  actorId,
  taskId,
  departmentId,
  status,
  reason = null
}) {
  const task = await getTask(taskId);
  if (!task) throw new Error("TASK_NOT_FOUND");

  const row = (task.task_departments || []).find(
    (item) => Number(item.department_id) === Number(departmentId)
  );
  if (!row) throw new Error("TASK_DEPARTMENT_NOT_FOUND");

  const canReview = await hasAnyPermission(actorId, ["tasks.review"]);
  const canComplete = await hasAnyPermission(actorId, ["tasks.complete"]);
  const isResponsible = Number(row.responsible_account_id) === Number(actorId);

  if (!isResponsible && !canReview && !canComplete) {
    throw new Error("PERMISSION_DENIED");
  }

  const patch = {};

  if (status === "accepted") {
    patch.status = TASK_STATUSES.IN_PROGRESS;
    patch.accepted_at = new Date().toISOString();
  } else if (status === "rejected") {
    if (!String(reason || "").trim()) throw new Error("REJECTION_REASON_REQUIRED");
    patch.status = TASK_STATUSES.REJECTED;
    patch.rejection_reason = String(reason).trim();
  } else if (status === "waiting_review") {
    patch.status = TASK_STATUSES.WAITING_REVIEW;
    patch.waiting_review_at = new Date().toISOString();
  } else if (status === "completed") {
    if (!canReview) throw new Error("PERMISSION_DENIED");
    patch.status = TASK_STATUSES.COMPLETED;
    patch.completed_at = new Date().toISOString();
    patch.completed_by = actorId;
    patch.reviewed_at = new Date().toISOString();
    patch.reviewed_by = actorId;
  } else if (status === "reopened") {
    if (!canReview) throw new Error("PERMISSION_DENIED");
    if (!String(reason || "").trim()) throw new Error("REOPEN_REASON_REQUIRED");
    patch.status = TASK_STATUSES.IN_PROGRESS;
    patch.reopened_at = new Date().toISOString();
    patch.reopened_by = actorId;
    patch.reopen_reason = String(reason).trim();
  } else {
    throw new Error("INVALID_DEPARTMENT_STATUS");
  }

  const { error } = await supabase
    .from("task_departments")
    .update(patch)
    .eq("task_id", taskId)
    .eq("department_id", departmentId);

  if (error) throw error;

  await addTaskHistory({
    taskId,
    accountId: actorId,
    action: `department.${status}`,
    oldValue: row.status,
    newValue: patch.status,
    reason,
    metadata: { department_id: departmentId }
  });

  await addAuditLog({
    accountId: actorId,
    actionType: `task.department.${status}`,
    entityType: "task",
    entityId: taskId,
    description: `تغيير حالة قسم في المهمة #${taskId}`,
    oldValue: { status: row.status },
    newValue: { status: patch.status, department_id: departmentId },
    metadata: { reason }
  });

  await refreshOverallTaskStatus(taskId, actorId);
  return getTask(taskId);
}

export async function refreshOverallTaskStatus(taskId, actorId = null) {
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, task_type, status, due_at")
    .eq("id", taskId)
    .single();

  if (taskError) throw taskError;

  const [{ data: assignees, error: assigneeError }, { data: departments, error: departmentError }] = await Promise.all([
    supabase.from("task_assignees").select("status, removed_at").eq("task_id", taskId),
    supabase.from("task_departments").select("status").eq("task_id", taskId)
  ]);

  if (assigneeError) throw assigneeError;
  if (departmentError) throw departmentError;

  const activeAssignees = (assignees || []).filter((row) => !row.removed_at);
  const activeDepartments = departments || [];

  let nextStatus = task.status;

  if (task.status === TASK_STATUSES.CANCELLED) return task;

  const targetRows =
    task.task_type === TASK_TYPES.DISTRIBUTED
      ? activeAssignees
      : activeDepartments;

  if (!targetRows.length) {
    nextStatus = TASK_STATUSES.WAITING_ACCEPTANCE;
  } else if (targetRows.some((row) => row.status === TASK_STATUSES.REJECTED)) {
    nextStatus = TASK_STATUSES.REJECTED;
  } else if (targetRows.every((row) => row.status === TASK_STATUSES.COMPLETED)) {
    nextStatus = TASK_STATUSES.WAITING_REVIEW;
  } else if (targetRows.some((row) => row.status === TASK_STATUSES.WAITING_REVIEW)) {
    nextStatus = TASK_STATUSES.WAITING_REVIEW;
  } else if (targetRows.some((row) => row.status === TASK_STATUSES.IN_PROGRESS)) {
    nextStatus = TASK_STATUSES.IN_PROGRESS;
  } else {
    nextStatus = TASK_STATUSES.WAITING_ACCEPTANCE;
  }

  if (task.due_at && new Date(task.due_at).getTime() < Date.now() && nextStatus !== TASK_STATUSES.COMPLETED) {
    nextStatus = TASK_STATUSES.OVERDUE;
  }

  if (nextStatus === task.status) return task;

  const patch = {
    status: nextStatus,
    updated_at: new Date().toISOString()
  };

  if (nextStatus === TASK_STATUSES.WAITING_REVIEW && !task.completed_at) {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = actorId;
  }

  const { data: updated, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) throw error;

  await addTaskHistory({
    taskId,
    accountId: actorId,
    action: "overall_status_changed",
    oldValue: task.status,
    newValue: nextStatus
  });

  return updated;
}

export async function reopenTask({ actorId, taskId, reason }) {
  await ensurePermission(actorId, "reopen");

  if (!String(reason || "").trim()) {
    throw new Error("REOPEN_REASON_REQUIRED");
  }

  const task = await getTask(taskId);
  if (!task) throw new Error("TASK_NOT_FOUND");

  const now = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      status: TASK_STATUSES.OVERDUE,
      reopened_at: now,
      reopened_by: actorId,
      reopen_reason: String(reason).trim(),
      updated_at: now
    })
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) throw error;

  await supabase
    .from("task_assignees")
    .update({
      status: TASK_STATUSES.IN_PROGRESS
    })
    .eq("task_id", taskId)
    .is("removed_at", null)
    .eq("status", TASK_STATUSES.COMPLETED);

  await supabase
    .from("task_departments")
    .update({
      status: TASK_STATUSES.IN_PROGRESS,
      reopened_at: now,
      reopened_by: actorId,
      reopen_reason: String(reason).trim()
    })
    .eq("task_id", taskId)
    .eq("status", TASK_STATUSES.COMPLETED);

  await addTaskHistory({
    taskId,
    accountId: actorId,
    action: "reopened",
    oldValue: task.status,
    newValue: TASK_STATUSES.OVERDUE,
    reason: String(reason).trim()
  });

  await addAuditLog({
    accountId: actorId,
    actionType: "task.reopened",
    entityType: "task",
    entityId: taskId,
    description: `تم إعادة فتح المهمة #${taskId} كمتأخرة`,
    oldValue: { status: task.status },
    newValue: { status: TASK_STATUSES.OVERDUE },
    metadata: { reason: String(reason).trim() }
  });

  return updated;
}

export async function markOverdueTasks() {
  const now = new Date().toISOString();

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, status, due_at")
    .lt("due_at", now)
    .not("status", "in", `(${TASK_STATUSES.COMPLETED},${TASK_STATUSES.CANCELLED})`)
    .limit(500);

  if (error) throw error;

  let changed = 0;

  for (const task of tasks || []) {
    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        status: TASK_STATUSES.OVERDUE,
        overdue_at: task.status === TASK_STATUSES.OVERDUE ? undefined : now,
        updated_at: now
      })
      .eq("id", task.id)
      .neq("status", TASK_STATUSES.COMPLETED)
      .neq("status", TASK_STATUSES.CANCELLED);

    if (!updateError) changed++;
  }

  return changed;
}


export async function isDepartmentHeadForTask(accountId, task) {
  const departments = (task.task_departments || []).map((row) => Number(row.department_id));
  if (!departments.length) return false;

  const { data, error } = await supabase
    .from("department_members")
    .select("department_id")
    .eq("account_id", accountId)
    .eq("is_head", true)
    .in("department_id", departments);

  if (error) throw error;
  return Boolean((data || []).length);
}

export async function reviewTask({ actorId, taskId, decision, reason = null }) {
  const task = await getTask(taskId);
  if (!task) throw new Error("TASK_NOT_FOUND");

  const canReview = await hasAnyPermission(actorId, ["tasks.review"]);
  const isHead = await isDepartmentHeadForTask(actorId, task);

  if (!canReview && !isHead) throw new Error("PERMISSION_DENIED");

  if (decision === "complete") {
    const targetRows = task.task_type === TASK_TYPES.DISTRIBUTED
      ? (task.task_assignees || []).filter((row) => !row.removed_at)
      : (task.task_departments || []);

    if (!targetRows.length || targetRows.some((row) => row.status !== TASK_STATUSES.COMPLETED)) {
      throw new Error("TASK_ITEMS_NOT_COMPLETED");
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from("tasks")
      .update({
        status: TASK_STATUSES.COMPLETED,
        completed_at: now,
        completed_by: actorId,
        closed_at: now,
        closed_by: actorId,
        updated_at: now
      })
      .eq("id", taskId)
      .select("*")
      .single();

    if (error) throw error;

    await addTaskHistory({
      taskId,
      accountId: actorId,
      action: "review.completed",
      oldValue: task.status,
      newValue: TASK_STATUSES.COMPLETED,
      reason
    });

    await addAuditLog({
      accountId: actorId,
      actionType: "task.review.completed",
      entityType: "task",
      entityId: taskId,
      description: `تم اعتماد وإغلاق المهمة #${taskId}`,
      oldValue: { status: task.status },
      newValue: { status: TASK_STATUSES.COMPLETED },
      metadata: { reason }
    });

    return updated;
  }

  if (decision === "reject") {
    if (!String(reason || "").trim()) throw new Error("REVIEW_REASON_REQUIRED");

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from("tasks")
      .update({
        status: TASK_STATUSES.IN_PROGRESS,
        updated_at: now
      })
      .eq("id", taskId)
      .select("*")
      .single();

    if (error) throw error;

    await supabase
      .from("task_assignees")
      .update({
        status: TASK_STATUSES.IN_PROGRESS,
        review_reason: String(reason).trim()
      })
      .eq("task_id", taskId)
      .eq("status", TASK_STATUSES.WAITING_REVIEW)
      .is("removed_at", null);

    await supabase
      .from("task_departments")
      .update({
        status: TASK_STATUSES.IN_PROGRESS,
        status_reason: String(reason).trim()
      })
      .eq("task_id", taskId)
      .eq("status", TASK_STATUSES.WAITING_REVIEW);

    await addTaskHistory({
      taskId,
      accountId: actorId,
      action: "review.rejected",
      oldValue: task.status,
      newValue: TASK_STATUSES.IN_PROGRESS,
      reason: String(reason).trim()
    });

    await addAuditLog({
      accountId: actorId,
      actionType: "task.review.rejected",
      entityType: "task",
      entityId: taskId,
      description: `تمت إعادة المهمة #${taskId} للتنفيذ`,
      oldValue: { status: task.status },
      newValue: { status: TASK_STATUSES.IN_PROGRESS },
      metadata: { reason: String(reason).trim() }
    });

    return updated;
  }

  throw new Error("INVALID_REVIEW_DECISION");
}

export async function removeTaskAssignee({ actorId, taskId, assigneeId, reason }) {
  await ensurePermission(actorId, "assign");
  if (!String(reason || "").trim()) throw new Error("REMOVAL_REASON_REQUIRED");

  const task = await getTask(taskId);
  if (!task) throw new Error("TASK_NOT_FOUND");

  const row = (task.task_assignees || []).find(
    (item) => Number(item.account_id) === Number(assigneeId) && !item.removed_at
  );
  if (!row) throw new Error("TASK_ASSIGNEE_NOT_FOUND");

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("task_assignees")
    .update({
      status: "removed",
      removed_at: now,
      removed_by: actorId,
      removal_reason: String(reason).trim()
    })
    .eq("task_id", taskId)
    .eq("account_id", assigneeId)
    .is("removed_at", null);

  if (error) throw error;

  await addTaskHistory({
    taskId,
    accountId: actorId,
    action: "assignee.removed",
    oldValue: row.status,
    newValue: "removed",
    reason: String(reason).trim(),
    metadata: { assignee_id: assigneeId }
  });

  await addAuditLog({
    accountId: actorId,
    actionType: "task.assignee.removed",
    entityType: "task",
    entityId: taskId,
    description: `تم استبعاد المكلف من المهمة #${taskId}`,
    metadata: {
      assignee_id: assigneeId,
      reason: String(reason).trim()
    }
  });

  await refreshOverallTaskStatus(taskId, actorId);
  return getTask(taskId);
}
