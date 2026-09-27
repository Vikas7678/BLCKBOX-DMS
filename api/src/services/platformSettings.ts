import { prisma } from "../lib/prisma";

/** Ensure the singleton platform settings row exists. */
export async function getOrCreatePlatformSettings() {
  const existing = await prisma.platformSettings.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.platformSettings.create({ data: {} });
}
