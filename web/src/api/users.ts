/** Platform user admin (list/create/role/disable). Requires platform admin. */
import type { PaginationMeta } from "../pagination";
import { listQuery, request, type ListParams } from "./client";
import type { ColleagueUser } from "./types";

export const usersApi = {
  listUsers: (params?: ListParams) =>
    request<{ users: ColleagueUser[]; canManage: boolean } & PaginationMeta>(
      `/users?${listQuery(params)}`,
    ),
  createUser: (body: {
    firstName: string;
    lastName?: string;
    email: string;
    password: string;
    platformRole: "admin" | "owner" | "member";
  }) =>
    request<{ user: ColleagueUser; emailSent: boolean; emailReason?: string }>("/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setUserPlatformRole: (id: string, platformRole: "admin" | "owner" | "member") =>
    request<{ user: ColleagueUser }>(`/users/${id}/platform-role`, {
      method: "PATCH",
      body: JSON.stringify({ platformRole }),
    }),
  disableUser: (id: string) =>
    request<{ user: ColleagueUser }>(`/users/${id}/disable`, { method: "PUT" }),
  enableUser: (id: string) =>
    request<{ user: ColleagueUser }>(`/users/${id}/enable`, { method: "PUT" }),
  deleteUser: (id: string) => request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" }),
};
