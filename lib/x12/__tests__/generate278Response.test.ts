import { describe, expect, it } from "vitest";
import { evaluateRequest, payerRequestFromParsed, type Decision } from "@/lib/payer/rules";
import { generate278Request, type Generate278Input } from "@/lib/x12/generate278";
import { generate278Response } from "@/lib/x12/generate278Response";
import { ISA_LENGTH, parse278 } from "@/lib/x12/parse278";
import { parse278Response } from "@/lib/x12/parse278Response";

const requestInput: Generate278Input = {
  controlNumber: 42,
  createdAt: new Date("2026-11-14T09:00:00Z"),
  requestReference: "cmreq0001",
  sender: { id: "DEMOHOSP1" },
  payer: { name: "ACME Health Plan", payerId: "SIMACME01" },
  provider: { firstName: "Jane", lastName: "Smith", npi: "1234567893" },
  patient: { firstName: "John", lastName: "Doe", memberId: "W123456789", dob: new Date("1980-01-15T00:00:00Z"), gender: "M" },
  service: { diagnosisCode: "M54.50", procedureCode: "97110", units: 20, serviceDate: new Date("2026-11-20T00:00:00Z") },
};
const request = parse278(generate278Request(requestInput));
const respondedAt = new Date("2026-11-14T09:05:00Z");

const DECISIONS: Record<string, { decision: Decision; auth?: string; outcome: string }> = {
  APPROVED: { decision: { kind: "APPROVED", unitsApproved: 20 }, auth: "AUTH0001", outcome: "APPROVED" },
  PARTIAL: { decision: { kind: "PARTIAL", unitsApproved: 12, reason: "Plan limit is 12 units; 20 requested" }, auth: "AUTH0002", outcome: "PARTIALLY_APPROVED" },
  DENIED: { decision: { kind: "DENIED", reason: "Medical necessity not established" }, outcome: "DENIED" },
  PENDED: { decision: { kind: "PENDED", reason: "Clinical notes required for 97110 (Physical therapy, per visit)" }, outcome: "PENDED" },
  REJECTED: {
    decision: { kind: "REJECTED", errors: [{ code: "75", text: "Member id W123456789 not found", loop: "subscriber" }] },
    outcome: "REJECTED",
  },
};

const respond = (decision: Decision, auth?: string, controlNumber = 7001) =>
  generate278Response({ request, decision, authorizationNumber: auth, controlNumber, respondedAt });

describe("generate278Response: every outcome", () => {
  for (const [name, { decision, auth, outcome }] of Object.entries(DECISIONS)) {
    describe(name, () => {
      const edi = respond(decision, auth);
      const lines = edi.split("\n");
      const parsed = parse278Response(edi);

      it("passes the parser's validation", () => {
        expect(parsed.errors).toEqual([]);
      });

      it("round-trips outcome, reason, authorization number and units", () => {
        expect(parsed.outcome).toBe(outcome);
        expect(parsed.purpose).toBe("11");
        if (decision.kind === "REJECTED") {
          expect(parsed.reason).toBe(decision.errors.map((e) => e.text).join("; "));
          expect(parsed.rejections).toEqual([
            { code: "75", text: "Subscriber/insured not found", followUp: "C", loop: "subscriber" },
          ]);
        } else if (decision.kind === "APPROVED") {
          expect(parsed.reason).toBeUndefined();
        } else {
          expect(parsed.reason).toBe(decision.reason);
        }
        expect(parsed.authorizationNumber).toBe(auth);
        expect(parsed.unitsApproved).toBe(
          decision.kind === "APPROVED" || decision.kind === "PARTIAL" ? decision.unitsApproved : undefined,
        );
      });

      it("has a 106-character ISA, matching envelopes and a correct SE01", () => {
        expect(lines[0]).toHaveLength(ISA_LENGTH);
        expect(lines[0].split("*")[13]).toBe("000007001");
        expect(lines.at(-1)).toBe("IEA*1*000007001~");
        expect(lines.at(-2)).toBe("GE*1*7001~");
        const st = lines.findIndex((l) => l.startsWith("ST*"));
        const se = lines.findIndex((l) => l.startsWith("SE*"));
        expect(lines[st]).toBe("ST*278*7001*005010X217~");
        expect(lines[se]).toBe(`SE*${se - st + 1}*7001~`);
      });

      it("is deterministic", () => {
        expect(respond(decision, auth)).toBe(edi);
      });

      it("keeps the request's HL hierarchy", () => {
        expect(parsed.parsed.loops.map((l) => `${l.id}/${l.parentId ?? ""}/${l.levelCode}/${l.hasChildren ? 1 : 0}`)).toEqual([
          "1//20/1", "2/1/21/1", "3/2/22/1", "4/3/EV/1", "5/4/SS/0",
        ]);
      });
    });
  }

  it("uses action codes A1, A2, A3, A4 and no HCR for rejections", () => {
    const hcr = (k: string) => respond(DECISIONS[k].decision, DECISIONS[k].auth).split("\n").find((l) => l.startsWith("HCR*"));
    expect(hcr("APPROVED")).toBe("HCR*A1*AUTH0001~");
    expect(hcr("PARTIAL")).toBe("HCR*A2*AUTH0002~");
    expect(hcr("DENIED")).toBe("HCR*A3~");
    expect(hcr("PENDED")).toBe("HCR*A4~");
    expect(hcr("REJECTED")).toBeUndefined();
  });

  it("puts approved units in SV1 with the UN + quantity layout", () => {
    expect(respond(DECISIONS.PARTIAL.decision, "AUTH0002")).toContain("SV1*HC:97110**UN*12~");
    // non-certified outcomes echo the requested line unchanged
    expect(respond(DECISIONS.DENIED.decision)).toContain("SV1*HC:97110**UN*20~");
  });
});

describe("generate278Response: envelope details", () => {
  const edi = respond(DECISIONS.APPROVED.decision, "AUTH0001");
  const p = parse278Response(edi).parsed;

  it("reverses sender and receiver", () => {
    expect(p.interchange.senderId).toBe("SIMACME01");
    expect(p.interchange.receiverId).toBe("DEMOHOSP1");
    expect(p.group?.senderId).toBe("SIMACME01");
    expect(p.group?.receiverId).toBe("DEMOHOSP1");
    expect(p.interchange.usage).toBe("T");
  });

  it("uses the response time, echoes the request reference, and references the request traces", () => {
    expect(edi).toContain("BHT*0007*11*cmreq0001*20261114*0905~");
    expect(edi).toContain("TRN*2*cmreq0001-EV*9DEMOHOSP1~");
    expect(edi).toContain("TRN*2*cmreq0001-SV1*9DEMOHOSP1~");
  });

  it("changes when the control number changes", () => {
    expect(respond(DECISIONS.APPROVED.decision, "AUTH0001", 7002)).not.toBe(edi);
  });

  it("requires an authorization number for certified outcomes", () => {
    expect(() => respond(DECISIONS.APPROVED.decision)).toThrow(/authorization number/);
    expect(() => respond(DECISIONS.PARTIAL.decision, "   ")).toThrow(/authorization number/);
  });
});

describe("generate278Response: AAA placement", () => {
  const loops = [
    ["payer", "20", "79"],
    ["requester", "21", "43"],
    ["subscriber", "22", "75"],
    ["event", "EV", "56"],
    ["service", "SS", "AG"],
  ] as const;

  for (const [loop, level, code] of loops) {
    it(`puts a ${loop} rejection in HL ${level}`, () => {
      const edi = respond({ kind: "REJECTED", errors: [{ code, text: `${loop} problem`, loop }] });
      const parsed = parse278Response(edi);
      expect(parsed.errors).toEqual([]);
      const hl = parsed.parsed.loops.find((l) => l.levelCode === level)!;
      expect(hl.segments).toContainEqual(["AAA", "N", "", code, "C"]);
      expect(parsed.rejections.map((r) => r.loop)).toEqual([loop]);
    });
  }

  it("emits one AAA per rejection when several are given", () => {
    const parsed = parse278Response(
      respond({
        kind: "REJECTED",
        errors: [
          { code: "75", text: "a", loop: "subscriber" },
          { code: "AG", text: "b", loop: "service" },
        ],
      }),
    );
    expect(parsed.rejections.map((r) => [r.code, r.loop])).toEqual([["75", "subscriber"], ["AG", "service"]]);
    expect(parsed.reason).toBe("a; b");
  });
});

describe("generate278Response: sanitizing", () => {
  it("does not let '*' or '~' in a reason or authorization number break the file", () => {
    const edi = respond(
      { kind: "PARTIAL", unitsApproved: 12, reason: "Limit*12~units: see policy^A" },
      "AU*TH~1",
    );
    const parsed = parse278Response(edi);
    expect(parsed.errors).toEqual([]);
    expect(parsed.reason).toBe("Limit 12 units see policy A");
    expect(parsed.authorizationNumber).toBe("AU TH 1");
    expect(edi.split("\n")).toHaveLength(respond(DECISIONS.PARTIAL.decision, "AUTH0002").split("\n").length);
  });

  it("round-trips every reason text the payer rules can produce, unchanged", () => {
    const base = payerRequestFromParsed(request);
    const roster = { W123456789: { active: true }, W999999999: { active: false } };
    const docs = { clinicalNotesAttached: true, conservativeTreatmentDocumented: true };
    const variants: [Partial<typeof base>, Partial<typeof docs>][] = [
      [{ payerId: "OTHERPAYR" }, {}], [{ payerId: undefined }, {}], [{ memberId: undefined }, {}],
      [{ memberId: "W000000000" }, {}], [{ providerNpi: undefined }, {}], [{ providerNpi: "1234567890" }, {}],
      [{ serviceDate: undefined }, {}], [{ serviceDate: "20260230" }, {}], [{ serviceDate: "20261101" }, {}],
      [{ diagnosisCode: undefined }, {}], [{ diagnosisCode: "12.3" }, {}], [{ procedureCode: undefined }, {}],
      [{ procedureCode: "99213" }, {}], [{ units: undefined }, {}], [{ units: 0 }, {}],
      [{}, { clinicalNotesAttached: false }], [{ memberId: "W999999999" }, {}],
      [{ diagnosisCode: "K21.9" }, {}], [{ procedureCode: "72148", diagnosisCode: "M54.16" }, { conservativeTreatmentDocumented: false }],
      [{}, {}], [{ units: 10 }, {}], [{ units: 5, procedureCode: "73721", diagnosisCode: "M17.11" }, {}],
    ];
    const kinds = new Set<string>();
    for (const [req, att] of variants) {
      const decision = evaluateRequest({ request: { ...base, ...req }, attachments: { ...docs, ...att }, roster, today: "20261114" });
      kinds.add(decision.kind);
      const expected =
        decision.kind === "REJECTED" ? decision.errors.map((e) => e.text).join("; ") : decision.kind === "APPROVED" ? undefined : decision.reason;
      const parsed = parse278Response(generate278Response({ request, decision, authorizationNumber: "AUTH1", controlNumber: 1, respondedAt }));
      expect(parsed.errors, JSON.stringify(decision)).toEqual([]);
      expect(parsed.reason, JSON.stringify(decision)).toBe(expected);
    }
    expect([...kinds].sort()).toEqual(["APPROVED", "DENIED", "PARTIAL", "PENDED", "REJECTED"]);
  });

  it("truncates MSG text to the X12 maximum of 264 characters", () => {
    const parsed = parse278Response(respond({ kind: "DENIED", reason: "x".repeat(400) }));
    expect(parsed.reason).toHaveLength(264);
  });

  it("re-delimits a request that used different separators", () => {
    const alt = parse278(generate278Request(requestInput).replaceAll("*", "|"));
    const edi = generate278Response({ request: alt, decision: { kind: "DENIED", reason: "No" }, controlNumber: 9, respondedAt });
    expect(edi).not.toContain("|");
    expect(parse278Response(edi).errors).toEqual([]);
  });
});

describe("end to end: request -> payer decision -> response -> parsed outcome", () => {
  it("partially approves 20 PT visits to the plan limit", () => {
    const decision = evaluateRequest({
      request: payerRequestFromParsed(request),
      attachments: { clinicalNotesAttached: true, conservativeTreatmentDocumented: true },
      roster: { W123456789: { active: true } },
      today: "20261114",
    });
    expect(decision).toEqual({ kind: "PARTIAL", unitsApproved: 12, reason: "Plan limit is 12 units; 20 requested" });
    const parsed = parse278Response(generate278Response({ request, decision, authorizationNumber: "SIM-0001", controlNumber: 1, respondedAt }));
    expect(parsed).toMatchObject({
      outcome: "PARTIALLY_APPROVED",
      reason: "Plan limit is 12 units; 20 requested",
      authorizationNumber: "SIM-0001",
      unitsApproved: 12,
      errors: [],
    });
  });

  it("maps a parsed request to payer input, with the diagnosis decimal removed", () => {
    expect(payerRequestFromParsed(request)).toEqual({
      payerId: "SIMACME01",
      memberId: "W123456789",
      providerNpi: "1234567893",
      diagnosisCode: "M5450",
      procedureCode: "97110",
      units: 20,
      serviceDate: "20261120",
    });
  });
});

describe("parse278Response: problems", () => {
  it("flags a request (BHT02 13) passed as a response", () => {
    expect(parse278Response(generate278Request(requestInput)).errors).toContainEqual(expect.stringMatching(/BHT02 is 13/));
  });

  it("flags an unknown HCR action code", () => {
    const edi = respond(DECISIONS.DENIED.decision).replace("HCR*A3~", "HCR*ZZ~");
    expect(parse278Response(edi).errors).toContainEqual("Unsupported HCR01 action code ZZ");
  });
});
