import { PlatformRole } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Workspace IDs visible for trash/dashboard stats (live workspaces only).
 * - admin: all workspaces
 * - others: memberships; platform owners also include workspaces they created
 *   (creator ≠ membership role owner — an added workspace owner is covered via membership)
 */
export async function resolveAccessibleWorkspaceIds(
  userId: string,
  platformRole: PlatformRole,
): Promise<string[]> {
  if (platformRole === "admin") {
    const all = await prisma.workspace.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return all.map((w) => w.id);
  }

  const [memberships, created] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      select: { workspaceId: true },
    }),
    platformRole === "owner"
      ? prisma.workspace.findMany({
          where: { deletedAt: null, createdById: userId },
          select: { id: true },
        })
      : Promise.resolve([] as { id: string }[]),
  ]);

  return [
    ...new Set([
      ...memberships.map((m) => m.workspaceId),
      ...created.map((w) => w.id),
    ]),
  ];
}

export type TrashedWorkspaceRow = {
  id: string;
  name: string;
  createdAt: Date;
  deletedAt: Date;
  createdBy: { id: string; name: string };
};

/**
 * Soft-deleted workspaces the user may restore/purge:
 * platform admin, membership owner|admin, or creator.
 */
export async function resolveTrashedWorkspaces(
  userId: string,
  platformRole: PlatformRole,
): Promise<TrashedWorkspaceRow[]> {
  const select = {
    id: true,
    name: true,
    createdAt: true,
    deletedAt: true,
    createdBy: { select: { id: true, name: true } },
  } as const;

  if (platformRole === "admin") {
    const rows = await prisma.workspace.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select,
    });
    return rows.filter((w): w is TrashedWorkspaceRow => w.deletedAt != null);
  }

  const [memberships, created] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: {
        userId,
        role: { in: ["owner", "admin"] },
        workspace: { deletedAt: { not: null } },
      },
      select: { workspace: { select } },
    }),
    prisma.workspace.findMany({
      where: { deletedAt: { not: null }, createdById: userId },
      select,
    }),
  ]);

  const byId = new Map<string, TrashedWorkspaceRow>();
  for (const m of memberships) {
    if (m.workspace.deletedAt) {
      byId.set(m.workspace.id, m.workspace as TrashedWorkspaceRow);
    }
  }
  for (const w of created) {
    if (w.deletedAt) {
      byId.set(w.id, w as TrashedWorkspaceRow);
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.deletedAt.getTime() - a.deletedAt.getTime(),
  );
}

/** Hide nested folders soft-deleted with a parent cascade. */
export function filterVisibleTrashFolders<T extends { id: string; parentId: string | null }>(
  folders: T[],
): T[] {
  const deletedFolderIds = new Set(folders.map((f) => f.id));
  return folders.filter((f) => !f.parentId || !deletedFolderIds.has(f.parentId));
}

/** Hide files that live inside a soft-deleted folder (cascade). */
export function filterVisibleTrashDocuments<
  T extends { folderId: string | null; folder?: { deletedAt: Date | null } | null },
>(docs: T[]): T[] {
  return docs.filter((d) => !d.folderId || !d.folder?.deletedAt);
}
