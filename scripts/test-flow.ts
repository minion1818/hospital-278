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
  const { parse278 } = await import("@/lib/x12/parse278");
  const { decideManually, suggestDecision, ManualDecisionError } = await import("@/lib/payer/console");
  const { evaluateRequest, payerRequestFromParsed } = await import("@/lib/payer/rules");

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
    const autoMessages = await db.payerMessage.findMany({ where: { status: "RESPONDED" }, select: { decidedBy: true } });
    check("AUTO decisions are marked decidedBy AUTO", autoMessages.length === 6 && autoMessages.every((m) => m.decidedBy === "AUTO"), autoMessages);
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

    // ---------------- payer console: manual decisions ----------------
    console.log("\nPayer console: five manual decisions (MANUAL mode)");
    await db.payerSettings.update({ where: { id: 1 }, data: { mode: "MANUAL" } });

    /** Approve as reviewer at second T, let the payer acknowledge, return the payer message id. */
    const sendAndAcknowledge = async (data: Parameters<typeof createPending>[0], T: number) => {
      const req = await createPending(data);
      const res = await applyTransition(db, { requestId: req.id, key: "APPROVE_AND_SEND", actor: reviewer, now: at(T) });
      if (!res.ok || !res.transmission?.ok) throw new Error(`send failed: ${JSON.stringify(res)}`);
      await tick(at(T + 2));
      return { requestId: req.id, messageId: res.transmission.messageId };
    };
    const messageRow = (id: string) => db.payerMessage.findUniqueOrThrow({ where: { id } });
    const expectManualError = async (label: string, fn: () => Promise<unknown>, pattern: RegExp) => {
      try {
        await fn();
        check(label, false, "no error thrown");
      } catch (e) {
        check(
          label,
          e instanceof ManualDecisionError && pattern.test(JSON.stringify({ m: e.message, f: e.fieldErrors })),
          e instanceof Error ? e.message : e,
        );
      }
    };

    const manualCases = [
      {
        name: "manual APPROVE",
        data: { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true },
        input: { kind: "APPROVED" },
        status: "APPROVED",
        reason: null,
        units: 1,
        auth: true,
      },
      {
        name: "manual APPROVE PART",
        data: { patientId: john.id, procedureCode: "97110", diagnosisCode: "M54.50", units: 12, notes: true },
        input: { kind: "PARTIAL", unitsApproved: "8", reason: "Approved 8 visits for now, send progress notes for more" },
        status: "PARTIALLY_APPROVED",
        reason: "Approved 8 visits for now, send progress notes for more",
        units: 8,
        auth: true,
      },
      {
        name: "manual DENY",
        data: { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true },
        input: { kind: "DENIED", reason: "Imaging not indicated per reviewer" },
        status: "DENIED",
        reason: "Imaging not indicated per reviewer",
        units: null,
        auth: false,
      },
      {
        name: "manual PEND",
        data: { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true },
        input: { kind: "PENDED", reason: "Send the most recent X-ray report" },
        status: "PENDED",
        reason: "Send the most recent X-ray report",
        units: null,
        auth: false,
      },
      {
        name: "manual REJECT (code 72)",
        data: { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true },
        input: { kind: "REJECTED", code: "72", reason: "Member ID format does not match our cards" },
        status: "REJECTED",
        reason: "AAA 72: Invalid/missing subscriber/insured ID - Member ID format does not match our cards",
        units: null,
        auth: false,
      },
    ] as const;

    let T = 1000;
    for (const c of manualCases) {
      const { requestId, messageId } = await sendAndAcknowledge(c.data, T);
      check(`${c.name}: waiting IN_REVIEW in MANUAL mode`, (await status(requestId)) === "IN_REVIEW");
      await decideManually(messageId, c.input, at(T + 3));
      const tickResult = await tick(at(T + 4));
      const req = await db.priorAuthRequest.findUniqueOrThrow({ where: { id: requestId } });
      const msg = await messageRow(messageId);
      check(`${c.name}: delivered by tick -> hospital ${c.status}`, tickResult.responded === 1 && req.status === c.status, {
        tickResult,
        status: req.status,
      });
      check(`${c.name}: reason`, req.decisionReason === c.reason, req.decisionReason);
      check(`${c.name}: units approved ${c.units}`, req.unitsApproved === c.units, req.unitsApproved);
      check(
        `${c.name}: authorization number ${c.auth ? "set and matches payer" : "empty"}`,
        c.auth
          ? /^AUTH\d{8}$/.test(req.authorizationNumber ?? "") && req.authorizationNumber === msg.authorizationNumber
          : req.authorizationNumber === null,
        { hospital: req.authorizationNumber, payer: msg.authorizationNumber },
      );
      check(
        `${c.name}: payer message RESPONDED, decidedBy MANUAL, delivered`,
        msg.status === "RESPONDED" && msg.decidedBy === "MANUAL" && msg.deliveredAt !== null,
        msg,
      );
      check(`${c.name}: stored response parses cleanly`, parse278Response(req.raw278Response!).errors.length === 0);
      T += 100;
    }

    console.log("\nPayer console: deciding twice");
    {
      const { messageId } = await sendAndAcknowledge(
        { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true },
        T,
      );
      await decideManually(messageId, { kind: "APPROVED" }, at(T + 3));
      const before = JSON.stringify(await messageRow(messageId));
      await expectManualError(
        "second decision gives the friendly 'already responded' error",
        () => decideManually(messageId, { kind: "DENIED", reason: "changed my mind" }, at(T + 5)),
        /already been responded/,
      );
      check("second decision changed nothing", JSON.stringify(await messageRow(messageId)) === before);
      await tick(at(T + 6));
      T += 100;
    }

    console.log("\nPayer console: validation (message must stay untouched)");
    {
      const { requestId, messageId } = await sendAndAcknowledge(
        { patientId: john.id, procedureCode: "97110", diagnosisCode: "M54.50", units: 12, notes: true },
        T,
      );
      const before = JSON.stringify(await messageRow(messageId));
      await expectManualError("empty reason rejected", () => decideManually(messageId, { kind: "DENIED", reason: "  " }, at(T + 3)), /Enter a reason/);
      await expectManualError(
        "reason over 200 characters rejected",
        () => decideManually(messageId, { kind: "PENDED", reason: "x".repeat(201) }, at(T + 3)),
        /under 200/,
      );
      await expectManualError(
        "partial with 0 units rejected",
        () => decideManually(messageId, { kind: "PARTIAL", unitsApproved: 0, reason: "r" }, at(T + 3)),
        /between 1 and 11/,
      );
      await expectManualError(
        "partial equal to requested (12) rejected",
        () => decideManually(messageId, { kind: "PARTIAL", unitsApproved: 12, reason: "r" }, at(T + 3)),
        /between 1 and 11/,
      );
      await expectManualError(
        "partial above requested (13) rejected",
        () => decideManually(messageId, { kind: "PARTIAL", unitsApproved: 13, reason: "r" }, at(T + 3)),
        /between 1 and 11/,
      );
      check("after all rejected attempts: message unchanged (still IN_REVIEW)", JSON.stringify(await messageRow(messageId)) === before);

      await decideManually(messageId, { kind: "DENIED", reason: "Needs *signed* order~then resubmit" }, at(T + 4));
      await tick(at(T + 5));
      const req = await db.priorAuthRequest.findUniqueOrThrow({ where: { id: requestId } });
      check(
        "reason with '*' and '~' is sanitized, not breaking the file",
        req.status === "DENIED" &&
          req.decisionReason === "Needs signed order then resubmit" &&
          parse278Response(req.raw278Response!).errors.length === 0,
        req.decisionReason,
      );
      T += 100;
    }

    console.log("\nPayer console: manual override in AUTO mode beats the timer");
    {
      await db.payerSettings.update({ where: { id: 1 }, data: { mode: "AUTO" } });
      // The AUTO rules would APPROVE this one
      const req = await createPending({ patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true });
      const res = await applyTransition(db, { requestId: req.id, key: "APPROVE_AND_SEND", actor: reviewer, now: at(T) });
      const messageId = res.ok && res.transmission?.ok ? res.transmission.messageId : "";
      await decideManually(messageId, { kind: "DENIED", reason: "Manual override before the timer" }, at(T + 1)); // still RECEIVED
      const r = await tick(at(T + 20)); // well past both timers
      const final = await db.priorAuthRequest.findUniqueOrThrow({ where: { id: req.id } });
      const msg = await messageRow(messageId);
      const trail = await actions(req.id);
      check(
        "manual decision (before ack) wins: hospital DENIED with the manual reason",
        r.responded === 1 && final.status === "DENIED" && final.decisionReason === "Manual override before the timer",
        { r, status: final.status, reason: final.decisionReason },
      );
      check(
        "payer message decidedBy MANUAL, never acknowledged by the timer",
        msg.decidedBy === "MANUAL" && !trail.includes("PAYER_IN_REVIEW"),
        { decidedBy: msg.decidedBy, trail },
      );
      T += 100;
    }

    console.log("\nPayer console: suggestDecision matches evaluateRequest and stores nothing");
    {
      await db.payerSettings.update({ where: { id: 1 }, data: { mode: "MANUAL" } });
      const suggestionCases = [
        ["would approve", { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true }],
        ["would pend (no notes)", { patientId: john.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: false }],
        ["would reject (Zed)", { patientId: zed.id, procedureCode: "73721", diagnosisCode: "M17.11", notes: true }],
      ] as const;
      for (const [label, data] of suggestionCases) {
        const { messageId } = await sendAndAcknowledge(data, T);
        const before = JSON.stringify(await messageRow(messageId));
        const countBefore = await db.payerMessage.count();
        const msg = await messageRow(messageId);
        const suggestion = await suggestDecision(msg, at(T + 3));
        const pr = payerRequestFromParsed(parse278(msg.requestEdi));
        const member = await db.payerMember.findUnique({ where: { memberId: pr.memberId! } });
        const expected = evaluateRequest({
          request: pr,
          attachments: msg.attachments as { clinicalNotesAttached: boolean; conservativeTreatmentDocumented: boolean },
          roster: member && member.payerId === pr.payerId ? { [member.memberId]: { active: member.active } } : {},
          today: at(T + 3).toISOString().slice(0, 10).replaceAll("-", ""),
        });
        check(`suggestDecision ${label}: equals evaluateRequest (${suggestion.kind})`, JSON.stringify(suggestion) === JSON.stringify(expected), {
          suggestion,
          expected,
        });
        check(
          `suggestDecision ${label}: stored nothing`,
          JSON.stringify(await messageRow(messageId)) === before && (await db.payerMessage.count()) === countBefore,
        );
        await decideManually(messageId, { kind: "APPROVED" }, at(T + 4)); // tidy up
        await tick(at(T + 5));
        T += 100;
      }
      await db.payerSettings.update({ where: { id: 1 }, data: { mode: "AUTO" } });
    }

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
