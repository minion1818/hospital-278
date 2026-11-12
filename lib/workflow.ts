// Single source of truth for the internal prior-auth workflow.
// Pure data + pure functions (no DB, no Next.js APIs) so it can be used from
// server components, server actions, and plain scripts alike.
//
// Payer-driven statuses (IN_REVIEW, APPROVED, PARTIALLY_APPROVED, DENIED,
// PENDED, REJECTED) are set by the simulated payer, not by these transitions.

import type { RequestStatus, Role } from "@/lib/generated/prisma/enums";

export const TRANSITION_KEYS = [
  "SUBMIT_FOR_REVIEW",
  "SEND_BACK",
  "APPROVE_AND_SEND",
  "REOPEN_AS_DRAFT",
  "MARK_SERVICE_COMPLETED",
] as const;

export type TransitionKey = (typeof TRANSITION_KEYS)[number];

/** Facts known only while applying a transition, available to audit details. */
export type AuditContext = {
  /** Control number used in the generated 278 (GENERATE_278 effect) */
  controlNumber?: number;
  /** Summary of the payer decision being cleared (RESET_FOR_RESUBMISSION effect) */
  previousDecision?: string;
};

export type AuditEntry = {
  /** AuditLog.action value, e.g. "SUBMITTED_FOR_REVIEW" */
  action: string;
  /** Details text (fixed or built from context); the user's note is appended to the first entry */
  details?: string | ((ctx: AuditContext) => string | undefined);
};

/**
 * Side effects applied in the same transaction as the status change:
 * - GENERATE_278: build the X12 278 request and store it in raw278Request
 * - RESET_FOR_RESUBMISSION: clear the previous submission's 278s and payer
 *   decision so the next submission starts clean (summarized in the audit log)
 */
export type TransitionEffect = "GENERATE_278" | "RESET_FOR_RESUBMISSION";

/** Plain audit entry after details are resolved. */
export type ResolvedAuditEntry = { action: string; details?: string };

export type Transition = {
  key: TransitionKey;
  label: string;
  /** Short explanation shown next to the button */
  description: string;
  roles: readonly Role[];
  from: readonly RequestStatus[];
  to: RequestStatus;
  noteRequired: boolean;
  /** Prompt shown above the note box (when a note is required) */
  notePrompt?: string;
  /** Audit entries written in order when the transition is applied */
  audit: readonly AuditEntry[];
  effect?: TransitionEffect;
};

export const TRANSITIONS: Record<TransitionKey, Transition> = {
  SUBMIT_FOR_REVIEW: {
    key: "SUBMIT_FOR_REVIEW",
    label: "Submit for review",
    description: "Send this draft to a reviewer before it goes to the payer.",
    roles: ["STAFF"],
    from: ["DRAFT"],
    to: "PENDING_REVIEW",
    noteRequired: false,
    audit: [{ action: "SUBMITTED_FOR_REVIEW" }],
  },
  SEND_BACK: {
    key: "SEND_BACK",
    label: "Send back to staff",
    description: "Return the request to draft so staff can fix it.",
    roles: ["REVIEWER"],
    from: ["PENDING_REVIEW"],
    to: "DRAFT",
    noteRequired: true,
    // Normally a no-op (no 278 exists before APPROVE_AND_SEND); kept so any
    // path back to DRAFT leaves the same clean state.
    effect: "RESET_FOR_RESUBMISSION",
    notePrompt: "What needs to change before this can be sent?",
    audit: [{ action: "SENT_BACK_TO_STAFF" }],
  },
  APPROVE_AND_SEND: {
    key: "APPROVE_AND_SEND",
    label: "Approve and send to payer",
    description: "Approve internally and transmit the 278 request to the payer.",
    roles: ["REVIEWER"],
    from: ["PENDING_REVIEW"],
    to: "SUBMITTED",
    noteRequired: false,
    effect: "GENERATE_278",
    audit: [
      { action: "APPROVED_FOR_SUBMISSION" },
      {
        action: "SUBMITTED_TO_PAYER",
        details: (ctx) => `278 request transmitted (control number ${ctx.controlNumber})`,
      },
    ],
  },
  REOPEN_AS_DRAFT: {
    key: "REOPEN_AS_DRAFT",
    label: "Reopen as draft",
    description: "Move back to draft to correct the request and resubmit it.",
    roles: ["STAFF"],
    from: ["PENDED", "REJECTED", "DENIED"],
    to: "DRAFT",
    noteRequired: false,
    effect: "RESET_FOR_RESUBMISSION",
    audit: [
      {
        action: "REOPENED_AS_DRAFT",
        details: (ctx) =>
          ctx.previousDecision
            ? `Reopened to correct and resubmit. Cleared previous submission: ${ctx.previousDecision}`
            : "Reopened to correct and resubmit",
      },
    ],
  },
  MARK_SERVICE_COMPLETED: {
    key: "MARK_SERVICE_COMPLETED",
    label: "Mark service completed",
    description: "Record that the authorized service was performed.",
    roles: ["STAFF"],
    from: ["APPROVED", "PARTIALLY_APPROVED"],
    to: "SERVICE_COMPLETED",
    noteRequired: false,
    audit: [{ action: "SERVICE_COMPLETED" }],
  },
};

export const ROLE_LABELS: Record<Role, string> = {
  STAFF: "Staff",
  REVIEWER: "Reviewer",
};

/** Transitions the given role may apply to a request in the given status. */
export function availableTransitions(status: RequestStatus, role: Role): Transition[] {
  return Object.values(TRANSITIONS).filter(
    (t) => t.roles.includes(role) && t.from.includes(status),
  );
}

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; error: string };

/**
 * Validates one attempt to apply a transition. Used by the server action
 * (against the freshly re-read status) and by tests.
 */
export function checkTransition(
  key: TransitionKey,
  role: Role,
  currentStatus: RequestStatus,
  note?: string | null,
): TransitionCheck {
  const t = TRANSITIONS[key];
  if (!t.roles.includes(role)) {
    return {
      ok: false,
      error: `Only ${t.roles.map((r) => ROLE_LABELS[r]).join(" or ")} can "${t.label.toLowerCase()}". Switch roles to continue.`,
    };
  }
  if (!t.from.includes(currentStatus)) {
    return {
      ok: false,
      error: `This request is now ${formatStatusText(currentStatus)}, so "${t.label.toLowerCase()}" no longer applies. The page has been refreshed.`,
    };
  }
  if (t.noteRequired && !note?.trim()) {
    return { ok: false, error: "Please add a note explaining why." };
  }
  return { ok: true, transition: t };
}

/** Audit entries to write, with the user's note appended to the first entry's details. */
export function auditEntriesFor(
  t: Transition,
  note?: string | null,
  ctx: AuditContext = {},
): ResolvedAuditEntry[] {
  const trimmed = note?.trim();
  return t.audit.map((entry, i) => {
    const details = typeof entry.details === "function" ? entry.details(ctx) : entry.details;
    if (i !== 0 || !trimmed) return { action: entry.action, details };
    return {
      action: entry.action,
      details: details ? `${details}. Note: ${trimmed}` : trimmed,
    };
  });
}

/**
 * Explains who can act next when the given role has no buttons for this status.
 * Derived from TRANSITIONS where possible, so it stays in sync with the rules.
 */
export function waitingMessage(status: RequestStatus, role: Role): string {
  const others = Object.values(TRANSITIONS).filter(
    (t) => t.from.includes(status) && !t.roles.includes(role),
  );
  if (others.length > 0) {
    const roles = [...new Set(others.flatMap((t) => t.roles))].map((r) => ROLE_LABELS[r]);
    const labels = others.map((t) => t.label.toLowerCase()).join(" or ");
    return `Waiting on ${roles.join(" or ")}: they can ${labels}.`;
  }
  switch (status) {
    case "SUBMITTED":
    case "IN_REVIEW":
      return "Waiting on payer. No action is needed until the payer responds.";
    case "SERVICE_COMPLETED":
      return "This request is complete. No further actions.";
    default:
      return "No actions are available for this status.";
  }
}

function formatStatusText(status: RequestStatus) {
  return status.replaceAll("_", " ").toLowerCase();
}
