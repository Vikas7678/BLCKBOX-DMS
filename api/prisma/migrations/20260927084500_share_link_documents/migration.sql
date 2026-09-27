-- CreateTable
CREATE TABLE "ShareLinkDocument" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShareLinkDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareLinkDocument_documentId_idx" ON "ShareLinkDocument"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLinkDocument_shareLinkId_documentId_key" ON "ShareLinkDocument"("shareLinkId", "documentId");

-- AddForeignKey
ALTER TABLE "ShareLinkDocument" ADD CONSTRAINT "ShareLinkDocument_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkDocument" ADD CONSTRAINT "ShareLinkDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ShareLinkDocument" ("id", "shareLinkId", "documentId", "sortOrder")
SELECT 'sld_' || "id", "id", "documentId", 0
FROM "ShareLink"
ON CONFLICT DO NOTHING;
