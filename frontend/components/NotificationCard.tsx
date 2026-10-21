"use client";

// Elegant notification card UI, designed to look "premium".
// Used by NotificationProvider. Not meant to be rendered directly.

import { CheckCircle2, AlertCircle, XCircle, Info, X } from "lucide-react";

export type NotificationVariant =
    | "success"
    | "warning"
    | "error"
    | "info";

interface NotificationCardProps {
    variant: NotificationVariant;
    title: string;
    description?: string;
    scorePercent?: number | null;
    onDismiss?: () => void;
}

const VARIANT_STYLES: Record<
    NotificationVariant,
    {
        Icon: typeof CheckCircle2;
        iconColor: string;
        iconBg: string;
        iconRing: string;
        gradientFrom: string;
        gradientTo: string;
        borderColor: string;
        scoreBarColor: string;
        glowColor: string;
    }
> = {
    success: {
        Icon: CheckCircle2,
        iconColor: "text-emerald-400",
        iconBg: "bg-emerald-500/15",
        iconRing: "ring-1 ring-emerald-500/30",
        gradientFrom: "from-emerald-500/[0.08]",
        gradientTo: "to-transparent",
        borderColor: "border-emerald-500/25",
        scoreBarColor: "bg-emerald-400",
        glowColor: "shadow-emerald-500/10",
    },
    warning: {
        Icon: AlertCircle,
        iconColor: "text-amber-400",
        iconBg: "bg-amber-500/15",
        iconRing: "ring-1 ring-amber-500/30",
        gradientFrom: "from-amber-500/[0.08]",
        gradientTo: "to-transparent",
        borderColor: "border-amber-500/25",
        scoreBarColor: "bg-amber-400",
        glowColor: "shadow-amber-500/10",
    },
    error: {
        Icon: XCircle,
        iconColor: "text-rose-400",
        iconBg: "bg-rose-500/15",
        iconRing: "ring-1 ring-rose-500/30",
        gradientFrom: "from-rose-500/[0.08]",
        gradientTo: "to-transparent",
        borderColor: "border-rose-500/25",
        scoreBarColor: "bg-rose-400",
        glowColor: "shadow-rose-500/10",
    },
    info: {
        Icon: Info,
        iconColor: "text-sky-400",
        iconBg: "bg-sky-500/15",
        iconRing: "ring-1 ring-sky-500/30",
        gradientFrom: "from-sky-500/[0.08]",
        gradientTo: "to-transparent",
        borderColor: "border-sky-500/25",
        scoreBarColor: "bg-sky-400",
        glowColor: "shadow-sky-500/10",
    },
};

export default function NotificationCard({
    variant,
    title,
    description,
    scorePercent,
    onDismiss,
}: NotificationCardProps) {
    const style = VARIANT_STYLES[variant];
    const Icon = style.Icon;

    const showScore =
        typeof scorePercent === "number" &&
        !Number.isNaN(scorePercent) &&
        scorePercent >= 0 &&
        scorePercent <= 100;

    return (
        <div
            className={`
                relative overflow-hidden rounded-2xl
                border ${style.borderColor}
                bg-background/80 backdrop-blur-xl
                shadow-xl ${style.glowColor}
            `}>
            {/* Soft gradient overlay */}
            <div
                className={`absolute inset-0 bg-gradient-to-br ${style.gradientFrom} ${style.gradientTo} pointer-events-none`}
            />

            {/* Content */}
            <div className="relative p-4 flex items-start gap-3">
                {/* Icon */}
                <div
                    className={`
                        flex-shrink-0 flex items-center justify-center
                        w-10 h-10 rounded-xl ${style.iconBg} ${style.iconRing}
                        animate-notif-pulse
                    `}>
                    <Icon className={`w-5 h-5 ${style.iconColor}`} strokeWidth={2.5} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0 pt-0.5">
                    <h4 className="text-sm font-semibold text-foreground leading-tight tracking-tight">
                        {title}
                    </h4>
                    {description && (
                        <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                            {description}
                        </p>
                    )}

                    {/* Optional score bar */}
                    {showScore && (
                        <div className="mt-2.5">
                            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                    className={`h-full ${style.scoreBarColor} rounded-full transition-all duration-700 ease-out`}
                                    style={{ width: `${scorePercent}%` }}
                                />
                            </div>
                            <div className="mt-1 text-[0.65rem] font-medium text-muted-foreground">
                                {scorePercent!.toFixed(1)}% match
                            </div>
                        </div>
                    )}
                </div>

                {/* Dismiss button */}
                {onDismiss && (
                    <button
                        onClick={onDismiss}
                        aria-label="Dismiss"
                        className="flex-shrink-0 p-1 rounded-md text-muted-foreground
                                 hover:text-foreground hover:bg-muted/50
                                 transition-colors cursor-pointer">
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}
