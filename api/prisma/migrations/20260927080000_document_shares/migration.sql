-- AlterTable ShareLink: require expiry + external share metadata
UPDATE "ShareLink" SET "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '7 days' WHERE "expiresAt" IS NULL;
ALTER TABLE "ShareLink" ALTER COLUMN "expiresAt" SET NOT NULL;
ALTER TABLE "ShareLink" ADD COLUMN IF NOT EXISTS "recipientEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ShareLink" ADD COLUMN IF NOT EXISTS "message" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ShareLink" ADD COLUMN IF NOT EXISTS "allowDownload" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "ShareLink_createdById_idx" ON "ShareLink"("createdById");

-- CreateTable DocumentShare
CREATE TABLE "DocumentShare" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sharedWithUserId" TEXT NOT NULL,
    "sharedById" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentShare_documentId_sharedWithUserId_key" ON "DocumentShare"("documentId", "sharedWithUserId");
CREATE INDEX "DocumentShare_sharedWithUserId_idx" ON "DocumentShare"("sharedWithUserId");
CREATE INDEX "DocumentShare_sharedById_idx" ON "DocumentShare"("sharedById");
CREATE INDEX "DocumentShare_documentId_idx" ON "DocumentShare"("documentId");

ALTER TABLE "DocumentShare" ADD CONSTRAINT "DocumentShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentShare" ADD CONSTRAINT "DocumentShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentShare" ADD CONSTRAINT "DocumentShare_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
