import type { PaginationMeta } from "./pagination";
import { DEFAULT_PAGE_LIMIT } from "./pagination";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type { PaginationMeta };

export type ListParams = {
  page?: number;
  limit?: number;
  q?: string;
};

function listQuery(params?: ListParams): string {
  const sp = new URLSearchParams();
  sp.set("page", String(params?.page ?? 1));
  sp.set("limit", String(params?.limit ?? DEFAULT_PAGE_LIMIT));
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  return sp.toString();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export type User = {
  id: string;
  email: string;
  name: string;
  platformRole: "admin" | "owner" | "member";
};

export const api = {
  me: () => request<{ user: User }>("/auth/me"),
  setup: () => request<{ needsSetup: boolean }>("/auth/setup"),
  register: (body: { email: string; password: string; name: string }) =>
    request<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  getDashboard: () => request<DashboardData>("/dashboard"),
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

  getSmtpSettings: () => request<{ smtp: SmtpSettings }>("/settings/smtp"),
  updateSmtpSettings: (body: {
    fromEmail: string;
    fromName: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    useSecureConnection: boolean;
  }) =>
    request<{ smtp: SmtpSettings }>("/settings/smtp", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testSmtpSettings: () =>
    request<{ ok: boolean }>("/settings/smtp/test", { method: "POST", body: "{}" }),

  getStorageSettings: () => request<{ storage: StorageSettings }>("/settings/storage"),
  updateStorageSettings: (body: {
    provider: "local" | "s3";
    localPath?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKeyId?: string;
    s3SecretAccessKey?: string;
    s3Endpoint?: string;
    s3ForcePathStyle?: boolean;
  }) =>
    request<{ storage: StorageSettings }>("/settings/storage", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testStorageSettings: () =>
    request<{ ok: boolean }>("/settings/storage/test", { method: "POST", body: "{}" }),

  listDocuments: (workspaceId: string, folderId?: string | null, params?: ListParams) => {
    const sp = new URLSearchParams({ workspaceId });
    sp.set("folderId", folderId || "root");
    sp.set("page", String(params?.page ?? 1));
    sp.set("limit", String(params?.limit ?? DEFAULT_PAGE_LIMIT));
    return request<{ documents: DocumentItem[] } & PaginationMeta>(`/documents?${sp.toString()}`);
  },
  listTrash: (params?: ListParams) =>
    request<
      {
        documents: TrashDocumentItem[];
        folders: TrashFolderItem[];
      } & PaginationMeta
    >(`/documents/trash?${listQuery(params)}`),
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
  uploadDocument: async (
    file: File,
    opts: { title?: string; workspaceId: string; folderId?: string },
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("workspaceId", opts.workspaceId);
    if (opts.title) form.append("title", opts.title);
    if (opts.folderId) form.append("folderId", opts.folderId);
    return request<{ document: DocumentItem }>("/documents", { method: "POST", body: form });
  },
  uploadDocumentWithProgress: (
    file: File,
    opts: { title?: string; workspaceId: string; folderId?: string },
    onProgress?: (percent: number) => void,
  ) =>
    new Promise<{ document: DocumentItem }>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      form.append("workspaceId", opts.workspaceId);
      if (opts.title) form.append("title", opts.title);
      if (opts.folderId) form.append("folderId", opts.folderId);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/documents`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      };
      xhr.onload = () => {
        let data: { document?: DocumentItem; error?: string } = {};
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          reject(new Error("Invalid upload response"));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300 && data.document) {
          onProgress?.(100);
          resolve({ document: data.document });
          return;
        }
        reject(new Error(data.error ?? `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(form);
    }),
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/documents/${id}`, { method: "DELETE" }),
  restoreDocument: (id: string) =>
    request<{ document: DocumentItem }>(`/documents/${id}/restore`, { method: "POST" }),
  purgeDocument: (id: string) =>
    request<{ queued: boolean; jobId: string; message: string }>(`/documents/${id}/permanent`, {
      method: "DELETE",
    }),
  purgeFolder: (workspaceId: string, folderId: string) =>
    request<{ queued: boolean; jobId: string; message: string }>(
      `/workspaces/${workspaceId}/folders/${folderId}/permanent`,
      { method: "DELETE" },
    ),
  purgeTrashItems: (body: {
    documents: string[];
    folders: { workspaceId: string; folderId: string }[];
  }) =>
    request<{ queued: boolean; jobId: string; count: number; message: string }>(
      "/documents/trash/purge",
      { method: "POST", body: JSON.stringify(body) },
    ),
  downloadUrl: (id: string) => `${API_URL}/documents/${id}/download`,
  getDocument: (id: string) => request<{ document: DocumentItem }>(`/documents/${id}`),
  renameDocument: (id: string, name: string) =>
    request<{ document: DocumentItem }>(`/documents/${id}/rename`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  getOnlyOfficePreview: (id: string) =>
    request<OnlyOfficePreviewPayload>(`/documents/${id}/onlyoffice`),

  createShareLink: (
    documentId: string,
    body: { password?: string; expiresAt: string; email?: string; message?: string },
  ) =>
    request<{ shareLink: ShareLink }>(`/documents/${documentId}/share-links`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listShareLinks: (documentId: string) =>
    request<{ shareLinks: ShareLink[] }>(`/documents/${documentId}/share-links`),
  revokeShareLink: (linkId: string) =>
    request<{ ok: boolean }>(`/documents/share-links/${linkId}`, { method: "DELETE" }),

  searchShareUsers: (q: string) =>
    request<{ users: { id: string; email: string; name: string }[] }>(
      `/shares/users/search?q=${encodeURIComponent(q)}`,
    ),
  shareInternal: (
    documentId: string,
    body: { userId: string; expiresAt: string; message?: string },
  ) =>
    request<{ share: { id: string; emailSent: boolean } }>(`/shares/documents/${documentId}/internal`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  shareBatchInternal: (body: {
    documentIds: string[];
    userIds: string[];
    expiresAt: string;
    message?: string;
  }) =>
    request<{ emailSent: boolean; count: number }>("/shares/batch/internal", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  shareExternal: (
    documentId: string,
    body: {
      recipients?: string[];
      email?: string;
      expiresAt: string;
      password?: string;
      message?: string;
      allowDownload?: boolean;
    },
  ) =>
    request<{
      share: {
        id: string;
        url: string;
        token: string;
        emailSent: boolean;
        emailsSent?: number;
        hasPassword: boolean;
        allowDownload: boolean;
      };
    }>(`/shares/documents/${documentId}/external`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  shareBatchExternal: (body: {
    documentIds: string[];
    recipients?: string[];
    email?: string;
    expiresAt: string;
    password?: string;
    message?: string;
    allowDownload?: boolean;
  }) =>
    request<{
      share: {
        id: string;
        url: string;
        token: string;
        emailSent: boolean;
        emailsSent?: number;
        hasPassword: boolean;
        allowDownload: boolean;
        documentIds: string[];
      };
    }>("/shares/batch/external", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listMyShares: (params?: ListParams) =>
    request<{ shares: MyShareItem[] } & PaginationMeta>(`/shares/mine?${listQuery(params)}`),
  listSharedWithMe: (params?: ListParams) =>
    request<{ shares: SharedWithMeItem[] } & PaginationMeta>(
      `/shares/with-me?${listQuery(params)}`,
    ),
  listDocumentAuditTrails: (documentId: string, params?: ListParams) =>
    request<{ items: AuditTrailItem[] } & PaginationMeta>(
      `/audit-trails/documents/${documentId}?${listQuery(params)}`,
    ),
  listFolderAuditTrails: (folderId: string, params?: ListParams) =>
    request<{ items: AuditTrailItem[] } & PaginationMeta>(
      `/audit-trails/folders/${folderId}?${listQuery(params)}`,
    ),
  revokeInternalShare: (id: string) =>
    request<{ ok: boolean }>(`/shares/internal/${id}`, { method: "DELETE" }),
  revokeExternalShare: (id: string) =>
    request<{ ok: boolean }>(`/shares/external/${id}`, { method: "DELETE" }),

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

  getShare: (token: string) =>
    request<{
      share: {
        token: string;
        needsPassword: boolean;
        passwordProtected: boolean;
        message: string | null;
        expiresAt: string;
        allowDownload: boolean;
        sharedByName: string;
        document: {
          id: string;
          title: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
          name?: string;
        } | null;
        documents: {
          id: string;
          title: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
          name?: string;
        }[];
      };
    }>(`/s/${token}`),
  unlockShare: (token: string, password: string) =>
    request<{
      ok: boolean;
      document: {
        id: string;
        title: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        name?: string;
      };
      documents?: {
        id: string;
        title: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        name?: string;
      }[];
    }>(`/s/${token}/unlock`, { method: "POST", body: JSON.stringify({ password }) }),
  shareDownloadUrl: (token: string, documentId?: string) =>
    documentId
      ? `${API_URL}/s/${token}/download?documentId=${encodeURIComponent(documentId)}`
      : `${API_URL}/s/${token}/download`,
  getSharePreview: (token: string, documentId?: string) =>
    request<OnlyOfficePreviewPayload>(
      documentId
        ? `/s/${token}/preview?documentId=${encodeURIComponent(documentId)}`
        : `/s/${token}/preview`,
    ),
};

export type DashboardData = {
  stats: {
    users?: number;
    documents: number;
    workspaces: number;
    trash?: number;
  };
  cards: {
    users: boolean;
    documents: boolean;
    workspaces: boolean;
    trash: boolean;
  };
  platformRole: "admin" | "owner" | "member";
  recentActivity: {
    id: string;
    entityType: string;
    entityName: string;
    action: string;
    actionPhrase: string;
    actorName: string;
    path: string | null;
    at: string;
  }[];
};

export type AuditTrailItem = {
  id: string;
  actorUserId: string;
  actorName: string;
  action: string;
  actionLabel: string;
  actionPhrase: string;
  entityType: string;
  entityId: string;
  entityName: string;
  label: string;
  workspaceId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type ColleagueUser = {
  id: string;
  email: string;
  name: string;
  platformRole: "admin" | "owner" | "member";
  createdAt: string;
  disabledAt?: string | null;
  workspaces: { id: string; name: string; role: string }[];
};

export type SmtpSettings = {
  fromEmail: string;
  fromName: string;
  host: string;
  port: number;
  username: string;
  passwordSet: boolean;
  useSecureConnection: boolean;
  configured: boolean;
};

export type StorageSettings = {
  provider: "local" | "s3";
  localPath: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretSet: boolean;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  configured: boolean;
};

export type DocumentItem = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  ownerId: string;
  owner?: { id: string; name: string } | null;
  updatedById?: string | null;
  updatedBy?: { id: string; name: string } | null;
  workspaceId: string | null;
  folderId?: string | null;
  createdAt: string;
  updatedAt?: string;
  canManage?: boolean;
  canDelete?: boolean;
};

export type MyShareItem = {
  id: string;
  kind: "internal" | "external";
  document: { id: string; title: string; filename: string } | null;
  documents: { id: string; title: string; filename: string }[];
  sharedWith: { id: string; email: string; name: string } | null;
  recipientEmail: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
  url: string | null;
  hasPassword: boolean;
  allowDownload: boolean;
  createdAt: string;
};

export type SharedWithMeItem = {
  id: string;
  document: {
    id: string;
    title: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
  };
  sharedBy: { id: string; email: string; name: string };
  message: string;
  expiresAt: string;
  createdAt: string;
  canDelete: boolean;
};

export type OnlyOfficePreviewPayload =
  | {
      mode: "onlyoffice";
      documentServerUrl: string;
      config: Record<string, unknown> & { documentType?: string };
    }
  | {
      mode: "image";
      documentServerUrl: string;
      title: string;
      url: string;
      mimeType: string;
    };

export type FolderItem = {
  id: string;
  name: string;
  workspaceId: string;
  parentId?: string | null;
  createdAt: string;
};

export type TrashDocumentItem = DocumentItem & {
  deletedAt?: string | null;
  deletedBy: string;
  path: string;
  workspaceName?: string | null;
  folderName?: string | null;
};

export type TrashFolderItem = FolderItem & {
  deletedAt?: string | null;
  deletedBy: string;
  path: string;
  sizeBytes: number;
  workspaceName: string;
};

export type ShareLink = {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
  hasPassword: boolean;
  createdAt: string;
  emailSent?: boolean;
};

export type WorkspaceItem = {
  id: string;
  name: string;
  description?: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

export type MemberItem = {
  id: string;
  role: string;
  user: { id: string; email: string; name: string };
  createdAt: string;
};

export type InvitationItem = {
  id: string;
  email: string;
  role: string;
  url: string;
  expiresAt: string;
  createdAt: string;
  emailSent?: boolean;
};
