"use client";

export function HeroStat({
  label,
  value,
  color,
  caption,
}: {
  label: string;
  value: string;
  color?: string;
  caption?: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span
        className="text-3xl font-bold tabular-nums"
        style={{ color: color ?? "var(--text-primary)" }}
      >
        {value}
      </span>
      <div>
        <p className="text-xs text-(--text-muted)">{label}</p>
        {caption && (
          <p className="text-[11px] text-(--text-muted) mt-0.5">{caption}</p>
        )}
      </div>
    </div>
  );
}
