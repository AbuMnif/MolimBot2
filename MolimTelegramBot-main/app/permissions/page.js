"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import "./page.css";

/*
========================================================
TELEGRAM WEB APP
========================================================
*/

function getTelegramWebApp() {
  if (
    typeof window === "undefined" ||
    !window.Telegram ||
    !window.Telegram.WebApp
  ) {
    return null;
  }

  return window.Telegram.WebApp;
}

function getInitData() {
  const tg = getTelegramWebApp();
  return tg?.initData || "";
}

/*
========================================================
HELPERS
========================================================
*/

function getDisplayName(user) {
  return (
    user?.displayName ||
    user?.username ||
    "مستخدم"
  );
}

function getRoleLabel(role) {
  if (!role) {
    return "بدون دور";
  }

  return (
    role.label ||
    role.name ||
    "بدون دور"
  );
}

function getPermissionName(permission) {
  return (
    permission?.name ||
    permission?.label ||
    permission?.code ||
    permission?.key ||
    "صلاحية"
  );
}

function getPermissionCode(permission) {
  return (
    permission?.code ||
    permission?.key ||
    ""
  );
}

/*
========================================================
PAGE
========================================================
*/

export default function PermissionsPage() {
  const router = useRouter();

  /*
  ========================================================
  GENERAL STATE
  ========================================================
  */

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingRole, setChangingRole] =
    useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  /*
  ========================================================
  DATA
  ========================================================
  */

  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] =
    useState([]);

  /*
  ========================================================
  SELECTED
  ========================================================
  */

  const [selectedUserId, setSelectedUserId] =
    useState("");

  const [selectedRoleId, setSelectedRoleId] =
    useState("");

  /*
  ========================================================
  USER SEARCH
  ========================================================
  */

  const [userSearch, setUserSearch] =
    useState("");

  /*
  ========================================================
  ROLE SEARCH
  ========================================================
  */

  const [roleSearch, setRoleSearch] =
    useState("");

  /*
  ========================================================
  PERMISSION SEARCH
  ========================================================
  */

  const [permissionSearch, setPermissionSearch] =
    useState("");

  /*
  ========================================================
  USER OVERRIDES
  ========================================================
  */

  const [userOverrides, setUserOverrides] =
    useState({});

  /*
  ========================================================
  ROLE PERMISSIONS
  ========================================================
  */

  const [rolePermissionIds, setRolePermissionIds] =
    useState([]);

  /*
  ========================================================
  USER ROLE CHANGE
  ========================================================
  */

  const [selectedUserRoleId, setSelectedUserRoleId] =
    useState("");

  /*
  ========================================================
  LOAD MAIN DATA
  ========================================================
  */

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const initData = getInitData();

      if (!initData) {
        setError(
          "يجب فتح التطبيق من داخل Telegram."
        );

        setLoading(false);
        return;
      }

      const response = await fetch(
        "/api/admin/permissions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            initData,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            "تعذر تحميل إدارة الصلاحيات."
        );
      }

      const loadedUsers =
        data.users || [];

      const loadedRoles =
        data.roles || [];

      const loadedPermissions =
        data.permissions || [];

      setUsers(loadedUsers);
      setRoles(loadedRoles);
      setPermissions(loadedPermissions);

      /*
      ------------------------------------------------------
      FIRST USER
      ------------------------------------------------------
      */

      if (
        loadedUsers.length &&
        !selectedUserId
      ) {
        setSelectedUserId(
          String(
            loadedUsers[0].id
          )
        );
      }

      /*
      ------------------------------------------------------
      FIRST ROLE
      ------------------------------------------------------
      */

      if (
        loadedRoles.length &&
        !selectedRoleId
      ) {
        setSelectedRoleId(
          String(
            loadedRoles[0].id
          )
        );
      }
    } catch (err) {
      console.error(
        "Permissions load error:",
        err
      );

      setError(
        err?.message ||
          "حدث خطأ أثناء تحميل الصلاحيات."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const tg =
      getTelegramWebApp();

    if (tg) {
      tg.ready();
      tg.expand();
    }

    loadData();
  }, []);

  /*
  ========================================================
  SELECTED USER
  ========================================================
  */

  const selectedUser = useMemo(() => {
    return (
      users.find(
        (user) =>
          String(user.id) ===
          String(selectedUserId)
      ) || null
    );
  }, [
    users,
    selectedUserId,
  ]);

  /*
  ========================================================
  SELECTED ROLE
  ========================================================
  */

  const selectedRole = useMemo(() => {
    return (
      roles.find(
        (role) =>
          String(role.id) ===
          String(selectedRoleId)
      ) || null
    );
  }, [
    roles,
    selectedRoleId,
  ]);

  /*
  ========================================================
  SYSTEM ADMIN ROLE
  ========================================================
  */

  const systemAdminRole =
    useMemo(() => {
      return (
        roles.find(
          (role) =>
            role.name ===
              "system_admin" ||
            role.code ===
              "system_admin"
        ) || null
      );
    }, [roles]);

  /*
  ========================================================
  FILTER USERS
  ========================================================
  */

  const filteredUsers =
    useMemo(() => {
      const query =
        userSearch
          .trim()
          .toLowerCase();

      if (!query) {
        return users;
      }

      return users.filter(
        (user) => {
          const values = [
            user.displayName,
            user.username,
            user.telegramUserId,
            user.role?.name,
            user.role?.label,
          ];

          return values.some(
            (value) =>
              String(value || "")
                .toLowerCase()
                .includes(query)
          );
        }
      );
    }, [
      users,
      userSearch,
    ]);

  /*
  ========================================================
  FILTER ROLES
  ========================================================
  */

  const filteredRoles =
    useMemo(() => {
      const query =
        roleSearch
          .trim()
          .toLowerCase();

      if (!query) {
        return roles;
      }

      return roles.filter(
        (role) =>
          String(
            role.name || ""
          )
            .toLowerCase()
            .includes(query) ||
          String(
            role.label || ""
          )
            .toLowerCase()
            .includes(query) ||
          String(
            role.code || ""
          )
            .toLowerCase()
            .includes(query)
      );
    }, [
      roles,
      roleSearch,
    ]);

  /*
  ========================================================
  FILTER PERMISSIONS
  ========================================================
  */

  const filteredPermissions =
    useMemo(() => {
      const query =
        permissionSearch
          .trim()
          .toLowerCase();

      if (!query) {
        return permissions;
      }

      return permissions.filter(
        (permission) =>
          getPermissionName(
            permission
          )
            .toLowerCase()
            .includes(query) ||
          getPermissionCode(
            permission
          )
            .toLowerCase()
            .includes(query)
      );
    }, [
      permissions,
      permissionSearch,
    ]);

  /*
  ========================================================
  WHEN USER CHANGES
  ========================================================
  */

  useEffect(() => {
    if (!selectedUser) {
      setSelectedUserRoleId("");
      return;
    }

    setSelectedUserRoleId(
      selectedUser.role?.id
        ? String(
            selectedUser.role.id
          )
        : ""
    );
  }, [selectedUser]);

  /*
  ========================================================
  LOAD USER OVERRIDES
  ========================================================
  */

  async function loadUserOverrides(
    userId
  ) {
    try {
      setError("");

      const response = await fetch(
        "/api/admin/permissions",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            initData:
              getInitData(),
            action: "user",
            userId,
          }),
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "تعذر تحميل صلاحيات المستخدم."
        );
      }

      const overrides = {};

      (
        data.overrides || []
      ).forEach(
        (item) => {
          overrides[
            String(
              item.permissionId
            )
          ] =
            item.effect;
        }
      );

      setUserOverrides(
        overrides
      );
    } catch (err) {
      console.error(
        "Load user overrides error:",
        err
      );

      setError(
        err?.message ||
          "تعذر تحميل صلاحيات المستخدم."
      );

      setUserOverrides({});
    }
  }

  useEffect(() => {
    if (!selectedUserId) {
      setUserOverrides({});
      return;
    }

    loadUserOverrides(
      selectedUserId
    );
  }, [selectedUserId]);

  /*
  ========================================================
  LOAD ROLE PERMISSIONS
  ========================================================
  */

  async function loadRolePermissions(
    roleId
  ) {
    try {
      setError("");

      const response = await fetch(
        "/api/admin/permissions",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            initData:
              getInitData(),
            action: "role",
            roleId,
          }),
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "تعذر تحميل صلاحيات الدور."
        );
      }

      setRolePermissionIds(
        (
          data.permissionIds ||
          []
        ).map((id) =>
          String(id)
        )
      );
    } catch (err) {
      console.error(
        "Load role permissions error:",
        err
      );

      setError(
        err?.message ||
          "تعذر تحميل صلاحيات الدور."
      );

      setRolePermissionIds([]);
    }
  }

  useEffect(() => {
    if (!selectedRoleId) {
      setRolePermissionIds([]);
      return;
    }

    loadRolePermissions(
      selectedRoleId
    );
  }, [selectedRoleId]);

  /*
  ========================================================
  USER PERMISSION STATE
  ========================================================
  */

  function getUserPermissionState(
    permission
  ) {
    const override =
      userOverrides[
        String(permission.id)
      ];

    if (
      override ===
      "allow"
    ) {
      return "allow";
    }

    if (
      override ===
      "deny"
    ) {
      return "deny";
    }

    return "inherit";
  }

  /*
  ========================================================
  ROLE PERMISSION CHECK
  ========================================================
  */

  function hasRolePermission(
    permissionId
  ) {
    return rolePermissionIds.includes(
      String(permissionId)
    );
  }

  /*
  ========================================================
  CHANGE USER ROLE
  ========================================================
  */

  async function changeUserRole() {
    if (
      !selectedUserId ||
      !selectedUserRoleId
    ) {
      setError(
        "اختر المستخدم والدور أولًا."
      );

      return;
    }

    const currentRoleId =
      selectedUser?.role?.id
        ? String(
            selectedUser.role.id
          )
        : "";

    if (
      currentRoleId ===
      String(
        selectedUserRoleId
      )
    ) {
      setSuccess(
        "المستخدم بالفعل على هذا الدور."
      );

      return;
    }

    const targetRole =
      roles.find(
        (role) =>
          String(role.id) ===
          String(
            selectedUserRoleId
          )
      );

    if (!targetRole) {
      setError(
        "الدور المحدد غير موجود."
      );

      return;
    }

    const isPromoting =
      targetRole.name ===
        "system_admin" ||
      targetRole.code ===
        "system_admin";

    const confirmed =
      window.confirm(
        isPromoting
          ? `هل أنت متأكد من رفع ${getDisplayName(
              selectedUser
            )} إلى مدير نظام؟\n\nسيصبح Role ID = ${targetRole.id}`
          : `هل أنت متأكد من تغيير دور ${getDisplayName(
              selectedUser
            )} إلى ${getRoleLabel(
              targetRole
            )}؟\n\nRole ID = ${targetRole.id}`
      );

    if (!confirmed) {
      return;
    }

    try {
      setChangingRole(true);
      setError("");
      setSuccess("");

      const response =
        await fetch(
          "/api/admin/users",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              initData:
                getInitData(),

              /*
              ------------------------------------------------
              ACCOUNT ID
              ------------------------------------------------
              */

              accountId:
                selectedUserId,

              /*
              ------------------------------------------------
              NEW ROLE ID
              ------------------------------------------------
              */

              roleId:
                selectedUserRoleId,
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "تعذر تغيير دور المستخدم."
        );
      }

      setSuccess(
        isPromoting
          ? `تم رفع ${getDisplayName(
              selectedUser
            )} إلى مدير نظام بنجاح. Role ID = ${targetRole.id}`
          : `تم تغيير دور ${getDisplayName(
              selectedUser
            )} بنجاح إلى ${getRoleLabel(
              targetRole
            )}.`
      );

      /*
      ------------------------------------------------------
      RELOAD EVERYTHING
      ------------------------------------------------------
      */

      await loadData();

      /*
      ------------------------------------------------------
      RELOAD USER OVERRIDES
      ------------------------------------------------------
      */

      await loadUserOverrides(
        selectedUserId
      );
    } catch (err) {
      console.error(
        "Change user role error:",
        err
      );

      setError(
        err?.message ||
          "تعذر تغيير دور المستخدم."
      );
    } finally {
      setChangingRole(false);
    }
  }

  /*
  ========================================================
  SAVE USER PERMISSION
  ========================================================
  */

  async function saveUserPermission(
    permissionId,
    effect
  ) {
    if (!selectedUserId) {
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        "/api/admin/permissions",
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            initData:
              getInitData(),
            action: "user",
            userId:
              selectedUserId,
            permissionId,
            effect,
          }),
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "تعذر حفظ الصلاحية."
        );
      }

      setUserOverrides(
        (current) => {
          const next = {
            ...current,
          };

          if (
            effect ===
            "inherit"
          ) {
            delete next[
              String(
                permissionId
              )
            ];
          } else {
            next[
              String(
                permissionId
              )
            ] = effect;
          }

          return next;
        }
      );

      setSuccess(
        "تم تحديث صلاحية المستخدم."
      );
    } catch (err) {
      console.error(
        "Save user permission error:",
        err
      );

      setError(
        err?.message ||
          "تعذر حفظ الصلاحية."
      );
    } finally {
      setSaving(false);
    }
  }

  /*
  ========================================================
  TOGGLE ROLE PERMISSION
  ========================================================
  */

  function toggleRolePermission(
    permissionId
  ) {
    const id =
      String(permissionId);

    setRolePermissionIds(
      (current) => {
        if (
          current.includes(id)
        ) {
          return current.filter(
            (item) =>
              item !== id
          );
        }

        return [
          ...current,
          id,
        ];
      }
    );
  }

  /*
  ========================================================
  SELECT ALL
  ========================================================
  */

  function selectAllRolePermissions() {
    setRolePermissionIds(
      permissions.map(
        (permission) =>
          String(
            permission.id
          )
      )
    );
  }

  /*
  ========================================================
  CLEAR ALL
  ========================================================
  */

  function clearRolePermissions() {
    setRolePermissionIds([]);
  }

  /*
  ========================================================
  SAVE ROLE PERMISSIONS
  ========================================================
  */

  async function saveRolePermissions() {
    if (!selectedRoleId) {
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        "/api/admin/permissions",
        {
          method: "PUT",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            initData:
              getInitData(),
            action: "role",
            roleId:
              selectedRoleId,
            permissionIds:
              rolePermissionIds,
          }),
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "تعذر حفظ صلاحيات الدور."
        );
      }

      setSuccess(
        `تم حفظ صلاحيات ${
          getRoleLabel(
            selectedRole
          )
        } بنجاح.`
      );

      await loadRolePermissions(
        selectedRoleId
      );
    } catch (err) {
      console.error(
        "Save role permissions error:",
        err
      );

      setError(
        err?.message ||
          "تعذر حفظ صلاحيات الدور."
      );
    } finally {
      setSaving(false);
    }
  }

  /*
  ========================================================
  ROLE STATS
  ========================================================
  */

  const rolePermissionCount =
    rolePermissionIds.length;

  const totalPermissions =
    permissions.length;

  const rolePermissionPercent =
    totalPermissions > 0
      ? Math.round(
          (rolePermissionCount /
            totalPermissions) *
            100
        )
      : 0;

  /*
  ========================================================
  LOADING
  ========================================================
  */

  if (loading) {
    return (
      <main
        className="permissions-page"
        dir="rtl"
      >
        <div className="permissions-loading">
          <div className="loading-spinner" />

          <p>
            جاري تحميل إدارة الصلاحيات...
          </p>
        </div>
      </main>
    );
  }

  /*
  ========================================================
  RENDER
  ========================================================
  */

  return (
    <main
      className="permissions-page"
      dir="rtl"
    >
      <div className="permissions-shell">

        {/* ==================================================
            HEADER
        ================================================== */}

        <header className="permissions-header">

          <div className="header-left">

            <button
              type="button"
              className="back-button"
              onClick={() =>
                router.push("/")
              }
              aria-label="العودة"
            >
              ←
            </button>

            <div className="header-title">

              <span className="header-icon">
                ◆
              </span>

              <div>

                <h1>
                  إدارة الصلاحيات
                </h1>

                <p>
                  الصلاحيات الأساسية
                  والتخصيص الفردي
                  وإدارة أدوار الحسابات
                </p>

              </div>

            </div>

          </div>

        </header>

        {/* ==================================================
            ALERT ERROR
        ================================================== */}

        {error && (
          <div className="alert alert-error">

            <span className="alert-symbol">
              !
            </span>

            <p>
              {error}
            </p>

            <button
              type="button"
              onClick={() =>
                setError("")
              }
            >
              ×
            </button>

          </div>
        )}

        {/* ==================================================
            ALERT SUCCESS
        ================================================== */}

        {success && (
          <div className="alert alert-success">

            <span className="alert-symbol">
              ✓
            </span>

            <p>
              {success}
            </p>

            <button
              type="button"
              onClick={() =>
                setSuccess("")
              }
            >
              ×
            </button>

          </div>
        )}

        {/* ==================================================
            INFO
        ================================================== */}

        <section className="permissions-info">

          <div className="info-icon">
            ◆
          </div>

          <div>

            <strong>
              نظام الصلاحيات في Molim
            </strong>

            <p>
              صلاحيات الدور تحدد الصلاحيات
              الأساسية للمستخدم، بينما
              صلاحيات الحساب الفردية تسمح
              بإضافة أو منع صلاحية معينة
              دون تغيير الدور.
            </p>

          </div>

        </section>

        {/* ==================================================
            USER MANAGEMENT
        ================================================== */}

        <section className="permission-card account-role-card">

          <div className="card-header">

            <div>

              <span className="card-kicker">
                إدارة الحساب
              </span>

              <h2>
                رفع وتنزيل مدير النظام
              </h2>

              <p>
                تغيير Role ID للحساب مباشرة
                من نفس صفحة إدارة الصلاحيات.
              </p>

            </div>

          </div>

          {selectedUser ? (

            <div className="account-role-layout">

              {/* USER INFO */}

              <div className="selected-account">

                <div className="selected-account-avatar">
                  {String(
                    getDisplayName(
                      selectedUser
                    )
                  )
                    .slice(
                      0,
                      1
                    )
                    .toUpperCase()}
                </div>

                <div>

                  <strong>
                    {getDisplayName(
                      selectedUser
                    )}
                  </strong>

                  <span>
                    @
                    {selectedUser.username ||
                      "بدون اسم مستخدم"}
                  </span>

                  <small>
                    Account ID:{" "}
                    {selectedUser.id}
                  </small>

                </div>

              </div>

              {/* CURRENT ROLE */}

              <div className="current-role-box">

                <span>
                  الدور الحالي
                </span>

                <strong>
                  {getRoleLabel(
                    selectedUser.role
                  )}
                </strong>

                <code>
                  Role ID:{" "}
                  {selectedUser.role?.id ||
                    "NULL"}
                </code>

                {(
                  selectedUser.role
                    ?.name ===
                    "system_admin" ||
                  selectedUser.role
                    ?.code ===
                    "system_admin"
                ) && (
                  <b className="system-admin-badge">
                    ★ مدير نظام
                  </b>
                )}

              </div>

              {/* CHANGE ROLE */}

              <div className="change-role-box">

                <label>
                  الدور الجديد
                </label>

                <select
                  value={
                    selectedUserRoleId
                  }
                  onChange={(event) =>
                    setSelectedUserRoleId(
                      event.target.value
                    )
                  }
                >

                  <option value="">
                    اختر الدور
                  </option>

                  {roles.map(
                    (role) => (
                      <option
                        key={
                          role.id
                        }
                        value={
                          role.id
                        }
                      >
                        {getRoleLabel(
                          role
                        )}{" "}
                        — ID:{" "}
                        {role.id}
                      </option>
                    )
                  )}

                </select>

                <button
                  type="button"
                  className="change-role-button"
                  disabled={
                    changingRole ||
                    !selectedUserRoleId
                  }
                  onClick={
                    changeUserRole
                  }
                >
                  {changingRole
                    ? "جاري التغيير..."
                    : "حفظ الدور"}
                </button>

              </div>

            </div>

          ) : (

            <div className="empty-state large">
              اختر مستخدمًا من قائمة المستخدمين
              حتى تتمكن من تغيير Role ID الخاص
              بالحساب.
            </div>

          )}

        </section>

        {/* ==================================================
            MAIN GRID
        ================================================== */}

        <div className="permissions-grid">

          {/* ==================================================
              USERS
          ================================================== */}

          <section className="permission-card users-card">

            <div className="card-header">

              <div>

                <span className="card-kicker">
                  الحسابات
                </span>

                <h2>
                  المستخدمون
                </h2>

                <p>
                  اختر الحساب الذي تريد إدارة
                  دوره وصلاحياته.
                </p>

              </div>

              <span className="card-number">
                {users.length}
              </span>

            </div>

            <div className="search-box">

              <span>
                ⌕
              </span>

              <input
                value={
                  userSearch
                }
                onChange={(event) =>
                  setUserSearch(
                    event.target.value
                  )
                }
                placeholder="ابحث عن مستخدم..."
              />

              {userSearch && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() =>
                    setUserSearch("")
                  }
                >
                  ×
                </button>
              )}

            </div>

            <div className="users-list">

              {filteredUsers.length ===
              0 ? (

                <div className="empty-state">
                  لا يوجد مستخدمون.
                </div>

              ) : (

                filteredUsers.map(
                  (user) => {

                    const active =
                      String(
                        selectedUserId
                      ) ===
                      String(
                        user.id
                      );

                    const isSystemAdmin =
                      user.role
                        ?.name ===
                        "system_admin" ||
                      user.role
                        ?.code ===
                        "system_admin";

                    return (
                      <button
                        key={
                          user.id
                        }
                        type="button"
                        className={`user-row ${
                          active
                            ? "selected"
                            : ""
                        }`}
                        onClick={() =>
                          setSelectedUserId(
                            String(
                              user.id
                            )
                          )
                        }
                      >

                        <div className="user-avatar">
                          {String(
                            getDisplayName(
                              user
                            )
                          )
                            .slice(
                              0,
                              1
                            )
                            .toUpperCase()}
                        </div>

                        <div className="user-row-content">

                          <strong>
                            {getDisplayName(
                              user
                            )}
                          </strong>

                          <span>
                            @
                            {user.username ||
                              "بدون اسم مستخدم"}
                          </span>

                          <small>
                            {getRoleLabel(
                              user.role
                            )}{" "}
                            {user.role?.id
                              ? `• ID ${user.role.id}`
                              : ""}
                          </small>

                        </div>

                        {isSystemAdmin && (
                          <span className="system-admin-mini">
                            ★
                          </span>
                        )}

                        {active && (
                          <span className="selected-mark">
                            ✓
                          </span>
                        )}

                      </button>
                    );
                  }
                )

              )}

            </div>

          </section>

          {/* ==================================================
              USER PERMISSIONS
          ================================================== */}

          <section className="permission-card permissions-card">

            <div className="card-header">

              <div>

                <span className="card-kicker">
                  تخصيص فردي
                </span>

                <h2>
                  {selectedUser
                    ? getDisplayName(
                        selectedUser
                      )
                    : "صلاحيات المستخدم"}
                </h2>

                {selectedUser && (
                  <p>
                    الدور الحالي:{" "}
                    <strong>
                      {getRoleLabel(
                        selectedUser.role
                      )}
                    </strong>
                  </p>
                )}

              </div>

              {selectedUser?.role?.name ===
                "system_admin" && (
                <span className="admin-badge">
                  مدير نظام
                </span>
              )}

            </div>

            <div className="permission-legend">

              <span>
                <i className="dot allow" />
                سماح
              </span>

              <span>
                <i className="dot deny" />
                منع
              </span>

              <span>
                <i className="dot inherit" />
                من الدور
              </span>

            </div>

            <div className="search-box">

              <span>
                ⌕
              </span>

              <input
                value={
                  permissionSearch
                }
                onChange={(event) =>
                  setPermissionSearch(
                    event.target.value
                  )
                }
                placeholder="ابحث عن صلاحية..."
              />

              {permissionSearch && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() =>
                    setPermissionSearch(
                      ""
                    )
                  }
                >
                  ×
                </button>
              )}

            </div>

            {!selectedUser ? (

              <div className="empty-state large">
                اختر مستخدمًا لعرض صلاحياته.
              </div>

            ) : (

              <div className="permissions-list">

                {filteredPermissions.length ===
                0 ? (

                  <div className="empty-state">
                    لا توجد صلاحيات.
                  </div>

                ) : (

                  filteredPermissions.map(
                    (permission) => {

                      const state =
                        getUserPermissionState(
                          permission
                        );

                      return (
                        <div
                          key={
                            permission.id
                          }
                          className="permission-row"
                        >

                          <div className="permission-description">

                            <strong>
                              {getPermissionName(
                                permission
                              )}
                            </strong>

                            <code>
                              {getPermissionCode(
                                permission
                              )}
                            </code>

                          </div>

                          <div className="permission-actions">

                            <button
                              type="button"
                              disabled={
                                saving
                              }
                              className={`permission-action allow ${
                                state ===
                                "allow"
                                  ? "active"
                                  : ""
                              }`}
                              onClick={() =>
                                saveUserPermission(
                                  permission.id,
                                  "allow"
                                )
                              }
                            >
                              ✓
                              <span>
                                سماح
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={
                                saving
                              }
                              className={`permission-action deny ${
                                state ===
                                "deny"
                                  ? "active"
                                  : ""
                              }`}
                              onClick={() =>
                                saveUserPermission(
                                  permission.id,
                                  "deny"
                                )
                              }
                            >
                              ×
                              <span>
                                منع
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={
                                saving
                              }
                              className={`permission-action inherit ${
                                state ===
                                "inherit"
                                  ? "active"
                                  : ""
                              }`}
                              onClick={() =>
                                saveUserPermission(
                                  permission.id,
                                  "inherit"
                                )
                              }
                            >
                              ↺
                              <span>
                                الدور
                              </span>
                            </button>

                          </div>

                        </div>
                      );
                    }
                  )

                )}

              </div>

            )}

          </section>

        </div>

        {/* ==================================================
            ROLES
        ================================================== */}

        <section className="permission-card roles-card">

          <div className="card-header roles-header">

            <div>

              <span className="card-kicker">
                الصلاحيات الأساسية
              </span>

              <h2>
                صلاحيات الأدوار
              </h2>

              <p>
                هذه الصلاحيات يتم تطبيقها
                تلقائيًا على كل حساب يحمل
                الدور المحدد.
              </p>

            </div>

            <div className="role-select-wrapper">

              <label>
                الدور
              </label>

              <select
                value={
                  selectedRoleId
                }
                onChange={(event) =>
                  setSelectedRoleId(
                    event.target.value
                  )
                }
              >

                {roles.map(
                  (role) => (
                    <option
                      key={
                        role.id
                      }
                      value={
                        role.id
                      }
                    >
                      {getRoleLabel(
                        role
                      )}{" "}
                      — ID{" "}
                      {role.id}
                    </option>
                  )
                )}

              </select>

            </div>

          </div>

          {/* ROLE SEARCH */}

          <div className="roles-selector-area">

            <div className="roles-selector-title">

              <strong>
                الأدوار
              </strong>

              <span>
                {roles.length}
              </span>

            </div>

            <div className="role-search-box">

              <span>
                ⌕
              </span>

              <input
                value={
                  roleSearch
                }
                onChange={(event) =>
                  setRoleSearch(
                    event.target.value
                  )
                }
                placeholder="ابحث عن دور..."
              />

            </div>

            <div className="roles-pills">

              {filteredRoles.map(
                (role) => {

                  const active =
                    String(
                      selectedRoleId
                    ) ===
                    String(
                      role.id
                    );

                  const isSystemAdmin =
                    role.name ===
                      "system_admin" ||
                    role.code ===
                      "system_admin";

                  return (
                    <button
                      key={
                        role.id
                      }
                      type="button"
                      className={`role-pill ${
                        active
                          ? "active"
                          : ""
                      } ${
                        isSystemAdmin
                          ? "system-role"
                          : ""
                      }`}
                      onClick={() =>
                        setSelectedRoleId(
                          String(
                            role.id
                          )
                        )
                      }
                    >

                      {isSystemAdmin && (
                        <span>
                          ★
                        </span>
                      )}

                      {getRoleLabel(
                        role
                      )}

                      <small>
                        ID{" "}
                        {role.id}
                      </small>

                    </button>
                  );
                }
              )}

            </div>

          </div>

          {/* ROLE TOOLBAR */}

          <div className="role-permissions-toolbar">

            <div className="role-summary">

              <strong>
                {selectedRole
                  ? getRoleLabel(
                      selectedRole
                    )
                  : "اختر دورًا"}
              </strong>

              <span>
                {rolePermissionCount} من{" "}
                {totalPermissions} صلاحية
              </span>

            </div>

            <div className="role-toolbar-actions">

              <button
                type="button"
                className="secondary-button"
                disabled={
                  saving ||
                  !selectedRoleId
                }
                onClick={
                  selectAllRolePermissions
                }
              >
                تحديد الكل
              </button>

              <button
                type="button"
                className="secondary-button danger-outline"
                disabled={
                  saving ||
                  !selectedRoleId
                }
                onClick={
                  clearRolePermissions
                }
              >
                إزالة الكل
              </button>

              <button
                type="button"
                className="save-button"
                disabled={
                  saving ||
                  !selectedRoleId
                }
                onClick={
                  saveRolePermissions
                }
              >
                {saving
                  ? "جاري الحفظ..."
                  : "حفظ صلاحيات الدور"}
              </button>

            </div>

          </div>

          {/* PROGRESS */}

          <div className="role-progress">

            <div className="role-progress-top">

              <span>
                نسبة الصلاحيات المفعلة
              </span>

              <strong>
                {rolePermissionPercent}%
              </strong>

            </div>

            <div className="role-progress-track">

              <div
                className="role-progress-fill"
                style={{
                  width: `${rolePermissionPercent}%`,
                }}
              />

            </div>

          </div>

          {/* PERMISSION SEARCH */}

          <div className="role-permission-search">

            <div className="search-box">

              <span>
                ⌕
              </span>

              <input
                value={
                  permissionSearch
                }
                onChange={(event) =>
                  setPermissionSearch(
                    event.target.value
                  )
                }
                placeholder="ابحث داخل صلاحيات الدور..."
              />

            </div>

          </div>

          {/* ROLE PERMISSIONS */}

          <div className="role-permissions-grid">

            {filteredPermissions.length ===
            0 ? (

              <div className="empty-state">
                لا توجد صلاحيات.
              </div>

            ) : (

              filteredPermissions.map(
                (permission) => {

                  const active =
                    hasRolePermission(
                      permission.id
                    );

                  return (
                    <button
                      type="button"
                      key={
                        permission.id
                      }
                      className={`role-permission ${
                        active
                          ? "active"
                          : ""
                      }`}
                      onClick={() =>
                        toggleRolePermission(
                          permission.id
                        )
                      }
                    >

                      <span className="role-permission-check">
                        {active
                          ? "✓"
                          : ""}
                      </span>

                      <span className="role-permission-text">

                        <strong>
                          {getPermissionName(
                            permission
                          )}
                        </strong>

                        <code>
                          {getPermissionCode(
                            permission
                          )}
                        </code>

                      </span>

                    </button>
                  );
                }
              )

            )}

          </div>

        </section>

        {/* ==================================================
            HELP
        ================================================== */}

        <section className="permission-card permission-help">

          <div className="help-title">

            <span>
              ◆
            </span>

            <div>

              <h2>
                طريقة عمل النظام
              </h2>

              <p>
                الدور والصلاحيات الفردية
                يعملان معًا.
              </p>

            </div>

          </div>

          <div className="help-grid">

            <div className="help-item">

              <span className="help-number">
                01
              </span>

              <strong>
                Role ID
              </strong>

              <p>
                يحدد الدور الأساسي للحساب،
                ويمكن تغييره من هذه الصفحة.
              </p>

            </div>

            <div className="help-item">

              <span className="help-number">
                02
              </span>

              <strong>
                صلاحيات الدور
              </strong>

              <p>
                تحدد الصلاحيات الأساسية لكل
                حساب يحمل هذا الدور.
              </p>

            </div>

            <div className="help-item">

              <span className="help-number">
                03
              </span>

              <strong>
                سماح أو منع فردي
              </strong>

              <p>
                يمكنك تعديل صلاحية شخص واحد
                دون تغيير دوره.
              </p>

            </div>

            <div className="help-item">

              <span className="help-number">
                04
              </span>

              <strong>
                مدير النظام
              </strong>

              <p>
                يمكن رفع الحساب إلى
                system_admin أو تنزيله إلى
                Role آخر من نفس الصفحة.
              </p>

            </div>

          </div>

        </section>

        {/* ==================================================
            FOOTER
        ================================================== */}

        <footer className="permissions-footer">

          <span>
            Molim
          </span>

          <span>
            نظام إدارة الصلاحيات
          </span>

        </footer>

      </div>
    </main>
  );
}
