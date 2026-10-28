"use client";

import { useState } from "react";

import { FormulaToggle } from "./FormulaToggle";
import { LayerMagnitudeChart } from "./LayerMagnitudeChart";
import { LayerWorkedExample } from "./LayerWorkedExample";
import type { LayerBlockOutput, LayerWorkedStep } from "./types";

// Real per-block activations captured via PyTorch forward hooks on the
// actual model's forward pass — not an illustration. Shared by the
// ECAPA-TDNN (speaker verification) and wav2vec2 (anti-spoof) sections.
// Primary view is LayerMagnitudeChart (mean/std/min/max across layers —
// summary stats computed over the FULL tensor, genuinely representative).
// The raw-value grid is an optional, honestly-labeled detail: it's the
// first 64 values of a flattened tensor that can have >1,000,000 elements,
// so it's an arbitrary corner, not a feature map.
function FeatureStrip({ preview }: { preview: number[] }) {
  const values = preview.slice(0, 64);
  if (values.length === 0) return null;
  const maxAbs = Math.max(...values.map(Math.abs), 1e-6);

  return (
    <div className="grid grid-cols-8 gap-0.5 mt-2 max-w-50">
      {values.map((v, i) => {
        const intensity = Math.min(1, Math.abs(v) / maxAbs);
        return (
          <span
            key={i}
            className="h-2 rounded-[1px]"
            title={v.toFixed(5)}
            style={{
              backgroundColor:
                v >= 0
                  ? `rgba(42,120,214,${0.15 + intensity * 0.85})`
                  : `rgba(235,104,52,${0.15 + intensity * 0.85})`,
            }}
          />
        );
      })}
    </div>
  );
}

function RealBlockCard({
  block,
  index,
  labelFn,
  formulaFn,
}: {
  block: LayerBlockOutput;
  index: number;
  labelFn: (name: string) => string;
  formulaFn: (name: string) => string | null;
}) {
  const [showGrid, setShowGrid] = useState(false);
  const formula = formulaFn(block.name);

  return (
    <div className="p-3 rounded-lg bg-(--bg-secondary) border border-(--border-color)/20">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-(--text-primary) leading-snug">
          {index + 1}. {labelFn(block.name)}
        </p>
        <code className="text-[10px] text-(--text-muted) shrink-0">
          [{block.shape.join("×")}]
        </code>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-[11px] text-(--text-muted)">
        <span>μ {block.mean?.toFixed(4) ?? "—"}</span>
        <span>σ {block.std?.toFixed(4) ?? "—"}</span>
        <span>min {block.min?.toFixed(3) ?? "—"}</span>
        <span>max {block.max?.toFixed(3) ?? "—"}</span>
      </div>

      <div className="flex items-center gap-3 mt-2">
        {formula && <FormulaToggle formula={formula} />}
        <button
          onClick={() => setShowGrid((o) => !o)}
          className="text-[11px] text-(--text-muted) hover:text-(--text-primary) cursor-pointer"
        >
          {showGrid ? "▾" : "▸"} contoh nilai mentah
        </button>
      </div>

      {showGrid && <FeatureStrip preview={block.preview} />}
    </div>
  );
}

const TABS = [
  { id: "real", label: "Nilai asli (data nyata)" },
  { id: "worked", label: "Contoh perhitungan (disederhanakan)" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function ModelBlockTrace({
  blocks,
  workedExample,
  workedExampleIntro,
  labelFn,
  formulaFn,
  color = "#2a78d6",
}: {
  blocks: LayerBlockOutput[];
  workedExample: LayerWorkedStep[];
  workedExampleIntro: string;
  labelFn: (name: string) => string;
  formulaFn: (name: string) => string | null;
  color?: string;
}) {
  const [tab, setTab] = useState<TabId>("real");

  if (blocks.length === 0) {
    return (
      <p className="text-xs text-(--text-muted) mt-3">
        Trace per-layer tidak tersedia untuk skenario ini.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-(--text-primary) mb-2">
        Perkembangan aktivasi melalui {blocks.length} layer
      </p>
      <LayerMagnitudeChart blocks={blocks} labelFn={labelFn} color={color} />

      <div className="flex gap-1 mt-4 border-b border-(--border-color)/20">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs cursor-pointer border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-(--text-primary) text-(--text-primary) font-medium"
                : "border-transparent text-(--text-muted) hover:text-(--text-secondary)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "real" && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-(--text-muted) leading-relaxed">
            Statistik di tiap kartu dihitung dari seluruh tensor layer itu
            (bukan cuplikan) — hasil asli dari model pretrained, ditangkap
            lewat forward hook. Rumus yang ditampilkan adalah rumus standar
            arsitektur ini, bukan hasil fit ke bobot spesifik model.
          </p>
          {blocks.map((b, i) => (
            <RealBlockCard
              key={`${b.name}-${i}`}
              block={b}
              index={i}
              labelFn={labelFn}
              formulaFn={formulaFn}
            />
          ))}
        </div>
      )}

      {tab === "worked" && (
        <div className="mt-3">
          <LayerWorkedExample steps={workedExample} intro={workedExampleIntro} />
        </div>
      )}
    </div>
  );
}
