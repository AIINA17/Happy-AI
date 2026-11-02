"use client";

import type { CSSProperties, ReactNode } from "react";

// Every existing pipeline detail component (ThresholdGauge, ModelBlockTrace,
// LayerWorkedExample, SpectrogramView, DecisionCascade, FinalDecisionBadge,
// EmbeddingFingerprint, WaveformPreview, FormulaToggle, ...) reads color
// through these CSS custom properties rather than hardcoded dark values —
// so overriding them inside this one wrapper is enough to reuse all of
// them, unmodified, on a light page instead of rebuilding each one.
const LIGHT_THEME_VARS: CSSProperties = {
  ["--bg-primary" as string]: "#f1f5f9",
  ["--bg-secondary" as string]: "#e2e8f0",
  ["--bg-card" as string]: "#ffffff",
  ["--text-primary" as string]: "#0f172a",
  ["--text-secondary" as string]: "#334155",
  ["--text-muted" as string]: "#64748b",
  ["--border-color" as string]: "#cbd5e1",
};

export function LightThemeScope({ children }: { children: ReactNode }) {
  return (
    <div style={LIGHT_THEME_VARS} className="bg-(--bg-primary) min-h-screen">
      {children}
    </div>
  );
}
