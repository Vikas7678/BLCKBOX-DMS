/** Per-document / per-folder audit trail listing. */
import type { PaginationMeta } from "../pagination";
import { listQuery, request, type ListParams } from "./client";
import type { AuditTrailItem } from "./types";

export const auditApi = {
  listDocumentAuditTrails: (documentId: string, params?: ListParams) =>
    request<{ items: AuditTrailItem[] } & PaginationMeta>(
      `/audit-trails/documents/${documentId}?${listQuery(params)}`,
    ),
  listFolderAuditTrails: (folderId: string, params?: ListParams) =>
    request<{ items: AuditTrailItem[] } & PaginationMeta>(
      `/audit-trails/folders/${folderId}?${listQuery(params)}`,
    ),
};
