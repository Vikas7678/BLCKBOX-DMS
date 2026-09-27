import { Document } from "@prisma/client";
import { canDeleteDocument, canManageDocument } from "./access";

/** Document row DTO for workspace contents (and similar list UIs). */
export type DocumentListItem = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  ownerId: string;
  workspaceId: string | null;
  folderId: string | null;
  createdAt: Date;
  canManage: boolean;
  canDelete: boolean;
};

async function mapDocumentListItem(doc: Document, userId: string): Promise<DocumentListItem> {
  return {
    id: doc.id,
    title: doc.title,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    ownerId: doc.ownerId,
    workspaceId: doc.workspaceId,
    folderId: doc.folderId,
    createdAt: doc.createdAt,
    canManage: await canManageDocument(doc, userId),
    canDelete: await canDeleteDocument(doc, userId),
  };
}

export async function mapDocumentListItems(
  docs: Document[],
  userId: string,
): Promise<DocumentListItem[]> {
  return Promise.all(docs.map((doc) => mapDocumentListItem(doc, userId)));
}
