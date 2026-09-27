import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { HttpError } from "./error";
import { assertUserSessionActive } from "../services/session";

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface JwtPayload {
  sub: string;
  email: string;
  sv?: number;
}

export function signToken(user: AuthUser, sessionVersion = 0): string {
  return jwt.sign({ email: user.email, sv: sessionVersion }, config.jwtSecret, {
    subject: user.id,
    expiresIn: `${config.jwtExpiresDays}d`,
  });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(config.jwtCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure cookies are dropped on plain HTTP (e.g. local docker / *.localapp).
    secure: cookieSecure(),
    maxAge: config.jwtExpiresDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(config.jwtCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
  });
}

function cookieSecure(): boolean {
  // NODE_ENV=local → HTTP cookies; NODE_ENV=production → Secure cookies
  return process.env.NODE_ENV === "production";
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.jwtCookieName] as string | undefined;
  if (!token) {
    return next(new HttpError(401, "Authentication required"));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    if (!payload.sub) {
      return next(new HttpError(401, "Invalid or expired session"));
    }
    req.user = await assertUserSessionActive(payload.sub, payload.sv);
    return next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    return next(new HttpError(401, "Invalid or expired session"));
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.jwtCookieName] as string | undefined;
  if (!token) {
    return next();
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    if (payload.sub) {
      req.user = await assertUserSessionActive(payload.sub, payload.sv);
    }
  } catch {
    // ignore invalid token for optional auth
  }
  return next();
}
