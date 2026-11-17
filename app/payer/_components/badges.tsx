// Payer-side badges. Separate from the hospital's StatusBadge on purpose:
// payer UI never imports hospital components (Pill is a generic shared primitive).

import { Bot, UserRound } from "lucide-react";
import { Pill, type Tone } from "@/components/pill";

const MESSAGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  RECEIVED: { label: "Received", tone: "blue" },
  IN_REVIEW: { label: "In review", tone: "amber" },
  RESPONDED: { label: "Responded", tone: "slate" },
};

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  APPROVED: { label: "Approved", tone: "green" },
  PARTIALLY_APPROVED: { label: "Partially approved", tone: "teal" },
  DENIED: { label: "Denied", tone: "red" },
  PENDED: { label: "Pended", tone: "orange" },
  REJECTED: { label: "Rejected", tone: "rose" },
};

const humanize = (v: string) => {
  const w = v.toLowerCase().replaceAll("_", " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
};

export function MessageStatusBadge({ status }: { status: string }) {
  const s = MESSAGE_STATUS[status] ?? { label: humanize(status), tone: "neutral" as Tone };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-muted-foreground">—</span>;
  const o = OUTCOME[outcome] ?? { label: humanize(outcome), tone: "neutral" as Tone };
  return <Pill tone={o.tone}>{o.label}</Pill>;
}

export function DecidedByBadge({ decidedBy }: { decidedBy: string | null }) {
  if (!decidedBy) return null;
  const manual = decidedBy === "MANUAL";
  const Icon = manual ? UserRound : Bot;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
      {manual ? "Decided by a reviewer" : "Decided by rules"}
    </span>
  );
}
