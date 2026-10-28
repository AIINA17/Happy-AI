"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PipelineStage({
  index,
  activeStage,
  stepNumber,
  title,
  subtitle,
  icon: Icon,
  accent = "#5c5c5c",
  children,
}: {
  index: number;
  activeStage: number;
  stepNumber: number;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  accent?: string;
  children: ReactNode;
}) {
  const visible = activeStage >= index;

  return (
    <section
      className={`rounded-2xl bg-(--bg-card) border border-(--border-color)/20 border-l-4 transition-all duration-500 ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-3 pointer-events-none"
      }`}
      style={{ borderLeftColor: accent }}
    >
      <div className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <span
            className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-xs font-semibold"
            style={{ backgroundColor: `${accent}22`, color: accent }}
          >
            {stepNumber}
          </span>
          <Icon size={18} style={{ color: accent }} className="shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-(--text-primary)">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-(--text-muted) mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
