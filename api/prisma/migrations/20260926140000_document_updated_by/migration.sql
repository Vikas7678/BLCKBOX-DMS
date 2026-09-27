-- AlterTable
ALTER TABLE "Document" ADD COLUMN "updatedById" TEXT;

-- CreateIndex
CREATE INDEX "Document_updatedById_idx" ON "Document"("updatedById");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: treat owner as last updater for existing rows
UPDATE "Document" SET "updatedById" = "ownerId" WHERE "updatedById" IS NULL;
