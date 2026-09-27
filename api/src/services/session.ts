import { prisma } from "../lib/prisma";
import { HttpError } from "../middleware/error";
import { emitToUser, disconnectUserSockets } from "../realtime/socket";

/**
 * Invalidate JWTs for a user (Angora force-end session) and kick sockets.
 * Call after bumping `sessionVersion` in the DB.
 */
export async function forceEndUserSession(
  userId: string,
  reason: "disabled" | "archived" = "disabled",
): Promise<void> {
  emitToUser(userId, "session:ended", { reason });
  disconnectUserSockets(userId);
}

/** Load auth gate fields; throws if user cannot use the API. */
export async function assertUserSessionActive(
  userId: string,
  tokenSessionVersion: number | undefined,
): Promise<{ id: string; email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      disabledAt: true,
      deletedAt: true,
      sessionVersion: true,
    },
  });
  if (!user || user.deletedAt) {
    throw new HttpError(401, "User not found");
  }
  if (user.disabledAt) {
    throw new HttpError(403, "This account has been disabled");
  }
  const sv = tokenSessionVersion ?? 0;
  if (sv !== user.sessionVersion) {
    throw new HttpError(401, "Session ended");
  }
  return { id: user.id, email: user.email };
}
