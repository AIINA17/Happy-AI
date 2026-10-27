"use client";

import { ArchFlowArrow, ArchFlowBox } from "./ArchFlowBox";

// Conceptual block diagram — the real pipeline calls a HuggingFace
// audio-classification pipeline (core/asvspoof.py) as a single black-box
// call, not instrumented layer-by-layer. Numbers annotated here are real,
// measured values from this run.
export function AntiSpoofArchitectureDiagram({
  fakeProb,
  realProb,
}: {
  fakeProb: number;
  realProb: number | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        <ArchFlowBox title="Raw audio" />
        <ArchFlowArrow />
        <ArchFlowBox title="Resample" detail="ke sample rate model" />
        <ArchFlowArrow />
        <ArchFlowBox title="wav2vec2" detail="pretrained, HF pipeline" />
        <ArchFlowArrow />
        <ArchFlowBox title="fake / real prob" />
      </div>
      <p className="text-[11px] text-(--text-muted) mt-1">
        fake_prob = {fakeProb.toFixed(5)}
        {realProb != null ? ` · real_prob = ${realProb.toFixed(5)}` : ""} —
        model pretrained dipanggil sebagai satu kesatuan (black-box), bukan
        diinstrumentasi per-layer.
      </p>
    </div>
  );
}
