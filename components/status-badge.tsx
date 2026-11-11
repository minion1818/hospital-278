import type { RequestStatus } from "@/lib/generated/prisma/enums";

// Record<RequestStatus, ...> makes tsc fail if a status is added to the enum without a style
const STATUS_STYLES: Record<RequestStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_REVIEW: "bg-yellow-100 text-yellow-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  IN_REVIEW: "bg-indigo-100 text-indigo-800",
  APPROVED: "bg-green-100 text-green-800",
  PARTIALLY_APPROVED: "bg-lime-100 text-lime-800",
  DENIED: "bg-red-100 text-red-800",
  PENDED: "bg-orange-100 text-orange-800",
  REJECTED: "bg-rose-200 text-rose-900",
  SERVICE_COMPLETED: "bg-teal-100 text-teal-800",
};

export function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {formatStatus(status)}
    </span>
  );
}
