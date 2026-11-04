"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

// Generic right-side detail drawer, shared by the biometric pipeline's
// SidePanel.tsx and the agent-tools pipeline's AgentStepPanel.tsx.
export function Panel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed top-0 right-0 h-full w-full sm:w-136 bg-white border-l border-slate-200 shadow-2xl z-50 overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3.5 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
          aria-label="Tutup panel"
        >
          <X size={20} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
