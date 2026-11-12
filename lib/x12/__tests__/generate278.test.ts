import { describe, expect, it } from "vitest";
import { generate278Request, sanitizeElement, type Generate278Input } from "@/lib/x12/generate278";
import { ISA_LENGTH, parse278 } from "@/lib/x12/parse278";
import { build278Input } from "@/lib/x12/from-request";

const baseInput: Generate278Input = {
  controlNumber: 42,
  createdAt: new Date("2026-11-11T14:05:00Z"),
  requestReference: "cmtestrequest0001",
  sender: { id: "DEMOHOSP1" },
  payer: { name: "ACME Health Plan", payerId: "SIMACME01" },
  provider: { firstName: "Jane", lastName: "Smith", npi: "1234567893" },
  patient: {
    firstName: "John",
    lastName: "Doe",
    memberId: "W123456789",
    dob: new Date("1980-01-15T00:00:00Z"),
    gender: "M",
  },
  service: {
    diagnosisCode: "M54.16",
    procedureCode: "97110",
    units: 12,
    serviceDate: new Date("2026-11-25T00:00:00Z"),
  },
};

const lines = (edi: string) => edi.split("\n");

describe("generate278Request", () => {
  const edi = generate278Request(baseInput);
  const parsed = parse278(edi);

  it("produces a file that passes the parser's validation", () => {
    expect(parsed.errors).toEqual([]);
  });

  it("puts one segment per line, each ending with the terminator", () => {
    for (const line of lines(edi)) expect(line).toMatch(/^[A-Z][A-Z0-9]{1,2}\*.*~$/);
    expect(lines(edi)[0].startsWith("ISA*")).toBe(true);
    expect(lines(edi).at(-1)).toBe("IEA*1*000000042~");
  });

  it("writes an ISA segment of exactly 106 characters with the declared delimiters", () => {
    const isa = lines(edi)[0];
    expect(isa).toHaveLength(ISA_LENGTH);
    expect(isa[3]).toBe("*");
    expect(isa[104]).toBe(":");
    expect(isa[105]).toBe("~");
    expect(parsed.interchange.usage).toBe("T");
  });

  it("sets SE01 to the real number of segments from ST to SE", () => {
    const all = lines(edi);
    const st = all.findIndex((l) => l.startsWith("ST*"));
    const se = all.findIndex((l) => l.startsWith("SE*"));
    const realCount = se - st + 1;
    expect(all[se]).toBe(`SE*${realCount}*0042~`);
    expect(parsed.transaction?.declaredSegmentCount).toBe(realCount);
  });

  it("uses matching control numbers in each envelope pair", () => {
    expect(parsed.interchange.controlNumber).toBe("000000042");
    expect(lines(edi).at(-1)).toContain("*000000042~"); // IEA02
    expect(parsed.group?.controlNumber).toBe("42");
    expect(lines(edi).at(-2)).toBe("GE*1*42~");
    expect(parsed.transaction?.controlNumber).toBe("0042");
  });

  it("keeps HL ids and parent ids consistent", () => {
    expect(parsed.loops.map((l) => [l.id, l.parentId, l.levelCode, l.hasChildren])).toEqual([
      ["1", null, "20", true],
      ["2", "1", "21", true],
      ["3", "2", "22", true],
      ["4", "3", "EV", true],
      ["5", "4", "SS", false],
    ]);
  });

  it("strips the decimal point from ICD-10 codes", () => {
    expect(edi).toContain("HI*ABK:M5416~");
    expect(edi).not.toContain("M54.16");
    expect(parsed.event?.diagnoses).toEqual([{ qualifier: "ABK", code: "M5416" }]);
  });

  it("round-trips the request data through the parser", () => {
    expect(parsed.subscriber).toMatchObject({
      lastName: "DOE",
      firstName: "JOHN",
      memberId: "W123456789",
      dob: "19800115",
      gender: "M",
    });
    expect(parsed.requester).toMatchObject({ lastName: "SMITH", firstName: "JANE", idQualifier: "XX", id: "1234567893" });
    expect(parsed.payer).toMatchObject({ name: "ACME HEALTH PLAN", idQualifier: "PI", id: "SIMACME01" });
    expect(parsed.event?.serviceDate).toBe("20261125");
    expect(parsed.services).toEqual([
      {
        traceNumber: "cmtestrequest0001-SV1",
        procedureQualifier: "HC",
        procedureCode: "97110",
        unitBasis: "UN",
        units: 12,
        serviceDate: "20261125",
      },
    ]);
    expect(parsed.bht).toMatchObject({ structure: "0007", purpose: "13", reference: "cmtestrequest0001", date: "20261111", time: "1405" });
  });

  it("writes units as SV103 'UN' + SV104 count", () => {
    expect(edi).toContain("SV1*HC:97110**UN*12~");
  });

  it("is deterministic for the same input", () => {
    expect(generate278Request(baseInput)).toBe(edi);
  });

  it("sanitizes values containing separator characters instead of breaking the file", () => {
    const nasty = generate278Request({
      ...baseInput,
      patient: { ...baseInput.patient, lastName: "O*Brien~Smith", firstName: "Ann:Marie^" },
      payer: { ...baseInput.payer, name: "Evil*Payer~Inc" },
    });
    const p = parse278(nasty);
    expect(p.errors).toEqual([]);
    expect(p.subscriber?.lastName).toBe("O BRIEN SMITH");
    expect(p.subscriber?.firstName).toBe("ANN MARIE");
    expect(p.payer?.name).toBe("EVIL PAYER INC");
    expect(lines(nasty)).toHaveLength(lines(edi).length);
    expect(sanitizeElement("a*b:c~d^e\nf")).toBe("a b c d e f");
  });

  it("rejects inputs that cannot be encoded", () => {
    expect(() => generate278Request({ ...baseInput, controlNumber: 0 })).toThrow(/controlNumber/);
    expect(() => generate278Request({ ...baseInput, controlNumber: 1_000_000_000 })).toThrow(/controlNumber/);
    expect(() => generate278Request({ ...baseInput, service: { ...baseInput.service, units: 0 } })).toThrow(/units/);
    expect(() =>
      generate278Request({ ...baseInput, sender: { id: "WAY-TOO-LONG-SENDER-ID" } }),
    ).toThrow(/ISA06/);
  });
});

describe("parse278 validation", () => {
  const edi = generate278Request(baseInput);

  it("reports an SE01 count mismatch", () => {
    const broken = edi.replace(/^SE\*\d+\*/m, "SE*99*");
    expect(parse278(broken).errors).toContainEqual(expect.stringMatching(/SE01 says 99/));
  });

  it("reports mismatched envelope control numbers", () => {
    const broken = edi.replace("IEA*1*000000042~", "IEA*1*000000043~").replace("GE*1*42~", "GE*1*41~");
    const errors = parse278(broken).errors;
    expect(errors).toContainEqual(expect.stringMatching(/IEA02 .* ISA13/));
    expect(errors).toContainEqual(expect.stringMatching(/GE02 .* GS06/));
  });

  it("reports an HL that points at a missing parent", () => {
    const broken = edi.replace("HL*5*4*SS*0~", "HL*5*9*SS*0~");
    expect(parse278(broken).errors).toContainEqual(expect.stringMatching(/HL 5 references parent 9/));
  });

  it("reads delimiters from the ISA segment rather than assuming them", () => {
    const alt = edi.replaceAll("*", "|").replaceAll("~", "'");
    const p = parse278(alt);
    expect(p.delimiters).toEqual({ element: "|", component: ":", segment: "'" });
    expect(p.errors).toEqual([]);
    expect(p.subscriber?.memberId).toBe("W123456789");
  });
});

describe("build278Input", () => {
  it("maps a stored request to generator input with the simulated payer id", () => {
    const input = build278Input({
      id: "req1",
      controlNumber: 7,
      createdAt: new Date("2026-11-01T09:30:00Z"),
      providerName: "Priya Patel",
      providerNpi: "1679576722",
      diagnosisCode: "I25.10",
      procedureCode: "93458",
      unitsRequested: 1,
      serviceDate: new Date("2026-11-20T00:00:00Z"),
      patient: {
        firstName: "Robert",
        lastName: "Chen",
        memberId: "W323456781",
        dob: new Date("1962-11-23T00:00:00Z"),
        gender: "M",
        payerName: "Summit Insurance",
      },
    });
    expect(input.payer).toEqual({ name: "Summit Insurance", payerId: "SIMSUMMT2" });
    expect(input.provider).toEqual({ firstName: "Priya", lastName: "Patel", npi: "1679576722" });
    expect(parse278(generate278Request(input)).errors).toEqual([]);
  });

  it("fails clearly for a payer without a simulated payer id", () => {
    expect(() =>
      build278Input({
        id: "r", controlNumber: 1, createdAt: new Date(), providerName: "A B", providerNpi: "1",
        diagnosisCode: "x", procedureCode: "y", unitsRequested: 1, serviceDate: new Date(),
        patient: { firstName: "a", lastName: "b", memberId: "m", dob: new Date(), gender: "F", payerName: "Unknown Payer" },
      }),
    ).toThrow(/No simulated payer id/);
  });
});
