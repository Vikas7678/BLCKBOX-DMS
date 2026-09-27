import { Document, WorkspaceMember, WorkspaceRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../middleware/error";
import { canDeleteContent, getPlatformRole } from "./platform";

export async function getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

export async function requireMembership(
  workspaceId: string,
  userId: string,
  roles?: WorkspaceRole[],
): Promise<WorkspaceMember> {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) {
    const platformRole = await getPlatformRole(userId);
    if (platformRole === "admin") {
      return {
        id: `platform-admin:${workspaceId}:${userId}`,
        workspaceId,
        userId,
        role: "owner",
        createdAt: new Date(),
      } as WorkspaceMember;
    }
    throw new HttpError(403, "Not a member of this workspace");
  }
  if (roles && !roles.includes(membership.role)) {
    throw new HttpError(403, "Insufficient workspace permissions");
  }
  return membership;
}

export async function canAccessDocument(doc: Document, userId: string): Promise<boolean> {
  if (doc.deletedAt) {
    return false;
  }
  const platformRole = await getPlatformRole(userId);
  if (platformRole === "admin") {
    return true;
  }
  if (!doc.workspaceId) {
    if (doc.ownerId === userId) return true;
  } else {
    const membership = await getMembership(doc.workspaceId, userId);
    if (membership) return true;
    if (platformRole === "owner") {
      const ws = await prisma.workspace.findFirst({
        where: { id: doc.workspaceId, createdById: userId, deletedAt: null },
        select: { id: true },
      });
      if (ws) return true;
    }
  }
  const share = await prisma.documentShare.findFirst({
    where: {
      documentId: doc.id,
      sharedWithUserId: userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return Boolean(share);
}

export async function isInternalShareOnlyAccess(doc: Document, userId: string): Promise<boolean> {
  if (doc.deletedAt) return false;
  const platformRole = await getPlatformRole(userId);
  if (platformRole === "admin") return false;
  if (!doc.workspaceId) {
    if (doc.ownerId === userId) return false;
  } else {
    const membership = await getMembership(doc.workspaceId, userId);
    if (membership) return false;
  }
  const share = await prisma.documentShare.findFirst({
    where: {
      documentId: doc.id,
      sharedWithUserId: userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return Boolean(share);
}

export async function canManageDocument(doc: Document, userId: string): Promise<boolean> {
  if (doc.deletedAt) {
    return false;
  }
  const platformRole = await getPlatformRole(userId);
  if (platformRole === "admin") {
    return true;
  }
  if (!doc.workspaceId) {
    return doc.ownerId === userId;
  }
  const membership = await getMembership(doc.workspaceId, userId);
  if (!membership) {
    if (platformRole === "owner") {
      const ws = await prisma.workspace.findFirst({
        where: { id: doc.workspaceId, createdById: userId, deletedAt: null },
        select: { id: true },
      });
      return Boolean(ws);
    }
    return false;
  }
  if (membership.role === "owner" || membership.role === "admin") {
    return true;
  }
  return doc.ownerId === userId;
}

/** Soft-delete / trash — platform members never delete. */
export async function canDeleteDocument(doc: Document, userId: string): Promise<boolean> {
  const platformRole = await getPlatformRole(userId);
  if (!canDeleteContent(platformRole)) {
    return false;
  }
  return canManageDocument(doc, userId);
}

export async function canAccessTrashedDocument(doc: Document, userId: string): Promise<boolean> {
  if (!doc.deletedAt) {
    return false;
  }
  const platformRole = await getPlatformRole(userId);
  if (!canDeleteContent(platformRole)) {
    return false;
  }
  if (platformRole === "admin") {
    return true;
  }
  if (!doc.workspaceId) {
    return doc.ownerId === userId;
  }
  const membership = await getMembership(doc.workspaceId, userId);
  if (membership) return true;
  if (platformRole === "owner") {
    const ws = await prisma.workspace.findFirst({
      where: { id: doc.workspaceId, createdById: userId, deletedAt: null },
      select: { id: true },
    });
    return Boolean(ws);
  }
  return false;
}

export async function requireDocumentAccess(documentId: string, userId: string): Promise<Document> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.deletedAt) {
    throw new HttpError(404, "Document not found");
  }
  const allowed = await canAccessDocument(doc, userId);
  if (!allowed) {
    throw new HttpError(403, "You do not have access to this document");
  }
  return doc;
}
