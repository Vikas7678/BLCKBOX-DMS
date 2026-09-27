import { Router } from "express";
import { WorkspaceRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { requireMembership, canManageWorkspaceAsAdmin } from "../services/access";
import { mapDocumentListItems } from "../services/documentList";
import { assertUniqueNameAtLevel } from "../services/names";
import { collectDescendantFolderIds } from "../services/folders";
import { searchActiveUsers } from "../services/userSearch";
import { resolveAccessibleWorkspaceIds } from "../services/trash";
import { inviteExpiryDate, randomToken } from "../lib/tokens";
import { sendMail } from "../services/mailer";
import { config } from "../config";
import {
  canCreateWorkspace,
  canDeleteContent,
  getPlatformRole,
} from "../services/platform";
import { enqueuePurgeJob } from "../queue/purgeQueue";
import { parsePagination, paginationMeta, slicePage } from "../lib/pagination";
import { recordAudit } from "../services/audit";

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(""),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(""),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member"]),
});

const createFolderSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).optional().nullable(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

const addMembersSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.string().min(1),
        role: z.enum(["owner", "admin", "member"]),
      }),
    )
    .min(1),
});

function mapFolder(f: {
  id: string;
  name: string;
  workspaceId: string;
  parentId: string | null;
  createdAt: Date;
}) {
  return {
    id: f.id,
    name: f.name,
    workspaceId: f.workspaceId,
    parentId: f.parentId,
    createdAt: f.createdAt,
  };
}

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

workspacesRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const platformRole = await getPlatformRole(userId);
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

    type WsRow = {
      id: string;
      name: string;
      description: string;
      role: string;
      createdAt: Date;
    };

    let rows: WsRow[] = [];

    if (platformRole === "admin") {
      const workspaces = await prisma.workspace.findMany({
        where: { deletedAt: null },
        include: {
          members: {
            where: { userId },
            select: { role: true },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
      });
      rows = workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        role: w.members[0]?.role ?? "owner",
        createdAt: w.createdAt,
      }));
    } else if (platformRole === "owner") {
      // Memberships ∪ created workspaces. Membership role "owner" ≠ creator (createdById).
      const workspaceIds = await resolveAccessibleWorkspaceIds(userId, platformRole);
      const workspaces = workspaceIds.length
        ? await prisma.workspace.findMany({
            where: { deletedAt: null, id: { in: workspaceIds } },
            include: {
              members: {
                where: { userId },
                select: { role: true },
                take: 1,
              },
            },
            orderBy: { createdAt: "desc" },
          })
        : [];
      rows = workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        // Prefer membership role; creator without a row still shows as owner in the UI.
        role: w.members[0]?.role ?? "owner",
        createdAt: w.createdAt,
      }));
    } else {
      const memberships = await prisma.workspaceMember.findMany({
        where: { userId, workspace: { deletedAt: null } },
        include: { workspace: true },
        orderBy: { createdAt: "desc" },
      });
      rows = memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        description: m.workspace.description,
        role: m.role,
        createdAt: m.workspace.createdAt,
      }));
    }

    if (q) {
      rows = rows.filter((w) => w.name.toLowerCase().includes(q));
    }

    const { items: workspaces, meta } = slicePage(rows, page, limit);

    res.json({ workspaces, ...meta });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post("/", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canCreateWorkspace(platformRole)) {
      throw new HttpError(403, "Members cannot create workspaces");
    }
    const body = createWorkspaceSchema.parse(req.body);
    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: body.name.trim(),
          description: (body.description ?? "").trim(),
          createdById: req.user!.id,
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: req.user!.id,
          role: WorkspaceRole.owner,
        },
      });
      return ws;
    });
    recordAudit({
      actorUserId: req.user!.id,
      action: "workspace.created",
      entityType: "workspace",
      entityId: workspace.id,
      entityName: workspace.name,
      workspaceId: workspace.id,
      label: `Created Workspace: ${workspace.name}`,
      metadata: { path: workspace.name },
    });
    res.status(201).json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        role: "owner",
        createdAt: workspace.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.get("/:id", async (req, res, next) => {
  try {
    const membership = await requireMembership(req.params.id, req.user!.id);
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!workspace) {
      throw new HttpError(404, "Workspace not found");
    }
    res.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        role: membership.role,
        createdAt: workspace.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.patch("/:id", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const body = updateWorkspaceSchema.parse(req.body);
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!workspace) {
      throw new HttpError(404, "Workspace not found");
    }
    const updated = await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        name: body.name.trim(),
        description: (body.description ?? "").trim(),
      },
    });
    res.json({
      workspace: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        createdAt: updated.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.delete("/:id", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canDeleteContent(platformRole)) {
      throw new HttpError(403, "Members cannot delete workspaces");
    }
    await requireMembership(req.params.id, req.user!.id, ["owner"]);
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!workspace) {
      throw new HttpError(404, "Workspace not found");
    }

    const deletedAt = new Date();
    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: workspace.id },
        data: { deletedAt },
      }),
      prisma.folder.updateMany({
        where: { workspaceId: workspace.id, deletedAt: null },
        data: { deletedAt },
      }),
      prisma.document.updateMany({
        where: { workspaceId: workspace.id, deletedAt: null },
        data: { deletedAt },
      }),
    ]);

    recordAudit({
      actorUserId: req.user!.id,
      action: "workspace.trashed",
      entityType: "workspace",
      entityId: workspace.id,
      entityName: workspace.name,
      workspaceId: workspace.id,
      label: `Workspace moved to trashcan: ${workspace.name}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post("/:id/restore", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canDeleteContent(platformRole)) {
      throw new HttpError(403, "Members cannot restore workspaces");
    }
    if (!(await canManageWorkspaceAsAdmin(req.params.id, req.user!.id))) {
      throw new HttpError(403, "You cannot restore this workspace");
    }
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, deletedAt: { not: null } },
    });
    if (!workspace) {
      throw new HttpError(404, "Trashed workspace not found");
    }

    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: workspace.id },
        data: { deletedAt: null },
      }),
      prisma.folder.updateMany({
        where: { workspaceId: workspace.id, deletedAt: { not: null } },
        data: { deletedAt: null },
      }),
      prisma.document.updateMany({
        where: { workspaceId: workspace.id, deletedAt: { not: null } },
        data: { deletedAt: null },
      }),
    ]);

    recordAudit({
      actorUserId: req.user!.id,
      action: "workspace.restored",
      entityType: "workspace",
      entityId: workspace.id,
      entityName: workspace.name,
      workspaceId: workspace.id,
      label: `Workspace restored from trashcan: ${workspace.name}`,
    });
    res.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.delete("/:id/permanent", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canDeleteContent(platformRole)) {
      throw new HttpError(403, "Members cannot permanently delete workspaces");
    }
    if (!(await canManageWorkspaceAsAdmin(req.params.id, req.user!.id))) {
      throw new HttpError(403, "You cannot permanently delete this workspace");
    }
    const workspace = await prisma.workspace.findFirst({
      where: { id: req.params.id, deletedAt: { not: null } },
    });
    if (!workspace) {
      throw new HttpError(404, "Trashed workspace not found");
    }

    const { jobId } = await enqueuePurgeJob({
      requestedByUserId: req.user!.id,
      items: [{ kind: "workspace", workspaceId: workspace.id }],
    });
    res.status(202).json({
      queued: true,
      jobId,
      message: "Your delete request has been queued",
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.get("/:id/folders", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id);
    const folders = await prisma.folder.findMany({
      where: { workspaceId: req.params.id, deletedAt: null },
      orderBy: { name: "asc" },
    });
    res.json({
      folders: folders.map(mapFolder),
    });
  } catch (err) {
    next(err);
  }
});

/** Paginated folders + documents at one folder level (folders first). */
workspacesRouter.get("/:id/contents", async (req, res, next) => {
  try {
    const workspaceId = req.params.id;
    const userId = req.user!.id;
    await requireMembership(workspaceId, userId);
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const folderParam =
      typeof req.query.folderId === "string" ? req.query.folderId : "root";
    const parentId = folderParam === "root" || folderParam === "" ? null : folderParam;

    const folderWhere = {
      workspaceId,
      deletedAt: null as null,
      parentId,
    };
    const docWhere = {
      workspaceId,
      deletedAt: null as null,
      folderId: parentId,
    };

    const [folderTotal, docTotal] = await Promise.all([
      prisma.folder.count({ where: folderWhere }),
      prisma.document.count({ where: docWhere }),
    ]);
    const total = folderTotal + docTotal;
    const meta = paginationMeta(total, page, limit);

    let folders: ReturnType<typeof mapFolder>[] = [];
    let documents: {
      id: string;
      title: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      ownerId: string;
      workspaceId: string | null;
      folderId: string | null;
      createdAt: Date;
      canManage: boolean;
      canDelete: boolean;
    }[] = [];

    if (skip < folderTotal) {
      const folderRows = await prisma.folder.findMany({
        where: folderWhere,
        orderBy: { name: "asc" },
        skip,
        take: limit,
      });
      folders = folderRows.map(mapFolder);
      const remaining = limit - folders.length;
      if (remaining > 0) {
        const docs = await prisma.document.findMany({
          where: docWhere,
          orderBy: { createdAt: "desc" },
          skip: 0,
          take: remaining,
        });
        documents = await mapDocumentListItems(docs, userId);
      }
    } else {
      const docs = await prisma.document.findMany({
        where: docWhere,
        orderBy: { createdAt: "desc" },
        skip: skip - folderTotal,
        take: limit,
      });
      documents = await mapDocumentListItems(docs, userId);
    }

    res.json({ folders, documents, ...meta });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post("/:id/folders", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id);
    const body = createFolderSchema.parse(req.body);
    const parentId = body.parentId ?? null;

    if (parentId) {
      const parent = await prisma.folder.findFirst({
        where: {
          id: parentId,
          workspaceId: req.params.id,
          deletedAt: null,
        },
      });
      if (!parent) {
        throw new HttpError(404, "Parent folder not found");
      }
    }

    const name = body.name.trim();
    const nameKey = name.toLowerCase();

    // Serializable get-or-create so concurrent uploads cannot insert two same-name folders.
    const { folder, created } = await prisma.$transaction(
      async (tx) => {
        const siblings = await tx.folder.findMany({
          where: {
            workspaceId: req.params.id,
            parentId,
            deletedAt: null,
          },
        });
        const existing = siblings
          .filter((f) => f.name.trim().toLowerCase() === nameKey)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        if (existing) {
          return { folder: existing, created: false };
        }

        await assertUniqueNameAtLevel(
          {
            workspaceId: req.params.id,
            parentFolderId: parentId,
            name,
          },
          tx,
        );

        const createdFolder = await tx.folder.create({
          data: {
            name,
            workspaceId: req.params.id,
            parentId,
            createdById: req.user!.id,
          },
        });
        return { folder: createdFolder, created: true };
      },
      { isolationLevel: "Serializable" },
    );

    res.status(created ? 201 : 200).json({
      folder: mapFolder(folder),
    });

    if (created) {
      recordAudit({
        actorUserId: req.user!.id,
        action: "folder.created",
        entityType: "folder",
        entityId: folder.id,
        entityName: folder.name,
        workspaceId: folder.workspaceId,
        label: `Created Folder: ${folder.name}`,
        metadata: { parentId: folder.parentId },
      });
    }
  } catch (err) {
    next(err);
  }
});

workspacesRouter.delete("/:id/folders/:folderId", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canDeleteContent(platformRole)) {
      throw new HttpError(403, "Members cannot delete folders");
    }
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const folder = await prisma.folder.findFirst({
      where: {
        id: req.params.folderId,
        workspaceId: req.params.id,
        deletedAt: null,
      },
    });
    if (!folder) {
      throw new HttpError(404, "Folder not found");
    }

    const tree = await prisma.folder.findMany({
      where: { workspaceId: req.params.id, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const folderIds = collectDescendantFolderIds(folder.id, tree);
    const deletedAt = new Date();

    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { id: { in: folderIds } },
        data: { deletedAt },
      }),
      prisma.document.updateMany({
        where: { folderId: { in: folderIds }, deletedAt: null },
        data: { deletedAt },
      }),
    ]);
    recordAudit({
      actorUserId: req.user!.id,
      action: "folder.trashed",
      entityType: "folder",
      entityId: folder.id,
      entityName: folder.name,
      workspaceId: folder.workspaceId,
      label: `Folder moved to trashcan: ${folder.name}`,
      metadata: { folderIds },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post("/:id/folders/:folderId/restore", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canDeleteContent(platformRole)) {
      throw new HttpError(403, "Members cannot restore folders");
    }
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const folder = await prisma.folder.findFirst({
      where: {
        id: req.params.folderId,
        workspaceId: req.params.id,
        deletedAt: { not: null },
      },
    });
    if (!folder) {
      throw new HttpError(404, "Trashed folder not found");
    }

    // Restore ancestors first so the folder is reachable again
    const ancestors: string[] = [];
    let cursor = folder.parentId;
    while (cursor) {
      const parent = await prisma.folder.findUnique({ where: { id: cursor } });
      if (!parent || parent.workspaceId !== req.params.id) break;
      if (parent.deletedAt) ancestors.push(parent.id);
      cursor = parent.parentId;
    }

    const tree = await prisma.folder.findMany({
      where: { workspaceId: req.params.id },
      select: { id: true, parentId: true, deletedAt: true },
    });
    const descendantIds = collectDescendantFolderIds(
      folder.id,
      tree.map((f) => ({ id: f.id, parentId: f.parentId })),
    );
    const folderIds = [...new Set([...ancestors, ...descendantIds])];

    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { id: { in: folderIds }, deletedAt: { not: null } },
        data: { deletedAt: null },
      }),
      prisma.document.updateMany({
        where: { folderId: { in: descendantIds }, deletedAt: { not: null } },
        data: { deletedAt: null },
      }),
    ]);
    recordAudit({
      actorUserId: req.user!.id,
      action: "folder.restored",
      entityType: "folder",
      entityId: folder.id,
      entityName: folder.name,
      workspaceId: folder.workspaceId,
      label: `Folder restored from trashcan: ${folder.name}`,
    });
    res.json({
      folder: mapFolder(folder),
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.delete("/:id/folders/:folderId/permanent", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canDeleteContent(platformRole)) {
      throw new HttpError(403, "Members cannot permanently delete folders");
    }
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const folder = await prisma.folder.findFirst({
      where: {
        id: req.params.folderId,
        workspaceId: req.params.id,
        deletedAt: { not: null },
      },
    });
    if (!folder) {
      throw new HttpError(404, "Trashed folder not found");
    }

    const { jobId } = await enqueuePurgeJob({
      requestedByUserId: req.user!.id,
      items: [
        {
          kind: "folder",
          workspaceId: req.params.id,
          folderId: folder.id,
        },
      ],
    });
    res.status(202).json({
      queued: true,
      jobId,
      message: "Your delete request has been queued",
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.get("/:id/members", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: req.params.id },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      members: members.map((m) => ({
        id: m.id,
        role: m.role,
        user: m.user,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Platform users who can be added to this workspace (not already members). */
workspacesRouter.get("/:id/addable-users", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const existing = await prisma.workspaceMember.findMany({
      where: { workspaceId: req.params.id },
      select: { userId: true },
    });
    const users = await searchActiveUsers({
      q,
      excludeIds: existing.map((m) => m.userId),
      take: 50,
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post("/:id/members", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const body = addMembersSchema.parse(req.body ?? {});
    const workspaceId = req.params.id;

    const userIds = [...new Set(body.members.map((m) => m.userId))];
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        deletedAt: null,
        disabledAt: null,
      },
      select: { id: true, name: true, email: true },
    });
    if (users.length !== userIds.length) {
      throw new HttpError(400, "One or more users were not found or are disabled");
    }

    const already = await prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: userIds } },
      select: { userId: true },
    });
    if (already.length) {
      throw new HttpError(409, "One or more users are already members");
    }

    const roleByUser = new Map(body.members.map((m) => [m.userId, m.role]));
    await prisma.workspaceMember.createMany({
      data: userIds.map((userId) => ({
        workspaceId,
        userId,
        role: roleByUser.get(userId) ?? "member",
      })),
    });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    const wsName = workspace?.name ?? workspaceId;

    for (const u of users) {
      const role = roleByUser.get(u.id) ?? "member";
      recordAudit({
        actorUserId: req.user!.id,
        action: "workspace.member_added",
        entityType: "user",
        entityId: u.id,
        entityName: u.name || u.email,
        workspaceId,
        label: `Permission granted to ${u.name || u.email} in ${wsName}`,
        metadata: { path: wsName, role, workspaceId },
      });
    }

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: userIds } },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    res.status(201).json({
      members: members.map((m) => ({
        id: m.id,
        role: m.role,
        user: m.user,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.delete("/:id/members/:memberId", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const member = await prisma.workspaceMember.findFirst({
      where: { id: req.params.memberId, workspaceId: req.params.id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!member) {
      throw new HttpError(404, "Member not found");
    }
    if (member.userId === req.user!.id) {
      throw new HttpError(400, "You cannot remove yourself");
    }
    if (member.role === "owner") {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: req.params.id, role: "owner" },
      });
      if (ownerCount <= 1) {
        throw new HttpError(400, "Cannot remove the last owner");
      }
    }
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.params.id },
      select: { name: true },
    });
    const wsName = workspace?.name ?? req.params.id;
    await prisma.workspaceMember.delete({ where: { id: member.id } });
    recordAudit({
      actorUserId: req.user!.id,
      action: "workspace.member_removed",
      entityType: "user",
      entityId: member.user.id,
      entityName: member.user.name || member.user.email,
      workspaceId: req.params.id,
      label: `Permission revoked for ${member.user.name || member.user.email} in ${wsName}`,
      metadata: { path: wsName, role: member.role, workspaceId: req.params.id },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.patch("/:id/members/:memberId", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const body = updateMemberRoleSchema.parse(req.body);
    const member = await prisma.workspaceMember.findFirst({
      where: { id: req.params.memberId, workspaceId: req.params.id },
    });
    if (!member) {
      throw new HttpError(404, "Member not found");
    }

    if (member.role === "owner" && body.role !== "owner") {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: req.params.id, role: "owner" },
      });
      if (ownerCount <= 1) {
        throw new HttpError(400, "Cannot demote the last owner");
      }
    }

    const updated = await prisma.workspaceMember.update({
      where: { id: member.id },
      data: { role: body.role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    const workspace = await prisma.workspace.findUnique({
      where: { id: req.params.id },
      select: { name: true },
    });
    const wsName = workspace?.name ?? req.params.id;
    recordAudit({
      actorUserId: req.user!.id,
      action: "workspace.member_role_changed",
      entityType: "user",
      entityId: updated.user.id,
      entityName: updated.user.name || updated.user.email,
      workspaceId: req.params.id,
      label: `Role updated for ${updated.user.name || updated.user.email} in ${wsName}`,
      metadata: {
        path: wsName,
        oldRole: member.role,
        newRole: body.role,
        workspaceId: req.params.id,
      },
    });

    res.json({
      member: {
        id: updated.id,
        role: updated.role,
        user: updated.user,
        createdAt: updated.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post("/:id/invitations", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const body = inviteSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const existingMember = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId: req.params.id,
        user: { email },
      },
    });
    if (existingMember) {
      throw new HttpError(409, "User is already a workspace member");
    }

    const token = randomToken(32);
    const invite = await prisma.workspaceInvitation.create({
      data: {
        workspaceId: req.params.id,
        email,
        role: body.role,
        token,
        expiresAt: inviteExpiryDate(7),
        createdById: req.user!.id,
      },
    });

    const url = `${config.publicWebUrl}/invite/${invite.token}`;
    const mail = await sendMail({
      to: email,
      subject: "You've been invited to a BLCKBOX workspace",
      text: `You have been invited to join a workspace on BLCKBOX.\n\nOpen this link to accept:\n${url}\n\nThis invitation expires on ${invite.expiresAt.toISOString()}.`,
    });
    if (!mail.sent) {
      console.log(`[invite] ${email} → ${url} (email not sent: ${mail.reason})`);
    }

    res.status(201).json({
      invitation: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token: invite.token,
        url,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        emailSent: mail.sent,
      },
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.get("/:id/invitations", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const invitations = await prisma.workspaceInvitation.findMany({
      where: {
        workspaceId: req.params.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        url: `${config.publicWebUrl}/invite/${i.token}`,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.delete("/:id/invitations/:invitationId", async (req, res, next) => {
  try {
    await requireMembership(req.params.id, req.user!.id, ["owner", "admin"]);
    const invite = await prisma.workspaceInvitation.findFirst({
      where: { id: req.params.invitationId, workspaceId: req.params.id },
    });
    if (!invite) {
      throw new HttpError(404, "Invitation not found");
    }
    await prisma.workspaceInvitation.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
