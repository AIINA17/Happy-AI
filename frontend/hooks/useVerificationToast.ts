"use client";

import { useEffect } from "react";
import { toast } from "sonner";

type VerificationStatus = "VERIFIED" | "REPEAT" | "DENIED" | null;

interface VerificationResult {
    status: VerificationStatus;
    score: number | null;
    reason: string | null;
}

const DEFAULT_REASONS: Record<Exclude<VerificationStatus, null>, string> = {
    VERIFIED: "Suara berhasil diverifikasi",
    REPEAT: "Suara kurang jelas, silakan ulangi",
    DENIED: "Suara tidak dikenali",
};

const TITLES: Record<Exclude<VerificationStatus, null>, string> = {
    VERIFIED: "Voice Verified",
    REPEAT: "Coba Lagi",
    DENIED: "Verifikasi Gagal",
};

/** Surfaces voice verification results as toasts, then clears the result. */
export function useVerificationToast(
    result: VerificationResult,
    onShown: () => void,
) {
    useEffect(() => {
        if (!result.status) return;

        const scoreText =
            result.score !== null && result.score !== undefined
                ? `Similarity: ${(result.score * 100).toFixed(1)}%`
                : undefined;
        const description = [
            result.reason || DEFAULT_REASONS[result.status],
            scoreText,
        ]
            .filter(Boolean)
            .join(" — ");

        const toastFn =
            result.status === "VERIFIED"
                ? toast.success
                : result.status === "REPEAT"
                  ? toast.warning
                  : toast.error;

        toastFn(TITLES[result.status], { description });
        onShown();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result.status]);
}
