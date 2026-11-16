-- CreateEnum
CREATE TYPE "PayerMessageStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'RESPONDED');

-- CreateEnum
CREATE TYPE "PayerMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "PriorAuthRequest" ADD COLUMN     "authorizationNumber" TEXT;

-- CreateTable
CREATE TABLE "PayerMember" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PayerMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerMessage" (
    "id" TEXT NOT NULL,
    "controlNumber" SERIAL NOT NULL,
    "status" "PayerMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "requestEdi" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgeAt" TIMESTAMP(3) NOT NULL,
    "respondAt" TIMESTAMP(3) NOT NULL,
    "responseEdi" TEXT,
    "outcome" TEXT,
    "respondedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "authorizationNumber" TEXT,

    CONSTRAINT "PayerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mode" "PayerMode" NOT NULL DEFAULT 'AUTO',
    "ackDelaySeconds" INTEGER NOT NULL DEFAULT 2,
    "responseDelaySeconds" INTEGER NOT NULL DEFAULT 8,

    CONSTRAINT "PayerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayerMember_memberId_key" ON "PayerMember"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "PayerMessage_controlNumber_key" ON "PayerMessage"("controlNumber");

-- CreateIndex
CREATE INDEX "PayerMessage_status_idx" ON "PayerMessage"("status");


-- PayerSettings is a single-row table (hand-added; Prisma does not model CHECK constraints)
ALTER TABLE "PayerSettings" ADD CONSTRAINT "PayerSettings_single_row" CHECK ("id" = 1);
