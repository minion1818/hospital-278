-- AlterEnum
-- Replaces NEEDS_INFO with PENDED and adds the fuller payer workflow statuses.
-- Existing NEEDS_INFO rows are mapped to PENDED so the cast cannot fail.
BEGIN;
CREATE TYPE "RequestStatus_new" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED', 'PENDED', 'REJECTED', 'SERVICE_COMPLETED');
ALTER TABLE "public"."PriorAuthRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PriorAuthRequest" ALTER COLUMN "status" TYPE "RequestStatus_new"
  USING (CASE WHEN "status"::text = 'NEEDS_INFO' THEN 'PENDED' ELSE "status"::text END)::"RequestStatus_new";
ALTER TYPE "RequestStatus" RENAME TO "RequestStatus_old";
ALTER TYPE "RequestStatus_new" RENAME TO "RequestStatus";
DROP TYPE "public"."RequestStatus_old";
ALTER TABLE "PriorAuthRequest" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
-- denialReason is renamed (not dropped) so existing reasons are preserved.
ALTER TABLE "PriorAuthRequest" RENAME COLUMN "denialReason" TO "decisionReason";

ALTER TABLE "PriorAuthRequest"
ADD COLUMN     "clinicalNotesAttached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "conservativeTreatmentTried" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "decisionAt" TIMESTAMP(3),
ADD COLUMN     "unitsApproved" INTEGER,
ADD COLUMN     "unitsRequested" INTEGER NOT NULL DEFAULT 1;
