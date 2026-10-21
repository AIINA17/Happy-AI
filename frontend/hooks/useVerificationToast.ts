"use client";

// Surfaces voice verification results as styled notifications.

import { useEffect } from "react";

import { useNotification } from "@/contexts/NotificationContext";
import { NotificationVariant } from "@/components/NotificationCard";

type VerificationStatus = "VERIFIED" | "REPEAT" | "DENIED" | null;

interface VerificationResult {
    status: VerificationStatus;
    score: number | null;
    reason: string | null;
}

interface Config {
    variant: NotificationVariant;
    title: string;
    defaultDescription: string;
}

const CONFIG: Record<Exclude<VerificationStatus, null>, Config> = {
    VERIFIED: {
        variant: "success",
        title: "Voice Verified",
        defaultDescription: "Welcome back",
    },
    REPEAT: {
        variant: "warning",
        title: "Try Again",
        defaultDescription: "Voice unclear, please repeat",
    },
    DENIED: {
        variant: "error",
        title: "Verification Failed",
        defaultDescription: "Voice not recognized",
    },
};

/** Surfaces voice verification results as toasts, then clears the result. */
export function useVerificationToast(
    result: VerificationResult,
    onShown: () => void,
) {
    const { notify } = useNotification();

    useEffect(() => {
        if (!result.status) return;

        const cfg = CONFIG[result.status];
        const scorePercent =
            result.score !== null && result.score !== undefined
                ? Math.max(0, Math.min(100, result.score * 100))
                : null;

        notify({
            variant: cfg.variant,
            title: cfg.title,
            description: result.reason || cfg.defaultDescription,
            scorePercent,
            duration: 4000,
        });
        onShown();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result.status]);
}
