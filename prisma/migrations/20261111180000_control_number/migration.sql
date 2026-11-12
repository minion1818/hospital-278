-- AlterTable
-- SERIAL backfills every existing row with a unique value from the new sequence.
ALTER TABLE "PriorAuthRequest" ADD COLUMN     "controlNumber" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PriorAuthRequest_controlNumber_key" ON "PriorAuthRequest"("controlNumber");
