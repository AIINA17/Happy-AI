"use client";

import { SpectrogramView } from "./SpectrogramView";
import type { SpectrogramData } from "./types";

// A second, independent way (besides the embedding fingerprint) to see
// whether this voice matches the enrolled one: the raw spectral pattern
// (pitch/formant structure visible as horizontal bands) rather than an
// abstract 192-d vector. Same speaker tends to show visually similar
// band patterns across different sentences; a different speaker usually
// looks visibly different even before any score is computed.
export function SpectrogramComparison({
  live,
  enrolled,
  enrolledLabel,
}: {
  live: SpectrogramData | null;
  enrolled: SpectrogramData | null;
  enrolledLabel: string;
}) {
  if (!live) {
    return (
      <p className="text-xs text-(--text-muted)">
        Tidak ada data spektrogram.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs font-medium text-(--text-primary) mb-2">
        Spektrogram: suara ini vs profil terdaftar
      </p>
      <div className="grid md:grid-cols-2 gap-3">
        <SpectrogramView data={live} label="Suara ini (live)" />
        {enrolled ? (
          <SpectrogramView
            data={enrolled}
            label={`Enrolled: "${enrolledLabel}"`}
          />
        ) : (
          <div className="flex items-center justify-center text-[11px] text-(--text-muted) border border-dashed border-(--border-color)/30 rounded-md p-4 text-center min-h-32">
            Spektrogram enrollment tidak tersedia untuk mode live — audio
            enrollment tidak disimpan, hanya embedding-nya.
          </div>
        )}
      </div>
      <p className="text-[11px] text-(--text-muted) mt-2 leading-relaxed">
        Bandingkan pola garis horizontal (pitch & formant) di kedua
        spektrogram — suara orang yang sama cenderung mirip polanya meski
        kalimatnya beda; suara orang lain biasanya terlihat jelas berbeda,
        bahkan sebelum melihat skornya.
      </p>
    </div>
  );
}
