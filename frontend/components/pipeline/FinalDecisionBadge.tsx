"use client";

import { statusColor } from "@/components/charts/VerificationChartKit";
import type { PipelineTrace } from "./types";

export function FinalDecisionBadge({
  decision,
}: {
  decision: PipelineTrace["decision"];
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-(--bg-secondary) border border-(--border-color)/20">
      <span
        className="inline-block w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: statusColor(decision.final) }}
      />
      <div>
        <p className="text-lg font-semibold text-(--text-primary)">
          {decision.final}
        </p>
        <p className="text-sm text-(--text-muted)">{decision.reason}</p>
      </div>
    </div>
  );
}
