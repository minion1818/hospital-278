import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);

async function main() {
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

  // [diagnosis, procedure]
  const services = [
    ["M54.16", "72148"], // lumbar MRI
    ["M17.11", "73721"], // knee MRI
    ["G43.909", "70553"], // brain MRI
    ["K21.9", "43239"], // upper GI endoscopy
    ["I25.10", "93458"], // cardiac cath
    ["M17.11", "27447"], // knee replacement
  ];

  const statuses = [
    "DRAFT", "DRAFT", "DRAFT",
    "PENDING_REVIEW", "PENDING_REVIEW", "PENDING_REVIEW",
    "SUBMITTED", "SUBMITTED",
    "APPROVED", "APPROVED", "APPROVED", "APPROVED",
    "DENIED", "DENIED",
    "NEEDS_INFO",
  ] as const;

  const denialReasons = [
    "Service not medically necessary per plan criteria",
    "Prior conservative treatment not documented",
  ];

  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const patient = patients[i % patients.length];
    const provider = providers[i % providers.length];
    const [diagnosisCode, procedureCode] = services[i % services.length];
    const reviewed = status !== "DRAFT" && status !== "PENDING_REVIEW";

    const request = await prisma.priorAuthRequest.create({
      data: {
        status,
        patientId: patient.id,
        ...provider,
        diagnosisCode,
        procedureCode,
        serviceDate: daysFromNow(3 + i),
        denialReason: status === "DENIED" ? denialReasons[i % 2] : null,
        createdById: staff.id,
        reviewedById: reviewed ? reviewer.id : null,
        createdAt: daysFromNow(-(statuses.length - i)),
      },
    });

    const logs = [{ actor: staff.name, action: "CREATED" }];
    if (status !== "DRAFT") logs.push({ actor: staff.name, action: "SUBMITTED_FOR_REVIEW" });
    if (reviewed) logs.push({ actor: reviewer.name, action: "APPROVED_FOR_SUBMISSION" });
    if (status === "APPROVED" || status === "DENIED" || status === "NEEDS_INFO")
      logs.push({ actor: "Payer (simulated)", action: `PAYER_${status}` });

    for (const log of logs)
      await prisma.auditLog.create({ data: { requestId: request.id, ...log } });
  }

  console.log("Seeded 2 users, 6 patients, 15 requests.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());