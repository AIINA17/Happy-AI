"use client";

const WIDTH = 760;
const HEIGHT = 70;
const PAD_X = 40;
const EPS = 1e-5;

export function ThresholdGauge({
  value,
  min = 0,
  max = 1,
  scale = "linear",
  thresholds,
  valueLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  scale?: "linear" | "log";
  thresholds: { value: number; label: string; color?: string }[];
  valueLabel: string;
}) {
  const toUnit = (v: number) => {
    if (scale === "log") {
      const lo = Math.log10(Math.max(min, EPS));
      const hi = Math.log10(Math.max(max, EPS));
      const vv = Math.log10(Math.min(Math.max(v, EPS), max));
      return (vv - lo) / (hi - lo || 1);
    }
    return (v - min) / (max - min || 1);
  };

  const plotW = WIDTH - PAD_X * 2;
  const xAt = (v: number) =>
    PAD_X + Math.min(Math.max(toUnit(v), 0), 1) * plotW;

  const sortedThresholds = [...thresholds].sort((a, b) => a.value - b.value);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Gauge: ${valueLabel}`}
    >
      <line
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={HEIGHT - 24}
        y2={HEIGHT - 24}
        stroke="var(--border-color)"
        strokeWidth={3}
        strokeLinecap="round"
      />

      {sortedThresholds.map((t) => (
        <g key={t.label}>
          <line
            x1={xAt(t.value)}
            x2={xAt(t.value)}
            y1={HEIGHT - 32}
            y2={HEIGHT - 16}
            stroke={t.color ?? "var(--text-muted)"}
            strokeWidth={2}
          />
          <text
            x={xAt(t.value)}
            y={HEIGHT - 38}
            textAnchor="middle"
            fontSize={9}
            fill="var(--text-muted)"
          >
            {t.label}
          </text>
        </g>
      ))}

      <circle
        cx={xAt(value)}
        cy={HEIGHT - 24}
        r={7}
        fill="#fab219"
        stroke="var(--bg-card)"
        strokeWidth={2}
      />
      <text
        x={xAt(value)}
        y={HEIGHT - 4}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill="var(--text-primary)"
      >
        {valueLabel}
      </text>
    </svg>
  );
}
