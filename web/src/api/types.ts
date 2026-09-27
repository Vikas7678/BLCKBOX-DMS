/**
 * DTO / response types shared by the API client and UI.
 * Grouped by domain for scanning — field docs live on the backend when needed.
 */

export type { PaginationMeta } from "../pagination";

// --- Auth / platform user ---

export type User = {
  id: string;
  email: string;
  name: string;
  platformRole: "admin" | "owner" | "member";
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

// --- Dashboard ---

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

// --- Settings ---

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

// --- Documents / folders / trash ---

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
  /** True when viewer only has access via an internal share (not workspace membership). */
  accessViaInternalShare?: boolean;
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

export type TrashWorkspaceItem = {
  id: string;
  name: string;
  createdAt: string;
  deletedAt: string;
  deletedBy: string;
  path: string;
  sizeBytes: number;
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

// --- Shares ---

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

// --- Workspaces ---

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

// --- Audit ---

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
