"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./page.css";

function getTelegramWebApp() {
    if (typeof window === "undefined") return null;
    return window.Telegram?.WebApp || null;
}

function getInitData() {
    const tg = getTelegramWebApp();
    return tg?.initData || "";
}

export default function DepartmentDetailsPage() {
    const router = useRouter();
    const params = useParams();

    const departmentId = params?.id;

    const [department, setDepartment] = useState(null);
    const [accounts, setAccounts] = useState([]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const [showAddMember, setShowAddMember] = useState(false);
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const [positionTitle, setPositionTitle] = useState("");

    const [search, setSearch] = useState("");

    // =========================================================
    // TELEGRAM
    // =========================================================

    const [showTelegramLink, setShowTelegramLink] = useState(false);
    const [showTelegramMenu, setShowTelegramMenu] = useState(false);
    const [telegramChatId, setTelegramChatId] = useState("");

    // =========================================================
    // LOAD DEPARTMENT
    // =========================================================

    async function loadDepartment() {
        try {
            setLoading(true);
            setError("");

            const initData = getInitData();

            if (!initData) {
                throw new Error(
                    "يجب فتح التطبيق من داخل Telegram"
                );
            }

            const response = await fetch(
                "/api/admin/departments",
                {
                    method: "GET",
                    headers: {
                        "x-telegram-init-data": initData,
                    },
                    cache: "no-store",
                }
            );

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.error ||
                        data.message ||
                        "تعذر تحميل بيانات القسم"
                );
            }

            const found = data.departments?.find(
                (item) =>
                    String(item.id) ===
                    String(departmentId)
            );

            if (!found) {
                throw new Error("القسم غير موجود");
            }

            setDepartment(found);

            setTelegramChatId(
                found.telegramChatId
                    ? String(found.telegramChatId)
                    : ""
            );

            const existingIds = new Set(
                (found.members || []).map((member) =>
                    String(member.accountId)
                )
            );

            setAccounts(
                (data.accounts || []).filter(
                    (account) =>
                        !existingIds.has(
                            String(account.id)
                        )
                )
            );
        } catch (err) {
            console.error(err);

            setError(
                err.message ||
                    "حدث خطأ غير متوقع"
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!departmentId) return;

        const tg = getTelegramWebApp();

        tg?.ready?.();
        tg?.expand?.();

        loadDepartment();
    }, [departmentId]);

    // =========================================================
    // SEARCH
    // =========================================================

    const filteredAccounts = useMemo(() => {
        const value = search
            .trim()
            .toLowerCase();

        if (!value) {
            return accounts;
        }

        return accounts.filter((account) => {
            const name = String(
                account.displayName || ""
            ).toLowerCase();

            const username = String(
                account.username || ""
            ).toLowerCase();

            const telegramId = String(
                account.telegramUserId || ""
            ).toLowerCase();

            return (
                name.includes(value) ||
                username.includes(
                    value.replace(/^@/, "")
                ) ||
                telegramId.includes(value)
            );
        });
    }, [accounts, search]);

    // =========================================================
    // ADD MEMBER
    // =========================================================

    function openAddMemberModal() {
        setSearch("");
        setSelectedAccountId("");
        setPositionTitle("");
        setShowAddMember(true);
    }

    function closeAddMemberModal() {
        if (saving) return;

        setShowAddMember(false);
        setSearch("");
        setSelectedAccountId("");
        setPositionTitle("");
    }

    function selectAccount(accountId) {
        setSelectedAccountId(
            String(accountId)
        );
    }

    async function addMember() {
        if (!selectedAccountId) {
            alert("اختر العضو أولًا");
            return;
        }

        try {
            setSaving(true);

            const response = await fetch(
                "/api/admin/departments/members",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        initData:
                            getInitData(),
                        departmentId,
                        accountId:
                            selectedAccountId,
                        positionTitle:
                            positionTitle.trim() ||
                            null,
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
                    data.error ||
                        data.message ||
                        "تعذر إضافة العضو"
                );
            }

            setShowAddMember(false);

            await loadDepartment();
        } catch (err) {
            console.error(err);

            alert(
                err.message ||
                    "حدث خطأ أثناء إضافة العضو"
            );
        } finally {
            setSaving(false);
        }
    }

    // =========================================================
    // REMOVE MEMBER
    // =========================================================

    async function removeMember(member) {
        const name =
            member?.account?.displayName ||
            member?.account?.username ||
            "هذا العضو";

        const confirmed =
            window.confirm(
                `هل أنت متأكد من إزالة ${name} من القسم؟\n\nلن يتم حذف حساب المستخدم، فقط ستتم إزالة عضويته من هذا القسم.`
            );

        if (!confirmed) return;

        try {
            setSaving(true);

            const response = await fetch(
                "/api/admin/departments/members",
                {
                    method: "DELETE",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        initData:
                            getInitData(),
                        membershipId:
                            member.id,
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
                    data.error ||
                        data.message ||
                        "تعذر إزالة العضو"
                );
            }

            await loadDepartment();
        } catch (err) {
            console.error(err);

            alert(
                err.message ||
                    "حدث خطأ أثناء إزالة العضو"
            );
        } finally {
            setSaving(false);
        }
    }

    // =========================================================
    // HEAD
    // =========================================================

    async function toggleHead(member) {
        const isHead =
            Boolean(member.isHead);

        const actionText = isHead
            ? "إلغاء تعيين هذا العضو كرئيس للقسم؟"
            : "تعيين هذا العضو كرئيس للقسم؟";

        if (
            !window.confirm(actionText)
        ) {
            return;
        }

        try {
            setSaving(true);

            const response = await fetch(
                "/api/admin/departments/members",
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        initData:
                            getInitData(),
                        membershipId:
                            member.id,
                        action: isHead
                            ? "remove_head"
                            : "set_head",
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
                    data.error ||
                        data.message ||
                        "تعذر تحديث رئيس القسم"
                );
            }

            await loadDepartment();
        } catch (err) {
            console.error(err);

            alert(
                err.message ||
                    "حدث خطأ أثناء تحديث رئيس القسم"
            );
        } finally {
            setSaving(false);
        }
    }

    // =========================================================
    // POSITION
    // =========================================================

    async function updatePosition(member) {
        const current =
            member.positionTitle || "";

        const value = window.prompt(
            "أدخل المسمى الوظيفي داخل القسم:",
            current
        );

        if (value === null) return;

        try {
            setSaving(true);

            const response = await fetch(
                "/api/admin/departments/members",
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        initData:
                            getInitData(),
                        membershipId:
                            member.id,
                        action:
                            "update_position",
                        positionTitle:
                            value.trim() ||
                            null,
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
                    data.error ||
                        data.message ||
                        "تعذر تحديث المسمى الوظيفي"
                );
            }

            await loadDepartment();
        } catch (err) {
            console.error(err);

            alert(
                err.message ||
                    "حدث خطأ أثناء تحديث المسمى"
            );
        } finally {
            setSaving(false);
        }
    }

    // =========================================================
    // TELEGRAM LINKING
    // =========================================================

    function openTelegramLink() {
        setShowTelegramMenu(false);

        setTelegramChatId(
            department?.telegramChatId
                ? String(
                      department.telegramChatId
                  )
                : ""
        );

        setShowTelegramLink(true);
    }

    function closeTelegramLink() {
        if (saving) return;

        setShowTelegramLink(false);
    }

    async function saveTelegramLink() {
        const value =
            telegramChatId.trim();

        if (!value) {
            alert(
                "أدخل Chat ID الخاص بقروب Telegram"
            );
            return;
        }

        try {
            setSaving(true);

            const response = await fetch(
                "/api/admin/departments",
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        initData:
                            getInitData(),
                        id: departmentId,
                        telegramChatId:
                            value,
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
                    data.error ||
                        data.message ||
                        "تعذر ربط قروب Telegram"
                );
            }

            setShowTelegramLink(false);
            setShowTelegramMenu(false);

            await loadDepartment();

            alert(
                "تم ربط قروب Telegram بالقسم بنجاح."
            );
        } catch (err) {
            console.error(err);

            alert(
                err.message ||
                    "حدث خطأ أثناء ربط القروب"
            );
        } finally {
            setSaving(false);
        }
    }

    async function unlinkTelegram() {
        const confirmed =
            window.confirm(
                "هل أنت متأكد من إلغاء ربط قروب Telegram بهذا القسم؟"
            );

        if (!confirmed) return;

        try {
            setSaving(true);

            const response = await fetch(
                "/api/admin/departments",
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        initData:
                            getInitData(),
                        id: departmentId,
                        telegramChatId:
                            null,
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
                    data.error ||
                        data.message ||
                        "تعذر إلغاء ربط القروب"
                );
            }

            setShowTelegramMenu(false);
            setTelegramChatId("");

            await loadDepartment();

            alert(
                "تم إلغاء ربط قروب Telegram."
            );
        } catch (err) {
            console.error(err);

            alert(
                err.message ||
                    "حدث خطأ أثناء إلغاء الربط"
            );
        } finally {
            setSaving(false);
        }
    }

    // =========================================================
    // LOADING
    // =========================================================

    if (loading) {
        return (
            <main className="department-page">
                <div className="department-loading">
                    <div className="loading-spinner" />

                    <p>
                        جاري تحميل القسم...
                    </p>
                </div>
            </main>
        );
    }

    // =========================================================
    // ERROR
    // =========================================================

    if (error) {
        return (
            <main className="department-page">
                <div className="department-error">

                    <div className="error-icon">
                        !
                    </div>

                    <h2>
                        تعذر تحميل القسم
                    </h2>

                    <p>{error}</p>

                    <div className="error-actions">

                        <button
                            className="primary-btn"
                            onClick={
                                loadDepartment
                            }
                        >
                            إعادة المحاولة
                        </button>

                        <button
                            className="secondary-btn"
                            onClick={() =>
                                router.push(
                                    "/departments"
                                )
                            }
                        >
                            العودة للأقسام
                        </button>

                    </div>
                </div>
            </main>
        );
    }

    if (!department) {
        return null;
    }

    const members =
        department.members || [];

    const isTelegramConnected =
        Boolean(
            department.telegramChatId
        );

    const telegramGroupName =
        department.telegramGroupName ||
        department.telegramChatTitle ||
        department.telegramTitle ||
        "";

    return (
        <main
            className="department-page"
            dir="rtl"
        >
            <div className="department-container">

                {/* =====================================================
                    HEADER
                ===================================================== */}

                <header className="department-header">

                    <button
                        className="back-btn"
                        onClick={() =>
                            router.push(
                                "/departments"
                            )
                        }
                    >
                        <span>→</span>
                        الأقسام
                    </button>

                    <div className="header-title">

                        <span className="header-kicker">
                            إدارة الأقسام
                        </span>

                        <h1>
                            {department.name}
                        </h1>

                        <p>
                            إدارة أعضاء القسم ومعلوماته
                        </p>

                    </div>

                </header>

                {/* =====================================================
                    HERO
                ===================================================== */}

                <section className="department-hero">

                    <div className="department-icon">
                        ▦
                    </div>

                    <div className="department-main-info">

                        <span className="section-label">
                            القسم
                        </span>

                        <h2>
                            {department.name}
                        </h2>

                        <p>
                            {department.description ||
                                "لا يوجد وصف مضاف لهذا القسم حاليًا."}
                        </p>

                        {isTelegramConnected && (
                            <div className="telegram-group">

                                <span>
                                    ✈
                                </span>

                                <div>

                                    <small>
                                        مجموعة Telegram
                                    </small>

                                    <strong>
                                        {
                                            telegramGroupName ||
                                            department.telegramChatId
                                        }
                                    </strong>

                                </div>

                            </div>
                        )}

                    </div>

                    {/* =================================================
                        HEAD
                    ================================================= */}

                    <div className="department-head-box">

                        <span className="head-label">
                            رئيس القسم
                        </span>

                        {department.head ? (
                            <>
                                <div className="head-avatar">

                                    {(
                                        department.head
                                            .displayName ||
                                        department.head
                                            .username ||
                                        "؟"
                                    )
                                        .charAt(0)
                                        .toUpperCase()}

                                </div>

                                <strong>
                                    {
                                        department.head
                                            .displayName ||
                                        department.head
                                            .username
                                    }
                                </strong>

                                <span>
                                    {
                                        department.head
                                            .positionTitle ||
                                        "رئيس القسم"
                                    }
                                </span>
                            </>
                        ) : (
                            <>
                                <div className="empty-head-icon">
                                    —
                                </div>

                                <strong>
                                    لم يتم تعيين رئيس
                                </strong>

                                <span>
                                    يمكنك تعيينه من قائمة الأعضاء
                                </span>
                            </>
                        )}

                    </div>

                </section>

                {/* =====================================================
                    STATS
                ===================================================== */}

                <section className="department-stats">

                    <div className="department-stat">

                        <span className="stat-icon">
                            ♙
                        </span>

                        <div>

                            <strong>
                                {members.length}
                            </strong>

                            <span>
                                أعضاء القسم
                            </span>

                        </div>

                    </div>

                    <div className="department-stat">

                        <span className="stat-icon">
                            ★
                        </span>

                        <div>

                            <strong>
                                {department.head
                                    ? "1"
                                    : "0"}
                            </strong>

                            <span>
                                رئيس القسم
                            </span>

                        </div>

                    </div>

                    <div className="department-stat">

                        <span className="stat-icon">
                            ✈
                        </span>

                        <div>

                            <strong>
                                {isTelegramConnected
                                    ? "مرتبط"
                                    : "غير مرتبط"}
                            </strong>

                            <span>
                                مجموعة Telegram
                            </span>

                        </div>

                    </div>

                </section>

                {/* =====================================================
                    MEMBERS
                ===================================================== */}

                <section className="members-section">

                    <div className="section-header">

                        <div className="members-section-title">

                            <span className="section-label">
                                فريق القسم
                            </span>

                            <h2>
                                أعضاء القسم
                            </h2>

                            <p>
                                الأشخاص المنضمون إلى هذا القسم
                            </p>

                        </div>

                        <div className="section-header-actions">

                            {/* =================================================
                                TELEGRAM
                            ================================================= */}

                            <div className="telegram-connection">

                                {isTelegramConnected ? (
                                    <>

                                        <button
                                            type="button"
                                            className="telegram-connected"
                                            onClick={() =>
                                                setShowTelegramMenu(
                                                    (value) =>
                                                        !value
                                                )
                                            }
                                            disabled={
                                                saving
                                            }
                                        >

                                            <span className="telegram-status-icon">
                                                🔗
                                            </span>

                                            <span className="telegram-status-text">

                                                <strong>
                                                    مرتبط بالقروب
                                                </strong>

                                                <small>
                                                    {
                                                        telegramGroupName ||
                                                        department.telegramChatId
                                                    }
                                                </small>

                                            </span>

                                            <span className="telegram-menu-arrow">
                                                ⋯
                                            </span>

                                        </button>

                                        {showTelegramMenu && (
                                            <div className="telegram-menu">

                                                <button
                                                    type="button"
                                                    onClick={
                                                        openTelegramLink
                                                    }
                                                >
                                                    تغيير القروب
                                                </button>

                                                <button
                                                    type="button"
                                                    className="telegram-menu-danger"
                                                    onClick={
                                                        unlinkTelegram
                                                    }
                                                >
                                                    إلغاء الربط
                                                </button>

                                            </div>
                                        )}

                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        className="telegram-connect-btn"
                                        onClick={
                                            openTelegramLink
                                        }
                                    >

                                        <span>
                                            🔗
                                        </span>

                                        <span>
                                            ربط Telegram
                                        </span>

                                    </button>
                                )}

                            </div>

                            {/* =================================================
                                ADD MEMBER
                            ================================================= */}

                            <button
                                className="primary-btn"
                                onClick={
                                    openAddMemberModal
                                }
                            >
                                <span>+</span>
                                إضافة عضو
                            </button>

                        </div>

                    </div>

                    {/* =====================================================
                        MEMBERS LIST
                    ===================================================== */}

                    {members.length === 0 ? (
                        <div className="empty-members">

                            <div className="empty-icon">
                                ♙
                            </div>

                            <h3>
                                لا يوجد أعضاء بعد
                            </h3>

                            <p>
                                استخدم زر «إضافة عضو» بالأعلى
                                لإضافة أول عضو إلى هذا القسم.
                            </p>

                        </div>
                    ) : (
                        <div className="members-list">

                            {members.map(
                                (member) => {

                                    const account =
                                        member.account ||
                                        {};

                                    const name =
                                        account.displayName ||
                                        account.username ||
                                        "مستخدم";

                                    const initials =
                                        name
                                            .split(" ")
                                            .filter(
                                                Boolean
                                            )
                                            .slice(0, 2)
                                            .map(
                                                (
                                                    item
                                                ) =>
                                                    item.charAt(
                                                        0
                                                    )
                                            )
                                            .join("");

                                    return (
                                        <article
                                            className={`member-card ${
                                                member.isHead
                                                    ? "member-is-head"
                                                    : ""
                                            }`}
                                            key={
                                                member.id
                                            }
                                        >

                                            <div className="member-avatar">
                                                {initials ||
                                                    "؟"}
                                            </div>

                                            <div className="member-info">

                                                <div className="member-name-row">

                                                    <h3>
                                                        {name}
                                                    </h3>

                                                    {member.isHead && (
                                                        <span className="head-badge">
                                                            رئيس القسم
                                                        </span>
                                                    )}

                                                </div>

                                                <p>
                                                    @{account.username ||
                                                        "بدون اسم مستخدم"}
                                                </p>

                                                <div className="member-meta">

                                                    <span>
                                                        {
                                                            member.positionTitle ||
                                                            "عضو"
                                                        }
                                                    </span>

                                                    <span>
                                                        ID:{" "}
                                                        {
                                                            account.telegramUserId ||
                                                            "—"
                                                        }
                                                    </span>

                                                </div>

                                            </div>

                                            <div className="member-actions">

                                                <button
                                                    className="member-action"
                                                    onClick={() =>
                                                        updatePosition(
                                                            member
                                                        )
                                                    }
                                                    disabled={
                                                        saving
                                                    }
                                                >
                                                    تعديل المسمى
                                                </button>

                                                <button
                                                    className={`member-action ${
                                                        member.isHead
                                                            ? "head-action"
                                                            : ""
                                                    }`}
                                                    onClick={() =>
                                                        toggleHead(
                                                            member
                                                        )
                                                    }
                                                    disabled={
                                                        saving
                                                    }
                                                >
                                                    {member.isHead
                                                        ? "إلغاء الرئاسة"
                                                        : "تعيين كرئيس"}
                                                </button>

                                                <button
                                                    className="member-action danger"
                                                    onClick={() =>
                                                        removeMember(
                                                            member
                                                        )
                                                    }
                                                    disabled={
                                                        saving
                                                    }
                                                >
                                                    إزالة
                                                </button>

                                            </div>

                                        </article>
                                    );
                                }
                            )}

                        </div>
                    )}

                </section>

            </div>

            {/* =========================================================
                ADD MEMBER MODAL
            ========================================================= */}

            {showAddMember && (
                <div
                    className="modal-overlay"
                    onMouseDown={(event) => {
                        if (
                            event.target ===
                            event.currentTarget
                        ) {
                            closeAddMemberModal();
                        }
                    }}
                >

                    <div className="member-modal">

                        <div className="modal-header">

                            <div>

                                <span className="section-label">
                                    إدارة الأعضاء
                                </span>

                                <h2>
                                    إضافة عضو إلى القسم
                                </h2>

                                <p>
                                    ابحث عن العضو ثم اختره
                                    لإضافته إلى القسم.
                                </p>

                            </div>

                            <button
                                className="close-btn"
                                onClick={
                                    closeAddMemberModal
                                }
                                disabled={
                                    saving
                                }
                            >
                                ×
                            </button>

                        </div>

                        <div className="modal-body">

                            <div className="member-search-box">

                                <div className="search-input-wrap">

                                    <span className="search-icon">
                                        ⌕
                                    </span>

                                    <input
                                        autoFocus
                                        value={
                                            search
                                        }
                                        onChange={(
                                            event
                                        ) =>
                                            setSearch(
                                                event
                                                    .target
                                                    .value
                                            )
                                        }
                                        placeholder="ابحث بالاسم أو اسم المستخدم أو Telegram ID..."
                                    />

                                    {search && (
                                        <button
                                            type="button"
                                            className="clear-search"
                                            onClick={() =>
                                                setSearch(
                                                    ""
                                                )
                                            }
                                        >
                                            ×
                                        </button>
                                    )}

                                </div>

                                <div className="search-results">

                                    <div className="search-results-header">

                                        <span>
                                            المستخدمون المتاحون
                                        </span>

                                        <strong>
                                            {
                                                filteredAccounts.length
                                            }
                                        </strong>

                                    </div>

                                    {filteredAccounts.length >
                                    0 ? (
                                        <div className="accounts-results">

                                            {filteredAccounts.map(
                                                (
                                                    account
                                                ) => {

                                                    const isSelected =
                                                        String(
                                                            selectedAccountId
                                                        ) ===
                                                        String(
                                                            account.id
                                                        );

                                                    const name =
                                                        account.displayName ||
                                                        account.username ||
                                                        account.telegramUserId ||
                                                        "مستخدم";

                                                    const initials =
                                                        name
                                                            .split(
                                                                " "
                                                            )
                                                            .filter(
                                                                Boolean
                                                            )
                                                            .slice(
                                                                0,
                                                                2
                                                            )
                                                            .map(
                                                                (
                                                                    item
                                                                ) =>
                                                                    item.charAt(
                                                                        0
                                                                    )
                                                            )
                                                            .join("");

                                                    return (
                                                        <button
                                                            type="button"
                                                            key={
                                                                account.id
                                                            }
                                                            className={`account-result ${
                                                                isSelected
                                                                    ? "account-result-selected"
                                                                    : ""
                                                            }`}
                                                            onClick={() =>
                                                                selectAccount(
                                                                    account.id
                                                                )
                                                            }
                                                        >

                                                            <span className="account-result-avatar">
                                                                {initials ||
                                                                    "؟"}
                                                            </span>

                                                            <span className="account-result-info">

                                                                <strong>
                                                                    {
                                                                        name
                                                                    }
                                                                </strong>

                                                                <span>
                                                                    {account.username
                                                                        ? `@${account.username}`
                                                                        : "بدون اسم مستخدم"}
                                                                </span>

                                                                <small>
                                                                    Telegram ID:{" "}
                                                                    {
                                                                        account.telegramUserId
                                                                    }
                                                                </small>

                                                            </span>

                                                            <span className="account-result-check">
                                                                {isSelected
                                                                    ? "✓"
                                                                    : ""}
                                                            </span>

                                                        </button>
                                                    );
                                                }
                                            )}

                                        </div>
                                    ) : (
                                        <div className="no-accounts">

                                            <div className="no-results-icon">
                                                ⌕
                                            </div>

                                            <strong>
                                                لا توجد نتائج
                                            </strong>

                                            <span>
                                                {search
                                                    ? "جرّب البحث باسم مختلف أو باسم المستخدم."
                                                    : "لا يوجد مستخدمون متاحون للإضافة إلى هذا القسم."}
                                            </span>

                                        </div>
                                    )}

                                </div>

                            </div>

                            <div className="selected-account-box">

                                <span>
                                    العضو المحدد
                                </span>

                                {selectedAccountId ? (
                                    (() => {

                                        const selected =
                                            accounts.find(
                                                (
                                                    account
                                                ) =>
                                                    String(
                                                        account.id
                                                    ) ===
                                                    String(
                                                        selectedAccountId
                                                    )
                                            );

                                        if (!selected)
                                            return null;

                                        return (
                                            <div className="selected-account">

                                                <div className="selected-account-avatar">
                                                    {(
                                                        selected.displayName ||
                                                        selected.username ||
                                                        "؟"
                                                    )
                                                        .charAt(
                                                            0
                                                        )
                                                        .toUpperCase()}
                                                </div>

                                                <div>

                                                    <strong>
                                                        {
                                                            selected.displayName ||
                                                            selected.username
                                                        }
                                                    </strong>

                                                    <span>
                                                        {selected.username
                                                            ? `@${selected.username}`
                                                            : selected.telegramUserId}
                                                    </span>

                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setSelectedAccountId(
                                                            ""
                                                        )
                                                    }
                                                >
                                                    تغيير
                                                </button>

                                            </div>
                                        );
                                    })()
                                ) : (
                                    <div className="selected-account-empty">
                                        لم يتم اختيار عضو بعد
                                    </div>
                                )}

                            </div>

                            <label className="position-field">

                                المسمى داخل القسم

                                <input
                                    value={
                                        positionTitle
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        setPositionTitle(
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                    placeholder="مثال: مطور، مصمم، مشرف..."
                                />

                            </label>

                        </div>

                        <div className="modal-footer">

                            <button
                                className="secondary-btn"
                                onClick={
                                    closeAddMemberModal
                                }
                                disabled={
                                    saving
                                }
                            >
                                إلغاء
                            </button>

                            <button
                                className="primary-btn"
                                onClick={
                                    addMember
                                }
                                disabled={
                                    saving ||
                                    !selectedAccountId
                                }
                            >
                                {saving
                                    ? "جاري الحفظ..."
                                    : "إضافة العضو"}
                            </button>

                        </div>

                    </div>

                </div>
            )}

            {/* =========================================================
                TELEGRAM LINK MODAL
            ========================================================= */}

            {showTelegramLink && (
                <div
                    className="modal-overlay telegram-link-overlay"
                    onMouseDown={(event) => {
                        if (
                            event.target ===
                            event.currentTarget
                        ) {
                            closeTelegramLink();
                        }
                    }}
                >

                    <div className="telegram-link-modal">

                        <div className="telegram-link-modal-icon">
                            ✈
                        </div>

                        <span className="section-label">
                            ربط Telegram
                        </span>

                        <h2>
                            ربط قروب القسم
                        </h2>

                        <p>
                            أدخل رقم تعريف القروب
                            <strong>
                                {" "}
                                Chat ID
                            </strong>
                            {" "}
                            لربطه بهذا القسم.
                        </p>

                        <div className="telegram-link-info">

                            <strong>
                                كيف أحصل على Chat ID؟
                            </strong>

                            <span>
                                يمكنك الحصول عليه من بيانات
                                قروب Telegram أو من خلال
                                البوت الذي يدير القروب.
                            </span>

                        </div>

                        <label className="telegram-chat-field">

                            <span>
                                Telegram Chat ID
                            </span>

                            <input
                                value={
                                    telegramChatId
                                }
                                onChange={(
                                    event
                                ) =>
                                    setTelegramChatId(
                                        event
                                            .target
                                            .value
                                    )
                                }
                                placeholder="-1001234567890"
                                inputMode="numeric"
                                dir="ltr"
                            />

                            <small>
                                غالبًا يبدأ Chat ID الخاص
                                بالقروبات بـ -100
                            </small>

                        </label>

                        <div className="telegram-link-actions">

                            <button
                                className="secondary-btn"
                                onClick={
                                    closeTelegramLink
                                }
                                disabled={
                                    saving
                                }
                            >
                                إلغاء
                            </button>

                            <button
                                className="primary-btn"
                                onClick={
                                    saveTelegramLink
                                }
                                disabled={
                                    saving ||
                                    !telegramChatId.trim()
                                }
                            >
                                {saving
                                    ? "جاري الربط..."
                                    : "حفظ وربط القروب"}
                            </button>

                        </div>

                    </div>

                </div>
            )}

        </main>
    );
}
