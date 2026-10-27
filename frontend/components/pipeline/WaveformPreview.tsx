"use client";

const WIDTH = 760;
const HEIGHT = 120;
const PAD_X = 8;

export function WaveformPreview({
  preview,
  trimStartSec,
  trimEndSec,
  durationSec,
}: {
  preview: number[];
  trimStartSec: number;
  trimEndSec: number;
  durationSec: number;
}) {
  if (preview.length === 0) {
    return (
      <p className="text-xs text-(--text-muted)">Tidak ada data waveform.</p>
    );
  }

  const plotW = WIDTH - PAD_X * 2;
  const barW = plotW / preview.length;
  const maxAmp = Math.max(...preview, 1e-6);
  const midY = HEIGHT / 2;

  const trimStartX =
    durationSec > 0 ? PAD_X + (trimStartSec / durationSec) * plotW : PAD_X;
  const trimEndX =
    durationSec > 0
      ? PAD_X + (trimEndSec / durationSec) * plotW
      : PAD_X + plotW;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="Waveform audio, area gelap menandakan silence yang di-trim"
      >
        <rect
          x={PAD_X}
          y={0}
          width={Math.max(0, trimStartX - PAD_X)}
          height={HEIGHT}
          fill="var(--text-muted)"
          opacity={0.08}
        />
        <rect
          x={trimEndX}
          y={0}
          width={Math.max(0, PAD_X + plotW - trimEndX)}
          height={HEIGHT}
          fill="var(--text-muted)"
          opacity={0.08}
        />

        {preview.map((amp, i) => {
          const h = Math.max(1, (amp / maxAmp) * (HEIGHT - 8));
          const x = PAD_X + i * barW;
          const inSpeech = x >= trimStartX && x <= trimEndX;
          return (
            <rect
              key={i}
              x={x}
              y={midY - h / 2}
              width={Math.max(1, barW - 0.5)}
              height={h}
              fill={inSpeech ? "#2a78d6" : "var(--text-muted)"}
              opacity={inSpeech ? 0.85 : 0.4}
            />
          );
        })}
      </svg>
      <p className="text-xs text-(--text-muted) mt-1">
        {durationSec.toFixed(2)}s total · speech{" "}
        {(trimEndSec - trimStartSec).toFixed(2)}s (area gelap = silence yang
        di-trim sebelum masuk model)
      </p>
    </div>
  );
}
