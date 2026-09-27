export type AuditEntityType = "document" | "folder" | "workspace" | "user";

export type AuditAction =
  | "document.created"
  | "document.renamed"
  | "document.trashed"
  | "document.restored"
  | "document.deleted"
  | "document.previewed"
  | "document.downloaded"
  | "document.shared"
  | "document.share_revoked"
  | "folder.created"
  | "folder.trashed"
  | "folder.restored"
  | "folder.deleted"
  | "workspace.created"
  | "workspace.trashed"
  | "workspace.restored"
  | "workspace.deleted"
  | "workspace.member_added"
  | "workspace.member_removed"
  | "workspace.member_role_changed"
  | "user.created"
  | "user.enabled"
  | "user.disabled"
  | "user.archived"
  | "user.login"
  | "user.logout";

export type AuditJobData = {
  actorUserId: string;
  actorName: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  entityName: string;
  label: string;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "document.created": "Created Document",
  "document.renamed": "Renamed Document",
  "document.trashed": "Document moved to trashcan",
  "document.restored": "Document restored from trashcan",
  "document.deleted": "Document permanently deleted",
  "document.previewed": "Viewed Document",
  "document.downloaded": "Downloaded Document",
  "document.shared": "Shared Document",
  "document.share_revoked": "Revoked Document Share",
  "folder.created": "Created Folder",
  "folder.trashed": "Folder moved to trashcan",
  "folder.restored": "Folder restored from trashcan",
  "folder.deleted": "Folder permanently deleted",
  "workspace.created": "Created Workspace",
  "workspace.trashed": "Workspace moved to trashcan",
  "workspace.restored": "Workspace restored from trashcan",
  "workspace.deleted": "Workspace permanently deleted",
  "workspace.member_added": "Permission Granted",
  "workspace.member_removed": "Permission Revoked",
  "workspace.member_role_changed": "Role Updated",
  "user.created": "Created User",
  "user.enabled": "Enabled User",
  "user.disabled": "Disabled User",
  "user.archived": "Archived User",
  "user.login": "User Login",
  "user.logout": "User Logout",
};

/** Short phrase for dashboard recent activity (e.g. "permanently deleted"). */
export const AUDIT_ACTION_PHRASES: Record<AuditAction, string> = {
  "document.created": "created",
  "document.renamed": "renamed",
  "document.trashed": "moved to trash",
  "document.restored": "restored",
  "document.deleted": "permanently deleted",
  "document.previewed": "viewed",
  "document.downloaded": "downloaded",
  "document.shared": "shared",
  "document.share_revoked": "share revoked",
  "folder.created": "created",
  "folder.trashed": "moved to trash",
  "folder.restored": "restored",
  "folder.deleted": "permanently deleted",
  "workspace.created": "created",
  "workspace.trashed": "moved to trash",
  "workspace.restored": "restored",
  "workspace.deleted": "permanently deleted",
  "workspace.member_added": "permission granted",
  "workspace.member_removed": "permission revoked",
  "workspace.member_role_changed": "role updated",
  "user.created": "created",
  "user.enabled": "enabled",
  "user.disabled": "disabled",
  "user.archived": "archived",
  "user.login": "logged in",
  "user.logout": "logged out",
};
