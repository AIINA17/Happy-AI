"use client";

import type { ToolTraceStep } from "./types";

export function ToolStepPicker({
  steps,
  selectedIndex,
  onSelect,
}: {
  steps: ToolTraceStep[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((step, i) => (
        <button
          key={`${step.step}-${i}`}
          onClick={() => onSelect(i)}
          className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
            selectedIndex === i
              ? "bg-(--bg-secondary) border-(--text-primary)/40"
              : "bg-(--bg-card) border-(--border-color)/20 hover:border-(--border-color)/50"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-(--text-primary) font-medium">
              {i + 1}. {step.tool.name}
            </span>
            {step.voice_gate && (
              <span
                className="text-[9px] px-1 rounded"
                style={{
                  backgroundColor: step.voice_gate.passed
                    ? "rgba(12,163,12,0.15)"
                    : "rgba(208,59,59,0.15)",
                  color: step.voice_gate.passed ? "#0ca30c" : "#d03b3b",
                }}
              >
                {step.voice_gate.passed ? "lolos" : "ditolak"}
              </span>
            )}
          </div>
          <p className="text-(--text-muted) max-w-40">{step.title}</p>
        </button>
      ))}
    </div>
  );
}
