/**
 * Public invite + share-token routers.
 * Mounted as `/api/invites` (invitesRouter) and `/api/s` (sharePublicRouter).
 * Authenticated sharing (create/list/revoke) lives in `shares.ts`.
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { getStorage } from "../services/storageSettings";
import {
  buildOnlyOfficePreviewPayload,
  createShareContentAccessToken,
} from "../services/onlyoffice";
import { recordAuditOnce } from "../services/audit";

export const invitesRouter = Router();
export const sharePublicRouter = Router();

async function loadValidInvite(token: string) {
  const invite = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: { workspace: true },
  });
  if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new HttpError(404, "Invitation not found or expired");
  }
  if (invite.workspace.deletedAt) {
    throw new HttpError(404, "Workspace no longer available");
  }
  return invite;
}

invitesRouter.get("/:token", async (req, res, next) => {
  try {
    const invite = await loadValidInvite(req.params.token);
    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
      select: { id: true },
    });
    res.json({
      invitation: {
        email: invite.email,
        role: invite.role,
        workspaceName: invite.workspace.name,
        expiresAt: invite.expiresAt,
        needsAccount: !existingUser,
      },
    });
  } catch (err) {
    next(err);
  }
});

invitesRouter.post("/:token/accept", requireAuth, async (req, res, next) => {
  try {
    const invite = await loadValidInvite(req.params.token);
    if (req.user!.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new HttpError(403, "This invitation was sent to a different email");
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: invite.workspaceId, userId: req.user!.id },
        },
      });
      if (!existing) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invite.workspaceId,
            userId: req.user!.id,
            role: invite.role === "owner" ? "member" : invite.role,
          },
        });
      }
      await tx.workspaceInvitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    res.json({
      ok: true,
      workspaceId: invite.workspaceId,
    });
  } catch (err) {
    next(err);
  }
});

async function loadValidShareLink(token: string) {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      document: true,
      createdBy: { select: { name: true, email: true } },
      documents: {
        include: { document: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!link || link.revokedAt) {
    throw new HttpError(404, "Share link not found");
  }
  if (link.expiresAt < new Date()) {
    throw new HttpError(410, "Share link has expired");
  }
  return link;
}

function documentsForShareLink(link: Awaited<ReturnType<typeof loadValidShareLink>>) {
  const fromJoin = link.documents
    .map((row) => row.document)
    .filter((d) => d && !d.deletedAt);
  if (fromJoin.length) return fromJoin;
  if (link.document && !link.document.deletedAt) return [link.document];
  return [];
}

function serializeShareDocument(doc: {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return {
    id: doc.id,
    title: doc.title,
    filename: doc.filename,
    name: doc.title || doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
  };
}

function unlockedCookieName(token: string) {
  return `share_unlock_${token.slice(0, 16)}`;
}

function isUnlocked(req: { cookies?: Record<string, string> }, token: string) {
  return req.cookies?.[unlockedCookieName(token)] === "1";
}

sharePublicRouter.get("/:token", async (req, res, next) => {
  try {
    const link = await loadValidShareLink(req.params.token);
    const docs = documentsForShareLink(link);
    if (!docs.length) {
      throw new HttpError(404, "Document is no longer available");
    }
    const unlocked = isUnlocked(req, link.token);
    const needsPassword = Boolean(link.passwordHash) && !unlocked;

    res.json({
      share: {
        token: link.token,
        needsPassword,
        passwordProtected: Boolean(link.passwordHash),
        message: needsPassword ? null : link.message,
        expiresAt: link.expiresAt,
        allowDownload: link.allowDownload,
        sharedByName: link.createdBy.name || link.createdBy.email,
        document: needsPassword ? null : serializeShareDocument(docs[0]),
        documents: needsPassword ? [] : docs.map(serializeShareDocument),
      },
    });
  } catch (err) {
    next(err);
  }
});

const unlockSchema = z.object({
  password: z.string().min(1),
});

sharePublicRouter.post("/:token/unlock", async (req, res, next) => {
  try {
    const link = await loadValidShareLink(req.params.token);
    const docs = documentsForShareLink(link);
    if (!docs.length) {
      throw new HttpError(404, "Document is no longer available");
    }
    if (!link.passwordHash) {
      return res.json({
        ok: true,
        document: serializeShareDocument(docs[0]),
        documents: docs.map(serializeShareDocument),
      });
    }
    const body = unlockSchema.parse(req.body);
    const ok = await bcrypt.compare(body.password, link.passwordHash);
    if (!ok) {
      throw new HttpError(401, "Incorrect password");
    }
    res.cookie(unlockedCookieName(link.token), "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 4 * 60 * 60 * 1000,
    });
    res.json({
      ok: true,
      document: serializeShareDocument(docs[0]),
      documents: docs.map(serializeShareDocument),
    });
  } catch (err) {
    next(err);
  }
});

sharePublicRouter.get("/:token/preview", async (req, res, next) => {
  try {
    const link = await loadValidShareLink(req.params.token);
    if (link.passwordHash && !isUnlocked(req, link.token)) {
      throw new HttpError(401, "Password required");
    }
    const docs = documentsForShareLink(link);
    if (!docs.length) {
      throw new HttpError(404, "Document is no longer available");
    }
    const requestedId = typeof req.query.documentId === "string" ? req.query.documentId : "";
    const doc = requestedId ? docs.find((d) => d.id === requestedId) : docs[0];
    if (!doc) {
      throw new HttpError(404, "Document is not part of this share");
    }

    recordAuditOnce(
      {
        actorUserId: link.createdById,
        actorName: "Guest",
        action: "document.previewed",
        entityType: "document",
        entityId: doc.id,
        entityName: doc.title || doc.filename,
        workspaceId: doc.workspaceId,
        label: `Viewed Document via share: ${doc.title || doc.filename}`,
        metadata: { via: "external_share", shareToken: link.token.slice(0, 8) },
      },
      { key: `audit:dedupe:preview:share:${link.token}:${doc.id}`, ttlSeconds: 60 },
    );

    const contentToken = createShareContentAccessToken(doc.id, link.token);
    const payload = buildOnlyOfficePreviewPayload(doc, {
      contentToken,
      documentKey: `blckbox-share-${doc.id}-${doc.updatedAt.getTime()}`,
      viewer: {
        id: `share-${link.token.slice(0, 8)}`,
        name: "Guest",
      },
    });
    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

sharePublicRouter.get("/:token/download", async (req, res, next) => {
  try {
    const link = await loadValidShareLink(req.params.token);
    if (!link.allowDownload) {
      throw new HttpError(403, "Download is not allowed for this share");
    }
    if (link.passwordHash && !isUnlocked(req, link.token)) {
      throw new HttpError(401, "Password required");
    }
    const docs = documentsForShareLink(link);
    if (!docs.length) {
      throw new HttpError(404, "Document is no longer available");
    }
    const requestedId = typeof req.query.documentId === "string" ? req.query.documentId : "";
    const doc = requestedId ? docs.find((d) => d.id === requestedId) : docs[0];
    if (!doc) {
      throw new HttpError(404, "Document is not part of this share");
    }
    const stream = await (await getStorage()).getStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(doc.filename)}"`,
    );
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});
