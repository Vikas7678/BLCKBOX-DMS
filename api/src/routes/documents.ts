import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { randomUUID } from "crypto";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { canAccessDocument, canManageDocument, canDeleteDocument, requireDocumentAccess, requireDocumentManage, requireMembership, canAccessTrashedDocument, canPurgeTrashedDocument, canRestoreTrashedDocument, canManageWorkspaceAsAdmin, isInternalShareOnlyAccess } from "../services/access";
import { canAccessTrash, canDeleteContent, getPlatformRole } from "../services/platform";
import { enqueuePurgeJob, type PurgeItem } from "../queue/purgeQueue";
import { assertUniqueNameAtLevel } from "../services/names";
import {
  buildOnlyOfficePreviewPayload,
  createContentAccessToken,
  verifyContentAccessToken,
} from "../services/onlyoffice";
import { getStorage } from "../services/storageSettings";
import { parsePagination, slicePage } from "../lib/pagination";
import { recordAudit, recordAuditOnce } from "../services/audit";
import { resolveAccessibleWorkspaceIds, resolveTrashedWorkspaces, filterVisibleTrashFolders, filterVisibleTrashDocuments } from "../services/trash";

/** Staging dir: Multer writes here first (not RAM). S3 uploads stream from here then delete. */
const incomingDir = path.resolve(config.storagePath, ".incoming");

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      void fs.mkdir(incomingDir, { recursive: true }).then(
        () => cb(null, incomingDir),
        (err) => cb(err as Error, incomingDir),
      );
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${path.extname(file.originalname) || ""}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes },
});

async function removeStagingFile(filePath: string | undefined) {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => undefined);
}

const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const documentsRouter = Router();

/** Fetched by OnlyOffice Document Server (no cookie — query token). */
documentsRouter.get("/:id/content", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      throw new HttpError(401, "Missing content token");
    }
    let claims: { documentId: string; userId?: string; shareToken?: string };
    try {
      claims = verifyContentAccessToken(token);
    } catch {
      throw new HttpError(401, "Invalid or expired content token");
    }
    if (claims.documentId !== req.params.id) {
      throw new HttpError(403, "Token does not match document");
    }

    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc || doc.deletedAt) {
      throw new HttpError(404, "Document not found");
    }

    if (claims.shareToken) {
      const link = await prisma.shareLink.findUnique({
        where: { token: claims.shareToken },
        include: {
          documents: { select: { documentId: true } },
        },
      });
      const allowedIds = new Set<string>([
        ...(link ? [link.documentId] : []),
        ...(link?.documents.map((d) => d.documentId) ?? []),
      ]);
      if (
        !link ||
        link.revokedAt ||
        !allowedIds.has(doc.id) ||
        link.expiresAt < new Date()
      ) {
        throw new HttpError(403, "Share link is not valid");
      }
    } else if (claims.userId) {
      const ok = await canAccessDocument(doc, claims.userId);
      if (!ok) {
        throw new HttpError(403, "You do not have access to this document");
      }
    } else {
      throw new HttpError(403, "You do not have access to this document");
    }

    const stream = await (await getStorage()).getStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(doc.filename)}"`,
    );
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

documentsRouter.use(requireAuth);

/** Soft-deleted workspaces / docs / folders visible to the caller. */
documentsRouter.get("/trash", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const platformRole = await getPlatformRole(userId);
    if (!canAccessTrash(platformRole)) {
      throw new HttpError(403, "You cannot access trash");
    }
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const q =
      typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

    const workspaceIds = await resolveAccessibleWorkspaceIds(userId, platformRole);
    const trashedWorkspaces = await resolveTrashedWorkspaces(userId, platformRole);

    const [docs, folders] = await Promise.all([
      prisma.document.findMany({
        where: {
          deletedAt: { not: null },
          // Hide contents already covered by a trashed workspace row.
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
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          title: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          ownerId: true,
          workspaceId: true,
          folderId: true,
          createdAt: true,
          deletedAt: true,
          owner: { select: { id: true, name: true } },
          workspace: { select: { id: true, name: true } },
          folder: { select: { id: true, name: true, deletedAt: true, parentId: true } },
        },
      }),
      workspaceIds.length
        ? prisma.folder.findMany({
            where: {
              deletedAt: { not: null },
              workspaceId: { in: workspaceIds },
              workspace: { deletedAt: null },
            },
            orderBy: { deletedAt: "desc" },
            select: {
              id: true,
              name: true,
              parentId: true,
              workspaceId: true,
              createdAt: true,
              deletedAt: true,
              createdBy: { select: { id: true, name: true } },
              workspace: { select: { id: true, name: true } },
              documents: {
                where: { deletedAt: { not: null } },
                select: { sizeBytes: true },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    // Only show the root of a cascaded delete in trash lists
    // not every nested folder/file that was soft-deleted with it.
    const visibleFolders = filterVisibleTrashFolders(folders);
    const visibleDocs = filterVisibleTrashDocuments(docs);

    const workspaceSizeById = new Map<string, number>();
    if (trashedWorkspaces.length) {
      const sizes = await prisma.document.groupBy({
        by: ["workspaceId"],
        where: {
          workspaceId: { in: trashedWorkspaces.map((w) => w.id) },
          deletedAt: { not: null },
        },
        _sum: { sizeBytes: true },
      });
      for (const row of sizes) {
        if (row.workspaceId) {
          workspaceSizeById.set(row.workspaceId, row._sum.sizeBytes ?? 0);
        }
      }
    }

    // Build folder paths from live ancestors + name
    const allFoldersForPath = workspaceIds.length
      ? await prisma.folder.findMany({
          where: { workspaceId: { in: workspaceIds } },
          select: { id: true, name: true, parentId: true },
        })
      : [];
    const folderById = new Map(allFoldersForPath.map((f) => [f.id, f]));

    function folderPath(folderId: string, workspaceName: string): string {
      const parts: string[] = [];
      let cursor: string | null = folderId;
      while (cursor) {
        const f = folderById.get(cursor);
        if (!f) break;
        parts.unshift(f.name);
        cursor = f.parentId;
      }
      return [workspaceName, ...parts].filter(Boolean).join(" / ");
    }

    type TrashRow =
      | {
          kind: "workspace";
          sortAt: number;
          workspace: {
            id: string;
            name: string;
            createdAt: Date;
            deletedAt: Date;
            deletedBy: string;
            sizeBytes: number;
            path: string;
          };
        }
      | {
          kind: "folder";
          sortAt: number;
          folder: {
            id: string;
            name: string;
            workspaceId: string;
            createdAt: Date;
            deletedAt: Date | null;
            deletedBy: string;
            sizeBytes: number;
            path: string;
            workspaceName: string;
          };
        }
      | {
          kind: "doc";
          sortAt: number;
          document: {
            id: string;
            title: string;
            filename: string;
            mimeType: string;
            sizeBytes: number;
            ownerId: string;
            workspaceId: string | null;
            folderId: string | null;
            createdAt: Date;
            deletedAt: Date | null;
            deletedBy: string;
            path: string;
            workspaceName: string | null;
            folderName: string | null;
          };
        };

    let rows: TrashRow[] = [
      ...trashedWorkspaces.map((w) => ({
        kind: "workspace" as const,
        sortAt: w.deletedAt.getTime(),
        workspace: {
          id: w.id,
          name: w.name,
          createdAt: w.createdAt,
          deletedAt: w.deletedAt,
          deletedBy: w.createdBy.name,
          sizeBytes: workspaceSizeById.get(w.id) ?? 0,
          path: w.name,
        },
      })),
      ...visibleFolders.map((f) => ({
        kind: "folder" as const,
        sortAt: f.deletedAt?.getTime() ?? 0,
        folder: {
          id: f.id,
          name: f.name,
          workspaceId: f.workspaceId,
          createdAt: f.createdAt,
          deletedAt: f.deletedAt,
          deletedBy: f.createdBy.name,
          sizeBytes: f.documents.reduce((sum, doc) => sum + doc.sizeBytes, 0),
          path: folderPath(f.id, f.workspace.name),
          workspaceName: f.workspace.name,
        },
      })),
      ...visibleDocs.map((d) => ({
        kind: "doc" as const,
        sortAt: d.deletedAt?.getTime() ?? 0,
        document: {
          id: d.id,
          title: d.title,
          filename: d.filename,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          ownerId: d.ownerId,
          workspaceId: d.workspaceId,
          folderId: d.folderId,
          createdAt: d.createdAt,
          deletedAt: d.deletedAt,
          deletedBy: d.owner.name,
          path:
            d.folderId && d.workspace
              ? folderPath(d.folderId, d.workspace.name)
              : d.workspace?.name ?? "/",
          workspaceName: d.workspace?.name ?? null,
          folderName: d.folder?.name ?? null,
        },
      })),
    ].sort((a, b) => b.sortAt - a.sortAt);

    if (q) {
      rows = rows.filter((row) => {
        if (row.kind === "workspace") {
          return (
            row.workspace.name.toLowerCase().includes(q) ||
            row.workspace.path.toLowerCase().includes(q)
          );
        }
        if (row.kind === "folder") {
          return (
            row.folder.name.toLowerCase().includes(q) ||
            row.folder.path.toLowerCase().includes(q)
          );
        }
        return (
          row.document.title.toLowerCase().includes(q) ||
          row.document.filename.toLowerCase().includes(q) ||
          row.document.path.toLowerCase().includes(q)
        );
      });
    }

    const { items, meta } = slicePage(rows, page, limit);

    res.json({
      workspaces: items.filter((r) => r.kind === "workspace").map((r) => r.workspace),
      documents: items.filter((r) => r.kind === "doc").map((r) => r.document),
      folders: items.filter((r) => r.kind === "folder").map((r) => r.folder),
      ...meta,
    });
  } catch (err) {
    next(err);
  }
});
const bulkPurgeSchema = z.object({
  documents: z.array(z.string().min(1)).default([]),
  folders: z
    .array(
      z.object({
        workspaceId: z.string().min(1),
        folderId: z.string().min(1),
      }),
    )
    .default([]),
  workspaces: z.array(z.string().min(1)).default([]),
});

/** Queue permanent delete for selected trash items (workspaces + docs + folders). */
documentsRouter.post("/trash/purge", async (req, res, next) => {
  try {
    const body = bulkPurgeSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    const platformRole = await getPlatformRole(userId);
    if (!canAccessTrash(platformRole)) {
      throw new HttpError(403, "You cannot access trash");
    }

    const items: PurgeItem[] = [];

    for (const workspaceId of body.workspaces) {
      if (!canDeleteContent(platformRole)) continue;
      if (!(await canManageWorkspaceAsAdmin(workspaceId, userId))) continue;
      const found = await prisma.workspace.findFirst({
        where: { id: workspaceId, deletedAt: { not: null } },
      });
      if (found) {
        items.push({ kind: "workspace", workspaceId: found.id });
      }
    }

    for (const documentId of body.documents) {
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc || !doc.deletedAt) continue;
      const canSee = await canAccessTrashedDocument(doc, userId);
      if (!canSee) continue;

      if (await canPurgeTrashedDocument(doc, userId)) {
        items.push({ kind: "document", documentId: doc.id });
      }
    }

    for (const folder of body.folders) {
      if (!canDeleteContent(platformRole)) {
        continue;
      }
      if (!(await canManageWorkspaceAsAdmin(folder.workspaceId, userId))) {
        continue;
      }
      const found = await prisma.folder.findFirst({
        where: {
          id: folder.folderId,
          workspaceId: folder.workspaceId,
          deletedAt: { not: null },
        },
      });
      if (found) {
        items.push({
          kind: "folder",
          workspaceId: folder.workspaceId,
          folderId: found.id,
        });
      }
    }

    if (!items.length) {
      throw new HttpError(400, "No items to delete");
    }

    const { jobId } = await enqueuePurgeJob({
      requestedByUserId: userId,
      items,
    });
    res.status(202).json({
      queued: true,
      jobId,
      count: items.length,
      message: "Your delete request has been queued",
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.post("/:id/restore", async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc || !doc.deletedAt) {
      throw new HttpError(404, "Trashed document not found");
    }
    const canSee = await canAccessTrashedDocument(doc, req.user!.id);
    if (!canSee) {
      throw new HttpError(403, "You cannot restore this document");
    }

    if (!(await canRestoreTrashedDocument(doc, req.user!.id))) {
      throw new HttpError(403, "You cannot restore this document");
    }

    if (doc.folderId) {
      const parentFolder = await prisma.folder.findUnique({ where: { id: doc.folderId } });
      if (parentFolder?.deletedAt) {
        await prisma.folder.update({
          where: { id: parentFolder.id },
          data: { deletedAt: null },
        });
      }
    }

    const restored = await prisma.document.update({
      where: { id: doc.id },
      data: { deletedAt: null },
    });
    recordAudit({
      actorUserId: req.user!.id,
      action: "document.restored",
      entityType: "document",
      entityId: restored.id,
      entityName: restored.title || restored.filename,
      workspaceId: restored.workspaceId,
      label: `Document restored from trashcan: ${restored.title || restored.filename}`,
    });
    res.json({
      document: {
        id: restored.id,
        title: restored.title,
        filename: restored.filename,
        mimeType: restored.mimeType,
        sizeBytes: restored.sizeBytes,
        ownerId: restored.ownerId,
        workspaceId: restored.workspaceId,
        createdAt: restored.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.post("/", upload.single("file"), async (req, res, next) => {
  const stagingPath = req.file?.path;
  try {
    if (!req.file || !stagingPath) {
      throw new HttpError(400, "file is required");
    }
    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      await removeStagingFile(stagingPath);
      throw new HttpError(400, "File type not allowed");
    }

    const workspaceId =
      typeof req.body.workspaceId === "string" && req.body.workspaceId.length > 0
        ? req.body.workspaceId
        : null;
    const title =
      typeof req.body.title === "string" && req.body.title.trim()
        ? req.body.title.trim()
        : req.file.originalname;

    const userId = req.user!.id;
    if (!workspaceId) {
      await removeStagingFile(stagingPath);
      throw new HttpError(400, "workspaceId is required — upload documents inside a workspace");
    }
    await requireMembership(workspaceId, userId);

    const folderId =
      typeof req.body.folderId === "string" && req.body.folderId.length > 0
        ? req.body.folderId
        : null;
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, workspaceId, deletedAt: null },
      });
      if (!folder) {
        await removeStagingFile(stagingPath);
        throw new HttpError(400, "Folder not found in this workspace");
      }
    }

    await assertUniqueNameAtLevel({
      workspaceId,
      parentFolderId: folderId,
      name: req.file.originalname,
    });

    const storageKey = path.posix.join(
      workspaceId ?? "personal",
      userId,
      `${randomUUID()}${path.extname(req.file.originalname) || ""}`,
    );

    // Disk-first: staging file already on disk from Multer.
    // Local provider moves it into permanent storage; S3 streams from disk then we delete staging.
    const stored = await (await getStorage()).putFromFile(
      storageKey,
      stagingPath,
      req.file.mimetype,
    );
    await removeStagingFile(stagingPath);

    const doc = await prisma.document.create({
      data: {
        title,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: stored.sizeBytes,
        storageKey,
        ownerId: userId,
        updatedById: userId,
        workspaceId,
        folderId,
      },
    });

    recordAudit({
      actorUserId: userId,
      action: "document.created",
      entityType: "document",
      entityId: doc.id,
      entityName: doc.title || doc.filename,
      workspaceId,
      label: `Created Document: ${doc.title || doc.filename}`,
      metadata: { filename: doc.filename, sizeBytes: doc.sizeBytes, folderId },
    });

    res.status(201).json({ document: doc });
  } catch (err) {
    await removeStagingFile(stagingPath);
    next(err);
  }
});

documentsRouter.get("/:id/onlyoffice", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    const contentToken = createContentAccessToken(doc.id, req.user!.id);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { name: true, email: true },
    });

    const payload = buildOnlyOfficePreviewPayload(doc, {
      contentToken,
      documentKey: `blckbox-${doc.id}-${doc.updatedAt.getTime()}`,
      viewer: {
        id: req.user!.id,
        name: user?.name || req.user!.email,
      },
    });

    recordAuditOnce(
      {
        actorUserId: req.user!.id,
        action: "document.previewed",
        entityType: "document",
        entityId: doc.id,
        entityName: doc.title || doc.filename,
        workspaceId: doc.workspaceId,
        label: `Viewed Document: ${doc.title || doc.filename}`,
      },
      { key: `audit:dedupe:preview:${req.user!.id}:${doc.id}`, ttlSeconds: 60 },
    );

    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    const [owner, updatedBy] = await Promise.all([
      prisma.user.findUnique({
        where: { id: doc.ownerId },
        select: { id: true, name: true },
      }),
      doc.updatedById
        ? prisma.user.findUnique({
            where: { id: doc.updatedById },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);
    res.json({
      document: {
        id: doc.id,
        title: doc.title,
        filename: doc.filename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        ownerId: doc.ownerId,
        owner: owner ? { id: owner.id, name: owner.name } : null,
        updatedById: doc.updatedById,
        updatedBy: updatedBy ? { id: updatedBy.id, name: updatedBy.name } : null,
        workspaceId: doc.workspaceId,
        folderId: doc.folderId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        canManage: await canManageDocument(doc, req.user!.id),
        canDelete: await canDeleteDocument(doc, req.user!.id),
        accessViaInternalShare: await isInternalShareOnlyAccess(doc, req.user!.id),
      },
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.put("/:id/rename", async (req, res, next) => {
  try {
    const doc = await requireDocumentManage(
      req.params.id,
      req.user!.id,
      "You cannot rename this document",
    );

    const body = z
      .object({
        name: z.string().trim().min(1).max(255),
      })
      .parse(req.body);

    const currentExt = path.extname(doc.filename);
    let nextName = body.name.trim();
    const nextExt = path.extname(nextName);

    if (currentExt) {
      if (!nextExt) {
        nextName = `${nextName}${currentExt}`;
      } else if (nextExt.toLowerCase() !== currentExt.toLowerCase()) {
        throw new HttpError(400, "File extension cannot be changed");
      }
    }

    if (nextName === doc.filename) {
      throw new HttpError(400, "Name is unchanged");
    }

    if (doc.workspaceId) {
      await assertUniqueNameAtLevel({
        workspaceId: doc.workspaceId,
        parentFolderId: doc.folderId ?? null,
        name: nextName,
        excludeDocumentId: doc.id,
      });
    }

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        filename: nextName,
        title: nextName,
        updatedById: req.user!.id,
      },
    });

    recordAudit({
      actorUserId: req.user!.id,
      action: "document.renamed",
      entityType: "document",
      entityId: updated.id,
      entityName: updated.filename,
      workspaceId: updated.workspaceId,
      label: `Renamed Document: ${doc.filename} → ${updated.filename}`,
      metadata: { oldName: doc.filename, newName: updated.filename },
    });

    const [owner, updatedBy] = await Promise.all([
      prisma.user.findUnique({
        where: { id: updated.ownerId },
        select: { id: true, name: true },
      }),
      updated.updatedById
        ? prisma.user.findUnique({
            where: { id: updated.updatedById },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    res.json({
      document: {
        id: updated.id,
        title: updated.title,
        filename: updated.filename,
        mimeType: updated.mimeType,
        sizeBytes: updated.sizeBytes,
        ownerId: updated.ownerId,
        owner: owner ? { id: owner.id, name: owner.name } : null,
        updatedById: updated.updatedById,
        updatedBy: updatedBy ? { id: updatedBy.id, name: updatedBy.name } : null,
        workspaceId: updated.workspaceId,
        folderId: updated.folderId,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/download", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    recordAudit({
      actorUserId: req.user!.id,
      action: "document.downloaded",
      entityType: "document",
      entityId: doc.id,
      entityName: doc.title || doc.filename,
      workspaceId: doc.workspaceId,
      label: `Downloaded Document: ${doc.title || doc.filename}`,
    });
    const stream = await (await getStorage()).getStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.filename)}"`);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    const allowed = await canDeleteDocument(doc, req.user!.id);
    if (!allowed) {
      throw new HttpError(403, "You cannot delete this document");
    }
    await prisma.$transaction([
      prisma.document.update({
        where: { id: doc.id },
        data: { deletedAt: new Date() },
      }),
      prisma.shareLink.updateMany({
        where: { documentId: doc.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.documentShare.updateMany({
        where: { documentId: doc.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    recordAudit({
      actorUserId: req.user!.id,
      action: "document.trashed",
      entityType: "document",
      entityId: doc.id,
      entityName: doc.title || doc.filename,
      workspaceId: doc.workspaceId,
      label: `Document moved to trashcan: ${doc.title || doc.filename}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete("/:id/permanent", async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc || !doc.deletedAt) {
      throw new HttpError(404, "Trashed document not found");
    }
    const canSee = await canAccessTrashedDocument(doc, req.user!.id);
    if (!canSee) {
      throw new HttpError(403, "You cannot permanently delete this document");
    }

    if (!(await canPurgeTrashedDocument(doc, req.user!.id))) {
      throw new HttpError(403, "You cannot permanently delete this document");
    }

    const { jobId } = await enqueuePurgeJob({
      requestedByUserId: req.user!.id,
      items: [{ kind: "document", documentId: doc.id }],
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
