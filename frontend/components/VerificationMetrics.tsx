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

export interface VerificationLogEntry {
    id: string;
    label: string | null;
    decision: "VERIFIED" | "REPEAT" | "DENIED" | string;
    reason: string | null;
    speaker_score: number;
    spoof_prob: number;
    behavior_score: number | null;
    created_at: string;
}

export interface DecisionThresholds {
    voice_accept: number;
    voice_repeat: number;
    abs_min_speaker: number;
    replay_deny: number;
    replay_warn: number;
}

export default function VerificationMetrics({
    logs,
    thresholds,
}: {
    logs: VerificationLogEntry[];
    thresholds: DecisionThresholds | null;
}) {
    const scorePoints = useMemo<ChartPoint[]>(
        () =>
            [...logs].reverse().map((l) => ({
                id: l.id,
                created_at: l.created_at,
                value: l.speaker_score,
                status: l.decision,
                sublabel: l.label,
            })),
        [logs],
    );

    const spoofPoints = useMemo<ChartPoint[]>(
        () =>
            [...logs].reverse().map((l) => ({
                id: l.id,
                created_at: l.created_at,
                value: l.spoof_prob,
                status: l.decision,
                sublabel: l.label,
            })),
        [logs],
    );

    const stats = useMemo(() => {
        const total = logs.length;
        const verified = logs.filter((l) => l.decision === "VERIFIED").length;
        const repeat = logs.filter((l) => l.decision === "REPEAT").length;
        const denied = logs.filter((l) => l.decision === "DENIED").length;
        const avgScore =
            total > 0 ? logs.reduce((s, l) => s + l.speaker_score, 0) / total : 0;
        const avgSpoof =
            total > 0 ? logs.reduce((s, l) => s + l.spoof_prob, 0) / total : 0;

        return { total, verified, repeat, denied, avgScore, avgSpoof };
    }, [logs]);

    return (
        <section className="space-y-4">
            <h2 className="text-lg font-medium text-(--text-primary)">
                Metrik Verifikasi Suara
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
                    label="Rata-rata speaker score"
                    value={stats.total > 0 ? stats.avgScore.toFixed(3) : "—"}
                />
                <StatTile
                    label="Rata-rata spoof prob"
                    value={stats.total > 0 ? stats.avgSpoof.toFixed(3) : "—"}
                />
            </div>

            {stats.total > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <DecisionBadge status="VERIFIED" count={stats.verified} total={stats.total} />
                    <DecisionBadge status="REPEAT" count={stats.repeat} total={stats.total} />
                    <DecisionBadge status="DENIED" count={stats.denied} total={stats.total} />
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TimeSeriesChart
                    title="Speaker score dari waktu ke waktu"
                    seriesLabel="speaker_score"
                    color="var(--accent-primary)"
                    points={scorePoints}
                    thresholds={
                        thresholds
                            ? [
                                  { value: thresholds.voice_accept, label: "accept" },
                                  { value: thresholds.voice_repeat, label: "repeat" },
                                  { value: thresholds.abs_min_speaker, label: "min" },
                              ]
                            : []
                    }
                />
                <TimeSeriesChart
                    title="Spoof probability dari waktu ke waktu"
                    seriesLabel="spoof_prob"
                    color="#d95926"
                    points={spoofPoints}
                    thresholds={
                        thresholds
                            ? [
                                  { value: thresholds.replay_warn, label: "warn" },
                                  { value: thresholds.replay_deny, label: "deny" },
                              ]
                            : []
                    }
                />
            </div>

            {stats.total > 0 && (
                <div className="rounded-xl bg-(--bg-card) border border-(--border-color)/20 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-(--text-muted) border-b border-(--border-color)/20">
                                <th className="px-3 py-2 font-medium">Waktu</th>
                                <th className="px-3 py-2 font-medium">Label</th>
                                <th className="px-3 py-2 font-medium">Decision</th>
                                <th className="px-3 py-2 font-medium">Speaker score</th>
                                <th className="px-3 py-2 font-medium">Spoof prob</th>
                                <th className="px-3 py-2 font-medium">Alasan</th>
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
                                    <td className="px-3 py-2 text-(--text-secondary)">
                                        {l.label ?? "—"}
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span
                                                className="inline-block w-2 h-2 rounded-full"
                                                style={{ backgroundColor: statusColor(l.decision) }}
                                            />
                                            {l.decision}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-(--text-secondary) tabular-nums">
                                        {l.speaker_score.toFixed(3)}
                                    </td>
                                    <td className="px-3 py-2 text-(--text-secondary) tabular-nums">
                                        {l.spoof_prob.toFixed(3)}
                                    </td>
                                    <td className="px-3 py-2 text-(--text-muted)">
                                        {l.reason ?? "—"}
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
