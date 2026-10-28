"use client";

import { ArrowRight } from "lucide-react";

export function ArchFlowBox({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="px-3 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-center min-w-[110px] shrink-0">
      <p className="text-xs font-medium text-(--text-primary)">{title}</p>
      {detail && (
        <p className="text-[10px] text-(--text-muted) mt-0.5">{detail}</p>
      )}
    </div>
  );
}

export function ArchFlowArrow() {
  return (
    <ArrowRight size={14} className="text-(--text-muted) shrink-0" />
  );
}
