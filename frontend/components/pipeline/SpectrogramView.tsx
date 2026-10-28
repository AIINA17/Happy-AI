"use client";

import { useEffect, useRef } from "react";

import type { SpectrogramData } from "./types";

const DISPLAY_HEIGHT = 130;

// Canvas, not SVG: a 40×80 grid is cheap per-pixel on canvas but would be
// 3200+ DOM nodes as individual <rect>s, doubled once two spectrograms are
// shown side by side.
export function SpectrogramView({
  data,
  label,
}: {
  data: SpectrogramData;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.n_frames === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { db, n_mels, n_frames } = data;
    canvas.width = n_frames;
    canvas.height = n_mels;

    let min = Infinity;
    let max = -Infinity;
    for (const row of db) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = max - min || 1;

    const image = ctx.createImageData(n_frames, n_mels);
    for (let mel = 0; mel < n_mels; mel++) {
      // Flip vertically: mel bin 0 (lowest frequency) belongs at the
      // bottom of the image, like a conventional spectrogram.
      const destRow = n_mels - 1 - mel;
      for (let t = 0; t < n_frames; t++) {
        const norm = Math.max(0, Math.min(1, (db[mel][t] - min) / range));
        const idx = (destRow * n_frames + t) * 4;
        image.data[idx] = Math.round(20 + norm * 235);
        image.data[idx + 1] = Math.round(35 + norm * 160);
        image.data[idx + 2] = Math.round(Math.max(0, 95 - norm * 75));
        image.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [data]);

  if (data.n_frames === 0) {
    return (
      <p className="text-xs text-(--text-muted)">Tidak ada data spektrogram.</p>
    );
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-md block"
        style={{ height: DISPLAY_HEIGHT }}
        role="img"
        aria-label={`Spektrogram: ${label}`}
      />
      <p className="text-[10px] text-(--text-muted) mt-1">
        {label} · {data.duration_sec.toFixed(2)}s · {data.n_mels} pita mel
      </p>
    </div>
  );
}
