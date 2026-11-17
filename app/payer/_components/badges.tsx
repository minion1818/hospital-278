// Payer-side badges. Separate from the hospital's StatusBadge on purpose:
// payer UI never imports hospital components.

const MESSAGE_STATUS: Record<string, { label: string; className: string }> = {
  RECEIVED: { label: "Received", className: "bg-sky-100 text-sky-800" },
  IN_REVIEW: { label: "In review", className: "bg-amber-100 text-amber-800" },
  RESPONDED: { label: "Responded", className: "bg-emerald-100 text-emerald-800" },
};

const OUTCOME: Record<string, { label: string; className: string }> = {
  APPROVED: { label: "Approved", className: "bg-green-100 text-green-800" },
  PARTIALLY_APPROVED: { label: "Approved in part", className: "bg-lime-100 text-lime-800" },
  DENIED: { label: "Denied", className: "bg-red-100 text-red-800" },
  PENDED: { label: "Pended", className: "bg-orange-100 text-orange-800" },
  REJECTED: { label: "Rejected", className: "bg-rose-200 text-rose-900" },
};

const pill = "inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium";

export function MessageStatusBadge({ status }: { status: string }) {
  const s = MESSAGE_STATUS[status] ?? { label: status, className: "bg-gray-100 text-gray-700" };
  return <span className={`${pill} ${s.className}`}>{s.label}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-gray-400">—</span>;
  const o = OUTCOME[outcome] ?? { label: outcome, className: "bg-gray-100 text-gray-700" };
  return <span className={`${pill} ${o.className}`}>{o.label}</span>;
}

export function DecidedByBadge({ decidedBy }: { decidedBy: string | null }) {
  if (!decidedBy) return null;
  return (
    <span className="inline-block rounded border border-emerald-300 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
      {decidedBy === "MANUAL" ? "Decided manually" : "Decided by rules"}
    </span>
  );
}
