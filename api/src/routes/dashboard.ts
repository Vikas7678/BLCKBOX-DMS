import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { canAccessTrash, canAccessUsersPage, getPlatformRole } from "../services/platform";
import { listRecentAuditActivity } from "../services/audit";
import {
  resolveAccessibleWorkspaceIds,
  resolveTrashedWorkspaces,
  filterVisibleTrashFolders,
  filterVisibleTrashDocuments,
} from "../services/trash";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const platformRole = await getPlatformRole(userId);
    const workspaceIds = await resolveAccessibleWorkspaceIds(userId, platformRole);

    const showTrash = canAccessTrash(platformRole);
    const showUsers = canAccessUsersPage(platformRole);

    const [workspaceCount, documentCount, trashedDocs, trashedFolders, trashedWorkspaces, userCount] =
      await Promise.all([
        Promise.resolve(workspaceIds.length),
        workspaceIds.length
          ? prisma.document.count({
              where: { workspaceId: { in: workspaceIds }, deletedAt: null },
            })
          : Promise.resolve(0),
        showTrash
          ? prisma.document.findMany({
              where: {
                deletedAt: { not: null },
                OR: [{ workspaceId: null }, { workspace: { deletedAt: null } }],
                AND: [
                  {
                    OR: [
                      { ownerId: userId },
                      ...(workspaceIds.length ? [{ workspaceId: { in: workspaceIds } }] : []),
                    ],
                  },
                ],
              },
              select: {
                folderId: true,
                folder: { select: { deletedAt: true } },
              },
            })
          : Promise.resolve(
              [] as { folderId: string | null; folder: { deletedAt: Date | null } | null }[],
            ),
        showTrash && workspaceIds.length
          ? prisma.folder.findMany({
              where: {
                workspaceId: { in: workspaceIds },
                deletedAt: { not: null },
                workspace: { deletedAt: null },
              },
              select: { id: true, parentId: true },
            })
          : Promise.resolve([] as { id: string; parentId: string | null }[]),
        showTrash ? resolveTrashedWorkspaces(userId, platformRole) : Promise.resolve([]),
        showUsers
          ? prisma.user.count({ where: { deletedAt: null } })
          : Promise.resolve(0),
      ]);

    const visibleTrashFolders = filterVisibleTrashFolders(trashedFolders).length;
    const visibleTrashDocs = filterVisibleTrashDocuments(trashedDocs).length;
    const trashCount = showTrash
      ? visibleTrashDocs + visibleTrashFolders + trashedWorkspaces.length
      : 0;

    const recentActivity = await listRecentAuditActivity({
      limit: 10,
      userId,
      platformRole,
      workspaceIds,
    });

    res.json({
      stats: {
        users: showUsers ? userCount : undefined,
        documents: documentCount,
        workspaces: workspaceCount,
        trash: showTrash ? trashCount : undefined,
      },
      cards: {
        users: showUsers,
        documents: true,
        workspaces: true,
        trash: showTrash,
      },
      platformRole,
      recentActivity,
    });
  } catch (err) {
    next(err);
  }
});
