-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('admin', 'owner', 'member');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'member';

-- First existing user becomes platform admin
UPDATE "User"
SET "platformRole" = 'admin'
WHERE id = (
  SELECT id FROM "User"
  WHERE "deletedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
);
