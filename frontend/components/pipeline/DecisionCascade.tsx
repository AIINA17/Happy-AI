"use client";

import type { DecisionStep } from "./types";

// Renders decide()'s real cascade steps verbatim — never reimplements the
// threshold logic client-side. Gates that don't appear here simply weren't
// reached, because an earlier gate already made the decision final.
export function DecisionCascade({ steps }: { steps: DecisionStep[] }) {
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0"
            style={{
              backgroundColor: s.passed
                ? "rgba(12,163,12,0.15)"
                : "rgba(208,59,59,0.15)",
              color: s.passed ? "#0ca30c" : "#d03b3b",
            }}
          >
            {s.passed ? "✓" : "✕"}
          </span>
          <span className="text-(--text-primary) font-mono text-xs">
            {s.check}
          </span>
          <span className="text-(--text-muted) text-xs">{s.detail}</span>
        </div>
      ))}
      <p className="text-xs text-(--text-muted) mt-2">
        Gate yang tidak muncul di atas tidak dievaluasi — keputusan sudah
        final di gate sebelumnya.
      </p>
    </div>
  );
}
