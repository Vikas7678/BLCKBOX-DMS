/**
 * Authenticated sharing APIs (`/api/shares/...`): internal user shares, external links, mine / with-me.
 * Public token unlock/download is in `share.ts` (sharePublicRouter).
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { config } from "../config";
import { canManageDocument, requireDocumentAccess } from "../services/access";
import { sendMail } from "../services/mailer";
import { buildExternalShareEmail, buildInternalShareEmail } from "../services/shareEmails";
import { randomToken } from "../lib/tokens";
import { parsePagination, paginationMeta, slicePage } from "../lib/pagination";
import { recordAudit } from "../services/audit";

export const sharesRouter = Router();
sharesRouter.use(requireAuth);

function parseRequiredExpiry(raw: string): Date {
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new HttpError(400, "Invalid expiry date");
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, "Expiry must be in the future");
  }
  const max = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() > max) {
    throw new HttpError(400, "Expiry cannot be more than 365 days from now");
  }
  return expiresAt;
}

const internalSchema = z.object({
  userId: z.string().min(1),
  expiresAt: z.string().datetime(),
  message: z.string().max(2000).optional().default(""),
});

const batchInternalSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
  userIds: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().datetime(),
  message: z.string().max(2000).optional().default(""),
});

const externalSchema = z.object({
  recipients: z.array(z.string().email()).optional().default([]),
  email: z.string().email().optional().nullable(),
  expiresAt: z.string().datetime(),
  password: z.string().min(4).max(100).optional().nullable(),
  message: z.string().max(2000).optional().default(""),
  allowDownload: z.boolean().optional().default(false),
});

const batchExternalSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
  recipients: z.array(z.string().email()).optional().default([]),
  email: z.string().email().optional().nullable(),
  expiresAt: z.string().datetime(),
  password: z.string().min(4).max(100).optional().nullable(),
  message: z.string().max(2000).optional().default(""),
  allowDownload: z.boolean().optional().default(false),
});

const externalEmailSchema = z.object({
  email: z.string().email(),
  /** Plaintext password for the email body only (not stored). */
  password: z.string().max(100).optional().nullable(),
});

/** Search platform users for internal sharing. Empty q returns first page of active users. */
sharesRouter.get("/users/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        disabledAt: null,
        id: { not: req.user!.id },
        ...(q.length >= 1
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: { id: true, email: true, name: true },
      take: q.length >= 1 ? 20 : 50,
      orderBy: { name: "asc" },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/documents/:id/internal", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    const allowed = await canManageDocument(doc, req.user!.id);
    if (!allowed) {
      throw new HttpError(403, "You cannot share this document");
    }
    const body = internalSchema.parse(req.body ?? {});
    const expiresAt = parseRequiredExpiry(body.expiresAt);
    if (body.userId === req.user!.id) {
      throw new HttpError(400, "You cannot share a document with yourself");
    }

    const target = await prisma.user.findFirst({
      where: { id: body.userId, deletedAt: null, disabledAt: null },
    });
    if (!target) {
      throw new HttpError(404, "User not found");
    }

    const share = await prisma.documentShare.upsert({
      where: {
        documentId_sharedWithUserId: {
          documentId: doc.id,
          sharedWithUserId: target.id,
        },
      },
      create: {
        documentId: doc.id,
        sharedWithUserId: target.id,
        sharedById: req.user!.id,
        message: body.message ?? "",
        expiresAt,
      },
      update: {
        sharedById: req.user!.id,
        message: body.message ?? "",
        expiresAt,
        revokedAt: null,
      },
    });

    const sharer = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { name: true },
    });
    const url = `${config.publicWebUrl}/preview/${doc.id}`;
    const mailContent = buildInternalShareEmail({
      sharerName: sharer?.name || req.user!.email,
      documentName: doc.title || doc.filename,
      expiresAt,
      url,
      message: body.message,
    });
    const mail = await sendMail({
      to: target.email,
      subject: mailContent.subject,
      text: mailContent.text,
      html: mailContent.html,
    });

    recordAudit({
      actorUserId: req.user!.id,
      actorName: sharer?.name || req.user!.email,
      action: "document.shared",
      entityType: "document",
      entityId: doc.id,
      entityName: doc.title || doc.filename,
      workspaceId: doc.workspaceId,
      label: `Shared Document with ${target.name || target.email}`,
      metadata: { kind: "internal", sharedWithUserId: target.id },
    });

    res.status(201).json({
      share: {
        id: share.id,
        kind: "internal" as const,
        documentId: doc.id,
        sharedWith: { id: target.id, email: target.email, name: target.name },
        expiresAt: share.expiresAt,
        message: share.message,
        emailSent: mail.sent,
      },
    });
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/documents/:id/external", async (req, res, next) => {
  try {
    const doc = await requireDocumentAccess(req.params.id, req.user!.id);
    const allowed = await canManageDocument(doc, req.user!.id);
    if (!allowed) {
      throw new HttpError(403, "You cannot share this document");
    }
    const body = externalSchema.parse(req.body ?? {});
    const expiresAt = parseRequiredExpiry(body.expiresAt);
    const recipients = [
      ...body.recipients.map((e) => e.toLowerCase().trim()),
      ...(body.email ? [body.email.toLowerCase().trim()] : []),
    ].filter((e, i, arr) => e && arr.indexOf(e) === i);
    const password = body.password?.trim() || "";
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const token = randomToken(32);

    const link = await prisma.shareLink.create({
      data: {
        documentId: doc.id,
        token,
        expiresAt,
        passwordHash,
        recipientEmail: recipients.join(", "),
        message: body.message ?? "",
        allowDownload: body.allowDownload ?? false,
        createdById: req.user!.id,
        documents: {
          create: [{ documentId: doc.id, sortOrder: 0 }],
        },
      },
    });

    const url = `${config.publicWebUrl}/s/${link.token}`;
    let emailsSent = 0;
    if (recipients.length) {
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
        password: password || undefined,
      });
      for (const to of recipients) {
        const mail = await sendMail({
          to,
          subject: mailContent.subject,
          text: mailContent.text,
          html: mailContent.html,
        });
        if (mail.sent) emailsSent += 1;
      }
    }

    res.status(201).json({
      share: {
        id: link.id,
        kind: "external" as const,
        documentId: doc.id,
        token: link.token,
        url,
        recipients,
        recipientEmail: recipients.join(", "),
        expiresAt: link.expiresAt,
        hasPassword: Boolean(passwordHash),
        allowDownload: link.allowDownload,
        message: link.message,
        emailSent: recipients.length > 0 && emailsSent === recipients.length,
        emailsSent,
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
      metadata: { kind: "external", recipients },
    });
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/batch/internal", async (req, res, next) => {
  try {
    const body = batchInternalSchema.parse(req.body ?? {});
    const expiresAt = parseRequiredExpiry(body.expiresAt);
    const documentIds = [...new Set(body.documentIds)];
    const userIds = [...new Set(body.userIds)];
    if (userIds.includes(req.user!.id)) {
      throw new HttpError(400, "You cannot share a document with yourself");
    }

    const targets = await prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null, disabledAt: null },
    });
    if (targets.length !== userIds.length) {
      throw new HttpError(404, "One or more users not found");
    }

    const docs = [];
    for (const id of documentIds) {
      const doc = await requireDocumentAccess(id, req.user!.id);
      if (!(await canManageDocument(doc, req.user!.id))) {
        throw new HttpError(403, `You cannot share ${doc.title || doc.filename}`);
      }
      docs.push(doc);
    }

    const shares = [];
    for (const target of targets) {
      for (const doc of docs) {
        const share = await prisma.documentShare.upsert({
          where: {
            documentId_sharedWithUserId: {
              documentId: doc.id,
              sharedWithUserId: target.id,
            },
          },
          create: {
            documentId: doc.id,
            sharedWithUserId: target.id,
            sharedById: req.user!.id,
            message: body.message ?? "",
            expiresAt,
          },
          update: {
            sharedById: req.user!.id,
            message: body.message ?? "",
            expiresAt,
            revokedAt: null,
          },
        });
        shares.push({ share, target });
      }
    }

    const sharer = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { name: true },
    });
    const names = docs.map((d) => d.title || d.filename).join(", ");
    const url =
      docs.length === 1
        ? `${config.publicWebUrl}/preview/${docs[0].id}`
        : `${config.publicWebUrl}/shared-with-me`;
    const mailContent = buildInternalShareEmail({
      sharerName: sharer?.name || req.user!.email,
      documentName: names,
      expiresAt,
      url,
      message: body.message,
    });

    let emailsSent = 0;
    for (const target of targets) {
      const mail = await sendMail({
        to: target.email,
        subject: mailContent.subject,
        text: mailContent.text,
        html: mailContent.html,
      });
      if (mail.sent) emailsSent += 1;
    }

    for (const target of targets) {
      for (const doc of docs) {
        recordAudit({
          actorUserId: req.user!.id,
          actorName: sharer?.name || req.user!.email,
          action: "document.shared",
          entityType: "document",
          entityId: doc.id,
          entityName: doc.title || doc.filename,
          workspaceId: doc.workspaceId,
          label: `Shared Document with ${target.name || target.email}`,
          metadata: { kind: "internal", sharedWithUserId: target.id },
        });
      }
    }

    res.status(201).json({
      shares: shares.map(({ share, target }) => ({
        id: share.id,
        kind: "internal" as const,
        documentId: share.documentId,
        sharedWith: { id: target.id, email: target.email, name: target.name },
        expiresAt: share.expiresAt,
        message: share.message,
      })),
      emailSent: targets.length > 0 && emailsSent === targets.length,
      emailsSent,
      count: shares.length,
    });
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/batch/external", async (req, res, next) => {
  try {
    const body = batchExternalSchema.parse(req.body ?? {});
    const expiresAt = parseRequiredExpiry(body.expiresAt);
    const documentIds = [...new Set(body.documentIds)];
    const recipients = [
      ...body.recipients.map((e) => e.toLowerCase().trim()),
      ...(body.email ? [body.email.toLowerCase().trim()] : []),
    ].filter((e, i, arr) => e && arr.indexOf(e) === i);

    const docs = [];
    for (const id of documentIds) {
      const doc = await requireDocumentAccess(id, req.user!.id);
      if (!(await canManageDocument(doc, req.user!.id))) {
        throw new HttpError(403, `You cannot share ${doc.title || doc.filename}`);
      }
      docs.push(doc);
    }

    const password = body.password?.trim() || "";
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const token = randomToken(32);
    const primary = docs[0];

    const link = await prisma.shareLink.create({
      data: {
        documentId: primary.id,
        token,
        expiresAt,
        passwordHash,
        recipientEmail: recipients.join(", "),
        message: body.message ?? "",
        allowDownload: body.allowDownload ?? false,
        createdById: req.user!.id,
        documents: {
          create: docs.map((d, i) => ({ documentId: d.id, sortOrder: i })),
        },
      },
    });

    const url = `${config.publicWebUrl}/s/${link.token}`;
    let emailsSent = 0;
    if (recipients.length) {
      const sharer = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });
      const documentName =
        docs.length === 1
          ? docs[0].title || docs[0].filename
          : `${docs.length} documents`;
      const mailContent = buildExternalShareEmail({
        sharerName: sharer?.name || req.user!.email,
        documentName,
        expiresAt,
        url,
        message: body.message,
        password: password || undefined,
      });
      for (const to of recipients) {
        const mail = await sendMail({
          to,
          subject: mailContent.subject,
          text: mailContent.text,
          html: mailContent.html,
        });
        if (mail.sent) emailsSent += 1;
      }
    }

    res.status(201).json({
      share: {
        id: link.id,
        kind: "external" as const,
        documentIds: docs.map((d) => d.id),
        token: link.token,
        url,
        recipients,
        expiresAt: link.expiresAt,
        hasPassword: Boolean(passwordHash),
        allowDownload: link.allowDownload,
        message: link.message,
        emailSent: recipients.length > 0 && emailsSent === recipients.length,
        emailsSent,
      },
    });

    for (const doc of docs) {
      recordAudit({
        actorUserId: req.user!.id,
        action: "document.shared",
        entityType: "document",
        entityId: doc.id,
        entityName: doc.title || doc.filename,
        workspaceId: doc.workspaceId,
        label: `Created External Share for ${doc.title || doc.filename}`,
        metadata: { kind: "external", recipients, shareLinkId: link.id },
      });
    }
  } catch (err) {
    next(err);
  }
});

sharesRouter.post("/external/:id/email", async (req, res, next) => {
  try {
    const body = externalEmailSchema.parse(req.body ?? {});
    const link = await prisma.shareLink.findUnique({
      where: { id: req.params.id },
      include: {
        document: true,
        createdBy: { select: { name: true, email: true } },
      },
    });
    if (!link || link.revokedAt) {
      throw new HttpError(404, "Share not found");
    }
    if (link.expiresAt < new Date()) {
      throw new HttpError(410, "Share link has expired");
    }
    if (link.createdById !== req.user!.id) {
      const allowed = await canManageDocument(link.document, req.user!.id);
      if (!allowed) {
        throw new HttpError(403, "You cannot email this share");
      }
    }
    if (link.document.deletedAt) {
      throw new HttpError(404, "Document is no longer available");
    }

    const email = body.email.toLowerCase().trim();
    const url = `${config.publicWebUrl}/s/${link.token}`;
    const mailContent = buildExternalShareEmail({
      sharerName: link.createdBy.name || link.createdBy.email,
      documentName: link.document.title || link.document.filename,
      expiresAt: link.expiresAt,
      url,
      message: link.message,
      password: body.password?.trim() || undefined,
    });
    const mail = await sendMail({
      to: email,
      subject: mailContent.subject,
      text: mailContent.text,
      html: mailContent.html,
    });

    await prisma.shareLink.update({
      where: { id: link.id },
      data: { recipientEmail: email },
    });

    res.json({ ok: true, emailSent: mail.sent });
  } catch (err) {
    next(err);
  }
});

sharesRouter.get("/mine", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const [internal, external] = await Promise.all([
      prisma.documentShare.findMany({
        where: { sharedById: userId },
        include: {
          document: { select: { id: true, title: true, filename: true, deletedAt: true } },
          sharedWith: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.shareLink.findMany({
        where: { createdById: userId },
        include: {
          document: { select: { id: true, title: true, filename: true, deletedAt: true } },
          documents: {
            include: {
              document: { select: { id: true, title: true, filename: true, deletedAt: true } },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const items = [
      ...internal.map((s) => ({
        id: s.id,
        kind: "internal" as const,
        document: s.document.deletedAt
          ? null
          : { id: s.document.id, title: s.document.title, filename: s.document.filename },
        documents: s.document.deletedAt
          ? []
          : [{ id: s.document.id, title: s.document.title, filename: s.document.filename }],
        sharedWith: s.sharedWith,
        recipientEmail: s.sharedWith.email,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        status: s.revokedAt
          ? ("revoked" as const)
          : s.expiresAt < now
            ? ("expired" as const)
            : ("active" as const),
        url: s.document.deletedAt ? null : `${config.publicWebUrl}/preview/${s.document.id}`,
        hasPassword: false,
        allowDownload: false,
        createdAt: s.createdAt,
      })),
      ...external.map((s) => {
        const fromJoin = s.documents
          .map((row) => row.document)
          .filter((d) => d && !d.deletedAt)
          .map((d) => ({ id: d.id, title: d.title, filename: d.filename }));
        const docs =
          fromJoin.length > 0
            ? fromJoin
            : s.document.deletedAt
              ? []
              : [
                  {
                    id: s.document.id,
                    title: s.document.title,
                    filename: s.document.filename,
                  },
                ];
        return {
          id: s.id,
          kind: "external" as const,
          document: docs[0] ?? null,
          documents: docs,
          sharedWith: null,
          recipientEmail: s.recipientEmail,
          expiresAt: s.expiresAt,
          revokedAt: s.revokedAt,
          status: s.revokedAt
            ? ("revoked" as const)
            : s.expiresAt < now
              ? ("expired" as const)
              : ("active" as const),
          url: `${config.publicWebUrl}/s/${s.token}`,
          hasPassword: Boolean(s.passwordHash),
          allowDownload: s.allowDownload,
          createdAt: s.createdAt,
        };
      }),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const { items: pageItems, meta } = slicePage(items, page, limit);
    res.json({ shares: pageItems, ...meta });
  } catch (err) {
    next(err);
  }
});

sharesRouter.get("/with-me", async (req, res, next) => {
  try {
    const now = new Date();
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const where = {
      sharedWithUserId: req.user!.id,
      revokedAt: null as null,
      expiresAt: { gt: now },
      document: { deletedAt: null as null },
    };
    const [total, rows] = await Promise.all([
      prisma.documentShare.count({ where }),
      prisma.documentShare.findMany({
        where,
        include: {
          document: {
            select: {
              id: true,
              title: true,
              filename: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          sharedBy: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      shares: rows.map((s) => ({
        id: s.id,
        document: s.document,
        sharedBy: s.sharedBy,
        message: s.message,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
        canDelete: false,
      })),
      ...paginationMeta(total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

sharesRouter.delete("/internal/:id", async (req, res, next) => {
  try {
    const share = await prisma.documentShare.findUnique({ where: { id: req.params.id } });
    if (!share || share.revokedAt) {
      throw new HttpError(404, "Share not found");
    }
    if (share.sharedById !== req.user!.id) {
      const doc = await prisma.document.findUnique({ where: { id: share.documentId } });
      if (!doc || !(await canManageDocument(doc, req.user!.id))) {
        throw new HttpError(403, "You cannot revoke this share");
      }
    }
    await prisma.documentShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date() },
    });
    const doc = await prisma.document.findUnique({
      where: { id: share.documentId },
      select: { id: true, title: true, filename: true, workspaceId: true },
    });
    if (doc) {
      recordAudit({
        actorUserId: req.user!.id,
        action: "document.share_revoked",
        entityType: "document",
        entityId: doc.id,
        entityName: doc.title || doc.filename,
        workspaceId: doc.workspaceId,
        label: `Revoked Document Share: ${doc.title || doc.filename}`,
        metadata: { kind: "internal", shareId: share.id },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

sharesRouter.delete("/external/:id", async (req, res, next) => {
  try {
    const link = await prisma.shareLink.findUnique({
      where: { id: req.params.id },
      include: { document: true },
    });
    if (!link || link.revokedAt) {
      throw new HttpError(404, "Share not found");
    }
    if (link.createdById !== req.user!.id) {
      const allowed = await canManageDocument(link.document, req.user!.id);
      if (!allowed) {
        throw new HttpError(403, "You cannot revoke this share");
      }
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
