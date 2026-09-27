import { PlatformRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../middleware/error";

/** Load platform role; rejects deleted/disabled accounts. */
export async function getPlatformRole(userId: string): Promise<PlatformRole> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { platformRole: true, deletedAt: true, disabledAt: true },
  });
  if (!user || user.deletedAt) {
    throw new HttpError(401, "User not found");
  }
  if (user.disabledAt) {
    throw new HttpError(403, "This account has been disabled");
  }
  return user.platformRole;
}

/** Platform admin or platform owner (not workspace membership role). */
function isAdminOrOwner(role: PlatformRole): boolean {
  return role === "admin" || role === "owner";
}

export function canAccessUsersPage(role: PlatformRole): boolean {
  return isAdminOrOwner(role);
}

export function canManageUsers(role: PlatformRole): boolean {
  return role === "admin";
}

export function canCreateWorkspace(role: PlatformRole): boolean {
  return isAdminOrOwner(role);
}

export function canAccessTrash(role: PlatformRole): boolean {
  return isAdminOrOwner(role);
}

export function canDeleteContent(role: PlatformRole): boolean {
  return isAdminOrOwner(role);
}

async function requirePlatformRole(
  userId: string,
  allowed: PlatformRole[],
  message = "Insufficient permissions",
): Promise<PlatformRole> {
  const role = await getPlatformRole(userId);
  if (!allowed.includes(role)) {
    throw new HttpError(403, message);
  }
  return role;
}

export async function requirePlatformAdmin(userId: string): Promise<PlatformRole> {
  return requirePlatformRole(userId, ["admin"], "Only platform admins can do this");
}
