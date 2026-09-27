/**
 * Sharing: internal/external shares, and public /s token flows
 * (getShare / unlockShare work without a logged-in session after unlock cookie).
 */
import type { PaginationMeta } from "../pagination";
import { API_URL, listQuery, request, type ListParams } from "./client";
import type {
  MyShareItem,
  OnlyOfficePreviewPayload,
  SharedWithMeItem,
} from "./types";

export const sharesApi = {
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
  revokeInternalShare: (id: string) =>
    request<{ ok: boolean }>(`/shares/internal/${id}`, { method: "DELETE" }),
  revokeExternalShare: (id: string) =>
    request<{ ok: boolean }>(`/shares/external/${id}`, { method: "DELETE" }),

  /** Public share metadata (may require password unlock next). */
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
  /** Sets unlock cookie for password-protected links. */
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
