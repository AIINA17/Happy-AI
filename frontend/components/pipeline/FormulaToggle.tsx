"use client";

import { useState } from "react";

// Small "lihat rumus" disclosure — hidden by default so each card reads as
// numbers-and-labels first, math only on request. Shared by EcapaBlockTrace
// (real-block formulas) and EcapaWorkedExample (worked-example formulas).
export function FormulaToggle({ formula }: { formula: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-(--text-muted) hover:text-(--text-primary) cursor-pointer"
      >
        {open ? "▾" : "▸"} rumus
      </button>
      {open && (
        <code className="block text-[11px] text-(--text-secondary) bg-(--bg-primary) rounded-md px-2.5 py-1.5 mt-1 leading-relaxed">
          {formula}
        </code>
      )}
    </div>
  );
}
