"use client";

// Custom notification system (replaces sonner).
// Provides a NotificationProvider that manages a queue of notifications,
// and a useNotification() hook to trigger them from anywhere.

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";

import NotificationCard, { NotificationVariant } from "@/components/NotificationCard";

export interface NotificationOptions {
    variant?: NotificationVariant;
    title: string;
    description?: string;
    duration?: number; // ms, default 4000
    scorePercent?: number | null; // optional score bar (0-100) for VERIFIED
}

interface Notification extends NotificationOptions {
    id: string;
    createdAt: number;
}

interface NotificationContextValue {
    notify: (options: NotificationOptions) => void;
    dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotification(): NotificationContextValue {
    const ctx = useContext(NotificationContext);
    if (!ctx) {
        throw new Error(
            "useNotification must be used within NotificationProvider",
        );
    }
    return ctx;
}

export function NotificationProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const dismiss = useCallback((id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, []);

    const notify = useCallback((options: NotificationOptions) => {
        const id =
            typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        setNotifications((prev) => [
            ...prev,
            {
                ...options,
                id,
                createdAt: Date.now(),
                duration: options.duration ?? 4000,
                variant: options.variant ?? "info",
            },
        ]);
    }, []);

    return (
        <NotificationContext.Provider value={{ notify, dismiss }}>
            {children}
            <NotificationContainer
                notifications={notifications}
                onDismiss={dismiss}
            />
        </NotificationContext.Provider>
    );
}

/* ================= CONTAINER ================= */

function NotificationContainer({
    notifications,
    onDismiss,
}: {
    notifications: Notification[];
    onDismiss: (id: string) => void;
}) {
    if (notifications.length === 0) return null;

    return (
        <div
            className="pointer-events-none fixed top-4 right-4 z-[100]
                       flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)]"
            aria-live="polite"
            aria-atomic="true">
            {notifications.map((n) => (
                <NotificationItem
                    key={n.id}
                    notification={n}
                    onDismiss={onDismiss}
                />
            ))}
        </div>
    );
}

/* ================= ITEM (handles its own fade-in / auto dismiss) ================= */

function NotificationItem({
    notification,
    onDismiss,
}: {
    notification: Notification;
    onDismiss: (id: string) => void;
}) {
    const [isVisible, setIsVisible] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);

    // Fade in on mount
    useEffect(() => {
        const t = setTimeout(() => setIsVisible(true), 10);
        return () => clearTimeout(t);
    }, []);

    // Auto dismiss after `duration`
    useEffect(() => {
        if (!notification.duration) return;
        const t = setTimeout(() => {
            setIsLeaving(true);
            // Wait for exit animation before actually removing
            setTimeout(() => onDismiss(notification.id), 250);
        }, notification.duration);
        return () => clearTimeout(t);
    }, [notification.duration, notification.id, onDismiss]);

    const handleManualDismiss = () => {
        setIsLeaving(true);
        setTimeout(() => onDismiss(notification.id), 250);
    };

    return (
        <div
            className={`pointer-events-auto transition-all duration-300 ease-out
                       ${
                           isLeaving
                               ? "opacity-0 translate-x-4 scale-95"
                               : isVisible
                                 ? "opacity-100 translate-x-0 scale-100"
                                 : "opacity-0 -translate-y-2 scale-95"
                       }`}>
            <NotificationCard
                variant={notification.variant || "info"}
                title={notification.title}
                description={notification.description}
                scorePercent={notification.scorePercent}
                onDismiss={handleManualDismiss}
            />
        </div>
    );
}
