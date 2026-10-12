"use client";

import { useMemo } from "react";

import {
    DecisionBadge,
    StatTile,
    TimeSeriesChart,
    formatTime,
    statusColor,
    type ChartPoint,
} from "@/components/charts/VerificationChartKit";

export interface FaceVerificationLogEntry {
    id: string;
    image_filename: string | null;
    verified: boolean;
    status: "VERIFIED" | "DENIED" | string;
    similarity: number | null;
    threshold: number | null;
    error_message: string | null;
    created_at: string;
}

export default function FaceVerificationMetrics({
    logs,
    threshold,
}: {
    logs: FaceVerificationLogEntry[];
    threshold: number | null;
}) {
    const similarityPoints = useMemo<ChartPoint[]>(
        () =>
            [...logs]
                .reverse()
                .filter((l) => l.similarity !== null)
                .map((l) => ({
                    id: l.id,
                    created_at: l.created_at,
                    value: l.similarity as number,
                    status: l.status,
                })),
        [logs],
    );

    const stats = useMemo(() => {
        const total = logs.length;
        const verified = logs.filter((l) => l.status === "VERIFIED").length;
        const denied = logs.filter((l) => l.status === "DENIED").length;
        const withSimilarity = logs.filter((l) => l.similarity !== null);
        const avgSimilarity =
            withSimilarity.length > 0
                ? withSimilarity.reduce((s, l) => s + (l.similarity as number), 0) /
                  withSimilarity.length
                : 0;

        return { total, verified, denied, avgSimilarity };
    }, [logs]);

    return (
        <section className="space-y-4">
            <h2 className="text-lg font-medium text-(--text-primary)">
                Metrik Verifikasi Wajah
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="Total percobaan" value={String(stats.total)} />
                <StatTile
                    label="Verified rate"
                    value={
                        stats.total > 0
                            ? `${Math.round((stats.verified / stats.total) * 100)}%`
                            : "—"
                    }
                />
                <StatTile
                    label="Rata-rata similarity"
                    value={stats.total > 0 ? stats.avgSimilarity.toFixed(3) : "—"}
                />
                <StatTile
                    label="Threshold saat ini"
                    value={threshold !== null ? threshold.toFixed(2) : "—"}
                />
            </div>

            {stats.total > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <DecisionBadge status="VERIFIED" count={stats.verified} total={stats.total} />
                    <DecisionBadge status="DENIED" count={stats.denied} total={stats.total} />
                </div>
            )}

            <TimeSeriesChart
                title="Similarity dari waktu ke waktu"
                seriesLabel="similarity"
                color="var(--accent-primary)"
                points={similarityPoints}
                thresholds={
                    threshold !== null ? [{ value: threshold, label: "threshold" }] : []
                }
            />

            {stats.total > 0 && (
                <div className="rounded-xl bg-(--bg-card) border border-(--border-color)/20 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-(--text-muted) border-b border-(--border-color)/20">
                                <th className="px-3 py-2 font-medium">Waktu</th>
                                <th className="px-3 py-2 font-medium">Status</th>
                                <th className="px-3 py-2 font-medium">Similarity</th>
                                <th className="px-3 py-2 font-medium">Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.slice(0, 20).map((l) => (
                                <tr
                                    key={l.id}
                                    className="border-b border-(--border-color)/10 last:border-0"
                                >
                                    <td className="px-3 py-2 text-(--text-secondary) whitespace-nowrap">
                                        {formatTime(l.created_at)}
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span
                                                className="inline-block w-2 h-2 rounded-full"
                                                style={{ backgroundColor: statusColor(l.status) }}
                                            />
                                            {l.status}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-(--text-secondary) tabular-nums">
                                        {l.similarity !== null ? l.similarity.toFixed(3) : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-(--text-muted)">
                                        {l.error_message ?? "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
