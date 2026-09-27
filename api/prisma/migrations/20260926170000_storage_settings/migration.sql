-- CreateTable
CREATE TABLE "StorageSettings" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "StorageSettings_pkey" PRIMARY KEY ("id")
);
