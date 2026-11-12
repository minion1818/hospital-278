import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import type { RequestStatus } from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { generate278Request } from "../lib/x12/generate278";
import { build278Input } from "../lib/x12/from-request";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const HOUR = 3600000;
const DAY = 24 * HOUR;
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY);

/** Date-only values are stored at UTC midnight (see parseIsoDate in lib/validation/request.ts). */
const utcDateFromToday = (d: number) => {
  const t = new Date();
  return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate() + d));
};

const PAYER_ACTOR = "Payer (simulated)";

// Statuses in which the payer has issued a decision
const DECIDED: RequestStatus[] = [
  "APPROVED",
  "PARTIALLY_APPROVED",
  "DENIED",
  "PENDED",
  "REJECTED",
  "SERVICE_COMPLETED",
];

type Service = { diagnosisCode: string; procedureCode: string; label: string };

const SERVICES = {
  lumbarMri: { diagnosisCode: "M54.16", procedureCode: "72148", label: "lumbar MRI" },
  kneeMri: { diagnosisCode: "M17.11", procedureCode: "73721", label: "knee MRI" },
  brainMri: { diagnosisCode: "G43.909", procedureCode: "70553", label: "brain MRI" },
  upperGi: { diagnosisCode: "K21.9", procedureCode: "43239", label: "upper GI endoscopy" },
  cardiacCath: { diagnosisCode: "I25.10", procedureCode: "93458", label: "cardiac catheterization" },
  kneeReplacement: { diagnosisCode: "M17.11", procedureCode: "27447", label: "total knee replacement" },
  physicalTherapy: { diagnosisCode: "M54.50", procedureCode: "97110", label: "physical therapy" },
  epiduralInjection: { diagnosisCode: "M54.16", procedureCode: "64483", label: "epidural steroid injection" },
} satisfies Record<string, Service>;

type SeedRequest = {
  status: RequestStatus;
  patient: number; // index into patientData
  provider: number; // index into providers
  service: Service;
  createdDaysAgo: number;
  serviceInDays: number; // negative = in the past
  unitsRequested?: number;
  unitsApproved?: number;
  clinicalNotesAttached: boolean;
  conservativeTreatmentTried: boolean;
  decisionReason?: string;
};

const REQUESTS: SeedRequest[] = [
  // DRAFT: still being prepared by staff
  { status: "DRAFT", patient: 0, provider: 0, service: SERVICES.lumbarMri, createdDaysAgo: 1, serviceInDays: 14, clinicalNotesAttached: false, conservativeTreatmentTried: true },
  { status: "DRAFT", patient: 3, provider: 2, service: SERVICES.physicalTherapy, createdDaysAgo: 2, serviceInDays: 10, unitsRequested: 12, clinicalNotesAttached: false, conservativeTreatmentTried: false },

  // PENDING_REVIEW: waiting on internal reviewer
  { status: "PENDING_REVIEW", patient: 1, provider: 1, service: SERVICES.kneeMri, createdDaysAgo: 3, serviceInDays: 12, clinicalNotesAttached: true, conservativeTreatmentTried: true },
  { status: "PENDING_REVIEW", patient: 4, provider: 0, service: SERVICES.brainMri, createdDaysAgo: 2, serviceInDays: 9, clinicalNotesAttached: true, conservativeTreatmentTried: false },

  // SUBMITTED: sent to payer, not yet picked up
  { status: "SUBMITTED", patient: 2, provider: 2, service: SERVICES.cardiacCath, createdDaysAgo: 4, serviceInDays: 8, clinicalNotesAttached: true, conservativeTreatmentTried: true },

  // IN_REVIEW: payer is reviewing
  { status: "IN_REVIEW", patient: 5, provider: 1, service: SERVICES.kneeReplacement, createdDaysAgo: 6, serviceInDays: 21, clinicalNotesAttached: true, conservativeTreatmentTried: true },
  { status: "IN_REVIEW", patient: 0, provider: 2, service: SERVICES.upperGi, createdDaysAgo: 5, serviceInDays: 7, clinicalNotesAttached: true, conservativeTreatmentTried: true },

  // APPROVED: units approved = units requested
  { status: "APPROVED", patient: 1, provider: 0, service: SERVICES.lumbarMri, createdDaysAgo: 9, serviceInDays: 4, unitsApproved: 1, clinicalNotesAttached: true, conservativeTreatmentTried: true },
  { status: "APPROVED", patient: 2, provider: 1, service: SERVICES.physicalTherapy, createdDaysAgo: 10, serviceInDays: 3, unitsRequested: 12, unitsApproved: 12, clinicalNotesAttached: true, conservativeTreatmentTried: true },

  // PARTIALLY_APPROVED: fewer units approved than requested
  {
    status: "PARTIALLY_APPROVED", patient: 3, provider: 1, service: SERVICES.physicalTherapy, createdDaysAgo: 11, serviceInDays: 2,
    unitsRequested: 12, unitsApproved: 8, clinicalNotesAttached: true, conservativeTreatmentTried: true,
    decisionReason: "Plan limits initial PT authorization to 8 visits; additional visits require submitted progress notes",
  },
  {
    status: "PARTIALLY_APPROVED", patient: 4, provider: 2, service: SERVICES.epiduralInjection, createdDaysAgo: 8, serviceInDays: 5,
    unitsRequested: 3, unitsApproved: 1, clinicalNotesAttached: true, conservativeTreatmentTried: true,
    decisionReason: "One injection approved; repeat injections require documented 50% or greater pain relief from the first",
  },

  // DENIED
  {
    status: "DENIED", patient: 5, provider: 0, service: SERVICES.brainMri, createdDaysAgo: 12, serviceInDays: 6,
    clinicalNotesAttached: true, conservativeTreatmentTried: true,
    decisionReason: "Medical necessity not established: no red-flag symptoms or neurological deficits documented",
  },
  {
    status: "DENIED", patient: 0, provider: 1, service: SERVICES.kneeReplacement, createdDaysAgo: 14, serviceInDays: 18,
    clinicalNotesAttached: true, conservativeTreatmentTried: false,
    decisionReason: "Conservative treatment not documented: plan requires 3 months of PT, NSAIDs, or injections before arthroplasty",
  },

  // PENDED: missing documentation
  {
    status: "PENDED", patient: 1, provider: 2, service: SERVICES.cardiacCath, createdDaysAgo: 7, serviceInDays: 11,
    clinicalNotesAttached: false, conservativeTreatmentTried: true,
    decisionReason: "Additional information required: recent stress test results and cardiology consult notes",
  },
  {
    status: "PENDED", patient: 2, provider: 0, service: SERVICES.lumbarMri, createdDaysAgo: 6, serviceInDays: 13,
    clinicalNotesAttached: false, conservativeTreatmentTried: true,
    decisionReason: "Additional information required: clinical notes documenting 6 weeks of conservative therapy and neurological exam findings",
  },

  // REJECTED: invalid request data, never clinically reviewed
  {
    status: "REJECTED", patient: 3, provider: 0, service: SERVICES.kneeMri, createdDaysAgo: 5, serviceInDays: 9,
    clinicalNotesAttached: true, conservativeTreatmentTried: true,
    decisionReason: "AAA 75: Subscriber/member ID not found in payer eligibility files",
  },
  {
    status: "REJECTED", patient: 4, provider: 1, service: SERVICES.upperGi, createdDaysAgo: 4, serviceInDays: 10,
    clinicalNotesAttached: true, conservativeTreatmentTried: true,
    decisionReason: "AAA 51: Requesting provider NPI not on file with payer",
  },

  // SERVICE_COMPLETED: approved and the service date has passed
  { status: "SERVICE_COMPLETED", patient: 5, provider: 2, service: SERVICES.upperGi, createdDaysAgo: 25, serviceInDays: -10, unitsApproved: 1, clinicalNotesAttached: true, conservativeTreatmentTried: true },
];

type LogEntry = { actor: string; action: string; details?: string; createdAt: Date };

/** Builds the status history for a request as ordered audit log entries. */
function buildHistory(
  r: SeedRequest,
  createdAt: Date,
  staffName: string,
  reviewerName: string,
  controlNumber: number,
): { logs: LogEntry[]; decisionAt: Date | null } {
  const logs: LogEntry[] = [];
  let t = createdAt.getTime();
  const step = (hours: number) => new Date((t += hours * HOUR));
  const units = r.unitsRequested ?? 1;

  logs.push({ actor: staffName, action: "CREATED", details: `Draft created for ${r.service.label}`, createdAt: new Date(t) });
  if (r.status === "DRAFT") return { logs, decisionAt: null };

  logs.push({ actor: staffName, action: "SUBMITTED_FOR_REVIEW", createdAt: step(3) });
  if (r.status === "PENDING_REVIEW") return { logs, decisionAt: null };

  logs.push({ actor: reviewerName, action: "APPROVED_FOR_SUBMISSION", createdAt: step(5) });
  // Same wording/actor as the APPROVE_AND_SEND transition in lib/workflow.ts
  logs.push({ actor: reviewerName, action: "SUBMITTED_TO_PAYER", details: `278 request transmitted (control number ${controlNumber})`, createdAt: step(0.01) });
  if (r.status === "SUBMITTED") return { logs, decisionAt: null };

  // Rejections happen at intake validation, before clinical review
  if (r.status === "REJECTED") {
    const decisionAt = step(1);
    logs.push({ actor: PAYER_ACTOR, action: "PAYER_REJECTED", details: r.decisionReason, createdAt: decisionAt });
    return { logs, decisionAt };
  }

  logs.push({ actor: PAYER_ACTOR, action: "PAYER_IN_REVIEW", createdAt: step(6) });
  if (r.status === "IN_REVIEW") return { logs, decisionAt: null };

  const decisionAt = step(20);
  switch (r.status) {
    case "APPROVED":
    case "SERVICE_COMPLETED":
      logs.push({ actor: PAYER_ACTOR, action: "PAYER_APPROVED", details: `${r.unitsApproved} of ${units} unit(s) approved`, createdAt: decisionAt });
      break;
    case "PARTIALLY_APPROVED":
      logs.push({ actor: PAYER_ACTOR, action: "PAYER_PARTIALLY_APPROVED", details: `${r.unitsApproved} of ${units} unit(s) approved. ${r.decisionReason}`, createdAt: decisionAt });
      break;
    case "DENIED":
      logs.push({ actor: PAYER_ACTOR, action: "PAYER_DENIED", details: r.decisionReason, createdAt: decisionAt });
      break;
    case "PENDED":
      logs.push({ actor: PAYER_ACTOR, action: "PAYER_PENDED", details: r.decisionReason, createdAt: decisionAt });
      break;
  }

  if (r.status === "SERVICE_COMPLETED") {
    logs.push({ actor: staffName, action: "SERVICE_COMPLETED", details: "Service rendered on authorized date", createdAt: daysFromNow(r.serviceInDays) });
  }

  return { logs, decisionAt };
}

/** Throws if a seed entry's fields are inconsistent with its status. */
function assertConsistent(r: SeedRequest, i: number) {
  const fail = (msg: string) => {
    throw new Error(`Seed request #${i} (${r.status}): ${msg}`);
  };
  const units = r.unitsRequested ?? 1;
  const decided = DECIDED.includes(r.status);
  const needsReason = ["PARTIALLY_APPROVED", "DENIED", "PENDED", "REJECTED"].includes(r.status);

  if (needsReason && !r.decisionReason) fail("decisionReason is required");
  if (!needsReason && r.decisionReason) fail("decisionReason should be empty");
  if ((r.status === "APPROVED" || r.status === "SERVICE_COMPLETED") && r.unitsApproved !== units)
    fail("unitsApproved must equal unitsRequested");
  if (r.status === "PARTIALLY_APPROVED" && !(r.unitsApproved! > 0 && r.unitsApproved! < units))
    fail("unitsApproved must be between 1 and unitsRequested - 1");
  if (!["APPROVED", "PARTIALLY_APPROVED", "SERVICE_COMPLETED"].includes(r.status) && r.unitsApproved != null)
    fail("unitsApproved should only be set on approvals");
  if (r.status === "PENDED" && r.clinicalNotesAttached) fail("pended requests should be missing clinical notes");
  if (r.status === "SERVICE_COMPLETED" && r.serviceInDays >= 0) fail("service date must be in the past");
  if (!decided && r.status !== "SERVICE_COMPLETED" && r.serviceInDays < 0) fail("undecided request with past service date");
}

async function main() {
  REQUESTS.forEach(assertConsistent);

  // Clear old data (children first)
  await prisma.auditLog.deleteMany();
  await prisma.priorAuthRequest.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();

  const staff = await prisma.user.create({
    data: { name: "Sam Rivera", email: "staff@demo.test", role: "STAFF" },
  });
  const reviewer = await prisma.user.create({
    data: { name: "Dana Lee", email: "reviewer@demo.test", role: "REVIEWER" },
  });

  const patientData = [
    { firstName: "John", lastName: "Doe", dob: new Date("1980-01-15"), gender: "M", memberId: "W123456789", payerName: "ACME Health Plan" },
    { firstName: "Maria", lastName: "Garcia", dob: new Date("1975-06-02"), gender: "F", memberId: "W223456780", payerName: "Summit Insurance" },
    { firstName: "Robert", lastName: "Chen", dob: new Date("1962-11-23"), gender: "M", memberId: "W323456781", payerName: "ACME Health Plan" },
    { firstName: "Aisha", lastName: "Khan", dob: new Date("1991-03-30"), gender: "F", memberId: "W423456782", payerName: "Northwind Health" },
    { firstName: "Linda", lastName: "Nguyen", dob: new Date("1958-09-12"), gender: "F", memberId: "W523456783", payerName: "Summit Insurance" },
    { firstName: "Tom", lastName: "Baker", dob: new Date("1970-12-05"), gender: "M", memberId: "W623456784", payerName: "Northwind Health" },
  ];
  const patients = [];
  for (const p of patientData) patients.push(await prisma.patient.create({ data: p }));

  const providers = [
    { providerName: "Jane Smith", providerNpi: "1234567893" },
    { providerName: "Alan Brooks", providerNpi: "1245319599" },
    { providerName: "Priya Patel", providerNpi: "1679576722" },
  ];

  let logCount = 0;
  let ediCount = 0;
  for (const r of REQUESTS) {
    const createdAt = daysFromNow(-r.createdDaysAgo);
    const reviewed = r.status !== "DRAFT" && r.status !== "PENDING_REVIEW";

    // Create first: controlNumber comes from the database sequence
    const request = await prisma.priorAuthRequest.create({
      data: {
        status: r.status,
        patientId: patients[r.patient].id,
        ...providers[r.provider],
        diagnosisCode: r.service.diagnosisCode,
        procedureCode: r.service.procedureCode,
        serviceDate: utcDateFromToday(r.serviceInDays),
        unitsRequested: r.unitsRequested ?? 1,
        unitsApproved: r.unitsApproved ?? null,
        clinicalNotesAttached: r.clinicalNotesAttached,
        conservativeTreatmentTried: r.conservativeTreatmentTried,
        decisionReason: r.decisionReason ?? null,
        createdById: staff.id,
        reviewedById: reviewed ? reviewer.id : null,
        createdAt,
      },
      include: { patient: true },
    });

    const sentToPayer = reviewed; // reviewer approval = 278 transmitted
    const { logs, decisionAt } = buildHistory(
      r,
      createdAt,
      staff.name,
      reviewer.name,
      request.controlNumber,
    );

    await prisma.priorAuthRequest.update({
      where: { id: request.id },
      data: {
        decisionAt,
        // Every request that reached the payer carries the 278 that was "sent"
        raw278Request: sentToPayer ? generate278Request(build278Input(request)) : null,
        auditLogs: { create: logs },
      },
    });
    logCount += logs.length;
    if (sentToPayer) ediCount++;
  }

  console.log(
    `Seeded 2 users, ${patients.length} patients, ${REQUESTS.length} requests (${ediCount} with a generated 278), ${logCount} audit log entries.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
