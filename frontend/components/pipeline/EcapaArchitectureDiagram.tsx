"use client";

import { ArchFlowArrow, ArchFlowBox } from "./ArchFlowBox";

// High-level overview of the ECAPA-TDNN flow. The real per-layer
// activations (captured via forward hooks on speechbrain's pretrained
// model — see models/speaker_verifier.py) are rendered separately by
// EcapaBlockTrace, below. Numbers annotated here are real, measured values
// from this run.
export function EcapaArchitectureDiagram({
  embeddingDim,
  score,
  matchedLabel,
}: {
  embeddingDim: number;
  score: number;
  matchedLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        <ArchFlowBox title="Raw audio" />
        <ArchFlowArrow />
        <ArchFlowBox title="Mel features" />
        <ArchFlowArrow />
        <ArchFlowBox title="ECAPA-TDNN" detail="pretrained, SpeechBrain" />
        <ArchFlowArrow />
        <ArchFlowBox title={`Embedding ${embeddingDim}-d`} />
        <ArchFlowArrow />
        <ArchFlowBox title="Cosine similarity" detail={`vs "${matchedLabel}"`} />
      </div>
      <p className="text-[11px] text-(--text-muted) mt-1">
        score = {score.toFixed(3)}
      </p>
    </div>
  );
}
