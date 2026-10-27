"use client";

import { ArchFlowArrow, ArchFlowBox } from "./ArchFlowBox";

// Conceptual block diagram — the real pipeline calls speechbrain's
// pretrained SpeakerRecognition.encode_batch() as a single black-box call
// (models/speaker_verifier.py), not instrumented layer-by-layer. Numbers
// annotated here are real, measured values from this run.
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
        score = {score.toFixed(3)} — model pretrained dipanggil sebagai satu
        kesatuan (black-box), bukan diinstrumentasi per-layer.
      </p>
    </div>
  );
}
