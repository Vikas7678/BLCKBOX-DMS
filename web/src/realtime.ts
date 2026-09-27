import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { toast } from "./toast";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
/** Socket.IO is mounted at the API host root, not under /api. */
const SOCKET_URL = API_URL.replace(/\/api\/?$/, "") || API_URL;

const PURGE_SETTLED_EVENT = "blckbox:purge-settled";

type PurgeCompletePayload = {
  jobId?: string;
  purged?: number;
  failed?: number;
  message?: string;
};

type PurgeFailedPayload = {
  jobId?: string;
  message?: string;
};

/** Connect Socket.IO while signed in; shows purge job toasts globally. */
export function useRealtimeNotifications() {
  const { user, setUser } = useAuth();

  useEffect(() => {
    if (!user) return;

    const socket: Socket = io(SOCKET_URL, {
      withCredentials: true,
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("purge:complete", (payload: PurgeCompletePayload) => {
      const failed = payload.failed ?? 0;
      if (failed > 0) {
        toast.error(payload.message ?? "Permanent delete finished with errors");
      } else {
        toast.success(payload.message ?? "Permanent delete complete");
      }
      window.dispatchEvent(new CustomEvent(PURGE_SETTLED_EVENT));
    });

    socket.on("purge:failed", (payload: PurgeFailedPayload) => {
      toast.error(payload.message ?? "Permanent delete failed");
      window.dispatchEvent(new CustomEvent(PURGE_SETTLED_EVENT));
    });

    socket.on("session:ended", (payload: { reason?: string }) => {
      void api.logout().catch(() => undefined);
      setUser(null);
      toast.info(
        payload?.reason === "archived"
          ? "Your account has been archived"
          : "Your account has been disabled",
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.id, setUser]);
}

/** Trash page: refresh when a purge job finishes. */
export function usePurgeSettledRefresh(onRefresh: () => void) {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    function handler() {
      cb.current();
    }
    window.addEventListener(PURGE_SETTLED_EVENT, handler);
    return () => window.removeEventListener(PURGE_SETTLED_EVENT, handler);
  }, []);
}
