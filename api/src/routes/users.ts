import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PlatformRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { sendMail } from "../services/mailer";
import {
  canAccessUsersPage,
  canManageUsers,
  getPlatformRole,
  requirePlatformAdmin,
} from "../services/platform";
import { buildUserCreatedEmail } from "../services/userEmails";
import { parsePagination, paginationMeta } from "../lib/pagination";
import { forceEndUserSession } from "../services/session";
import { recordAudit } from "../services/audit";

export const usersRouter = Router();
usersRouter.use(requireAuth);

type UserRow = {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  createdAt: Date;
  disabledAt: Date | null;
  workspaces: { id: string; name: string; role: string }[];
};

function mapUser(
  user: {
    id: string;
    email: string;
    name: string;
    platformRole: PlatformRole;
    createdAt: Date;
    disabledAt: Date | null;
  },
  workspaces: { id: string; name: string; role: string }[],
): UserRow {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole,
    createdAt: user.createdAt,
    disabledAt: user.disabledAt,
    workspaces,
  };
}

async function requireManageableUser(targetId: string, actorId: string) {
  if (targetId === actorId) {
    throw new HttpError(403, "You cannot change your own account here");
  }
  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user || user.deletedAt) {
    throw new HttpError(404, "User not found");
  }
  return user;
}

/** Admin/owner: all platform users. Members: forbidden. */
usersRouter.get("/", async (req, res, next) => {
  try {
    const platformRole = await getPlatformRole(req.user!.id);
    if (!canAccessUsersPage(platformRole)) {
      throw new HttpError(403, "You cannot view users");
    }

    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    // platformRole enum equality only when q matches a role; otherwise name/email
    const searchWhere = q
      ? {
          deletedAt: null as null,
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            ...(["admin", "owner", "member"].includes(q.toLowerCase())
              ? [{ platformRole: q.toLowerCase() as PlatformRole }]
              : []),
          ],
        }
      : { deletedAt: null as null };

    const [total, users] = await Promise.all([
      prisma.user.count({ where: searchWhere }),
      prisma.user.findMany({
        where: searchWhere,
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          createdAt: true,
          disabledAt: true,
          memberships: {
            where: { workspace: { deletedAt: null } },
            select: {
              role: true,
              workspace: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      users: users.map((u) =>
        mapUser(
          u,
          u.memberships.map((m) => ({
            id: m.workspace.id,
            name: m.workspace.name,
            role: m.role,
          })),
        ),
      ),
      canManage: canManageUsers(platformRole),
      ...paginationMeta(total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().default(""),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  platformRole: z.enum(["admin", "owner", "member"]),
});

usersRouter.post("/", async (req, res, next) => {
  try {
    await requirePlatformAdmin(req.user!.id);
    const body = createUserSchema.parse(req.body ?? {});
    const email = body.email.toLowerCase().trim();
    const firstName = body.firstName.trim();
    const lastName = (body.lastName ?? "").trim();
    const name = [firstName, lastName].filter(Boolean).join(" ");

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(
        409,
        existing.deletedAt
          ? "Email belongs to an archived user and cannot be reused"
          : "Email already registered",
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        platformRole: body.platformRole,
      },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        createdAt: true,
        disabledAt: true,
      },
    });

    const actor = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { name: true },
    });
    const mailContent = buildUserCreatedEmail({
      firstName,
      lastName,
      email: user.email,
      password: body.password,
      platformRole: user.platformRole,
      loginUrl: `${config.publicWebUrl}/login`,
      createdByName: actor?.name ?? "An administrator",
    });
    const mail = await sendMail({
      to: user.email,
      subject: mailContent.subject,
      text: mailContent.text,
      html: mailContent.html,
    });

    recordAudit({
      actorUserId: req.user!.id,
      actorName: actor?.name,
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      entityName: user.name || user.email,
      label: `Created User: ${user.name || user.email}`,
    });

    res.status(201).json({
      user: mapUser(user, []),
      emailSent: mail.sent,
      emailReason: mail.reason,
    });
  } catch (err) {
    next(err);
  }
});

const platformRoleSchema = z.object({
  platformRole: z.enum(["admin", "owner", "member"]),
});

usersRouter.patch("/:id/platform-role", async (req, res, next) => {
  try {
    await requirePlatformAdmin(req.user!.id);
    const body = platformRoleSchema.parse(req.body ?? {});
    const target = await requireManageableUser(req.params.id, req.user!.id);
    if (target.platformRole === "admin" && body.platformRole !== "admin") {
      const adminCount = await prisma.user.count({
        where: { deletedAt: null, platformRole: "admin" },
      });
      if (adminCount <= 1) {
        throw new HttpError(400, "Cannot demote the last platform admin");
      }
    }
    const user = await prisma.user.update({
      where: { id: target.id },
      data: { platformRole: body.platformRole },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        createdAt: true,
        disabledAt: true,
      },
    });
    res.json({ user: mapUser(user, []) });
  } catch (err) {
    next(err);
  }
});

usersRouter.put("/:id/disable", async (req, res, next) => {
  try {
    await requirePlatformAdmin(req.user!.id);
    await requireManageableUser(req.params.id, req.user!.id);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        disabledAt: new Date(),
        sessionVersion: { increment: 1 },
      },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        createdAt: true,
        disabledAt: true,
      },
    });
    await forceEndUserSession(user.id, "disabled");
    recordAudit({
      actorUserId: req.user!.id,
      action: "user.disabled",
      entityType: "user",
      entityId: user.id,
      entityName: user.name || user.email,
      label: `Disabled User: ${user.name || user.email}`,
    });
    res.json({ user: mapUser(user, []) });
  } catch (err) {
    next(err);
  }
});

usersRouter.put("/:id/enable", async (req, res, next) => {
  try {
    await requirePlatformAdmin(req.user!.id);
    const target = await requireManageableUser(req.params.id, req.user!.id);
    if (target.deletedAt) {
      throw new HttpError(400, "Cannot enable an archived user");
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { disabledAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        createdAt: true,
        disabledAt: true,
      },
    });
    recordAudit({
      actorUserId: req.user!.id,
      action: "user.enabled",
      entityType: "user",
      entityId: user.id,
      entityName: user.name || user.email,
      label: `Enabled User: ${user.name || user.email}`,
    });
    res.json({ user: mapUser(user, []) });
  } catch (err) {
    next(err);
  }
});

/**
 * Archive user (“delete”): permanent soft tombstone.
 * Clears credentials, removes workspace memberships, revokes shares, force-ends sessions.
 * Keeps name/email for history; cannot re-enable.
 */
usersRouter.delete("/:id", async (req, res, next) => {
  try {
    await requirePlatformAdmin(req.user!.id);
    const target = await requireManageableUser(req.params.id, req.user!.id);

    if (target.platformRole === "admin") {
      const adminCount = await prisma.user.count({
        where: { deletedAt: null, platformRole: "admin" },
      });
      if (adminCount <= 1) {
        throw new HttpError(400, "Cannot archive the last platform admin");
      }
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          deletedAt: now,
          disabledAt: now,
          passwordHash: null,
          sessionVersion: { increment: 1 },
        },
      });

      // Remove from all workspaces
      await tx.workspaceMember.deleteMany({ where: { userId: target.id } });

      // Revoke internal shares involving this user
      await tx.documentShare.updateMany({
        where: {
          revokedAt: null,
          OR: [{ sharedWithUserId: target.id }, { sharedById: target.id }],
        },
        data: { revokedAt: now },
      });

      // Revoke external share links they created
      await tx.shareLink.updateMany({
        where: { createdById: target.id, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    await forceEndUserSession(target.id, "archived");
    recordAudit({
      actorUserId: req.user!.id,
      action: "user.archived",
      entityType: "user",
      entityId: target.id,
      entityName: target.name || target.email,
      label: `Archived User: ${target.name || target.email}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
