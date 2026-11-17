import { describe, expect, it } from "vitest";
import { ManualDecisionError, REJECT_CODE_LOOP, REJECT_CODES, toManualDecision } from "@/lib/payer/manual";
import { REJECT_REASON_CODES } from "@/lib/x12/reject-reasons";

const fails = (input: unknown, units = 12) => {
  try {
    toManualDecision(input, units);
  } catch (e) {
    if (e instanceof ManualDecisionError) return e;
    throw e;
  }
  throw new Error("expected a ManualDecisionError");
};

describe("toManualDecision: the five decisions", () => {
  it("APPROVED approves exactly the requested units", () => {
    expect(toManualDecision({ kind: "APPROVED" }, 12)).toEqual({ kind: "APPROVED", unitsApproved: 12 });
  });

  it("PARTIAL keeps units and reason (units may arrive as a form string)", () => {
    expect(toManualDecision({ kind: "PARTIAL", unitsApproved: "8", reason: " Limit 8 visits " }, 12)).toEqual({
      kind: "PARTIAL",
      unitsApproved: 8,
      reason: "Limit 8 visits",
    });
  });

  it("DENIED and PENDED carry the trimmed reason", () => {
    expect(toManualDecision({ kind: "DENIED", reason: "Not medically necessary" }, 1)).toEqual({ kind: "DENIED", reason: "Not medically necessary" });
    expect(toManualDecision({ kind: "PENDED", reason: "Send PT notes" }, 1)).toEqual({ kind: "PENDED", reason: "Send PT notes" });
  });

  it("REJECTED uses the chosen code, the text, and the code's usual loop", () => {
    expect(toManualDecision({ kind: "REJECTED", code: "75", reason: "Member not on file" }, 1)).toEqual({
      kind: "REJECTED",
      errors: [{ code: "75", text: "Member not on file", loop: "subscriber" }],
    });
  });

  it("offers exactly the reject codes the AUTO rules use, each with a loop", () => {
    expect([...REJECT_CODES].sort()).toEqual(Object.keys(REJECT_REASON_CODES).sort());
    for (const c of REJECT_CODES) expect(REJECT_CODE_LOOP[c]).toBeTruthy();
  });
});

describe("toManualDecision: reason validation", () => {
  it.each(["DENIED", "PENDED"])("%s requires a reason", (kind) => {
    expect(fails({ kind }).fieldErrors.reason).toBe("Enter a reason.");
    expect(fails({ kind, reason: "   " }).fieldErrors.reason).toBe("Enter a reason.");
  });

  it("PARTIAL and REJECTED require a reason too", () => {
    expect(fails({ kind: "PARTIAL", unitsApproved: 5 }).fieldErrors.reason).toBe("Enter a reason.");
    expect(fails({ kind: "REJECTED", code: "75" }).fieldErrors.reason).toBe("Enter a reason.");
  });

  it("rejects reasons over 200 characters and accepts exactly 200", () => {
    expect(fails({ kind: "DENIED", reason: "x".repeat(201) }).fieldErrors.reason).toMatch(/under 200/);
    expect(toManualDecision({ kind: "DENIED", reason: "x".repeat(200) }, 1)).toMatchObject({ kind: "DENIED" });
  });

  it("accepts '*' and '~' here; the response generator sanitizes them", () => {
    expect(toManualDecision({ kind: "DENIED", reason: "a*b~c" }, 1)).toEqual({ kind: "DENIED", reason: "a*b~c" });
  });

  it("APPROVED needs no reason", () => {
    expect(toManualDecision({ kind: "APPROVED", reason: "" }, 3)).toEqual({ kind: "APPROVED", unitsApproved: 3 });
  });
});

describe("toManualDecision: partial units", () => {
  it.each([
    ["0", 0],
    ["equal to requested", 12],
    ["above requested", 13],
    ["negative", -1],
  ])("rejects %s", (_label, units) => {
    expect(fails({ kind: "PARTIAL", unitsApproved: units, reason: "r" }).fieldErrors.unitsApproved).toBe(
      "Approve between 1 and 11 units (12 requested).",
    );
  });

  it("rejects fractional and missing units", () => {
    expect(fails({ kind: "PARTIAL", unitsApproved: 2.5, reason: "r" }).fieldErrors.unitsApproved).toBe("Units must be a whole number.");
    expect(fails({ kind: "PARTIAL", unitsApproved: "abc", reason: "r" }).fieldErrors.unitsApproved).toBeTruthy();
  });

  it("accepts the boundaries 1 and requested - 1", () => {
    expect(toManualDecision({ kind: "PARTIAL", unitsApproved: 1, reason: "r" }, 12)).toMatchObject({ unitsApproved: 1 });
    expect(toManualDecision({ kind: "PARTIAL", unitsApproved: 11, reason: "r" }, 12)).toMatchObject({ unitsApproved: 11 });
  });

  it("refuses a partial approval of a 1-unit request", () => {
    expect(fails({ kind: "PARTIAL", unitsApproved: 1, reason: "r" }, 1).message).toMatch(/Only 1 unit was requested/);
  });
});

describe("toManualDecision: other input problems", () => {
  it("requires a known decision kind", () => {
    expect(fails({}).fieldErrors.kind).toBeTruthy();
    expect(fails({ kind: "MAYBE" }).fieldErrors.kind).toBeTruthy();
  });

  it("requires a valid reject code", () => {
    expect(fails({ kind: "REJECTED", code: "", reason: "r" }).fieldErrors.code).toBe("Choose a reject reason code.");
    expect(fails({ kind: "REJECTED", code: "ZZ", reason: "r" }).fieldErrors.code).toBe("Choose a reject reason code.");
  });
});
