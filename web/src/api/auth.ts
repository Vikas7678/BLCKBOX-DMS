/** Session auth: login/logout/me. Register exists but is disabled on the server. */
import { request } from "./client";
import type { User } from "./types";

export const authApi = {
  me: () => request<{ user: User }>("/auth/me"),
  setup: () => request<{ needsSetup: boolean }>("/auth/setup"),
  register: (body: { email: string; password: string; name: string }) =>
    request<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};
