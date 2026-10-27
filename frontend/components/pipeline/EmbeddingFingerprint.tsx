"use client";

const WIDTH = 760;
const HEIGHT = 100;
const PAD_X = 8;

// Mirrors analysis/visualize_speaker_fingerprint.py's concept exactly: the
// 192 raw embedding values plotted as a 1D signed strip, not a 2D grid.
export function EmbeddingFingerprint({
  values,
  compareValues,
  label,
  compareLabel,
}: {
  values: number[];
  compareValues?: number[];
  label: string;
  compareLabel?: string;
}) {
  if (values.length === 0) {
    return <p className="text-xs text-(--text-muted)">Tidak ada embedding.</p>;
  }

  const plotW = WIDTH - PAD_X * 2;
  const barW = plotW / values.length;
  const maxAbs = Math.max(...values.map(Math.abs), 1e-6);
  const midY = HEIGHT / 2;

  const comparePoints = compareValues
    ?.map((v, i) => {
      const x = PAD_X + i * barW + barW / 2;
      const y = midY - (v / maxAbs) * (HEIGHT / 2 - 4);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Embedding fingerprint: ${label}`}
      >
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={midY}
          y2={midY}
          stroke="var(--border-color)"
          strokeOpacity={0.3}
        />
        {values.map((v, i) => {
          const h = (Math.abs(v) / maxAbs) * (HEIGHT / 2 - 4);
          const x = PAD_X + i * barW;
          return (
            <rect
              key={i}
              x={x}
              y={v >= 0 ? midY - h : midY}
              width={Math.max(1, barW - 0.3)}
              height={Math.max(0.5, h)}
              fill="#2a78d6"
              opacity={0.85}
            />
          );
        })}
        {comparePoints && (
          <polyline
            points={comparePoints}
            fill="none"
            stroke="#eb6834"
            strokeWidth={1}
            opacity={0.8}
          />
        )}
      </svg>
      <div className="flex items-center gap-4 mt-1 text-xs text-(--text-muted)">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: "#2a78d6" }}
          />
          {label} ({values.length}-d)
        </span>
        {compareValues && compareLabel && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5"
              style={{ backgroundColor: "#eb6834" }}
            />
            {compareLabel}
          </span>
        )}
      </div>
    </div>
  );
}
