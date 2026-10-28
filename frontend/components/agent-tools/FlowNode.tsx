"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// One "layer" in the User -> Agent -> Tool -> Agent -> User round trip.
// Visible/animated in from useSequentialReveal, same mechanism as
// PipelineStage uses for the voice-verification page.
export function FlowNode({
  visible,
  actor,
  icon: Icon,
  accent,
  children,
}: {
  visible: boolean;
  actor: string;
  icon: LucideIcon;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`transition-all duration-500 ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-2 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="flex items-center justify-center w-7 h-7 rounded-full shrink-0"
          style={{ backgroundColor: `${accent}22`, color: accent }}
        >
          <Icon size={15} />
        </span>
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: accent }}
        >
          {actor}
        </span>
      </div>
      <div className="ml-9 p-3 rounded-lg bg-(--bg-secondary) border border-(--border-color)/20">
        {children}
      </div>
    </div>
  );
}

export function FlowArrow({ visible }: { visible: boolean }) {
  return (
    <div
      className={`ml-[13px] w-px h-5 bg-(--border-color)/40 transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
