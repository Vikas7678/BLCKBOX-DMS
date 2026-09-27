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
import { canAccessDocument, canManageDocument, canDeleteDocument, requireDocumentAccess, requireMembership, canAccessTrashedDocument } from "../services/access";
import { canAccessTrash, canDeleteContent, getPlatformRole } from "../services/platform";
import { enqueuePurgeJob, type PurgeItem } from "../queue/purgeQueue";
import { assertUniqueNameAtLevel } from "../services/names";
import {
  buildContentUrl,
  buildBrowserContentUrl,
  createContentAccessToken,
  fileExtension,
  getOnlyOfficeDocumentType,
  isImageFile,
  signOnlyOfficeConfig,
  verifyContentAccessToken,
} from "../services/onlyoffice";
import { randomToken } from "../lib/tokens";
import bcrypt from "bcryptjs";
import { sendMail } from "../services/mailer";
import { getStorage } from "../services/storageSettings";
import { parsePagination, paginationMeta, slicePage } from "../lib/pagination";
import { recordAudit, recordAuditOnce } from "../services/audit";

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

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    let workspaceIds = memberships.map((m) => m.workspaceId);
    if (platformRole === "admin") {
      const all = await prisma.workspace.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      workspaceIds = all.map((w) => w.id);
    } else if (platformRole === "owner") {
      const created = await prisma.workspace.findMany({
        where: { deletedAt: null, createdById: userId },
        select: { id: true },
      });
      workspaceIds = [...new Set([...workspaceIds, ...created.map((w) => w.id)])];
    }

    const [docs, folders] = await Promise.all([
      prisma.document.findMany({
        where: {
          deletedAt: { not: null },
          OR: [
            { ownerId: userId },
            ...(workspaceIds.length ? [{ workspaceId: { in: workspaceIds } }] : []),
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

    // Like Angora isVisibleInList: only show the root of a cascaded delete,
    // not every nested folder/file that was soft-deleted with it.
    const deletedFolderIds = new Set(folders.map((f) => f.id));
    const visibleFolders = folders.filter(
      (f) => !f.parentId || !deletedFolderIds.has(f.parentId),
    );
    const visibleDocs = docs.filter(
      (d) => !d.folderId || !d.folder?.deletedAt,
    );

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
});

documentsRouter.post("/trash/purge", async (req, res, next) => {
  try {
    const body = bulkPurgeSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    const platformRole = await getPlatformRole(userId);
    if (!canAccessTrash(platformRole)) {
      throw new HttpError(403, "You cannot access trash");
    }

    const items: PurgeItem[] = [];

    for (const documentId of body.documents) {
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc || !doc.deletedAt) continue;
      const canSee = await canAccessTrashedDocument(doc, userId);
      if (!canSee) continue;

      let canPurge = platformRole === "admin" || doc.ownerId === userId;
      if (!canPurge && doc.workspaceId) {
        const membership = await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: doc.workspaceId, userId },
          },
        });
        canPurge = membership?.role === "owner" || membership?.role === "admin";
        if (!canPurge && platformRole === "owner") {
          const ws = await prisma.workspace.findFirst({
            where: { id: doc.workspaceId, createdById: userId, deletedAt: null },
            select: { id: true },
          });
          canPurge = Boolean(ws);
        }
      }
      if (canPurge) {
        items.push({ kind: "document", documentId: doc.id });
      }
    }

    for (const folder of body.folders) {
      if (!canDeleteContent(platformRole)) {
        continue;
      }
      try {
        await requireMembership(folder.workspaceId, userId, ["owner", "admin"]);
      } catch {
        if (platformRole !== "admin") continue;
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

    let canRestore = doc.ownerId === req.user!.id;
    if (!canRestore && doc.workspaceId) {
      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: doc.workspaceId, userId: req.user!.id },
        },
      });
      canRestore = membership?.role === "owner" || membership?.role === "admin";
    }
    if (!canRestore) {
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

documentsRouter.get("/", async (req, res, next) => {
  try {
    const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
    const userId = req.user!.id;
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);

    if (workspaceId) {
      await requireMembership(workspaceId, userId);
      const folderParam =
        typeof req.query.folderId === "string" ? req.query.folderId : undefined;
      const where = {
        workspaceId,
        deletedAt: null as null,
        ...(folderParam === "root"
          ? { folderId: null }
          : folderParam
            ? { folderId: folderParam }
            : {}),
      };
      const [total, docs] = await Promise.all([
        prisma.document.count({ where }),
        prisma.document.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
      ]);
      const documents = await Promise.all(
        docs.map(async (doc) => ({
          id: doc.id,
          title: doc.title,
          filename: doc.filename,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          ownerId: doc.ownerId,
          workspaceId: doc.workspaceId,
          folderId: doc.folderId,
          createdAt: doc.createdAt,
          canManage: await canManageDocument(doc, userId),
          canDelete: await canDeleteDocument(doc, userId),
        })),
      );
      return res.json({ documents, ...paginationMeta(total, page, limit) });
    }

    const where = { ownerId: userId, workspaceId: null as null, deletedAt: null as null };
    const [total, docs] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const documents = await Promise.all(
      docs.map(async (doc) => ({
        id: doc.id,
        title: doc.title,
        filename: doc.filename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        ownerId: doc.ownerId,
        workspaceId: doc.workspaceId,
        createdAt: doc.createdAt,
        canManage: await canManageDocument(doc, userId),
        canDelete: await canDeleteDocument(doc, userId),
      })),
    );
    return res.json({ documents, ...paginationMeta(total, page, limit) });
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
      kind: "file",
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
    const documentType = getOnlyOfficeDocumentType(doc.filename);
    const image =
      isImageFile(doc.filename) || doc.mimeType.startsWith("image/");

    if (!documentType && !image) {
      throw new HttpError(400, "Preview is not available for this file type");
    }

    const contentToken = createContentAccessToken(doc.id, req.user!.id);
    const contentUrl = buildContentUrl(doc.id, contentToken);

    if (image) {
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
      return res.json({
        mode: "image" as const,
        documentServerUrl: config.onlyOfficeUrl,
        title: doc.title || doc.filename,
        url: buildBrowserContentUrl(doc.id, contentToken),
        mimeType: doc.mimeType,
      });
    }

    const ext = fileExtension(doc.filename);
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { name: true, email: true },
    });
    const editorConfig = {
      document: {
        fileType: ext,
        key: `blckbox-${doc.id}-${doc.updatedAt.getTime()}`,
        title: doc.title || doc.filename,
        url: contentUrl,
        permissions: {
          print: false,
          download: false,
          edit: false,
          comment: false,
        },
      },
      editorConfig: {
        mode: "view" as const,
        user: {
          id: req.user!.id,
          name: user?.name || req.user!.email,
        },
        customization: {
          compactHeader: true,
          compactToolbar: true,
          chat: false,
          help: false,
          plugins: false,
          zoom: 100,
        },
      },
      documentType,
    };

    const token = signOnlyOfficeConfig(editorConfig);

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

    return res.json({
      mode: "onlyoffice" as const,
      documentServerUrl: config.onlyOfficeUrl,
      config: { ...editorConfig, token },
    });
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
      },
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.put("/:id/rename", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    const allowed = await canManageDocument(doc, req.user!.id);
    if (!allowed) {
      throw new HttpError(403, "You cannot rename this document");
    }

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
        kind: "file",
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

    const platformRole = await getPlatformRole(req.user!.id);
    let canPurge = platformRole === "admin" || doc.ownerId === req.user!.id;
    if (!canPurge && doc.workspaceId) {
      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: doc.workspaceId, userId: req.user!.id },
        },
      });
      canPurge = membership?.role === "owner" || membership?.role === "admin";
      if (!canPurge && platformRole === "owner") {
        const ws = await prisma.workspace.findFirst({
          where: { id: doc.workspaceId, createdById: req.user!.id, deletedAt: null },
          select: { id: true },
        });
        canPurge = Boolean(ws);
      }
    }
    if (!canPurge) {
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

const shareSchema = z.object({
  expiresAt: z.string().datetime(),
  password: z.string().min(4).max(100).optional().nullable(),
  email: z.string().email().optional().nullable(),
  message: z.string().max(2000).optional().default(""),
});

documentsRouter.post("/:id/share-links", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    const allowed = await canManageDocument(doc, req.user!.id);
    if (!allowed) {
      throw new HttpError(403, "You cannot share this document");
    }
    const body = shareSchema.parse(req.body ?? {});
    const expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new HttpError(400, "Expiry must be in the future");
    }
    const token = randomToken(32);
    const passwordPlain = body.password?.trim() || "";
    const passwordHash = passwordPlain ? await bcrypt.hash(passwordPlain, 10) : null;
    const email = body.email?.toLowerCase().trim() || "";

    const link = await prisma.shareLink.create({
      data: {
        documentId: doc.id,
        token,
        expiresAt,
        passwordHash,
        recipientEmail: email,
        message: body.message ?? "",
        allowDownload: true,
        createdById: req.user!.id,
      },
    });

    const url = `${config.publicWebUrl}/s/${link.token}`;
    let emailSent = false;
    if (email) {
      const { buildExternalShareEmail } = await import("../services/shareEmails");
      const sharer = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });
      const mailContent = buildExternalShareEmail({
        sharerName: sharer?.name || req.user!.email,
        documentName: doc.title || doc.filename,
        expiresAt,
        url,
        message: body.message,
        password: passwordPlain || undefined,
      });
      const mail = await sendMail({
        to: email,
        subject: mailContent.subject,
        text: mailContent.text,
        html: mailContent.html,
      });
      emailSent = mail.sent;
    }

    res.status(201).json({
      shareLink: {
        id: link.id,
        token: link.token,
        url,
        expiresAt: link.expiresAt,
        hasPassword: Boolean(link.passwordHash),
        createdAt: link.createdAt,
        emailSent,
      },
    });

    recordAudit({
      actorUserId: req.user!.id,
      action: "document.shared",
      entityType: "document",
      entityId: doc.id,
      entityName: doc.title || doc.filename,
      workspaceId: doc.workspaceId,
      label: `Created External Share for ${doc.title || doc.filename}`,
      metadata: { kind: "external", recipients: email ? [email] : [], shareLinkId: link.id },
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/share-links", async (req, res, next) => {
  try {
    await requireDocumentAccess(req.params.id, req.user!.id);
    const links = await prisma.shareLink.findMany({
      where: { documentId: req.params.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      shareLinks: links.map((l) => ({
        id: l.id,
        token: l.token,
        url: `${config.publicWebUrl}/s/${l.token}`,
        expiresAt: l.expiresAt,
        hasPassword: Boolean(l.passwordHash),
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete("/share-links/:linkId", async (req, res, next) => {
  try {
    const link = await prisma.shareLink.findUnique({
      where: { id: req.params.linkId },
      include: { document: true },
    });
    if (!link || link.revokedAt) {
      throw new HttpError(404, "Share link not found");
    }
    const allowed = await canManageDocument(link.document, req.user!.id);
    if (!allowed) {
      throw new HttpError(403, "You cannot revoke this share link");
    }
    await prisma.shareLink.update({
      where: { id: link.id },
      data: { revokedAt: new Date() },
    });
    recordAudit({
      actorUserId: req.user!.id,
      action: "document.share_revoked",
      entityType: "document",
      entityId: link.document.id,
      entityName: link.document.title || link.document.filename,
      workspaceId: link.document.workspaceId,
      label: `Revoked Document Share: ${link.document.title || link.document.filename}`,
      metadata: { kind: "external", shareId: link.id },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
