import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { canAccessTrash, getPlatformRole } from "../services/platform";
import { listRecentAuditActivity } from "../services/audit";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const platformRole = await getPlatformRole(userId);

    let workspaceIds: string[] = [];
    if (platformRole === "admin") {
      const all = await prisma.workspace.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      workspaceIds = all.map((w) => w.id);
    } else {
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
      workspaceIds = [
        ...new Set([
          ...memberships.map((m) => m.workspaceId),
          ...created.map((w) => w.id),
        ]),
      ];
    }

    const showTrash = canAccessTrash(platformRole);
    const showUsers = platformRole === "admin" || platformRole === "owner";

    const [workspaceCount, documentCount, trashedDocs, trashedFolders, userCount] =
      await Promise.all([
        Promise.resolve(workspaceIds.length),
        workspaceIds.length
          ? prisma.document.count({
              where: { workspaceId: { in: workspaceIds }, deletedAt: null },
            })
          : Promise.resolve(0),
        showTrash
          ? workspaceIds.length
            ? prisma.document.findMany({
                where: {
                  deletedAt: { not: null },
                  OR: [{ ownerId: userId }, { workspaceId: { in: workspaceIds } }],
                },
                select: {
                  folderId: true,
                  folder: { select: { deletedAt: true } },
                },
              })
            : prisma.document.findMany({
                where: { ownerId: userId, deletedAt: { not: null } },
                select: {
                  folderId: true,
                  folder: { select: { deletedAt: true } },
                },
              })
          : Promise.resolve([] as { folderId: string | null; folder: { deletedAt: Date | null } | null }[]),
        showTrash && workspaceIds.length
          ? prisma.folder.findMany({
              where: { workspaceId: { in: workspaceIds }, deletedAt: { not: null } },
              select: { id: true, parentId: true },
            })
          : Promise.resolve([] as { id: string; parentId: string | null }[]),
        showUsers
          ? prisma.user.count({ where: { deletedAt: null } })
          : Promise.resolve(0),
      ]);

    const deletedFolderIds = new Set(trashedFolders.map((f) => f.id));
    const visibleTrashFolders = trashedFolders.filter(
      (f) => !f.parentId || !deletedFolderIds.has(f.parentId),
    ).length;
    const visibleTrashDocs = trashedDocs.filter(
      (d) => !d.folderId || !d.folder?.deletedAt,
    ).length;
    const trashCount = showTrash ? visibleTrashDocs + visibleTrashFolders : 0;

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
