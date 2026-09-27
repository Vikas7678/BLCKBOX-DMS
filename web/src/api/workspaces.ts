/** Workspaces, members, folders, contents listing, and email invitations. */
import type { PaginationMeta } from "../pagination";
import { DEFAULT_PAGE_LIMIT } from "../pagination";
import { listQuery, request, type ListParams } from "./client";
import type {
  DocumentItem,
  FolderItem,
  InvitationItem,
  MemberItem,
  WorkspaceItem,
} from "./types";

export const workspacesApi = {
  listWorkspaces: (params?: ListParams) =>
    request<{ workspaces: WorkspaceItem[] } & PaginationMeta>(
      `/workspaces?${listQuery(params)}`,
    ),
  createWorkspace: (body: { name: string; description?: string }) =>
    request<{ workspace: WorkspaceItem }>("/workspaces", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getWorkspace: (id: string) => request<{ workspace: WorkspaceItem }>(`/workspaces/${id}`),
  updateWorkspace: (id: string, body: { name: string; description?: string }) =>
    request<{ workspace: WorkspaceItem }>(`/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteWorkspace: (id: string) =>
    request<{ ok: boolean }>(`/workspaces/${id}`, { method: "DELETE" }),
  listWorkspaceContents: (
    workspaceId: string,
    folderId?: string | null,
    params?: ListParams,
  ) => {
    const sp = new URLSearchParams();
    sp.set("folderId", folderId || "root");
    sp.set("page", String(params?.page ?? 1));
    sp.set("limit", String(params?.limit ?? DEFAULT_PAGE_LIMIT));
    return request<
      { folders: FolderItem[]; documents: DocumentItem[] } & PaginationMeta
    >(`/workspaces/${workspaceId}/contents?${sp.toString()}`);
  },
  listMembers: (id: string) => request<{ members: MemberItem[] }>(`/workspaces/${id}/members`),
  listAddableUsers: (workspaceId: string, q = "") => {
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    return request<{ users: { id: string; email: string; name: string }[] }>(
      `/workspaces/${workspaceId}/addable-users${qs}`,
    );
  },
  addMembers: (
    workspaceId: string,
    members: { userId: string; role: "owner" | "admin" | "member" }[],
  ) =>
    request<{ members: MemberItem[] }>(`/workspaces/${workspaceId}/members`, {
      method: "POST",
      body: JSON.stringify({ members }),
    }),
  removeMember: (workspaceId: string, memberId: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${memberId}`, {
      method: "DELETE",
    }),
  updateMemberRole: (workspaceId: string, memberId: string, role: "owner" | "admin" | "member") =>
    request<{ member: MemberItem }>(`/workspaces/${workspaceId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  listFolders: (workspaceId: string) =>
    request<{ folders: FolderItem[] }>(`/workspaces/${workspaceId}/folders`),
  createFolder: (workspaceId: string, name: string, parentId?: string | null) =>
    request<{ folder: FolderItem }>(`/workspaces/${workspaceId}/folders`, {
      method: "POST",
      body: JSON.stringify({ name, parentId: parentId || undefined }),
    }),
  deleteFolder: (workspaceId: string, folderId: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/folders/${folderId}`, { method: "DELETE" }),
  restoreFolder: (workspaceId: string, folderId: string) =>
    request<{ folder: FolderItem }>(`/workspaces/${workspaceId}/folders/${folderId}/restore`, {
      method: "POST",
    }),
  createInvitation: (id: string, email: string, role: "admin" | "member" = "member") =>
    request<{ invitation: InvitationItem }>(`/workspaces/${id}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  listInvitations: (id: string) =>
    request<{ invitations: InvitationItem[] }>(`/workspaces/${id}/invitations`),

  getInvite: (token: string) =>
    request<{
      invitation: {
        email: string;
        role: string;
        workspaceName: string;
        expiresAt: string;
        needsAccount: boolean;
      };
    }>(`/invites/${token}`),
  acceptInvite: (token: string) =>
    request<{ ok: boolean; workspaceId: string }>(`/invites/${token}/accept`, { method: "POST" }),
};
