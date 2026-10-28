"use client";

import { useId, useState } from "react";

import { blockLabel } from "./ecapaBlockLabel";
import type { EcapaBlockOutput } from "./types";

const WIDTH = 760;
const HEIGHT = 220;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

// Primary ECAPA-TDNN visualization: how activation magnitude (min/max band,
// mean ± std band, mean line) actually evolves across the 10 hooked
// layers, using the summary stats already captured per block — no
// per-value "feature map" slice, which (for a flattened multi-thousand
// element tensor) wasn't a meaningful spatial summary anyway.
export function EcapaMagnitudeChart({ blocks }: { blocks: EcapaBlockOutput[] }) {
  const gradientId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (blocks.length === 0) {
    return <p className="text-xs text-(--text-muted)">Tidak ada data trace.</p>;
  }

  const mins = blocks.map((b) => b.min ?? 0);
  const maxs = blocks.map((b) => b.max ?? 0);
  const yMin = Math.min(...mins);
  const yMax = Math.max(...maxs);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const domainMin = yMin - yPad;
  const domainMax = yMax + yPad;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xAt = (i: number) =>
    blocks.length <= 1
      ? PAD_LEFT + plotW / 2
      : PAD_LEFT + (i / (blocks.length - 1)) * plotW;
  const yAt = (v: number) =>
    PAD_TOP + (1 - (v - domainMin) / (domainMax - domainMin || 1)) * plotH;

  const minMaxTop = blocks.map((b, i) => `${xAt(i)},${yAt(b.max ?? 0)}`).join(" L");
  const minMaxBottom = blocks
    .map((b, i) => [i, b] as const)
    .reverse()
    .map(([i, b]) => `${xAt(i)},${yAt(b.min ?? 0)}`)
    .join(" L");

  const stdTop = blocks
    .map((b, i) => `${xAt(i)},${yAt((b.mean ?? 0) + (b.std ?? 0))}`)
    .join(" L");
  const stdBottom = blocks
    .map((b, i) => [i, b] as const)
    .reverse()
    .map(([i, b]) => `${xAt(i)},${yAt((b.mean ?? 0) - (b.std ?? 0))}`)
    .join(" L");

  const meanLine = blocks
    .map((b, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(b.mean ?? 0)}`)
    .join(" ");

  const zeroY = yAt(0);
  const hovered = hoverIdx !== null ? blocks[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="Perkembangan magnitude aktivasi tiap layer ECAPA-TDNN"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a78d6" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#2a78d6" stopOpacity={0.03} />
          </linearGradient>
        </defs>

        <line
          x1={PAD_LEFT}
          x2={WIDTH - PAD_RIGHT}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--border-color)"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
        />

        <path d={`M${minMaxTop} L${minMaxBottom} Z`} fill="#2a78d6" opacity={0.1} />
        <path d={`M${stdTop} L${stdBottom} Z`} fill="#2a78d6" opacity={0.25} />
        <path
          d={meanLine}
          fill="none"
          stroke="#2a78d6"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {blocks.map((b, i) => (
          <g key={b.name}>
            <circle
              cx={xAt(i)}
              cy={yAt(b.mean ?? 0)}
              r={i === hoverIdx ? 5 : 3}
              fill="#2a78d6"
              stroke="var(--bg-card)"
              strokeWidth={2}
            />
            <rect
              x={xAt(i) - plotW / blocks.length / 2}
              y={PAD_TOP}
              width={plotW / blocks.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          </g>
        ))}

        {blocks.map((b, i) => (
          <text
            key={`label-${b.name}`}
            x={xAt(i)}
            y={HEIGHT - 10}
            textAnchor="middle"
            fontSize={8.5}
            fill="var(--text-muted)"
          >
            {i + 1}
          </text>
        ))}

        {[domainMin, 0, domainMax].map((t) => (
          <text
            key={t}
            x={PAD_LEFT - 6}
            y={yAt(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={9}
            fill="var(--text-muted)"
          >
            {t.toFixed(0)}
          </text>
        ))}
      </svg>

      {hovered && (
        <div className="absolute top-2 right-2 px-3 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-xs space-y-0.5 pointer-events-none">
          <div className="text-(--text-primary) font-medium">
            {hoverIdx! + 1}. {blockLabel(hovered.name)}
          </div>
          <div className="text-(--text-muted)">
            μ {hovered.mean?.toFixed(3)} · σ {hovered.std?.toFixed(3)}
          </div>
          <div className="text-(--text-muted)">
            min {hovered.min?.toFixed(2)} · max {hovered.max?.toFixed(2)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-(--text-muted)">
        {blocks.map((b, i) => (
          <span key={b.name}>
            {i + 1}. {blockLabel(b.name)}
          </span>
        ))}
      </div>
    </div>
  );
}
