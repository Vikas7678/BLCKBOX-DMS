-- Unify SmtpSettings + StorageSettings into one platform-wide settings row.

CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT '',
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 587,
    "username" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "useSecureConnection" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'local',
    "localPath" TEXT NOT NULL DEFAULT '',
    "s3Bucket" TEXT NOT NULL DEFAULT '',
    "s3Region" TEXT NOT NULL DEFAULT '',
    "s3AccessKeyId" TEXT NOT NULL DEFAULT '',
    "s3SecretAccessKey" TEXT NOT NULL DEFAULT '',
    "s3Endpoint" TEXT NOT NULL DEFAULT '',
    "s3ForcePathStyle" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSettings" (
  "id", "fromEmail", "fromName", "host", "port", "username", "password", "useSecureConnection",
  "provider", "localPath", "s3Bucket", "s3Region", "s3AccessKeyId", "s3SecretAccessKey", "s3Endpoint", "s3ForcePathStyle",
  "createdAt", "updatedAt"
)
SELECT
  s."id",
  s."fromEmail", s."fromName", s."host", s."port", s."username", s."password", s."useSecureConnection",
  'local', '', '', '', '', '', '', false,
  s."createdAt", s."updatedAt"
FROM "SmtpSettings" s
ORDER BY s."createdAt" ASC
LIMIT 1;

INSERT INTO "PlatformSettings" ("id", "updatedAt")
SELECT 'platform-settings', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PlatformSettings");

UPDATE "PlatformSettings" p
SET
  "provider" = st."provider",
  "localPath" = st."localPath",
  "s3Bucket" = st."s3Bucket",
  "s3Region" = st."s3Region",
  "s3AccessKeyId" = st."s3AccessKeyId",
  "s3SecretAccessKey" = st."s3SecretAccessKey",
  "s3Endpoint" = st."s3Endpoint",
  "s3ForcePathStyle" = st."s3ForcePathStyle",
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT * FROM "StorageSettings" ORDER BY "createdAt" ASC LIMIT 1
) st;

DROP TABLE IF EXISTS "StorageSettings";
DROP TABLE IF EXISTS "SmtpSettings";
