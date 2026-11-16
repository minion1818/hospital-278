import { describe, expect, it } from "vitest";
import { DIAGNOSES, PROCEDURES } from "@/lib/catalog";
import {
  PROCEDURE_RULES,
  evaluateRequest,
  isValidNpi,
  normalizeDiagnosis,
  type Attachments,
  type EvaluateInput,
  type PayerRequest,
} from "@/lib/payer/rules";

const TODAY = "20261114";

const valid: PayerRequest = {
  payerId: "SIMACME01",
  memberId: "W123456789",
  providerNpi: "1234567893",
  diagnosisCode: "M17.11",
  procedureCode: "73721", // MRI knee: notes required, 1 unit
  units: 1,
  serviceDate: "20261120",
};
const allDocs: Attachments = { clinicalNotesAttached: true, conservativeTreatmentDocumented: true };
const roster = { W123456789: { active: true }, W999999999: { active: false } };

const run = (
  request: Partial<PayerRequest> = {},
  attachments: Partial<Attachments> = {},
  extra: Partial<EvaluateInput> = {},
) =>
  evaluateRequest({
    request: { ...valid, ...request },
    attachments: { ...allDocs, ...attachments },
    roster,
    today: TODAY,
    ...extra,
  });

describe("rule data", () => {
  it("has a rule for every catalog procedure", () => {
    expect(Object.keys(PROCEDURE_RULES).sort()).toEqual(PROCEDURES.map((p) => p.code).sort());
  });

  it("matches the specified requirements and limits", () => {
    const conservative = Object.entries(PROCEDURE_RULES).filter(([, r]) => r.requiresConservativeTreatment).map(([c]) => c).sort();
    const notes = Object.entries(PROCEDURE_RULES).filter(([, r]) => r.requiresClinicalNotes).map(([c]) => c).sort();
    expect(conservative).toEqual(["27447", "64483", "72148"]);
    expect(notes).toEqual(["27447", "70553", "73721", "93458", "97110"]);
    for (const [code, r] of Object.entries(PROCEDURE_RULES)) expect(r.maxUnits).toBe(code === "97110" ? 12 : 1);
  });

  it("allows every procedure/diagnosis pair used in prisma/seed.ts", () => {
    const seedPairs: [string, string][] = [
      ["72148", "M54.16"], ["73721", "M17.11"], ["70553", "G43.909"], ["43239", "K21.9"],
      ["93458", "I25.10"], ["27447", "M17.11"], ["97110", "M54.50"], ["64483", "M54.16"],
    ];
    for (const [procedureCode, diagnosisCode] of seedPairs) {
      expect(run({ procedureCode, diagnosisCode }).kind, `${procedureCode} + ${diagnosisCode}`).toBe("APPROVED");
    }
  });

  it("supports every catalog diagnosis with at least one procedure", () => {
    for (const d of DIAGNOSES) {
      const ok = Object.values(PROCEDURE_RULES).some((r) =>
        r.allowedDiagnosisPrefixes.some((p) => normalizeDiagnosis(d.code).startsWith(p)),
      );
      expect(ok, d.code).toBe(true);
    }
  });
});

describe("evaluateRequest: APPROVED", () => {
  it("approves a complete, covered request for the requested units", () => {
    expect(run()).toEqual({ kind: "APPROVED", unitsApproved: 1 });
    expect(run({ procedureCode: "97110", diagnosisCode: "M54.50", units: 12 })).toEqual({ kind: "APPROVED", unitsApproved: 12 });
  });

  it("accepts a service date of today", () => {
    expect(run({ serviceDate: TODAY }).kind).toBe("APPROVED");
  });
});

describe("evaluateRequest: REJECTED (each rule, code, loop and text)", () => {
  const cases: [string, Partial<PayerRequest>, string, string, string][] = [
    ["missing payer id", { payerId: "" }, "79", "payer", "Payer id is missing"],
    ["unknown payer id", { payerId: "OTHERPAYR" }, "79", "payer", "Payer id OTHERPAYR is not handled by this payer"],
    ["missing member id", { memberId: " " }, "72", "subscriber", "Member id is missing"],
    ["member not in roster", { memberId: "W000000000" }, "75", "subscriber", "Member id W000000000 not found"],
    ["missing NPI", { providerNpi: undefined }, "43", "requester", "Requesting provider NPI is missing"],
    ["NPI with bad check digit", { providerNpi: "1234567890" }, "43", "requester", "Requesting provider NPI 1234567890 is not a valid NPI"],
    ["NPI wrong length", { providerNpi: "12345" }, "43", "requester", "Requesting provider NPI 12345 is not a valid NPI"],
    ["missing service date", { serviceDate: undefined }, "57", "event", "Service date is missing"],
    ["malformed service date", { serviceDate: "20260230" }, "57", "event", "Service date 20260230 is not a valid CCYYMMDD date"],
    ["service date before today", { serviceDate: "20261113" }, "56", "event", "Service date 20261113 is before today (20261114); retroactive requests are not accepted"],
    ["missing diagnosis", { diagnosisCode: "" }, "AF", "event", "Diagnosis code is missing"],
    ["malformed diagnosis", { diagnosisCode: "12.3" }, "AF", "event", "Diagnosis code 12.3 is not a valid ICD-10 code"],
    ["missing procedure", { procedureCode: undefined }, "AG", "service", "Procedure code is missing"],
    ["unknown procedure", { procedureCode: "99213" }, "AG", "service", "Procedure code 99213 is not covered by this payer's review rules"],
    ["missing units", { units: undefined }, "15", "service", "Unit count is missing"],
    ["zero units", { units: 0 }, "33", "service", "Unit count 0 must be a whole number of at least 1"],
    ["fractional units", { units: 1.5 }, "33", "service", "Unit count 1.5 must be a whole number of at least 1"],
  ];

  for (const [label, request, code, loop, text] of cases) {
    it(label, () => {
      expect(run(request)).toEqual({ kind: "REJECTED", errors: [{ code, loop, text }] });
    });
  }

  it("reports only the first failing rule, in loop order", () => {
    const d = run({ memberId: "W000000000", providerNpi: "1", serviceDate: "20200101", procedureCode: "99999" });
    expect(d).toMatchObject({ kind: "REJECTED", errors: [{ code: "75" }] });
    expect(d.kind === "REJECTED" && d.errors).toHaveLength(1);
  });

  it("throws on a malformed 'today' instead of guessing", () => {
    expect(() => run({}, {}, { today: "2026-11-14" })).toThrow(/today must be a CCYYMMDD date/);
  });
});

describe("evaluateRequest: PENDED", () => {
  it("pends when clinical notes are required and not attached", () => {
    expect(run({}, { clinicalNotesAttached: false })).toEqual({
      kind: "PENDED",
      reason: "Clinical notes required for 73721 (MRI knee)",
    });
  });

  it("does not pend procedures that don't require notes", () => {
    expect(run({ procedureCode: "43239", diagnosisCode: "K21.9" }, { clinicalNotesAttached: false }).kind).toBe("APPROVED");
  });
});

describe("evaluateRequest: DENIED", () => {
  it("denies when coverage is inactive", () => {
    expect(run({ memberId: "W999999999" })).toEqual({
      kind: "DENIED",
      reason: "Coverage inactive for member W999999999",
    });
  });

  it("denies when the diagnosis doesn't support the procedure", () => {
    expect(run({ diagnosisCode: "K21.9" })).toEqual({
      kind: "DENIED",
      reason: "Medical necessity not established - diagnosis K21.9 is not supported for 73721 (MRI knee); allowed diagnosis groups M17, M25",
    });
  });

  it("denies when required conservative treatment isn't documented", () => {
    expect(run({ procedureCode: "72148", diagnosisCode: "M54.16" }, { conservativeTreatmentDocumented: false })).toEqual({
      kind: "DENIED",
      reason: "Conservative treatment not documented; required for 72148 (MRI lumbar spine)",
    });
  });

  it("checks DENIED rules in fixed order: coverage, then diagnosis, then conservative treatment", () => {
    const allBad = run({ memberId: "W999999999", procedureCode: "27447", diagnosisCode: "K21.9" }, { conservativeTreatmentDocumented: false });
    expect(allBad).toMatchObject({ kind: "DENIED", reason: expect.stringMatching(/^Coverage inactive/) });
    const dxAndConservative = run({ procedureCode: "27447", diagnosisCode: "K21.9" }, { conservativeTreatmentDocumented: false });
    expect(dxAndConservative).toMatchObject({ kind: "DENIED", reason: expect.stringMatching(/^Medical necessity not established/) });
  });
});

describe("evaluateRequest: PARTIAL", () => {
  it("approves up to the plan limit when units exceed it", () => {
    expect(run({ procedureCode: "97110", diagnosisCode: "M54.50", units: 20 })).toEqual({
      kind: "PARTIAL",
      unitsApproved: 12,
      reason: "Plan limit is 12 units; 20 requested",
    });
  });

  it("uses the singular for a 1-unit limit", () => {
    expect(run({ units: 3 })).toEqual({ kind: "PARTIAL", unitsApproved: 1, reason: "Plan limit is 1 unit; 3 requested" });
  });
});

describe("evaluateRequest: strict priority between categories", () => {
  it("REJECTED beats PENDED (missing member AND missing notes)", () => {
    expect(run({ memberId: "W000000000" }, { clinicalNotesAttached: false }).kind).toBe("REJECTED");
  });

  it("PENDED beats DENIED (missing notes AND wrong diagnosis)", () => {
    expect(run({ diagnosisCode: "K21.9" }, { clinicalNotesAttached: false }).kind).toBe("PENDED");
  });

  it("PENDED beats DENIED for inactive coverage too (as specified)", () => {
    expect(run({ memberId: "W999999999" }, { clinicalNotesAttached: false }).kind).toBe("PENDED");
  });

  it("DENIED beats PARTIAL (wrong diagnosis AND over-limit units)", () => {
    expect(run({ diagnosisCode: "K21.9", units: 5 }).kind).toBe("DENIED");
  });
});

describe("diagnosis codes with or without the decimal point", () => {
  it.each(["M17.11", "M1711", "m17.11", " M17.11 "])("treats %j the same", (dx) => {
    expect(run({ diagnosisCode: dx }).kind).toBe("APPROVED");
  });

  it.each(["K21.9", "K219"])("denies %j for a knee MRI either way", (dx) => {
    expect(run({ diagnosisCode: dx }).kind).toBe("DENIED");
  });

  it("normalizes to uppercase without dots", () => {
    expect(normalizeDiagnosis(" g43.909 ")).toBe("G43909");
  });
});

describe("isValidNpi", () => {
  it("accepts the seeded NPIs and rejects bad check digits", () => {
    for (const npi of ["1234567893", "1245319599", "1679576722"]) expect(isValidNpi(npi)).toBe(true);
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidNpi("123456789A")).toBe(false);
  });
});
