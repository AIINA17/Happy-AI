import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Dummy e-commerce sources are themed green ("hijau") and orange ("oren") —
// color the source badge to match so it's recognizable at a glance, not
// just from the label text.
export function sourceBadgeClass(source?: string): string {
  switch (source) {
    case "hijau":
      return "bg-emerald-600 text-white";
    case "oren":
      return "bg-orange-500 text-white";
    default:
      return "";
  }
}

// Resolves NEXT_PUBLIC_SERVER_URL into an absolute URL usable from the
// browser — accepts either a full origin or a path relative to the current
// page's origin.
export function normalizePublicServerUrl(raw: string | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\/+$/, "");
  if (normalized.startsWith("/")) {
    if (typeof window === "undefined") return null;
    return `${window.location.origin}${normalized}`;
  }

  try {
    new URL(normalized);
    return normalized;
  } catch {
    return null;
  }
}
