import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Generic status pill shared by the hospital and payer badges. Imports nothing domain-specific.

export type Tone = "neutral" | "slate" | "amber" | "blue" | "indigo" | "green" | "teal" | "red" | "orange" | "rose";

// Soft fill + darker text + hairline ring: readable (AA) without looking neon
export const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-gray-100 text-gray-700 ring-gray-500/20", dot: "bg-gray-400" },
  slate: { badge: "bg-slate-100 text-slate-700 ring-slate-500/20", dot: "bg-slate-500" },
  amber: { badge: "bg-amber-50 text-amber-800 ring-amber-600/25", dot: "bg-amber-500" },
  blue: { badge: "bg-blue-50 text-blue-800 ring-blue-600/20", dot: "bg-blue-500" },
  indigo: { badge: "bg-indigo-50 text-indigo-800 ring-indigo-600/20", dot: "bg-indigo-500" },
  green: { badge: "bg-green-50 text-green-800 ring-green-600/20", dot: "bg-green-600" },
  teal: { badge: "bg-teal-50 text-teal-800 ring-teal-600/20", dot: "bg-teal-600" },
  red: { badge: "bg-red-50 text-red-800 ring-red-600/20", dot: "bg-red-600" },
  orange: { badge: "bg-orange-50 text-orange-800 ring-orange-600/20", dot: "bg-orange-500" },
  rose: { badge: "bg-rose-50 text-rose-800 ring-rose-600/25", dot: "bg-rose-600" },
};

/** Generic pill used by every status-like badge in the app (hospital and payer). */
export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE_CLASSES[tone].badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_CLASSES[tone].dot)} />
      {children}
    </span>
  );
}

