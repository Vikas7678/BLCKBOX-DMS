/**
 * Workspace/document authorization helpers.
 *
 * Important distinctions:
 * - Workspace membership role `owner` ≠ workspace creator (`createdById`).
 *   A user can be added as workspace owner without having created the workspace.
 * - Platform role `owner` who created a workspace may lack a membership row;
 *   `isWorkspaceCreator` covers that fallback only (not membership owner).
 * - Platform `admin` is treated as workspace `owner` for membership checks
 *   (see requireMembership).
 */
import { Document, WorkspaceMember, WorkspaceRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../middleware/error";
import { canDeleteContent, getPlatformRole } from "./platform";

async function getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

/** True when user created the workspace (`createdById`), including soft-deleted ones. */
async function isWorkspaceCreator(workspaceId: string, userId: string): Promise<boolean> {
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, createdById: userId },
    select: { id: true },
  });
  return Boolean(ws);
}

async function findActiveInternalShare(documentId: string, userId: string) {
  return prisma.documentShare.findFirst({
    where: {
      documentId,
      sharedWithUserId: userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
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

/**
 * Read access: platform admin, any workspace member, platform-owner creator fallback,
 * or an active internal share.
 */
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
    // Creator fallback — not the same as membership role "owner".
    if (platformRole === "owner" && (await isWorkspaceCreator(doc.workspaceId, userId))) {
      return true;
    }
  }
  const share = await findActiveInternalShare(doc.id, userId);
  return Boolean(share);
}

/**
 * True when the only grant is an internal share (no membership / creator / admin path).
 * Must stay the inverse of the non-share branches in canAccessDocument.
 */
export async function isInternalShareOnlyAccess(doc: Document, userId: string): Promise<boolean> {
  if (doc.deletedAt) return false;
  const platformRole = await getPlatformRole(userId);
  if (platformRole === "admin") return false;
  if (!doc.workspaceId) {
    if (doc.ownerId === userId) return false;
  } else {
    const membership = await getMembership(doc.workspaceId, userId);
    if (membership) return false;
    if (platformRole === "owner" && (await isWorkspaceCreator(doc.workspaceId, userId))) {
      return false;
    }
  }
  const share = await findActiveInternalShare(doc.id, userId);
  return Boolean(share);
}

/** Manage/share/rename: workspace membership owner|admin, doc owner, admin, or creator fallback. */
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
      return isWorkspaceCreator(doc.workspaceId, userId);
    }
    return false;
  }
  // Membership role owner/admin — may or may not be the workspace creator.
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

/** See a trashed doc in lists: any workspace member (or creator fallback), not only managers. */
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
    return isWorkspaceCreator(doc.workspaceId, userId);
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

/**
 * requireDocumentAccess + canManageDocument.
 * Default error message is share-oriented; pass `message` for rename/other actions.
 */
export async function requireDocumentManage(
  documentId: string,
  userId: string,
  message = "You cannot share this document",
): Promise<Document> {
  const doc = await requireDocumentAccess(documentId, userId);
  const allowed = await canManageDocument(doc, userId);
  if (!allowed) {
    throw new HttpError(403, message);
  }
  return doc;
}

/**
 * Permanent delete / restore of a soft-deleted document.
 * Doc owner, workspace membership owner|admin, platform admin, or platform-owner creator.
 */
export async function canPurgeTrashedDocument(doc: Document, userId: string): Promise<boolean> {
  if (!doc.deletedAt) {
    return false;
  }
  const platformRole = await getPlatformRole(userId);
  if (platformRole === "admin" || doc.ownerId === userId) {
    return true;
  }
  if (!doc.workspaceId) {
    return false;
  }
  const membership = await getMembership(doc.workspaceId, userId);
  if (membership?.role === "owner" || membership?.role === "admin") {
    return true;
  }
  if (platformRole === "owner") {
    return isWorkspaceCreator(doc.workspaceId, userId);
  }
  return false;
}

/** Same rules as purge — used by restore so admins/creators are not blocked after purge access. */
export const canRestoreTrashedDocument = canPurgeTrashedDocument;

/**
 * Workspace-level manage (folder purge, etc.): membership owner|admin, platform admin,
 * or platform-owner creator. Membership owner ≠ creator.
 */
export async function canManageWorkspaceAsAdmin(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const platformRole = await getPlatformRole(userId);
  if (platformRole === "admin") {
    return true;
  }
  const membership = await getMembership(workspaceId, userId);
  if (membership?.role === "owner" || membership?.role === "admin") {
    return true;
  }
  if (platformRole === "owner") {
    return isWorkspaceCreator(workspaceId, userId);
  }
  return false;
}
