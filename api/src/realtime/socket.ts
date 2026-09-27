import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../lib/prisma";

type JwtPayload = { sub: string; email: string; sv?: number };

let io: Server | null = null;

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      credentials: true,
    },
    path: "/socket.io",
  });

  io.use((socket, next) => {
    void (async () => {
      try {
        const cookies = parseCookieHeader(socket.handshake.headers.cookie);
        const token = cookies[config.jwtCookieName];
        if (!token) {
          return next(new Error("Authentication required"));
        }
        const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
        if (!payload.sub) {
          return next(new Error("Invalid session"));
        }
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { sessionVersion: true, disabledAt: true, deletedAt: true },
        });
        if (!user || user.deletedAt || user.disabledAt) {
          return next(new Error("Session ended"));
        }
        if ((payload.sv ?? 0) !== user.sessionVersion) {
          return next(new Error("Session ended"));
        }
        socket.data.userId = payload.sub;
        return next();
      } catch {
        return next(new Error("Invalid or expired session"));
      }
    })();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);
  });

  return io;
}

export function getIo(): Server | null {
  return io;
}

export function emitToUser(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  getIo()?.to(`user:${userId}`).emit(event, payload);
}

/** Force-disconnect all Socket.IO connections for a user (Angora session end). */
export function disconnectUserSockets(userId: string): void {
  getIo()?.in(`user:${userId}`).disconnectSockets(true);
}
