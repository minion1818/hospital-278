import type { RequestStatus } from "@/lib/generated/prisma/enums";
import { Pill, type Tone } from "@/components/pill";

// Record<RequestStatus, ...> makes tsc fail if a status is added to the enum without a label and style
const STATUS_META: Record<RequestStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING_REVIEW: { label: "Pending review", tone: "amber" },
  SUBMITTED: { label: "Submitted", tone: "blue" },
  IN_REVIEW: { label: "In review (payer)", tone: "indigo" },
  APPROVED: { label: "Approved", tone: "green" },
  PARTIALLY_APPROVED: { label: "Partially approved", tone: "teal" },
  DENIED: { label: "Denied", tone: "red" },
  PENDED: { label: "Pended (more information needed)", tone: "orange" },
  REJECTED: { label: "Rejected (needs correction)", tone: "rose" },
  SERVICE_COMPLETED: { label: "Service completed", tone: "slate" },
};

/** Short labels for tight spaces (tables, filter chips). */
const SHORT_LABELS: Partial<Record<RequestStatus, string>> = {
  PENDED: "Pended",
  REJECTED: "Rejected",
};

export function statusLabel(status: RequestStatus, short = false): string {
  return (short && SHORT_LABELS[status]) || STATUS_META[status].label;
}

export function StatusBadge({ status, short = false }: { status: RequestStatus; short?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <Pill tone={meta.tone}>
      <span title={short ? meta.label : undefined}>{statusLabel(status, short)}</span>
    </Pill>
  );
}
