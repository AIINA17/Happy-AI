"use client";

import { Handle, Position } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";

export interface BlockNodeData {
  label: string;
  subtitle?: string;
  icon: LucideIcon;
  accent: string;
  stat?: string;
  clickable?: boolean;
  compact?: boolean;
  highlight?: boolean;
  [key: string]: unknown;
}

export function BlockNode({ data }: { data: BlockNodeData }) {
  const Icon = data.icon;
  const width = data.compact ? 150 : 200;

  return (
    <div
      className={`rounded-xl border-2 bg-white shadow-sm px-3 py-2.5 transition-shadow ${
        data.clickable ? "cursor-pointer hover:shadow-lg" : ""
      } ${data.highlight ? "ring-2 ring-offset-2" : ""}`}
      style={{
        width,
        borderColor: data.accent,
        ...(data.highlight ? { ["--tw-ring-color" as string]: data.accent } : {}),
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: data.accent, width: 7, height: 7 }}
      />
      <div className="flex items-center gap-2">
        <span
          className="flex items-center justify-center w-6 h-6 rounded-full shrink-0"
          style={{ backgroundColor: `${data.accent}22`, color: data.accent }}
        >
          <Icon size={13} />
        </span>
        <span className="text-xs font-semibold text-slate-900 leading-tight">
          {data.label}
        </span>
      </div>
      {data.subtitle && (
        <p className="text-[10px] text-slate-500 mt-1 leading-snug">
          {data.subtitle}
        </p>
      )}
      {data.stat && (
        <p className="text-[11px] font-mono text-slate-700 mt-1 font-medium">
          {data.stat}
        </p>
      )}
      {data.clickable && (
        <p className="text-[9px] text-slate-400 mt-1">klik untuk detail →</p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: data.accent, width: 7, height: 7 }}
      />
    </div>
  );
}

export const nodeTypes = { block: BlockNode };
