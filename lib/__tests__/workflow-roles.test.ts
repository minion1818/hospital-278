import { describe, expect, it } from "vitest";
import { availableTransitions, checkTransition, waitingMessage } from "@/lib/workflow";

// Role checks are unchanged; these cover the role-title wording on the detail page
describe("workflow role wording", () => {
  it("names the role that may act when another role tries", () => {
    const res = checkTransition("APPROVE_AND_SEND", "STAFF", "PENDING_REVIEW");
    expect(res).toEqual({
      ok: false,
      error: 'Only the Utilization Reviewer can "send to payer". Sign in with that role to continue.',
    });
  });

  it("explains who the request is waiting on when a role has no actions", () => {
    expect(availableTransitions("PENDING_REVIEW", "STAFF")).toEqual([]);
    expect(waitingMessage("PENDING_REVIEW", "STAFF")).toBe(
      "No actions for the Authorization Specialist on this request. It is waiting on the Utilization Reviewer, who can send back to staff or send to payer.",
    );
    expect(availableTransitions("DRAFT", "REVIEWER")).toEqual([]);
    expect(waitingMessage("DRAFT", "REVIEWER")).toBe(
      "No actions for the Utilization Reviewer on this request. It is waiting on the Authorization Specialist, who can submit for review.",
    );
    expect(waitingMessage("IN_REVIEW", "REVIEWER")).toBe(
      "No actions for the Utilization Reviewer on this request. It is waiting on the payer's decision.",
    );
  });
});
