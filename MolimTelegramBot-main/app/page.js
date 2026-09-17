"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import "./page.css";

function getTelegramWebApp() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.Telegram?.WebApp || null;
}

function getInitData() {
  const tg = getTelegramWebApp();
  return tg?.initData || "";
}

function getDisplayName(data) {
  return (
    data?.account?.displayName ||
    data?.user?.firstName ||
    data?.user?.username ||
    "مستخدم"
  );
}

function getInitials(name) {
  if (!name) {
    return "م";
  }

  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2);
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`;
}

function getRoleLabel(role) {
  if (!role) {
    return "بدون دور";
  }

  const labels = {
    system_admin: "ادمن النظام",
    admin: "ادمن",
    department_head: "رئيس قسم",
    employee: "متطوع",
    user: "مستخدم"
  };

  return labels[role.name] || role.name || "بدون دور";
}

function getStatusLabel(status) {
  const labels = {
    active: "نشط",
    inactive: "غير نشط",
    blocked: "محظور"
  };

  return labels[status] || status || "غير محدد";
}

function getPageTitle(page) {
  const titles = {
    dashboard: "الرئيسية",
    tasks: "مهامي",
    departmentTasks: "مهام القسم",
    announcements: "الإعلانات",
    team: "الفريق",
    notes: "الملاحظات",
    notifications: "التنبيهات",
    settings: "الإعدادات",
    users: "إدارة المستخدمين",
    departments: "إدارة الأقسام",
    permissions: "إدارة الصلاحيات",
    system: "إدارة النظام"
  };

  return titles[page] || "Molim";
}

export default function Home() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);

  const [authData, setAuthData] = useState(null);
  const [accountData, setAccountData] = useState(null);

  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const [error, setError] = useState("");

  const [showRegister, setShowRegister] = useState(false);

  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] =
    useState("");

  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerMessage, setRegisterMessage] = useState("");

  useEffect(() => {
    const tg = getTelegramWebApp();

    if (tg) {
      try {
        tg.ready();
        tg.expand();
      } catch (error) {
        console.error(error);
      }
    }

    authenticate();
  }, []);

  async function authenticate() {
    try {
      setAuthLoading(true);
      setLoading(true);
      setError("");

      const initData = getInitData();

      if (!initData) {
        setError(
          "تعذر الحصول على بيانات Telegram. افتح النظام من خلال البوت."
        );
        return;
      }

      const response = await fetch("/api/telegram/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          initData
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        if (response.status === 403) {
          setError("ليس لديك صلاحية الدخول إلى نظام Molim.");
        } else {
          setError(result.message || "تعذر تسجيل الدخول.");
        }

        return;
      }

      setAuthData(result);

      if (!result.account?.exists) {
        setShowRegister(true);
        return;
      }

      await loadAccount();
    } catch (error) {
      console.error(error);
      setError("حدث خطأ أثناء الاتصال بالنظام.");
    } finally {
      setAuthLoading(false);
      setLoading(false);
    }
  }

  async function loadAccount() {
    try {
      const response = await fetch("/api/account/me", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          initData: getInitData()
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.message || "تعذر تحميل بيانات الحساب.");
        return;
      }

      setAccountData(result);
    } catch (error) {
      console.error(error);
      setError("تعذر تحميل بيانات الحساب.");
    }
  }

  async function handleRegister(event) {
    event.preventDefault();

    setRegisterMessage("");

    if (registerUsername.length < 3) {
      setRegisterMessage(
        "اسم المستخدم يجب أن يكون 3 أحرف على الأقل."
      );
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(registerUsername)) {
      setRegisterMessage(
        "اسم المستخدم يسمح فقط بالحروف الإنجليزية والأرقام والشرطة السفلية."
      );
      return;
    }

    if (registerPassword.length < 8) {
      setRegisterMessage(
        "كلمة المرور يجب أن تكون 8 أحرف على الأقل."
      );
      return;
    }

    if (registerPassword !== registerConfirmPassword) {
      setRegisterMessage("كلمتا المرور غير متطابقتين.");
      return;
    }

    try {
      setRegisterLoading(true);

      const response = await fetch("/api/account/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          initData: getInitData(),
          username: registerUsername,
          password: registerPassword
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setRegisterMessage(
          result.message || "تعذر إنشاء الحساب."
        );
        return;
      }

      setShowRegister(false);
      setRegisterMessage("");

      await loadAccount();
    } catch (error) {
      console.error(error);
      setRegisterMessage("حدث خطأ أثناء إنشاء الحساب.");
    } finally {
      setRegisterLoading(false);
    }
  }

  function navigate(nextPage) {
    setSidebarOpen(false);

    if (nextPage === "departments") {
      router.push("/departments");
      return;
    }

    if (nextPage === "permissions") {
      router.push("/permissions");
      return;
    }

    setPage(nextPage);
  }

  if (authLoading || loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <ErrorScreen
        message={error}
        onRetry={authenticate}
      />
    );
  }

  if (showRegister) {
    return (
      <RegisterScreen
        username={registerUsername}
        setUsername={setRegisterUsername}
        password={registerPassword}
        setPassword={setRegisterPassword}
        confirmPassword={registerConfirmPassword}
        setConfirmPassword={setRegisterConfirmPassword}
        message={registerMessage}
        loading={registerLoading}
        onSubmit={handleRegister}
      />
    );
  }

  const displayName = getDisplayName(accountData);

  return (
    <div className="app-shell">
      <Sidebar
        open={sidebarOpen}
        page={page}
        account={accountData}
        onNavigate={navigate}
        onClose={() => setSidebarOpen(false)}
        onProfile={() => {
          setSidebarOpen(false);
          setProfileOpen(true);
        }}
      />

      <div className="main-content">
        <Header
          title={getPageTitle(page)}
          account={accountData}
          onMenu={() => setSidebarOpen(true)}
          onProfile={() => setProfileOpen(true)}
          onNotifications={() => navigate("notifications")}
        />

        <main className="content">
          {page === "dashboard" && (
            <Dashboard
              account={accountData}
              displayName={displayName}
              onNavigate={navigate}
            />
          )}

          {page === "users" && (
            <UsersPage account={accountData} />
          )}

          {page === "tasks" && (
            <EmptyPage
              title="مهامي"
              description="ستظهر هنا المهام المسندة إليك."
              icon="✓"
            />
          )}

          {page === "departmentTasks" && (
            <EmptyPage
              title="مهام القسم"
              description="ستظهر هنا مهام القسم."
              icon="▣"
            />
          )}

          {page === "announcements" && (
            <EmptyPage
              title="الإعلانات"
              description="ستظهر هنا الإعلانات المهمة."
              icon="!"
            />
          )}

          {page === "team" && (
            <EmptyPage
              title="الفريق"
              description="ستظهر هنا أعضاء الفريق."
              icon="♙"
            />
          )}

          {page === "notes" && (
            <EmptyPage
              title="الملاحظات"
              description="ستظهر هنا الملاحظات."
              icon="✎"
            />
          )}

          {page === "notifications" && (
            <EmptyPage
              title="التنبيهات"
              description="ستظهر هنا التنبيهات."
              icon="●"
            />
          )}

          {page === "settings" && (
            <EmptyPage
              title="الإعدادات"
              description="إعدادات الحساب والنظام."
              icon="⚙"
            />
          )}

          {page === "departments" && (
            <EmptyPage
              title="إدارة الأقسام"
              description="إدارة أقسام النظام."
              icon="▦"
            />
          )}

          {page === "permissions" && (
            <EmptyPage
              title="إدارة الصلاحيات"
              description="إدارة الأدوار والصلاحيات."
              icon="◆"
            />
          )}

          {page === "system" && (
            <EmptyPage
              title="إدارة النظام"
              description="إعدادات النظام العامة."
              icon="⚙"
            />
          )}
        </main>
      </div>

      {profileOpen && (
        <ProfileModal
          account={accountData}
          onClose={() => setProfileOpen(false)}
          onUpdated={async () => {
            await loadAccount();
          }}
        />
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-page">
      <div className="loading-card">
        <div className="loading-brand brand">
          <span className="brand-dot" />
          <span>Molim</span>
        </div>

        <div className="loading-spinner" />

        <p>جاري تحميل النظام...</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div className="loading-page">
      <div className="loading-card">
        <div
          className="brand"
          style={{ justifyContent: "center" }}
        >
          <span className="brand-dot" />
          <span>Molim</span>
        </div>

        <div
          className="announcement-icon announcement-important"
          style={{
            width: "55px",
            height: "55px",
            margin: "25px auto 15px",
            fontSize: "22px"
          }}
        >
          !
        </div>

        <h2
          style={{
            margin: "0 0 8px",
            fontSize: "20px",
            fontWeight: 900
          }}
        >
          تعذر الدخول
        </h2>

        <p>{message}</p>

        <button
          type="button"
          className="primary-button"
          onClick={onRetry}
        >
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}

function RegisterScreen({
  username,
  setUsername,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  message,
  loading,
  onSubmit
}) {
  return (
    <div className="register-page">
      <div className="register-decoration register-decoration-one" />
      <div className="register-decoration register-decoration-two" />

      <div className="register-card">
        <div className="register-brand">
          <div className="brand-icon">
            <span />
            <span />
            <span />
          </div>

          <div>
            <div className="brand-name">Molim</div>
            <div className="brand-subtitle">
              Management System
            </div>
          </div>
        </div>

        <div className="register-heading">
          <span className="section-label">
            مرحبًا بك
          </span>

          <h1>أنشئ حسابك</h1>

          <p>
            أنشئ بيانات الدخول الخاصة بك للبدء باستخدام النظام.
          </p>
        </div>

        <form
          className="register-form"
          onSubmit={onSubmit}
        >
          <div className="field">
            <label>اسم المستخدم</label>

            <div className="input-wrapper">
              <span className="input-icon">@</span>

              <input
                type="text"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                placeholder="username"
                autoComplete="username"
                dir="ltr"
              />
            </div>
          </div>

          <div className="field">
            <label>كلمة المرور</label>

            <div className="input-wrapper">
              <span className="input-icon">●</span>

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="••••••••"
                autoComplete="new-password"
                dir="ltr"
              />
            </div>
          </div>

          <div className="field">
            <label>تأكيد كلمة المرور</label>

            <div className="input-wrapper">
              <span className="input-icon">●</span>

              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                placeholder="••••••••"
                autoComplete="new-password"
                dir="ltr"
              />
            </div>
          </div>

          {message && (
            <div className="register-message">
              {message}
            </div>
          )}

          <button
            type="submit"
            className="primary-button"
            disabled={loading}
          >
            {loading
              ? "جاري إنشاء الحساب..."
              : "إنشاء الحساب"}
          </button>
        </form>

        <div className="secure-note">
          <span>🔒</span>
          <span>بياناتك محمية ومشفرة</span>
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  open,
  page,
  account,
  onNavigate,
  onClose,
  onProfile
}) {
  const roleName =
    account?.account?.role?.name;

  const isAdmin =
    roleName === "system_admin" ||
    roleName === "admin";

  return (
    <>
      {open && (
        <div
          className="sidebar-overlay sidebar-overlay-active"
          onClick={onClose}
        />
      )}

      <aside
        className={`sidebar ${
          open ? "sidebar-open" : ""
        }`}
        style={{
          overflowY: "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch"
        }}
      >
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="brand-icon">
              <span />
              <span />
              <span />
            </div>

            <div>
              <div className="brand-name">
                Molim
              </div>

              <div className="brand-subtitle">
                Management System
              </div>
            </div>
          </div>

          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="إغلاق القائمة"
          >
            ×
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-profile">
            <div className="avatar">
              {getInitials(getDisplayName(account))}
            </div>

            <div className="profile-info">
              <strong>
                {getDisplayName(account)}
              </strong>

              <span>
                {account?.account?.role
                  ? getRoleLabel(account.account.role)
                  : "مستخدم"}
              </span>
            </div>

            <button
              type="button"
              className="profile-more"
              onClick={onProfile}
              aria-label="الملف الشخصي"
            >
              ⋮
            </button>
          </div>
        </div>

        <nav>
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              النظام
            </div>

            <NavButton
              icon="⌂"
              label="الرئيسية"
              active={page === "dashboard"}
              onClick={() => onNavigate("dashboard")}
            />

            <NavButton
              icon="✓"
              label="مهامي"
              active={page === "tasks"}
              onClick={() => onNavigate("tasks")}
            />

            <NavButton
              icon="▣"
              label="مهام القسم"
              active={page === "departmentTasks"}
              onClick={() => onNavigate("departmentTasks")}
            />

            <NavButton
              icon="!"
              label="الإعلانات"
              active={page === "announcements"}
              onClick={() => onNavigate("announcements")}
            />

            <NavButton
              icon="♙"
              label="الفريق"
              active={page === "team"}
              onClick={() => onNavigate("team")}
            />

            <NavButton
              icon="✎"
              label="الملاحظات"
              active={page === "notes"}
              onClick={() => onNavigate("notes")}
            />

            <NavButton
              icon="●"
              label="التنبيهات"
              active={page === "notifications"}
              onClick={() => onNavigate("notifications")}
            />

            <NavButton
              icon="⚙"
              label="الإعدادات"
              active={page === "settings"}
              onClick={() => onNavigate("settings")}
            />
          </div>

          {isAdmin && (
            <div className="sidebar-section sidebar-admin">
              <div className="sidebar-section-title">
                الإدارة
              </div>

              <NavButton
                icon="♙"
                label="إدارة المستخدمين"
                active={page === "users"}
                onClick={() => onNavigate("users")}
              />

              <NavButton
                icon="▦"
                label="إدارة الأقسام"
                active={page === "departments"}
                onClick={() => onNavigate("departments")}
              />

              <NavButton
                icon="◆"
                label="إدارة الصلاحيات"
                active={page === "permissions"}
                onClick={() => onNavigate("permissions")}
              />

              <NavButton
                icon="⚙"
                label="إدارة النظام"
                active={page === "system"}
                onClick={() => onNavigate("system")}
              />
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick
}) {
  return (
    <button
      type="button"
      className={`nav-item ${
        active ? "nav-item-active" : ""
      }`}
      onClick={onClick}
    >
      <span className="nav-icon">
        {icon}
      </span>

      <span>{label}</span>
    </button>
  );
}

function Header({
  title,
  account,
  onMenu,
  onProfile,
  onNotifications
}) {
  const displayName =
    getDisplayName(account);

  return (
    <header className="topbar">
      <div className="topbar-right">
        <button
          type="button"
          className="menu-button"
          onClick={onMenu}
          aria-label="فتح القائمة"
        >
          <span />
          <span />
          <span />
        </button>

        <div className="mobile-brand">
          <span className="brand-dot" />
          Molim
        </div>

        <div>
          <span
            style={{
              display: "block",
              marginBottom: "2px",
              color: "#aaa",
              fontSize: "9px",
              fontWeight: 700
            }}
          >
            Molim
          </span>

          <strong
            style={{
              display: "block",
              color: "#282828",
              fontSize: "15px",
              fontWeight: 900
            }}
          >
            {title}
          </strong>
        </div>
      </div>

      <div className="topbar-left">
        <button
          type="button"
          className="icon-button"
          aria-label="التنبيهات"
          onClick={onNotifications}
        >
          ●
          <span className="notification-dot" />
        </button>

        <button
          type="button"
          className="top-profile"
          onClick={onProfile}
          style={{
            border: 0,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit"
          }}
          aria-label="فتح الملف الشخصي"
        >
          <div className="top-profile-text">
            <strong>{displayName}</strong>

            <span>
              {account?.account?.department?.name ||
                "بدون قسم"}
            </span>
          </div>

          <div className="avatar avatar-small">
            {getInitials(displayName)}
          </div>
        </button>
      </div>
    </header>
  );
}

/*
========================================================
DASHBOARD
========================================================
*/

function Dashboard({
  account,
  displayName,
  onNavigate
}) {
  const department =
    account?.account?.department?.name ||
    "بدون قسم";

  const roleLabel =
    account?.account?.role
      ? getRoleLabel(account.account.role)
      : "مستخدم";

  const today =
    new Date().toLocaleDateString(
      "ar-SA",
      {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }
    );

  return (
    <>
      <section className="welcome-section">
        <div>
          <span className="section-label">
            لوحة التحكم
          </span>

          <h1>
            أهلاً، <span>{displayName}</span>
          </h1>

          <p>
            مرحبًا بك في نظام Molim لإدارة المهام والفريق والإعلانات.
          </p>
        </div>

        <div className="date-card">
          <span>اليوم</span>
          <strong>{today}</strong>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          icon="✓"
          title="مهامي"
          value="0"
          description="المهام الحالية"
          onClick={() => onNavigate("tasks")}
        />

        <StatCard
          icon="◷"
          title="قيد التنفيذ"
          value="0"
          description="مهام قيد المتابعة"
          onClick={() => onNavigate("tasks")}
        />

        <StatCard
          icon="!"
          title="متأخرة"
          value="0"
          description="تحتاج إلى متابعة"
          danger
          onClick={() => onNavigate("tasks")}
        />

        <StatCard
          icon="●"
          title="التنبيهات"
          value="0"
          description="تنبيهات غير مقروءة"
          onClick={() => onNavigate("notifications")}
        />
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>المهام الحالية</h2>
              <p>المهام المسندة إليك حاليًا</p>
            </div>

            <button
              type="button"
              className="text-button"
              onClick={() => onNavigate("tasks")}
            >
              عرض الكل
            </button>
          </div>

          <div className="task-list">
            <div className="task-item">
              <div className="task-main">
                <div className="task-check">
                  <span />
                </div>

                <div className="task-info">
                  <h3>لا توجد مهام حاليًا</h3>

                  <span>
                    ستظهر المهام المسندة إليك هنا.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>الإعلانات المهمة</h2>
              <p>آخر التحديثات والتنبيهات</p>
            </div>

            <button
              type="button"
              className="text-button"
              onClick={() =>
                onNavigate("announcements")
              }
            >
              عرض الكل
            </button>
          </div>

          <div className="announcement-list">
            <div className="announcement">
              <div className="announcement-icon announcement-important">
                !
              </div>

              <div className="announcement-content">
                <h3>لا توجد إعلانات</h3>

                <p>
                  ستظهر الإعلانات المهمة هنا.
                </p>

                <span>Molim</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>معلومات الحساب</h2>
              <p>بيانات حسابك في النظام</p>
            </div>
          </div>

          <div className="activity-list">
            <div className="activity-item">
              <div className="activity-icon">
                👤
              </div>

              <div className="activity-content">
                <h3>{displayName}</h3>
                <p>الاسم</p>
              </div>
            </div>

            <div className="activity-item">
              <div className="activity-icon">
                🏢
              </div>

              <div className="activity-content">
                <h3>{department}</h3>
                <p>القسم</p>
              </div>
            </div>

            <div className="activity-item">
              <div className="activity-icon">
                ◆
              </div>

              <div className="activity-content">
                <h3>{roleLabel}</h3>
                <p>نوع الحساب</p>
              </div>
            </div>
          </div>
        </div>

        <div className="quick-panel">
          <span className="quick-label">
            Molim
          </span>

          <h2>
            إدارة فريقك بسهولة
          </h2>

          <p>
            تابع المهام والإعلانات وأعضاء الفريق من مكان واحد.
          </p>

          <div className="quick-actions">
            <button
              type="button"
              onClick={() => onNavigate("tasks")}
            >
              <span>✓</span>
              المهام
            </button>

            <button
              type="button"
              onClick={() =>
                onNavigate("announcements")
              }
            >
              <span>!</span>
              الإعلانات
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

/*
========================================================
USERS PAGE
========================================================
*/

function UsersPage({ account }) {
  const [loading, setLoading] =
    useState(true);

  const [users, setUsers] =
    useState([]);

  const [departments, setDepartments] =
    useState([]);

  const [roles, setRoles] =
    useState([]);

  const [error, setError] =
    useState("");

  const [selectedUser, setSelectedUser] =
    useState(null);

  const [showAddUser, setShowAddUser] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  async function loadUsers(showLoading = true) {
    try {
      if (showLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError("");

      const response =
        await fetch(
          "/api/admin/users",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              initData:
                getInitData()
            })
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "تعذر تحميل المستخدمين."
        );
      }

      setUsers(
        Array.isArray(
          result.users
        )
          ? result.users
          : []
      );

      setDepartments(
        Array.isArray(
          result.departments
        )
          ? result.departments
          : []
      );

      setRoles(
        Array.isArray(
          result.roles
        )
          ? result.roles
          : []
      );
    } catch (error) {
      console.error(error);

      setError(
        error.message ||
          "حدث خطأ أثناء تحميل المستخدمين."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const statistics =
    useMemo(() => {
      return {
        total: users.length,

        active:
          users.filter(
            (user) =>
              user.status ===
              "active"
          ).length,

        blocked:
          users.filter(
            (user) =>
              user.status ===
              "blocked"
          ).length,

        inactive:
          users.filter(
            (user) =>
              user.status ===
              "inactive"
          ).length
      };
    }, [users]);

  function handleUserUpdated(
    updatedUser
  ) {
    setUsers(
      (currentUsers) =>
        currentUsers.map(
          (user) =>
            user.id ===
            updatedUser.id
              ? updatedUser
              : user
        )
    );

    setSelectedUser(
      updatedUser
    );
  }

  function handleUserDeleted(
    userId
  ) {
    setUsers(
      (currentUsers) =>
        currentUsers.filter(
          (user) =>
            user.id !== userId
        )
    );

    setSelectedUser(null);
  }

  function handleUserAdded() {
    setShowAddUser(false);
    loadUsers(false);
  }

  return (
    <div className="users-page">
      <div className="users-page-header">
        <div>
          <span className="section-label">
            الإدارة
          </span>

          <h1>
            إدارة المستخدمين
          </h1>

          <p>
            عرض وإدارة حسابات أعضاء النظام وصلاحياتهم.
          </p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() =>
            loadUsers(false)
          }
          disabled={refreshing}
        >
          {refreshing
            ? "جاري التحديث..."
            : "تحديث القائمة"}
        </button>
      </div>

      <div className="users-summary">
        <div className="user-summary-card">
          <span>
            إجمالي المستخدمين
          </span>

          <strong>
            {statistics.total}
          </strong>
        </div>

        <div className="user-summary-card">
          <span>
            المستخدمون النشطون
          </span>

          <strong>
            {statistics.active}
          </strong>
        </div>

        <div className="user-summary-card">
          <span>
            المحظورون
          </span>

          <strong>
            {statistics.blocked}
          </strong>
        </div>

        <div className="user-summary-card">
          <span>
            غير النشطين
          </span>

          <strong>
            {statistics.inactive}
          </strong>
        </div>
      </div>

      <div className="panel users-panel">
        <div
          className="panel-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent:
              "space-between",
            gap: "14px",
            flexWrap: "wrap"
          }}
        >
          <div>
            <h2>
              جميع المستخدمين
            </h2>

            <p>
              اضغط على اسم المستخدم لعرض التفاصيل والإجراءات.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px"
            }}
          >
            <span className="text-button">
              {users.length} مستخدم
            </span>

            <button
              type="button"
              onClick={() =>
                setShowAddUser(true)
              }
              aria-label="إضافة مستخدم"
              title="إضافة مستخدم"
              style={{
                width: "42px",
                height: "42px",
                minWidth: "42px",
                border: 0,
                borderRadius: "12px",
                background:
                  "#f28c28",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent:
                  "center",
                fontSize: "26px",
                lineHeight: 1,
                fontWeight: 400,
                cursor: "pointer",
                boxShadow:
                  "0 8px 20px rgba(242,140,40,.20)"
              }}
            >
              +
            </button>
          </div>
        </div>

        {loading ? (
          <div className="users-loading">
            <div className="loading-spinner" />

            <p>
              جاري تحميل المستخدمين...
            </p>
          </div>
        ) : error ? (
          <div className="users-empty">
            <div className="announcement-icon announcement-important">
              !
            </div>

            <strong>
              تعذر تحميل البيانات
            </strong>

            <span>{error}</span>

            <button
              type="button"
              className="primary-button"
              onClick={() =>
                loadUsers()
              }
            >
              إعادة المحاولة
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="users-empty">
            <div className="announcement-icon">
              ♙
            </div>

            <strong>
              لا يوجد مستخدمون
            </strong>

            <span>
              اضغط على + لإضافة Telegram ID جديد.
            </span>

            <button
              type="button"
              className="primary-button"
              onClick={() =>
                setShowAddUser(true)
              }
            >
              + إضافة مستخدم
            </button>
          </div>
        ) : (
          <div className="users-table-wrapper">
            <div className="users-table">
              <div className="users-table-head">
                <div>المستخدم</div>
                <div>القسم</div>
                <div>الدور</div>
                <div>Telegram ID</div>
                <div>الحالة</div>
                <div>إجراء</div>
              </div>

              {users.map(
                (user) => (
                  <div
                    className="users-table-row"
                    key={user.id}
                  >
                    <div
                      className="user-cell"
                      style={{
                        cursor:
                          "pointer"
                      }}
                      onClick={() =>
                        setSelectedUser(
                          user
                        )
                      }
                    >
                      <div className="avatar">
                        {getInitials(
                          user.displayName ||
                            user.username
                        )}
                      </div>

                      <div>
                        <strong>
                          {user.displayName ||
                            "بدون اسم"}
                        </strong>

                        <span dir="ltr">
                          @
                          {user.username ||
                            "-"}
                        </span>
                      </div>
                    </div>

                    <div>
                      {user.department
                        ?.name ||
                        "بدون قسم"}
                    </div>

                    <div>
                      {getRoleLabel(
                        user.role
                      )}
                    </div>

                    <div className="telegram-id">
                      {user.telegramUserId ||
                        "-"}
                    </div>

                    <div>
                      <StatusBadge
                        status={
                          user.status
                        }
                      />
                    </div>

                    <div>
                      <button
                        type="button"
                        className="user-view-button"
                        onClick={() =>
                          setSelectedUser(
                            user
                          )
                        }
                      >
                        عرض
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {selectedUser && (
        <UserDetails
          user={selectedUser}
          departments={departments}
          roles={roles}
          currentAccount={
            account?.account
          }
          onClose={() =>
            setSelectedUser(null)
          }
          onUpdated={
            handleUserUpdated
          }
          onDeleted={
            handleUserDeleted
          }
        />
      )}

      {showAddUser && (
        <AddUserModal
          onClose={() =>
            setShowAddUser(false)
          }
          onAdded={
            handleUserAdded
          }
        />
      )}
    </div>
  );
}

/*
========================================================
USER DETAILS
========================================================
*/

function UserDetails({
  user,
  departments,
  roles,
  currentAccount,
  onClose,
  onUpdated,
  onDeleted
}) {
  const [editing, setEditing] =
    useState(false);

  const [displayName, setDisplayName] =
    useState(
      user.displayName || ""
    );

  const [username, setUsername] =
    useState(
      user.username || ""
    );

  const [departmentId, setDepartmentId] =
    useState(
      user.department?.id || ""
    );

  const [roleId, setRoleId] =
    useState(
      user.role?.id || ""
    );

  const [status, setStatus] =
    useState(
      user.status || "active"
    );

  const [saving, setSaving] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [confirmDelete, setConfirmDelete] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [messageType, setMessageType] =
    useState("error");

  useEffect(() => {
    setDisplayName(
      user.displayName || ""
    );

    setUsername(
      user.username || ""
    );

    setDepartmentId(
      user.department?.id || ""
    );

    setRoleId(
      user.role?.id || ""
    );

    setStatus(
      user.status || "active"
    );

    setMessage("");
    setEditing(false);
    setConfirmDelete(false);
  }, [user]);

  const isCurrentUser =
    currentAccount?.id ===
    user.id;

  async function handleSave(event) {
    event.preventDefault();

    setMessage("");

    const cleanDisplayName =
      displayName.trim();

    const cleanUsername =
      username.trim();

    if (
      cleanDisplayName.length >
      100
    ) {
      setMessageType("error");
      setMessage(
        "الاسم طويل جدًا."
      );
      return;
    }

    if (
      cleanUsername.length < 3 ||
      cleanUsername.length > 30
    ) {
      setMessageType("error");

      setMessage(
        "اسم المستخدم يجب أن يكون بين 3 و30 حرفًا."
      );

      return;
    }

    if (
      !/^[a-zA-Z0-9_]+$/.test(
        cleanUsername
      )
    ) {
      setMessageType("error");

      setMessage(
        "اسم المستخدم يسمح فقط بالحروف الإنجليزية والأرقام والشرطة السفلية."
      );

      return;
    }

    if (!roleId) {
      setMessageType("error");
      setMessage(
        "يرجى اختيار الدور."
      );
      return;
    }

    try {
      setSaving(true);

      const response =
        await fetch(
          "/api/admin/users",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              initData:
                getInitData(),

              userId:
                user.id,

              displayName:
                cleanDisplayName,

              username:
                cleanUsername,

              departmentId:
                departmentId ||
                null,

              roleId:
                roleId ||
                null,

              status
            })
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        setMessageType(
          "error"
        );

        setMessage(
          result.message ||
            "تعذر تحديث بيانات المستخدم."
        );

        return;
      }

      setMessageType(
        "success"
      );

      setMessage(
        result.message ||
          "تم تحديث بيانات المستخدم بنجاح."
      );

      if (result.user) {
        onUpdated(
          result.user
        );
      }

      setTimeout(() => {
        setEditing(false);
      }, 500);
    } catch (error) {
      console.error(error);

      setMessageType(
        "error"
      );

      setMessage(
        "حدث خطأ أثناء حفظ التعديلات."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isCurrentUser) {
      setMessageType("error");
      setMessage(
        "لا يمكنك حذف حسابك الحالي."
      );
      return;
    }

    try {
      setDeleting(true);
      setMessage("");

      const response =
        await fetch(
          "/api/admin/users",
          {
            method: "DELETE",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              initData:
                getInitData(),

              userId:
                user.id
            })
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        setMessageType(
          "error"
        );

        setMessage(
          result.message ||
            "تعذر حذف المستخدم."
        );

        setConfirmDelete(false);
        return;
      }

      onDeleted(
        user.id
      );
    } catch (error) {
      console.error(error);

      setMessageType(
        "error"
      );

      setMessage(
        "حدث خطأ أثناء حذف المستخدم."
      );

      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="user-modal-overlay"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        className="user-modal"
        style={{
          maxWidth: "560px"
        }}
      >
        <div className="user-modal-header">
          <div>
            <span className="section-label">
              بيانات المستخدم
            </span>

            <h2>
              {editing
                ? "تعديل المستخدم"
                : "تفاصيل المستخدم"}
            </h2>
          </div>

          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        {!editing ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "15px",
                padding: "18px",
                marginBottom: "18px",
                borderRadius: "18px",
                background:
                  "linear-gradient(135deg,#fffaf5,#fff)",
                border:
                  "1px solid rgba(242,140,40,.12)"
              }}
            >
              <div className="avatar">
                {getInitials(
                  user.displayName ||
                    user.username
                )}
              </div>

              <div
                style={{
                  minWidth: 0
                }}
              >
                <strong
                  style={{
                    display:
                      "block",
                    color:
                      "#222",
                    fontSize:
                      "18px",
                    fontWeight:
                      900,
                    marginBottom:
                      "4px"
                  }}
                >
                  {user.displayName ||
                    "بدون اسم"}
                </strong>

                <span
                  dir="ltr"
                  style={{
                    display:
                      "block",
                    color:
                      "#999",
                    fontSize:
                      "12px"
                  }}
                >
                  @
                  {user.username ||
                    "-"}
                </span>
              </div>
            </div>

            <div
              className="user-current-info"
              style={{
                marginBottom:
                  "20px"
              }}
            >
              <div>
                <span>
                  Telegram ID
                </span>

                <strong dir="ltr">
                  {user.telegramUserId ||
                    "-"}
                </strong>
              </div>

              <div>
                <span>
                  القسم
                </span>

                <strong>
                  {user.department
                    ?.name ||
                    "بدون قسم"}
                </strong>
              </div>

              <div>
                <span>
                  الدور
                </span>

                <strong>
                  {getRoleLabel(
                    user.role
                  )}
                </strong>
              </div>

              <div>
                <span>
                  الحالة
                </span>

                <StatusBadge
                  status={
                    user.status
                  }
                />
              </div>

              <div>
                <span>
                  تاريخ إنشاء الحساب
                </span>

                <strong>
                  {user.createdAt
                    ? new Date(
                        user.createdAt
                      ).toLocaleDateString(
                        "ar-SA"
                      )
                    : "-"}
                </strong>
              </div>
            </div>

            {message && (
              <div
                className={`form-message ${
                  messageType ===
                  "success"
                    ? "success"
                    : "error"
                }`}
              >
                {message}
              </div>
            )}

            <div
              style={{
                display:
                  "flex",
                gap:
                  "10px",
                marginTop:
                  "20px",
                flexWrap:
                  "wrap"
              }}
            >
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  setEditing(
                    true
                  )
                }
                style={{
                  flex: 1,
                  minWidth:
                    "140px"
                }}
              >
                تعديل
              </button>

              <button
                type="button"
                onClick={() =>
                  setConfirmDelete(
                    true
                  )
                }
                disabled={
                  isCurrentUser ||
                  deleting
                }
                style={{
                  flex: 1,
                  minWidth:
                    "140px",
                  height:
                    "44px",
                  border: 0,
                  borderRadius:
                    "11px",
                  background:
                    isCurrentUser
                      ? "#ddd"
                      : "#d9363e",
                  color:
                    "#fff",
                  fontFamily:
                    "inherit",
                  fontSize:
                    "13px",
                  fontWeight:
                    900,
                  cursor:
                    isCurrentUser
                      ? "not-allowed"
                      : "pointer"
                }}
              >
                حظر
              </button>
            </div>

            {isCurrentUser && (
              <div
                className="user-modal-note"
                style={{
                  marginTop:
                    "15px"
                }}
              >
                <span>
                  ⚠️
                </span>

                <p>
                  هذا حسابك الحالي، لذلك لا
                  يمكنك حذف أو حظر حسابك.
                </p>
              </div>
            )}
          </>
        ) : (
          <form
            onSubmit={
              handleSave
            }
          >
            <div
              className="user-details-grid"
            >
              <div className="user-detail">
                <span>
                  Telegram ID
                </span>

                <strong dir="ltr">
                  {user.telegramUserId ||
                    "-"}
                </strong>
              </div>

              <div className="user-detail">
                <span>
                  تاريخ إنشاء الحساب
                </span>

                <strong>
                  {user.createdAt
                    ? new Date(
                        user.createdAt
                      ).toLocaleDateString(
                        "ar-SA"
                      )
                    : "-"}
                </strong>
              </div>
            </div>

            <div className="user-form-grid">
              <label className="user-form-field">
                <span>
                  الاسم الحقيقي
                </span>

                <input
                  type="text"
                  value={
                    displayName
                  }
                  onChange={(
                    event
                  ) =>
                    setDisplayName(
                      event.target
                        .value
                    )
                  }
                  placeholder="الاسم الحقيقي"
                  maxLength={
                    100
                  }
                />
              </label>

              <label className="user-form-field">
                <span>
                  اسم المستخدم
                </span>

                <input
                  type="text"
                  value={
                    username
                  }
                  onChange={(
                    event
                  ) =>
                    setUsername(
                      event.target
                        .value
                    )
                  }
                  placeholder="username"
                  maxLength={
                    30
                  }
                  dir="ltr"
                />
              </label>

              <label className="user-form-field">
                <span>
                  القسم
                </span>

                <select
                  value={
                    departmentId
                  }
                  onChange={(
                    event
                  ) =>
                    setDepartmentId(
                      event.target
                        .value
                    )
                  }
                >
                  <option value="">
                    بدون قسم
                  </option>

                  {departments.map(
                    (
                      department
                    ) => (
                      <option
                        key={
                          department.id
                        }
                        value={
                          department.id
                        }
                      >
                        {
                          department.name
                        }
                      </option>
                    )
                  )}
                </select>
              </label>

              <label className="user-form-field">
                <span>
                  الدور والصلاحيات
                </span>

                <select
                  value={
                    roleId
                  }
                  onChange={(
                    event
                  ) =>
                    setRoleId(
                      event.target
                        .value
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
                        )}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label className="user-form-field">
                <span>
                  حالة الحساب
                </span>

                <select
                  value={
                    status
                  }
                  onChange={(
                    event
                  ) =>
                    setStatus(
                      event.target
                        .value
                    )
                  }
                >
                  <option value="active">
                    نشط
                  </option>

                  <option value="inactive">
                    غير نشط
                  </option>

                  <option value="blocked">
                    محظور
                  </option>
                </select>
              </label>
            </div>

            <div className="user-modal-note">
              <span>
                🔐
              </span>

              <p>
                Telegram ID مرتبط بحساب Telegram
                ولا يمكن تعديله من لوحة الإدارة.
              </p>
            </div>

            {isCurrentUser && (
              <div className="user-modal-note">
                <span>
                  ⚠️
                </span>

                <p>
                  هذا حسابك الحالي. لا يمكنك تعطيل
                  أو حظر حسابك، ولا يمكنك إزالة
                  صلاحية مدير النظام من نفسك.
                </p>
              </div>
            )}

            {message && (
              <div
                className={`form-message ${
                  messageType ===
                  "success"
                    ? "success"
                    : "error"
                }`}
              >
                {message}
              </div>
            )}

            <div className="user-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setEditing(
                    false
                  )
                }
                disabled={
                  saving
                }
              >
                رجوع
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={
                  saving
                }
              >
                {saving
                  ? "جاري الحفظ..."
                  : "حفظ التعديلات"}
              </button>
            </div>
          </form>
        )}

        {confirmDelete && (
          <div
            style={{
              position:
                "fixed",
              inset: 0,
              zIndex: 10000,
              background:
                "rgba(20,20,20,.58)",
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              padding:
                "20px"
            }}
            onMouseDown={(
              event
            ) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setConfirmDelete(
                  false
                );
              }
            }}
          >
            <div
              style={{
                width:
                  "100%",
                maxWidth:
                  "420px",
                background:
                  "#fff",
                borderRadius:
                  "20px",
                padding:
                  "24px",
                boxShadow:
                  "0 25px 80px rgba(0,0,0,.25)",
                textAlign:
                  "center"
              }}
            >
              <div
                style={{
                  width:
                    "58px",
                  height:
                    "58px",
                  margin:
                    "0 auto 15px",
                  borderRadius:
                    "50%",
                  background:
                    "#fff0f0",
                  color:
                    "#d9363e",
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  fontSize:
                    "25px",
                  fontWeight:
                    900
                }}
              >
                !
              </div>

              <h3
                style={{
                  margin:
                    "0 0 8px",
                  fontSize:
                    "19px",
                  fontWeight:
                    900,
                  color:
                    "#222"
                }}
              >
                تأكيد الحظر
              </h3>

              <p
                style={{
                  margin:
                    "0 0 18px",
                  color:
                    "#777",
                  fontSize:
                    "13px",
                  lineHeight:
                    1.8
                }}
              >
                هل أنت متأكد من حظر
                <strong
                  style={{
                    color:
                      "#222"
                  }}
                >
                  {" "}
                  {user.displayName ||
                    user.username ||
                    "هذا المستخدم"}{" "}
                </strong>
                ؟
                <br />
                سيتم حذف حسابه وإزالة Telegram ID
                الخاص به من قاعدة البيانات، ولن
                يستطيع الدخول مرة أخرى.
              </p>

              <div
                style={{
                  display:
                    "flex",
                  gap:
                    "10px"
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setConfirmDelete(
                      false
                    )
                  }
                  disabled={
                    deleting
                  }
                  className="secondary-button"
                  style={{
                    flex:
                      1
                  }}
                >
                  إلغاء
                </button>

                <button
                  type="button"
                  onClick={
                    handleDelete
                  }
                  disabled={
                    deleting
                  }
                  style={{
                    flex:
                      1,
                    height:
                      "44px",
                    border:
                      0,
                    borderRadius:
                      "11px",
                    background:
                      "#d9363e",
                    color:
                      "#fff",
                    fontFamily:
                      "inherit",
                    fontWeight:
                      900,
                    cursor:
                      deleting
                        ? "wait"
                        : "pointer"
                  }}
                >
                  {deleting
                    ? "جاري الحذف..."
                    : "نعم، احذف الحساب"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/*
========================================================
ADD USER MODAL
========================================================
*/

function AddUserModal({
  onClose,
  onAdded
}) {
  const [telegramUserId, setTelegramUserId] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [messageType, setMessageType] =
    useState("error");

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    setMessage("");

    const cleanId =
      telegramUserId.trim();

    if (!cleanId) {
      setMessageType(
        "error"
      );

      setMessage(
        "يرجى إدخال Telegram ID."
      );

      return;
    }

    if (!/^\d+$/.test(cleanId)) {
      setMessageType(
        "error"
      );

      setMessage(
        "Telegram ID يجب أن يحتوي على أرقام فقط."
      );

      return;
    }

    try {
      setSaving(true);

      const response =
        await fetch(
          "/api/admin/users",
          {
            method: "PUT",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              initData:
                getInitData(),

              telegramUserId:
                cleanId
            })
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        setMessageType(
          "error"
        );

        setMessage(
          result.message ||
            "تعذر إضافة Telegram ID."
        );

        return;
      }

      setMessageType(
        "success"
      );

      setMessage(
        result.message ||
          "تمت إضافة Telegram ID بنجاح."
      );

      setTimeout(() => {
        onAdded();
      }, 800);
    } catch (error) {
      console.error(error);

      setMessageType(
        "error"
      );

      setMessage(
        "حدث خطأ أثناء إضافة المستخدم."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="user-modal-overlay"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        className="user-modal"
        style={{
          maxWidth:
            "470px"
        }}
      >
        <div className="user-modal-header">
          <div>
            <span className="section-label">
              مستخدم جديد
            </span>

            <h2>
              إضافة مستخدم
            </h2>
          </div>

          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <div
          style={{
            width:
              "64px",
            height:
              "64px",
            borderRadius:
              "18px",
            background:
              "#fff5ea",
            color:
              "#f28c28",
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            fontSize:
              "28px",
            fontWeight:
              900,
            margin:
              "0 auto 18px"
          }}
        >
          +
        </div>

        <p
          style={{
            margin:
              "0 0 20px",
            textAlign:
              "center",
            color:
              "#777",
            fontSize:
              "13px",
            lineHeight:
              1.8
          }}
        >
          أدخل Telegram ID للمستخدم. بعد الإضافة
          سيُسمح له بفتح النظام وإنشاء حسابه بنفسه.
        </p>

        <form
          onSubmit={
            handleSubmit
          }
        >
          <label className="user-form-field">
            <span>
              Telegram ID
            </span>

            <input
              type="text"
              value={
                telegramUserId
              }
              onChange={(
                event
              ) =>
                setTelegramUserId(
                  event.target.value.replace(
                    /\D/g,
                    ""
                  )
                )
              }
              placeholder="مثال: 5856409647"
              inputMode="numeric"
              dir="ltr"
              autoFocus
            />
          </label>

          <div
            className="user-modal-note"
            style={{
              marginTop:
                "15px"
            }}
          >
            <span>
              ℹ️
            </span>

            <p>
              سيتم إضافة المعرف إلى قائمة المستخدمين
              المسموح لهم فقط، ولن يتم إنشاء حساب
              بكلمة مرور من هنا.
            </p>
          </div>

          {message && (
            <div
              className={`form-message ${
                messageType ===
                "success"
                  ? "success"
                  : "error"
              }`}
              style={{
                marginTop:
                  "15px"
              }}
            >
              {message}
            </div>
          )}

          <div className="user-modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={
                onClose
              }
              disabled={
                saving
              }
            >
              إلغاء
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={
                saving
              }
            >
              {saving
                ? "جاري الإضافة..."
                : "إضافة المستخدم"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/*
========================================================
PROFILE MODAL
========================================================
*/

function ProfileModal({
  account,
  onClose,
  onUpdated
}) {
  const [displayName, setDisplayName] =
    useState(
      account?.account?.displayName ||
        ""
    );

  const [username, setUsername] =
    useState(
      account?.account?.username ||
        ""
    );

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [messageType, setMessageType] =
    useState("error");

  async function handleSave(
    event
  ) {
    event.preventDefault();

    setMessage("");

    const cleanDisplayName =
      displayName.trim();

    const cleanUsername =
      username.trim();

    if (
      cleanDisplayName.length <
        1 ||
      cleanDisplayName.length >
        100
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "الاسم يجب أن يكون بين حرف واحد و100 حرف."
      );

      return;
    }

    if (
      cleanUsername.length <
        3 ||
      cleanUsername.length >
        30
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "اسم المستخدم يجب أن يكون بين 3 و30 حرفًا."
      );

      return;
    }

    if (
      !/^[a-zA-Z0-9_]+$/.test(
        cleanUsername
      )
    ) {
      setMessageType(
        "error"
      );

      setMessage(
        "اسم المستخدم يسمح فقط بالحروف الإنجليزية والأرقام والشرطة السفلية."
      );

      return;
    }

    try {
      setSaving(true);

      const response =
        await fetch(
          "/api/account/me",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              initData:
                getInitData(),

              displayName:
                cleanDisplayName,

              username:
                cleanUsername
            })
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        setMessageType(
          "error"
        );

        setMessage(
          result.message ||
            "تعذر تحديث الملف الشخصي."
        );

        return;
      }

      setMessageType(
        "success"
      );

      setMessage(
        result.message ||
          "تم تحديث الملف الشخصي بنجاح."
      );

      await onUpdated();

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (error) {
      console.error(error);

      setMessageType(
        "error"
      );

      setMessage(
        "حدث خطأ أثناء حفظ التعديلات."
      );
    } finally {
      setSaving(false);
    }
  }

  const department =
    account?.account?.department?.name ||
    "بدون قسم";

  const role =
    account?.account?.role;

  const roleLabel =
    role
      ? getRoleLabel(role)
      : "بدون دور";

  const status =
    account?.account?.status ||
    "inactive";

  const currentDisplayName =
    account?.account?.displayName ||
    account?.user?.firstName ||
    "مستخدم";

  return (
    <div
      className="user-modal-overlay"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div className="user-modal">
        <div className="user-modal-header">
          <div>
            <span className="section-label">
              الحساب
            </span>

            <h2>
              الملف الشخصي
            </h2>
          </div>

          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap:
              "15px",
            marginBottom:
              "20px",
            padding:
              "16px",
            borderRadius:
              "16px",
            background:
              "linear-gradient(135deg,#fffaf5,#ffffff)",
            border:
              "1px solid rgba(245,166,91,.12)"
          }}
        >
          <div className="avatar">
            {getInitials(
              currentDisplayName
            )}
          </div>

          <div
            style={{
              minWidth:
                0
            }}
          >
            <strong
              style={{
                display:
                  "block",
                color:
                  "#222",
                fontSize:
                  "16px",
                fontWeight:
                  900,
                marginBottom:
                  "4px"
              }}
            >
              {currentDisplayName}
            </strong>

            <span
              dir="ltr"
              style={{
                display:
                  "block",
                color:
                  "#999",
                fontSize:
                  "12px"
              }}
            >
              @
              {account?.account
                ?.username ||
                "-"}
            </span>
          </div>
        </div>

        <form
          onSubmit={
            handleSave
          }
        >
          <div className="user-form-grid">
            <label className="user-form-field">
              <span>
                الاسم الحقيقي
              </span>

              <input
                type="text"
                value={
                  displayName
                }
                onChange={(
                  event
                ) =>
                  setDisplayName(
                    event.target
                      .value
                  )
                }
                placeholder="الاسم الحقيقي"
                maxLength={
                  100
                }
              />
            </label>

            <label className="user-form-field">
              <span>
                اسم المستخدم
              </span>

              <input
                type="text"
                value={
                  username
                }
                onChange={(
                  event
                ) =>
                  setUsername(
                    event.target
                      .value
                  )
                }
                placeholder="username"
                maxLength={
                  30
                }
                dir="ltr"
              />
            </label>
          </div>

          <div className="user-current-info">
            <div>
              <span>
                Telegram ID
              </span>

              <strong dir="ltr">
                {account?.account
                  ?.telegramUserId ||
                  "-"}
              </strong>
            </div>

            <div>
              <span>
                القسم
              </span>

              <strong>
                {department}
              </strong>
            </div>

            <div>
              <span>
                الدور
              </span>

              <strong>
                {roleLabel}
              </strong>
            </div>

            <div>
              <span>
                الحالة
              </span>

              <StatusBadge
                status={
                  status
                }
              />
            </div>
          </div>

          <div className="user-modal-note">
            <span>
              🔐
            </span>

            <p>
              Telegram ID والقسم والدور والصلاحيات
              تتم إدارتها من لوحة الإدارة ولا يمكن
              تغييرها من الملف الشخصي.
            </p>
          </div>

          {message && (
            <div
              className={`form-message ${
                messageType ===
                "success"
                  ? "success"
                  : "error"
              }`}
            >
              {message}
            </div>
          )}

          <div className="user-modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={
                onClose
              }
              disabled={
                saving
              }
            >
              إلغاء
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={
                saving
              }
            >
              {saving
                ? "جاري الحفظ..."
                : "حفظ التعديلات"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/*
========================================================
STATUS
========================================================
*/

function StatusBadge({
  status
}) {
  const className =
    status === "active"
      ? "status-active"
      : status === "blocked"
      ? "status-blocked"
      : "status-inactive";

  return (
    <span
      className={`status-badge ${className}`}
    >
      {getStatusLabel(
        status
      )}
    </span>
  );
}

/*
========================================================
STAT CARD
========================================================
*/

function StatCard({
  icon,
  title,
  value,
  description,
  danger,
  onClick
}) {
  return (
    <button
      type="button"
      className={`stat-card ${
        danger
          ? "stat-danger"
          : ""
      }`}
      onClick={
        onClick
      }
    >
      <div className="stat-top">
        <div className="stat-icon">
          {icon}
        </div>

        <span className="stat-more">
          •••
        </span>
      </div>

      <div className="stat-value">
        {value}
      </div>

      <div className="stat-title">
        {title}
      </div>

      <div className="stat-subtitle">
        {description}
      </div>
    </button>
  );
}

/*
========================================================
EMPTY PAGE
========================================================
*/

function EmptyPage({
  title,
  description,
  icon
}) {
  return (
    <div className="placeholder-page">
      <div className="placeholder-icon">
        {icon}
      </div>

      <h1>
        {title}
      </h1>

      <p>
        {description}
      </p>
    </div>
  );
}
