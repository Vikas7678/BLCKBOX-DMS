import { prisma } from "../lib/prisma";
import type { AuditEntityType } from "./auditTypes";

/** Build path label for an entity when still present in DB. */
export async function resolveEntityPath(input: {
  entityType: AuditEntityType;
  entityId: string;
  entityName?: string;
}): Promise<string | null> {
  try {
    if (input.entityType === "document") {
      const doc = await prisma.document.findUnique({
        where: { id: input.entityId },
        select: {
          title: true,
          filename: true,
          folderId: true,
          workspace: { select: { name: true } },
        },
      });
      if (!doc) return null;
      const name = input.entityName || doc.title || doc.filename;
      const parts = await ancestorFolderNames(doc.folderId, doc.workspace?.name ?? null);
      return [...parts, name].filter(Boolean).join(" / ");
    }

    if (input.entityType === "folder") {
      const folder = await prisma.folder.findUnique({
        where: { id: input.entityId },
        select: {
          name: true,
          parentId: true,
          workspace: { select: { name: true } },
        },
      });
      if (!folder) return null;
      const name = input.entityName || folder.name;
      const parts = await ancestorFolderNames(folder.parentId, folder.workspace?.name ?? null);
      return [...parts, name].filter(Boolean).join(" / ");
    }

    if (input.entityType === "workspace") {
      const ws = await prisma.workspace.findUnique({
        where: { id: input.entityId },
        select: { name: true },
      });
      return ws?.name ?? input.entityName ?? null;
    }

    // user (and any future types): no filesystem path
    return null;
  } catch {
    return null;
  }
}

/** Path for a folder by id/parent before it is deleted from DB. */
export async function resolveFolderPathFromIds(input: {
  folderId: string;
  folderName: string;
  parentId: string | null;
  workspaceId: string;
}): Promise<string | null> {
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { name: true },
    });
    const parts = await ancestorFolderNames(input.parentId, ws?.name ?? null);
    return [...parts, input.folderName].filter(Boolean).join(" / ");
  } catch {
    return null;
  }
}

/** Path for a document before permanent delete. */
export async function resolveDocumentPathFromIds(input: {
  documentName: string;
  folderId: string | null;
  workspaceId: string | null;
}): Promise<string | null> {
  try {
    let workspaceName: string | null = null;
    if (input.workspaceId) {
      const ws = await prisma.workspace.findUnique({
        where: { id: input.workspaceId },
        select: { name: true },
      });
      workspaceName = ws?.name ?? null;
    }
    const parts = await ancestorFolderNames(input.folderId, workspaceName);
    return [...parts, input.documentName].filter(Boolean).join(" / ");
  } catch {
    return null;
  }
}

async function ancestorFolderNames(
  folderId: string | null | undefined,
  workspaceName: string | null,
): Promise<string[]> {
  const parts: string[] = [];
  if (workspaceName) parts.push(workspaceName);

  const chain: string[] = [];
  let cursor: string | null = folderId ?? null;
  let guard = 0;
  while (cursor && guard < 50) {
    guard += 1;
    const f = await prisma.folder.findUnique({
      where: { id: cursor },
      select: { name: true, parentId: true },
    });
    if (!f) break;
    chain.unshift(f.name);
    cursor = f.parentId;
  }

  return [...parts, ...chain];
}
