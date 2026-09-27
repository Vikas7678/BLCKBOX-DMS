import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { HttpError } from "../middleware/error";
import {
  clearAuthCookie,
  optionalAuth,
  requireAuth,
  setAuthCookie,
  signToken,
} from "../middleware/auth";
import { recordAudit } from "../services/audit";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/register", async (req, res, next) => {
  try {
    const userCount = await prisma.user.count({ where: { deletedAt: null } });
    if (userCount > 0) {
      throw new HttpError(
        403,
        "Public registration is disabled. Ask an admin to create your account.",
      );
    }

    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "Email already registered");
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: body.name.trim(),
        platformRole: "admin",
      },
    });

    const token = signToken({ id: user.id, email: user.email }, user.sessionVersion);
    setAuthCookie(res, token);
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/setup", async (_req, res, next) => {
  try {
    const userCount = await prisma.user.count({ where: { deletedAt: null } });
    res.json({ needsSetup: userCount === 0 });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(401, "Invalid email or password");
    }
    if (user.deletedAt) {
      throw new HttpError(403, "This account has been archived");
    }
    if (user.disabledAt) {
      throw new HttpError(403, "This account has been disabled");
    }
    if (!user.passwordHash) {
      throw new HttpError(401, "Invalid email or password");
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      throw new HttpError(401, "Invalid email or password");
    }
    const token = signToken({ id: user.id, email: user.email }, user.sessionVersion);
    setAuthCookie(res, token);
    recordAudit({
      actorUserId: user.id,
      actorName: user.name,
      action: "user.login",
      entityType: "user",
      entityId: user.id,
      entityName: user.name || user.email,
      label: `Logged in: ${user.name || user.email}`,
    });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", optionalAuth, (req, res) => {
  if (req.user) {
    recordAudit({
      actorUserId: req.user.id,
      action: "user.logout",
      entityType: "user",
      entityId: req.user.id,
      entityName: req.user.email,
      label: `Logged out: ${req.user.email}`,
    });
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new HttpError(401, "User not found");
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platformRole,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});
