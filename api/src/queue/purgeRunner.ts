import { prisma } from "../lib/prisma";
import { getStorage } from "../services/storageSettings";
import { recordAudit, resolveActorName } from "../services/audit";
import {
  resolveDocumentPathFromIds,
  resolveFolderPathFromIds,
} from "../services/auditPath";
import { collectDescendantFolderIds } from "../services/folders";
import type { PurgeItem } from "./purgeQueue";

export async function purgeDocumentById(
  documentId: string,
  actor?: { userId: string; name: string },
): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || !doc.deletedAt) {
    return;
  }
  const snap = {
    id: doc.id,
    name: doc.title || doc.filename,
    workspaceId: doc.workspaceId,
    folderId: doc.folderId,
  };
  const path = await resolveDocumentPathFromIds({
    documentName: snap.name,
    folderId: snap.folderId,
    workspaceId: snap.workspaceId,
  });
  await prisma.shareLink.deleteMany({ where: { documentId: doc.id } });
  await prisma.documentShare.deleteMany({ where: { documentId: doc.id } });
  await prisma.document.delete({ where: { id: doc.id } });
  await (await getStorage()).delete(doc.storageKey).catch(() => undefined);
  if (actor) {
    recordAudit({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: "document.deleted",
      entityType: "document",
      entityId: snap.id,
      entityName: snap.name,
      workspaceId: snap.workspaceId,
      label: `Document permanently deleted: ${snap.name}`,
      metadata: path ? { path } : undefined,
    });
  }
}

export async function purgeFolderById(
  workspaceId: string,
  folderId: string,
  actor?: { userId: string; name: string },
): Promise<void> {
  const folder = await prisma.folder.findFirst({
    where: {
      id: folderId,
      workspaceId,
      deletedAt: { not: null },
    },
  });
  if (!folder) {
    return;
  }

  const snap = {
    id: folder.id,
    name: folder.name,
    workspaceId: folder.workspaceId,
    parentId: folder.parentId,
  };
  const path = await resolveFolderPathFromIds({
    folderId: snap.id,
    folderName: snap.name,
    parentId: snap.parentId,
    workspaceId: snap.workspaceId,
  });

  const tree = await prisma.folder.findMany({
    where: { workspaceId },
    select: { id: true, parentId: true },
  });
  const folderIds = collectDescendantFolderIds(folder.id, tree);

  const documents = await prisma.document.findMany({
    where: { folderId: { in: folderIds } },
    select: { id: true, storageKey: true },
  });
  const docIds = documents.map((d) => d.id);

  if (docIds.length) {
    await prisma.shareLink.deleteMany({ where: { documentId: { in: docIds } } });
    await prisma.documentShare.deleteMany({ where: { documentId: { in: docIds } } });
    await prisma.document.deleteMany({ where: { id: { in: docIds } } });
  }
  await prisma.folder.deleteMany({ where: { id: { in: folderIds } } });

  for (const doc of documents) {
    await (await getStorage()).delete(doc.storageKey).catch(() => undefined);
  }

  if (actor) {
    recordAudit({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: "folder.deleted",
      entityType: "folder",
      entityId: snap.id,
      entityName: snap.name,
      workspaceId: snap.workspaceId,
      label: `Folder permanently deleted: ${snap.name}`,
      metadata: {
        purgedDocuments: docIds.length,
        purgedFolders: folderIds.length,
        ...(path ? { path } : {}),
      },
    });
  }
}

/** Hard-delete a soft-deleted workspace (cascades DB rows; cleans storage keys). */
export async function purgeWorkspaceById(
  workspaceId: string,
  actor?: { userId: string; name: string },
): Promise<void> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: { not: null } },
  });
  if (!workspace) {
    return;
  }

  const snap = { id: workspace.id, name: workspace.name };
  const documents = await prisma.document.findMany({
    where: { workspaceId },
    select: { id: true, storageKey: true },
  });
  const docIds = documents.map((d) => d.id);

  if (docIds.length) {
    await prisma.shareLink.deleteMany({ where: { documentId: { in: docIds } } });
    await prisma.documentShare.deleteMany({ where: { documentId: { in: docIds } } });
  }

  await prisma.workspace.delete({ where: { id: workspace.id } });

  for (const doc of documents) {
    await (await getStorage()).delete(doc.storageKey).catch(() => undefined);
  }

  if (actor) {
    recordAudit({
      actorUserId: actor.userId,
      actorName: actor.name,
      action: "workspace.deleted",
      entityType: "workspace",
      entityId: snap.id,
      entityName: snap.name,
      workspaceId: snap.id,
      label: `Workspace permanently deleted: ${snap.name}`,
      metadata: { purgedDocuments: docIds.length },
    });
  }
}

export async function runPurgeItems(
  items: PurgeItem[],
  requestedByUserId?: string,
): Promise<{
  purged: number;
  failed: number;
  errors: string[];
}> {
  let purged = 0;
  let failed = 0;
  const errors: string[] = [];

  const actor = requestedByUserId
    ? { userId: requestedByUserId, name: await resolveActorName(requestedByUserId) }
    : undefined;

  for (const item of items) {
    try {
      if (item.kind === "document") {
        await purgeDocumentById(item.documentId, actor);
      } else if (item.kind === "folder") {
        await purgeFolderById(item.workspaceId, item.folderId, actor);
      } else {
        await purgeWorkspaceById(item.workspaceId, actor);
      }
      purged += 1;
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : "Purge failed");
    }
  }

  return { purged, failed, errors };
}
