"use client";

import { FormulaToggle } from "./FormulaToggle";
import type { EcapaWorkedStep } from "./types";

// Step-by-step worked example of what ECAPA-TDNN actually *does* at each
// stage — real short audio slice in, small fixed illustrative weights (not
// the trained model's), real arithmetic out. Complements the "Nilai asli"
// tab (the real model's real activations, but only as summary statistics)
// with something a non-ML judge can follow number-by-number.
function MiniMatrix({ values }: { values: number[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] font-mono border-separate border-spacing-1">
        <tbody>
          {values.map((row, r) => (
            <tr key={r}>
              {row.map((v, c) => (
                <td
                  key={c}
                  className="px-1.5 py-1 rounded bg-(--bg-primary) text-(--text-secondary) text-right"
                >
                  {v.toFixed(3)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepCard({ step, index }: { step: EcapaWorkedStep; index: number }) {
  return (
    <div className="p-3.5 rounded-lg bg-(--bg-secondary) border border-(--border-color)/20">
      <p className="text-xs font-medium text-(--text-primary) leading-snug">
        {index + 1}. {step.title}
      </p>
      <p className="text-[11px] text-(--text-muted) mt-1 leading-relaxed">
        {step.note}
      </p>
      {step.formula && (
        <div className="mt-2">
          <FormulaToggle formula={step.formula} />
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 mt-3">
        {step.input && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-(--text-muted) mb-1.5">
              Input
            </p>
            <MiniMatrix values={step.input} />
          </div>
        )}
        {step.input && (
          <span className="text-(--text-muted) self-center">→</span>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-(--text-muted) mb-1.5">
            Output
          </p>
          <MiniMatrix values={step.output} />
        </div>
      </div>

      {step.extra && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 pt-3 border-t border-(--border-color)/15">
          {Object.entries(step.extra).map(([label, values]) => (
            <div key={label} className="text-[11px]">
              <span className="text-(--text-muted)">{label}: </span>
              <span className="font-mono text-(--text-secondary)">
                [{values.map((v) => v.toFixed(3)).join(", ")}]
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EcapaWorkedExample({ steps }: { steps: EcapaWorkedStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-xs text-(--text-muted)">
        Contoh perhitungan tidak tersedia untuk skenario ini.
      </p>
    );
  }

  return (
    <div>
      <p className="text-[11px] text-(--text-muted) leading-relaxed mb-3">
        Dihitung dari potongan audio yang sama, tapi pakai bobot ilustratif
        tetap — bukan bobot hasil training model asli. Dimensinya sengaja
        dikecilkan (4 frame, 4 kanal) supaya tiap langkah bisa diikuti; model
        asli memakai 80+ kanal dan lebih banyak frame.
      </p>
      <div className="space-y-2.5">
        {steps.map((s, i) => (
          <StepCard key={s.step} step={s} index={i} />
        ))}
      </div>
    </div>
  );
}
