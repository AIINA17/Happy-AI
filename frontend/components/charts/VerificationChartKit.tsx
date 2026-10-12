"use client";

import { useId, useState } from "react";

export interface ChartPoint {
    id: string;
    created_at: string;
    value: number;
    status: string;
    sublabel?: string | null;
}

export const STATUS_COLOR: Record<string, string> = {
    VERIFIED: "#0ca30c",
    REPEAT: "#fab219",
    DENIED: "#d03b3b",
};

export function statusColor(status: string) {
    return STATUS_COLOR[status] ?? "#898781";
}

export function formatTime(iso: string) {
    return new Date(iso).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const CHART_WIDTH = 760;
const CHART_HEIGHT = 220;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

export function TimeSeriesChart({
    title,
    seriesLabel,
    color,
    points,
    thresholds,
}: {
    title: string;
    seriesLabel: string;
    color: string;
    points: ChartPoint[];
    thresholds: { value: number; label: string }[];
}) {
    const gradientId = useId();
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);

    const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

    const xAt = (i: number) =>
        points.length <= 1
            ? PAD_LEFT + plotW / 2
            : PAD_LEFT + (i / (points.length - 1)) * plotW;
    const yAt = (v: number) => PAD_TOP + (1 - Math.min(Math.max(v, 0), 1)) * plotH;

    const linePath = points
        .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.value)}`)
        .join(" ");

    const ticks = [0, 0.25, 0.5, 0.75, 1];

    if (points.length === 0) {
        return (
            <div className="p-4 rounded-xl bg-(--bg-card) border border-(--border-color)/20">
                <h3 className="text-sm font-medium text-(--text-primary) mb-1">
                    {title}
                </h3>
                <p className="text-xs text-(--text-muted)">
                    Belum ada data percobaan verifikasi.
                </p>
            </div>
        );
    }

    const hovered = hoverIdx !== null ? points[hoverIdx] : null;

    return (
        <div className="p-4 rounded-xl bg-(--bg-card) border border-(--border-color)/20 relative">
            <h3 className="text-sm font-medium text-(--text-primary) mb-2">
                {title}
            </h3>

            <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="w-full h-auto"
                role="img"
                aria-label={`${title}: grafik ${seriesLabel} dari ${points.length} percobaan verifikasi terakhir`}
            >
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.12} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                </defs>

                {/* gridlines */}
                {ticks.map((t) => (
                    <g key={t}>
                        <line
                            x1={PAD_LEFT}
                            x2={CHART_WIDTH - PAD_RIGHT}
                            y1={yAt(t)}
                            y2={yAt(t)}
                            stroke="var(--border-color)"
                            strokeOpacity={0.25}
                            strokeWidth={1}
                        />
                        <text
                            x={PAD_LEFT - 8}
                            y={yAt(t)}
                            textAnchor="end"
                            dominantBaseline="middle"
                            fontSize={10}
                            fill="var(--text-muted)"
                        >
                            {t.toFixed(2)}
                        </text>
                    </g>
                ))}

                {/* threshold reference lines */}
                {thresholds.map((th) => (
                    <g key={th.label}>
                        <line
                            x1={PAD_LEFT}
                            x2={CHART_WIDTH - PAD_RIGHT}
                            y1={yAt(th.value)}
                            y2={yAt(th.value)}
                            stroke="var(--text-muted)"
                            strokeWidth={1}
                            strokeDasharray="4 3"
                        />
                        <text
                            x={CHART_WIDTH - PAD_RIGHT}
                            y={yAt(th.value) - 3}
                            textAnchor="end"
                            fontSize={9}
                            fill="var(--text-muted)"
                        >
                            {th.label} {th.value.toFixed(2)}
                        </text>
                    </g>
                ))}

                {/* area wash + line */}
                <path
                    d={`${linePath} L${xAt(points.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`}
                    fill={`url(#${gradientId})`}
                    stroke="none"
                />
                <path
                    d={linePath}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />

                {/* dots */}
                {points.map((p, i) => (
                    <circle
                        key={p.id}
                        cx={xAt(i)}
                        cy={yAt(p.value)}
                        r={i === hoverIdx ? 5 : 3}
                        fill={color}
                        stroke="var(--bg-card)"
                        strokeWidth={2}
                    />
                ))}

                {/* hover hit targets */}
                {points.map((p, i) => (
                    <rect
                        key={`hit-${p.id}`}
                        x={xAt(i) - plotW / Math.max(points.length, 1) / 2}
                        y={PAD_TOP}
                        width={plotW / Math.max(points.length, 1)}
                        height={plotH}
                        fill="transparent"
                        onMouseEnter={() => setHoverIdx(i)}
                        onMouseLeave={() => setHoverIdx(null)}
                    />
                ))}

                {hovered && (
                    <line
                        x1={xAt(hoverIdx!)}
                        x2={xAt(hoverIdx!)}
                        y1={PAD_TOP}
                        y2={CHART_HEIGHT - PAD_BOTTOM}
                        stroke="var(--text-muted)"
                        strokeWidth={1}
                        strokeOpacity={0.5}
                    />
                )}

                {/* x-axis endpoints */}
                <text
                    x={PAD_LEFT}
                    y={CHART_HEIGHT - 8}
                    fontSize={10}
                    fill="var(--text-muted)"
                >
                    {formatTime(points[0].created_at)}
                </text>
                <text
                    x={CHART_WIDTH - PAD_RIGHT}
                    y={CHART_HEIGHT - 8}
                    textAnchor="end"
                    fontSize={10}
                    fill="var(--text-muted)"
                >
                    {formatTime(points[points.length - 1].created_at)}
                </text>
            </svg>

            {hovered && (
                <div className="absolute top-3 right-3 px-3 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-xs space-y-0.5 pointer-events-none">
                    <div className="text-(--text-primary) font-medium">
                        {seriesLabel}: {hovered.value.toFixed(3)}
                    </div>
                    <div className="text-(--text-muted)">
                        {formatTime(hovered.created_at)}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: statusColor(hovered.status) }}
                        />
                        <span className="text-(--text-secondary)">
                            {hovered.status}
                            {hovered.sublabel ? ` · ${hovered.sublabel}` : ""}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

export function StatTile({
    label,
    value,
    hint,
}: {
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <div className="p-4 rounded-xl bg-(--bg-card) border border-(--border-color)/20">
            <p className="text-xs text-(--text-muted)">{label}</p>
            <p className="text-2xl font-semibold text-(--text-primary) mt-1">
                {value}
            </p>
            {hint && <p className="text-xs text-(--text-muted) mt-1">{hint}</p>}
        </div>
    );
}

export function DecisionBadge({
    status,
    count,
    total,
}: {
    status: string;
    count: number;
    total: number;
}) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color)/20">
            <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: statusColor(status) }}
            />
            <span className="text-sm text-(--text-primary)">{status}</span>
            <span className="text-sm text-(--text-muted) ml-auto">
                {count} ({pct}%)
            </span>
        </div>
    );
}
