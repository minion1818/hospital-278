// End-to-end flow test: hospital -> simulated payer -> hospital, against a real
// Postgres database with injected times. Run with `npm run test:flow`.
//
// Uses a SEPARATE database (<dev db name>_test on the same server), created and
// migrated automatically, so ticks with injected times never touch dev data.
// Every run wipes and re-creates its own fixtures in that test database.

import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

// ---------------------------------------------------------------------------
// Point everything at the test database BEFORE any app module creates a client
// ---------------------------------------------------------------------------
const devUrl = process.env.DATABASE_URL;
if (!devUrl) throw new Error("DATABASE_URL is not set (see .env)");
const testUrl = new URL(devUrl);
const testDbName = `${testUrl.pathname.replace(/^\//, "")}_test`;
testUrl.pathname = `/${testDbName}`;
process.env.DATABASE_URL = testUrl.toString();

const SECOND = 1000;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${!ok && detail !== undefined ? `\n          got: ${JSON.stringify(detail)}` : ""}`);
}

async function ensureTestDatabase() {
  const admin = new URL(devUrl!);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDbName]);
    if (exists.rowCount === 0) {
      // Identifier comes from our own .env, but quote it anyway
      await client.query(`CREATE DATABASE "${testDbName.replace(/"/g, '""')}"`);
      console.log(`Created database ${testDbName}`);
    }
  } finally {
    await client.end();
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: "pipe",
  });
}

async function main() {
  console.log(`Flow test database: ${testDbName}`);
  await ensureTestDatabase();

  // App modules load only now, so lib/db connects to the test database
  const { db } = await import("@/lib/db");
  const { applyTransition } = await import("@/lib/workflow-db");
  const { tick } = await import("@/lib/integration/tick");
  const { applyPayerResponse } = await import("@/lib/hospital/applyPayerResponse");
  const { receive278 } = await import("@/lib/payer/inbox");
  const { parse278Response } = await import("@/lib/x12/parse278Response");

  try {
    // ---------------- fixtures (test database only) ----------------
    await db.payerMessage.deleteMany();
    await db.payerMember.deleteMany();
    await db.payerSettings.deleteMany();
    await db.auditLog.deleteMany();
    await db.priorAuthRequest.deleteMany();
    await db.patient.deleteMany();
    await db.user.deleteMany();

    await db.payerSettings.create({ data: { id: 1, mode: "AUTO", ackDelaySeconds: 2, responseDelaySeconds: 8 } });
    const staffUser = await db.user.create({ data: { name: "Flow Staff", email: "staff@flow.test", role: "STAFF" } });
    const reviewerUser = await db.user.create({ data: { name: "Flow Reviewer", email: "reviewer@flow.test", role: "REVIEWER" } });
    const reviewer = { id: reviewerUser.id, name: reviewerUser.name, role: "REVIEWER" as const };

    const john = await db.patient.create({ data: { firstName: "John", lastName: "Doe", dob: new Date("1980-01-15"), gender: "M", memberId: "W123456789", payerName: "ACME Health Plan" } });
    const zed = await db.patient.create({ data: { firstName: "Zed", lastName: "Unknown", dob: new Date("1985-04-20"), gender: "M", memberId: "W999000001", payerName: "ACME Health Plan" } });
    const tom = await db.patient.create({ data: { firstName: "Tom", lastName: "Baker", dob: new Date("1970-12-05"), gender: "M", memberId: "W623456784", payerName: "Northwind Health" } });
    await db.payerMember.createMany({
      data: [
        { memberId: john.memberId, payerId: "SIMACME01", active: true },
        { memberId: tom.memberId, payerId: "SIMNWIND3", active: false }, // inactive coverage
        // Zed deliberately not on the roster
      ],
    });

    const t0 = new Date();
    const at = (seconds: number) => new Date(t0.getTime() + seconds * SECOND);
    const utcMidnightIn = (days: number) =>
      new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate() + days));

    const createPending = (o: {
      patientId: string; procedureCode: string; diagnosisCode: string; units?: number; notes: boolean; conservative?: boolean;
    }) =>
      db.priorAuthRequest.create({
        data: {
          status: "PENDING_REVIEW",
          patientId: o.patientId,
          providerName: "Jane Smith",
          providerNpi: "1234567893",
          diagnosisCode: o.diagnosisCode,
          procedureCode: o.procedureCode,
          serviceDate: utcMidnightIn(7),
          unitsRequested: o.units ?? 1,
          clinicalNotesAttached: o.notes,
          conservativeTreatmentTried: o.conservative ?? true,
          createdById: staffUser.id,
        },
      });

    const status = async (id: string) => (await db.priorAuthRequest.findUniqueOrThrow({ where: { id } })).status;
    const actions = async (id: string) =>
      (await db.auditLog.findMany({ where: { requestId: id }, orderBy: { createdAt: "asc" } })).map((l) => l.action);

    // ---------------- the six decision cases ----------------
    console.log("\nSix requests: approve as reviewer at t0, then tick with injected times");
    const cases = [
      { name: "approved", expect: "APPROVED", data: { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true }, reason: undefined, units: 1 },
      { name: "pended (no clinical notes)", expect: "PENDED", data: { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: false }, reason: "Clinical notes required for 73721 (MRI knee)" },
      { name: "denied (diagnosis not supported)", expect: "DENIED", data: { patientId: john.id, procedureCode: "73721", diagnosisCode: "K21.9", notes: true }, reason: "Medical necessity not established - diagnosis K219 is not supported for 73721 (MRI knee); allowed diagnosis groups M17, M25" },
      { name: "partially approved (20 PT visits, limit 12)", expect: "PARTIALLY_APPROVED", data: { patientId: john.id, procedureCode: "97110", diagnosisCode: "M54.50", units: 20, notes: true }, reason: "Plan limit is 12 units; 20 requested", units: 12 },
      { name: "rejected (Zed Unknown, member not found)", expect: "REJECTED", data: { patientId: zed.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true }, reason: "AAA 75: Subscriber/insured not found - Member id W999000001 not found" },
      { name: "denied (Tom Baker, coverage inactive)", expect: "DENIED", data: { patientId: tom.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true }, reason: "Coverage inactive for member W623456784" },
    ] as const;

    const ids: string[] = [];
    for (const c of cases) {
      const req = await createPending(c.data);
      const res = await applyTransition(db, { requestId: req.id, key: "APPROVE_AND_SEND", actor: reviewer, now: t0 });
      check(`${c.name}: approve and send -> SUBMITTED, transmitted`, res.ok && res.to === "SUBMITTED" && res.transmission?.ok === true, res);
      ids.push(req.id);
    }

    let r = await tick(at(1));
    check("t0+1s: nothing due yet", r.acknowledged === 0 && r.responded === 0, r);
    check("t0+1s: all six still SUBMITTED", (await Promise.all(ids.map(status))).every((s) => s === "SUBMITTED"));

    // Two concurrent ticks: atomic claims must acknowledge each message exactly once
    const [a1, a2] = await Promise.all([tick(at(2)), tick(at(2))]);
    check("t0+2s (two concurrent ticks): six acknowledged in total", a1.acknowledged + a2.acknowledged === 6, [a1, a2]);
    check("t0+2s: all six IN_REVIEW", (await Promise.all(ids.map(status))).every((s) => s === "IN_REVIEW"));

    r = await tick(at(7));
    check("t0+7s: no decisions before respondAt", r.responded === 0, r);

    const [d1, d2] = await Promise.all([tick(at(8)), tick(at(8))]);
    check("t0+8s (two concurrent ticks): six responses applied in total", d1.responded + d2.responded === 6, [d1, d2]);

    for (const [i, c] of cases.entries()) {
      const req = await db.priorAuthRequest.findUniqueOrThrow({ where: { id: ids[i] } });
      const certified = c.expect === "APPROVED" || c.expect === "PARTIALLY_APPROVED";
      const parsed = req.raw278Response ? parse278Response(req.raw278Response) : undefined;
      check(`${c.name}: final status ${c.expect}`, req.status === c.expect, req.status);
      check(`${c.name}: decisionReason`, (req.decisionReason ?? undefined) === c.reason, req.decisionReason);
      check(`${c.name}: decisionAt = t0+8s`, req.decisionAt?.getTime() === at(8).getTime(), req.decisionAt);
      check(
        `${c.name}: units/authorization ${certified ? "set" : "empty"}`,
        certified
          ? req.unitsApproved === ("units" in c ? c.units : undefined) && /^AUTH\d{8}$/.test(req.authorizationNumber ?? "")
          : req.unitsApproved === null && req.authorizationNumber === null,
        { unitsApproved: req.unitsApproved, authorizationNumber: req.authorizationNumber },
      );
      check(`${c.name}: stored 278 response parses cleanly`, parsed?.errors.length === 0, parsed?.errors);
      const trail = await actions(ids[i]);
      check(
        `${c.name}: audit trail`,
        JSON.stringify(trail) === JSON.stringify(["APPROVED_FOR_SUBMISSION", "SUBMITTED_TO_PAYER", "PAYER_IN_REVIEW", `PAYER_${c.expect}`]),
        trail,
      );
    }
    const sent = await db.auditLog.findFirst({ where: { requestId: ids[0], action: "SUBMITTED_TO_PAYER" } });
    check("'Submitted to payer' mentions the payer message id", /payer message c[a-z0-9]+\)/.test(sent?.details ?? ""), sent?.details);

    // ---------------- idempotency ----------------
    console.log("\nIdempotency");
    const auditBefore = await db.auditLog.count();
    r = await tick(at(8));
    check("tick again with the same now: no changes", r.acknowledged === 0 && r.responded === 0 && r.ignored === 0, r);
    check("tick again: no new audit entries", (await db.auditLog.count()) === auditBefore);

    const decided = await db.priorAuthRequest.findUniqueOrThrow({ where: { id: ids[0] } });
    const replay = await applyPayerResponse(decided.raw278Response!, at(30));
    check("applyPayerResponse ignores a request that is no longer SUBMITTED/IN_REVIEW", !replay.applied && /Ignored: request is APPROVED/.test(!replay.applied ? replay.reason : ""), replay);
    check("replay: status and audit unchanged", (await status(ids[0])) === "APPROVED" && (await db.auditLog.count()) === auditBefore);

    // ---------------- MANUAL mode ----------------
    console.log("\nMANUAL mode");
    await db.payerSettings.update({ where: { id: 1 }, data: { mode: "MANUAL" } });
    const t1 = 100; // seconds after t0
    const manual = await createPending({ patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true });
    await applyTransition(db, { requestId: manual.id, key: "APPROVE_AND_SEND", actor: reviewer, now: at(t1) });
    r = await tick(at(t1 + 2));
    check("MANUAL: tick acknowledges (-> IN_REVIEW)", r.acknowledged === 1 && (await status(manual.id)) === "IN_REVIEW", r);
    r = await tick(at(t1 + 3600));
    const manualMsg = await db.payerMessage.findFirst({ where: { requestEdi: { contains: manual.id } } });
    check("MANUAL: an hour later still undecided (request IN_REVIEW, message IN_REVIEW)", r.responded === 0 && (await status(manual.id)) === "IN_REVIEW" && manualMsg?.status === "IN_REVIEW", { r, msg: manualMsg?.status });
    await db.payerSettings.update({ where: { id: 1 }, data: { mode: "AUTO" } });
    r = await tick(at(t1 + 3601));
    check("switching back to AUTO: decided on the next tick", r.responded === 1 && (await status(manual.id)) === "APPROVED", r);

    // ---------------- failed transmission ----------------
    console.log("\nFailed transmission");
    const failing = await createPending({ patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true });
    const failed = await applyTransition(db, {
      requestId: failing.id,
      key: "APPROVE_AND_SEND",
      actor: reviewer,
      now: at(200),
      transmit: async () => {
        throw new Error("Payer endpoint unreachable (simulated)");
      },
    });
    const failTrail = await actions(failing.id);
    const failEntry = await db.auditLog.findFirst({ where: { requestId: failing.id, action: "TRANSMISSION_FAILED" } });
    check("transition reports the failed transmission", failed.ok && failed.transmission?.ok === false, failed);
    check("status stays SUBMITTED", (await status(failing.id)) === "SUBMITTED");
    check("audit: 'Transmission to payer failed' with the error, no 'Submitted to payer'",
      failEntry?.details === "Transmission to payer failed: Payer endpoint unreachable (simulated)" && !failTrail.includes("SUBMITTED_TO_PAYER"),
      { failTrail, details: failEntry?.details });
    check("no payer message was created", (await db.payerMessage.count({ where: { requestEdi: { contains: failing.id } } })) === 0);

    // ---------------- garbage in ----------------
    console.log("\nPayer intake validation");
    let threw = false;
    try {
      await receive278("hello, not X12", { clinicalNotesAttached: true, conservativeTreatmentDocumented: true }, at(300));
    } catch {
      threw = true;
    }
    check("receive278 throws on non-X12 text", threw);
  } finally {
    await db.$disconnect();
  }

  console.log(failures === 0 ? "\nALL FLOW CHECKS PASSED" : `\n${failures} FLOW CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
