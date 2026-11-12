// Small X12 278 parser: splits an interchange into segments using the delimiters
// declared in its own ISA segment, validates the envelopes and HL tree, and
// extracts the request loops produced by generate278Request.
//
// Used for round-trip tests now; the generic `segments` and `loops` output is
// meant to be reused for parsing (simulated) payer responses later.

export type Delimiters = { element: string; component: string; segment: string };

export type HlLoop = {
  id: string;
  parentId: string | null;
  levelCode: string;
  hasChildren: boolean;
  /** Segments after this HL, up to the next HL or SE (element arrays) */
  segments: string[][];
};

export type Parsed278 = {
  delimiters: Delimiters;
  /** Every segment as an array of elements; index 0 is the segment id */
  segments: string[][];
  interchange: {
    senderId: string;
    receiverId: string;
    date: string;
    time: string;
    controlNumber: string;
    usage: string;
  };
  group?: { functionalId: string; senderId: string; receiverId: string; controlNumber: string; version: string };
  transaction?: { type: string; controlNumber: string; declaredSegmentCount: number; actualSegmentCount: number };
  bht?: { structure: string; purpose: string; reference: string; date: string; time: string };
  loops: HlLoop[];
  payer?: { name: string; idQualifier: string; id: string };
  requester?: { lastName: string; firstName: string; idQualifier: string; id: string };
  subscriber?: { lastName: string; firstName: string; memberId: string; dob?: string; gender?: string };
  event?: {
    traceNumber?: string;
    requestCategory?: string;
    certificationType?: string;
    serviceType?: string;
    placeOfService?: string;
    serviceDate?: string;
    diagnoses: { qualifier: string; code: string }[];
  };
  services: {
    traceNumber?: string;
    procedureQualifier: string;
    procedureCode: string;
    unitBasis?: string;
    units?: number;
    serviceDate?: string;
  }[];
  errors: string[];
};

export class X12ParseError extends Error {}

/** The ISA segment is fixed width: 106 characters including the segment terminator. */
export const ISA_LENGTH = 106;

export function readDelimiters(text: string): Delimiters {
  const t = text.trimStart();
  if (!t.startsWith("ISA")) throw new X12ParseError("Interchange must start with an ISA segment");
  if (t.length < ISA_LENGTH) throw new X12ParseError("Text is too short to contain an ISA segment");
  return { element: t[3], component: t[104], segment: t[105] };
}

export function parse278(text: string): Parsed278 {
  const raw = text.trimStart();
  const delimiters = readDelimiters(raw);
  const { element: E, component: C, segment: T } = delimiters;
  const errors: string[] = [];

  // Line breaks between segments are allowed for readability; trim them off
  const segments = raw
    .split(T)
    .map((s) => s.replace(/^[\r\n]+|[\r\n]+$/g, ""))
    .filter((s) => s.trim() !== "")
    .map((s) => s.split(E));

  const isaText = raw.slice(0, raw.indexOf(T) + 1);
  if (isaText.length !== ISA_LENGTH) {
    errors.push(`ISA segment is ${isaText.length} characters, expected ${ISA_LENGTH}`);
  }

  const isa = segments[0];
  if (isa.length !== 17) errors.push(`ISA has ${isa.length - 1} elements, expected 16`);
  const interchange = {
    senderId: (isa[6] ?? "").trim(),
    receiverId: (isa[8] ?? "").trim(),
    date: isa[9] ?? "",
    time: isa[10] ?? "",
    controlNumber: isa[13] ?? "",
    usage: isa[15] ?? "",
  };

  const ids = segments.map((s) => s[0]);
  const count = (id: string) => ids.filter((x) => x === id).length;

  // Interchange envelope
  const iea = segments.at(-1);
  if (!iea || iea[0] !== "IEA") {
    errors.push("Interchange must end with an IEA segment");
  } else {
    if (iea[2] !== interchange.controlNumber) {
      errors.push(`IEA02 (${iea[2]}) does not match ISA13 (${interchange.controlNumber})`);
    }
    if (Number(iea[1]) !== count("GS")) {
      errors.push(`IEA01 says ${iea[1]} functional group(s), found ${count("GS")}`);
    }
  }

  // Functional group envelope (this parser expects one group with one transaction)
  const gsIdx = ids.indexOf("GS");
  const geIdx = ids.lastIndexOf("GE");
  let group: Parsed278["group"];
  if (gsIdx === -1 || geIdx === -1) {
    errors.push("Missing GS/GE functional group envelope");
  } else {
    const gs = segments[gsIdx];
    const ge = segments[geIdx];
    group = { functionalId: gs[1], senderId: gs[2], receiverId: gs[3], controlNumber: gs[6], version: gs[8] };
    if (ge[2] !== gs[6]) errors.push(`GE02 (${ge[2]}) does not match GS06 (${gs[6]})`);
    const stInGroup = ids.slice(gsIdx, geIdx).filter((x) => x === "ST").length;
    if (Number(ge[1]) !== stInGroup) {
      errors.push(`GE01 says ${ge[1]} transaction set(s), found ${stInGroup}`);
    }
  }

  // Transaction set envelope + SE01 count
  const stIdx = ids.indexOf("ST");
  const seIdx = ids.indexOf("SE");
  let transaction: Parsed278["transaction"];
  if (stIdx === -1 || seIdx === -1 || seIdx < stIdx) {
    errors.push("Missing ST/SE transaction set envelope");
  } else {
    const st = segments[stIdx];
    const se = segments[seIdx];
    const actual = seIdx - stIdx + 1;
    transaction = {
      type: st[1],
      controlNumber: st[2],
      declaredSegmentCount: Number(se[1]),
      actualSegmentCount: actual,
    };
    if (se[2] !== st[2]) errors.push(`SE02 (${se[2]}) does not match ST02 (${st[2]})`);
    if (Number(se[1]) !== actual) {
      errors.push(`SE01 says ${se[1]} segments, but ST through SE contains ${actual}`);
    }
    if (st[1] !== "278") errors.push(`ST01 is ${st[1]}, expected 278`);
  }

  // HL tree: ids unique, parents declared earlier, child flags consistent
  const body = stIdx !== -1 && seIdx > stIdx ? segments.slice(stIdx + 1, seIdx) : [];
  const loops: HlLoop[] = [];
  for (const s of body) {
    if (s[0] === "HL") {
      loops.push({
        id: s[1] ?? "",
        parentId: s[2] ? s[2] : null,
        levelCode: s[3] ?? "",
        hasChildren: s[4] === "1",
        segments: [],
      });
    } else if (loops.length > 0) {
      loops[loops.length - 1].segments.push(s);
    }
  }
  const seen = new Set<string>();
  loops.forEach((loop, i) => {
    if (seen.has(loop.id)) errors.push(`HL id ${loop.id} is used more than once`);
    if (loop.id !== String(i + 1)) errors.push(`HL ids should be sequential: expected ${i + 1}, found ${loop.id}`);
    if (i === 0 && loop.parentId !== null) errors.push("The first HL must not have a parent");
    if (i > 0 && (loop.parentId === null || !seen.has(loop.parentId))) {
      errors.push(`HL ${loop.id} references parent ${loop.parentId ?? "(none)"}, which is not an earlier HL`);
    }
    seen.add(loop.id);
  });
  for (const loop of loops) {
    const children = loops.filter((l) => l.parentId === loop.id).length;
    if (loop.hasChildren !== children > 0) {
      errors.push(`HL ${loop.id} child code says ${loop.hasChildren ? "has" : "no"} children, found ${children}`);
    }
  }

  // Structured data for the request loops
  const bhtSeg = segments.find((s) => s[0] === "BHT");
  const bht = bhtSeg && {
    structure: bhtSeg[1],
    purpose: bhtSeg[2],
    reference: bhtSeg[3],
    date: bhtSeg[4],
    time: bhtSeg[5],
  };
  const find = (loop: HlLoop | undefined, id: string, q?: string) =>
    loop?.segments.find((s) => s[0] === id && (q === undefined || s[1] === q));

  const payerLoop = loops.find((l) => l.levelCode === "20");
  const providerLoop = loops.find((l) => l.levelCode === "21");
  const subscriberLoop = loops.find((l) => l.levelCode === "22");
  const eventLoop = loops.find((l) => l.levelCode === "EV");
  const serviceLoops = loops.filter((l) => l.levelCode === "SS");

  const x3 = find(payerLoop, "NM1", "X3");
  const p1 = find(providerLoop, "NM1", "1P");
  const il = find(subscriberLoop, "NM1", "IL");
  const dmg = find(subscriberLoop, "DMG");
  const um = find(eventLoop, "UM");
  const hi = find(eventLoop, "HI");

  const result: Parsed278 = {
    delimiters,
    segments,
    interchange,
    group,
    transaction,
    bht,
    loops,
    payer: x3 && { name: x3[3], idQualifier: x3[8], id: x3[9] },
    requester: p1 && { lastName: p1[3], firstName: p1[4], idQualifier: p1[8], id: p1[9] },
    subscriber: il && { lastName: il[3], firstName: il[4], memberId: il[9], dob: dmg?.[2], gender: dmg?.[3] },
    event: eventLoop && {
      traceNumber: find(eventLoop, "TRN")?.[2],
      requestCategory: um?.[1],
      certificationType: um?.[2],
      serviceType: um?.[3],
      placeOfService: um?.[4]?.split(C)[0],
      serviceDate: find(eventLoop, "DTP")?.[3],
      diagnoses: (hi?.slice(1) ?? [])
        .filter(Boolean)
        .map((el) => {
          const [qualifier, code] = el.split(C);
          return { qualifier, code };
        }),
    },
    services: serviceLoops.map((loop) => {
      const sv1 = find(loop, "SV1");
      const [procedureQualifier = "", procedureCode = ""] = (sv1?.[1] ?? "").split(C);
      return {
        traceNumber: find(loop, "TRN")?.[2],
        procedureQualifier,
        procedureCode,
        unitBasis: sv1?.[3] || undefined,
        units: sv1?.[4] ? Number(sv1[4]) : undefined,
        serviceDate: find(loop, "DTP")?.[3],
      };
    }),
    errors,
  };

  if (!payerLoop || !x3) errors.push("Missing payer loop (HL 20 / NM1*X3)");
  if (!providerLoop || !p1) errors.push("Missing requesting provider loop (HL 21 / NM1*1P)");
  if (!subscriberLoop || !il) errors.push("Missing subscriber loop (HL 22 / NM1*IL)");
  if (!eventLoop) errors.push("Missing patient event loop (HL EV)");
  if (serviceLoops.length === 0) errors.push("Missing service loop (HL SS)");

  return result;
}
