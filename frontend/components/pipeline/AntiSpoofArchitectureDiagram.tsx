"use client";

import { ArchFlowArrow, ArchFlowBox } from "./ArchFlowBox";

// High-level overview of the wav2vec2 anti-spoof flow. The real per-layer
// activations (captured via forward hooks on the pretrained model — see
// core/asvspoof.py) are rendered separately by ModelBlockTrace, below.
// Numbers annotated here are real, measured values from this run.
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
        <ArchFlowBox title="Raw waveform" />
        <ArchFlowArrow />
        <ArchFlowBox title="Conv 1D ×7" detail="fitur langsung dari sample" />
        <ArchFlowArrow />
        <ArchFlowBox title="Transformer ×12" detail="self-attention" />
        <ArchFlowArrow />
        <ArchFlowBox title="Classifier" detail="fake / real prob" />
      </div>
      <p className="text-[11px] text-(--text-muted) mt-1">
        fake_prob = {fakeProb.toFixed(5)}
        {realProb != null ? ` · real_prob = ${realProb.toFixed(5)}` : ""}
      </p>
    </div>
  );
}
