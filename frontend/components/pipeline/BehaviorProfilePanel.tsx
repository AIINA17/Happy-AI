"use client";

import { ThresholdGauge } from "./ThresholdGauge";
import type { PipelineTrace } from "./types";

export function BehaviorProfilePanel({
  behaviorProfiling,
}: {
  behaviorProfiling: PipelineTrace["behavior_profiling"];
}) {
  if (!behaviorProfiling.available) {
    return (
      <p className="text-sm text-(--text-muted)">
        Dilewati — riwayat perilaku belum cukup (n_samples=
        {behaviorProfiling.n_samples} &lt;{" "}
        {behaviorProfiling.thresholds.behavior_min_samples}). Voiceprint
        match tidak di-downgrade.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-(--text-muted) text-xs">Pitch</p>
          <p className="text-(--text-primary)">
            {behaviorProfiling.pitch_hz?.toFixed(1)} Hz (z=
            {behaviorProfiling.z_pitch?.toFixed(2)})
          </p>
        </div>
        <div>
          <p className="text-(--text-muted) text-xs">Rate proxy</p>
          <p className="text-(--text-primary)">
            {behaviorProfiling.rate_proxy_sec?.toFixed(2)}s (z=
            {behaviorProfiling.z_rate?.toFixed(2)})
          </p>
        </div>
      </div>
      <ThresholdGauge
        value={behaviorProfiling.behavior_score ?? 0}
        min={0}
        max={1}
        thresholds={[
          {
            value: behaviorProfiling.thresholds.behavior_repeat,
            label: "repeat",
            color: "#fab219",
          },
        ]}
        valueLabel={`behavior_score=${behaviorProfiling.behavior_score?.toFixed(3)}`}
      />
    </div>
  );
}
