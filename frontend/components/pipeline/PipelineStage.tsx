"use client";

import type { ReactNode } from "react";

export function PipelineStage({
  index,
  activeStage,
  title,
  subtitle,
  children,
}: {
  index: number;
  activeStage: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const visible = activeStage >= index;

  return (
    <section
      className={`p-5 rounded-2xl bg-(--bg-card) border border-(--border-color)/20 transition-all duration-500 ${
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-3 pointer-events-none"
      }`}
    >
      <div className="mb-3">
        <h2 className="text-lg font-medium text-(--text-primary)">{title}</h2>
        {subtitle && (
          <p className="text-xs text-(--text-muted) mt-1">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}
