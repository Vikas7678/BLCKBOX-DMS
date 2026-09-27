/**
 * Documents: list/upload/rename/trash/purge and OnlyOffice preview.
 * Upload-with-progress uses XHR because fetch has no upload progress events.
 */
import type { PaginationMeta } from "../pagination";
import { DEFAULT_PAGE_LIMIT } from "../pagination";
import { API_URL, listQuery, request, type ListParams } from "./client";
import type {
  DocumentItem,
  OnlyOfficePreviewPayload,
  TrashDocumentItem,
  TrashFolderItem,
} from "./types";

export const documentsApi = {
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
  /** XHR so callers can show upload % via onProgress. */
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
};
