"use client";

import { useEffect, useState } from "react";
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

export default function DepartmentsPage() {
    const router = useRouter();

    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");
    const [messageType, setMessageType] = useState("");

    const [showAddModal, setShowAddModal] = useState(false);
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        name: "",
        description: "",
        telegramChatId: "",
    });

    useEffect(() => {
        loadDepartments();
    }, []);

    async function loadDepartments() {
        try {
            setLoading(true);
            setMessage("");

            const response = await fetch(
                "/api/admin/departments",
                {
                    method: "GET",
                    headers: {
                        "x-telegram-init-data": getInitData(),
                    },
                }
            );

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.message || "تعذر تحميل الأقسام."
                );
            }

            setDepartments(data.departments || []);
        } catch (error) {
            console.error(error);
            setMessage(
                error.message || "حدث خطأ أثناء تحميل الأقسام."
            );
            setMessageType("error");
        } finally {
            setLoading(false);
        }
    }

    function updateForm(field, value) {
        setForm((current) => ({
            ...current,
            [field]: value,
        }));
    }

    async function createDepartment(event) {
        event.preventDefault();

        if (!form.name.trim()) {
            setMessage("اكتب اسم القسم أولًا.");
            setMessageType("error");
            return;
        }

        try {
            setSaving(true);
            setMessage("");

            const response = await fetch(
                "/api/admin/departments",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        initData: getInitData(),
                        name: form.name.trim(),
                        description: form.description.trim(),
                        telegramChatId:
                            form.telegramChatId.trim(),
                    }),
                }
            );

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.message || "تعذر إنشاء القسم."
                );
            }

            setDepartments((current) => [
                ...current,
                {
                    ...data.department,
                    memberCount: 0,
                    members: [],
                    head: null,
                },
            ]);

            setForm({
                name: "",
                description: "",
                telegramChatId: "",
            });

            setShowAddModal(false);

            setMessage("تم إنشاء القسم بنجاح.");
            setMessageType("success");
        } catch (error) {
            console.error(error);
            setMessage(
                error.message || "حدث خطأ أثناء إنشاء القسم."
            );
            setMessageType("error");
        } finally {
            setSaving(false);
        }
    }

    function openDepartment(department) {
        router.push(
            `/departments/${department.id}`
        );
    }

    return (
        <main className="departments-page">
            <div className="departments-container">

                {/* HEADER */}
                <header className="departments-header">

                    <div className="departments-header-text">
                        <button
                            type="button"
                            className="back-button"
                            onClick={() => router.back()}
                        >
                            ←
                        </button>

                        <div>
                            <div className="page-kicker">
                                الإدارة
                            </div>

                            <h1>
                                إدارة الأقسام
                            </h1>

                            <p>
                                إدارة أقسام الفريق وأعضائها
                                وربطها بمجموعات Telegram.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="add-department-button"
                        onClick={() => {
                            setMessage("");
                            setShowAddModal(true);
                        }}
                    >
                        <span>+</span>
                        إضافة قسم
                    </button>

                </header>

                {/* MESSAGE */}
                {message && (
                    <div
                        className={`departments-message ${messageType}`}
                    >
                        {message}
                    </div>
                )}

                {/* STATS */}
                <section className="departments-stats">

                    <div className="department-stat-card">
                        <span>
                            إجمالي الأقسام
                        </span>

                        <strong>
                            {departments.length}
                        </strong>
                    </div>

                    <div className="department-stat-card">
                        <span>
                            إجمالي الأعضاء
                        </span>

                        <strong>
                            {departments.reduce(
                                (total, department) =>
                                    total +
                                    Number(
                                        department.memberCount || 0
                                    ),
                                0
                            )}
                        </strong>
                    </div>

                    <div className="department-stat-card">
                        <span>
                            الأقسام المرتبطة بـ Telegram
                        </span>

                        <strong>
                            {
                                departments.filter(
                                    (department) =>
                                        department.telegramChatId
                                ).length
                            }
                        </strong>
                    </div>

                </section>

                {/* DEPARTMENTS */}
                <section className="departments-section">

                    <div className="section-heading">
                        <div>
                            <h2>
                                جميع الأقسام
                            </h2>

                            <p>
                                اختر قسمًا لعرض تفاصيله وإدارته.
                            </p>
                        </div>
                    </div>

                    {loading ? (
                        <div className="departments-loading">
                            <div className="loading-spinner" />
                            <span>
                                جاري تحميل الأقسام...
                            </span>
                        </div>
                    ) : departments.length === 0 ? (
                        <div className="departments-empty">

                            <div className="empty-icon">
                                🏢
                            </div>

                            <h3>
                                لا توجد أقسام
                            </h3>

                            <p>
                                ابدأ بإضافة أول قسم للفريق.
                            </p>

                            <button
                                type="button"
                                onClick={() =>
                                    setShowAddModal(true)
                                }
                            >
                                + إضافة قسم
                            </button>

                        </div>
                    ) : (
                        <div className="departments-grid">

                            {departments.map((department) => (
                                <article
                                    key={department.id}
                                    className="department-card"
                                    onClick={() =>
                                        openDepartment(
                                            department
                                        )
                                    }
                                >

                                    <div className="department-card-top">

                                        <div className="department-icon">
                                            🏢
                                        </div>

                                        <div className="department-card-arrow">
                                            ←
                                        </div>

                                    </div>

                                    <div className="department-card-content">

                                        <h3>
                                            {department.name}
                                        </h3>

                                        <p>
                                            {department.description ||
                                                "لا يوجد وصف للقسم."}
                                        </p>

                                    </div>

                                    <div className="department-card-info">

                                        <div>
                                            <span>
                                                الأعضاء
                                            </span>

                                            <strong>
                                                {department.memberCount ||
                                                    0}
                                            </strong>
                                        </div>

                                        <div>
                                            <span>
                                                رئيس القسم
                                            </span>

                                            <strong>
                                                {department.head
                                                    ?.displayName ||
                                                    "غير محدد"}
                                            </strong>
                                        </div>

                                    </div>

                                    <div className="department-card-footer">

                                        <span
                                            className={
                                                department.telegramChatId
                                                    ? "telegram-status connected"
                                                    : "telegram-status"
                                            }
                                        >
                                            {department.telegramChatId
                                                ? "مرتبط بـ Telegram"
                                                : "غير مرتبط بـ Telegram"}
                                        </span>

                                        <span className="view-department">
                                            عرض القسم
                                        </span>

                                    </div>

                                </article>
                            ))}

                        </div>
                    )}

                </section>

            </div>

            {/* ADD MODAL */}
            {showAddModal && (
                <div
                    className="department-modal-overlay"
                    onMouseDown={(event) => {
                        if (
                            event.target ===
                            event.currentTarget
                        ) {
                            setShowAddModal(false);
                        }
                    }}
                >

                    <div className="department-modal">

                        <div className="department-modal-header">

                            <div>
                                <span>
                                    قسم جديد
                                </span>

                                <h2>
                                    إضافة قسم
                                </h2>
                            </div>

                            <button
                                type="button"
                                onClick={() =>
                                    setShowAddModal(false)
                                }
                            >
                                ×
                            </button>

                        </div>

                        <form
                            onSubmit={createDepartment}
                            className="department-form"
                        >

                            <label>
                                اسم القسم
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(event) =>
                                        updateForm(
                                            "name",
                                            event.target.value
                                        )
                                    }
                                    placeholder="مثال: البرمجة"
                                    maxLength={100}
                                    required
                                />
                            </label>

                            <label>
                                وصف القسم
                                <textarea
                                    value={form.description}
                                    onChange={(event) =>
                                        updateForm(
                                            "description",
                                            event.target.value
                                        )
                                    }
                                    placeholder="اكتب وصفًا مختصرًا للقسم..."
                                    rows={4}
                                />
                            </label>

                            <label>
                                Telegram Group ID
                                <input
                                    type="text"
                                    value={
                                        form.telegramChatId
                                    }
                                    onChange={(event) =>
                                        updateForm(
                                            "telegramChatId",
                                            event.target.value
                                        )
                                    }
                                    placeholder="-1001234567890"
                                />

                                <small>
                                    اختياري. يمكنك ربط مجموعة
                                    Telegram بالقسم لاحقًا.
                                </small>
                            </label>

                            <div className="department-modal-actions">

                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() =>
                                        setShowAddModal(false)
                                    }
                                    disabled={saving}
                                >
                                    إلغاء
                                </button>

                                <button
                                    type="submit"
                                    className="primary-button"
                                    disabled={saving}
                                >
                                    {saving
                                        ? "جاري الحفظ..."
                                        : "إنشاء القسم"}
                                </button>

                            </div>

                        </form>

                    </div>

                </div>
            )}

        </main>
    );
}
