"use client";

import { statusColor } from "@/components/charts/VerificationChartKit";
import type { PipelineTrace } from "./types";

export function ScenarioPicker({
  traces,
  selectedId,
  onSelect,
}: {
  traces: PipelineTrace[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {traces.map((t) => (
        <button
          key={t.scenario_id}
          onClick={() => onSelect(t.scenario_id)}
          className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
            selectedId === t.scenario_id
              ? "bg-(--bg-secondary) border-(--text-primary)/40"
              : "bg-(--bg-card) border-(--border-color)/20 hover:border-(--border-color)/50"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: statusColor(t.decision.final) }}
            />
            <span className="text-(--text-primary) font-medium">
              {t.decision.final}
            </span>
          </div>
          <p className="text-(--text-muted) max-w-[160px]">{t.title}</p>
        </button>
      ))}
    </div>
  );
}
