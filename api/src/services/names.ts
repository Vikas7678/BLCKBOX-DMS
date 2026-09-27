import { prisma } from "../lib/prisma";
import { HttpError } from "../middleware/error";

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

/**
 * Ensures no non-deleted file or folder already uses this name
 * at the same workspace level (root or under the same parent folder).
 */
export async function assertUniqueNameAtLevel(opts: {
  workspaceId: string;
  parentFolderId: string | null;
  name: string;
  kind: "file" | "folder";
  excludeDocumentId?: string;
  excludeFolderId?: string;
}) {
  const name = opts.name.trim();
  if (!name) {
    throw new HttpError(400, "Name is required");
  }
  const needle = normalizeName(name);
  const parentId = opts.parentFolderId;

  const [siblingFolders, siblingDocs] = await Promise.all([
    prisma.folder.findMany({
      where: {
        workspaceId: opts.workspaceId,
        parentId,
        deletedAt: null,
        ...(opts.excludeFolderId ? { NOT: { id: opts.excludeFolderId } } : {}),
      },
      select: { name: true },
    }),
    prisma.document.findMany({
      where: {
        workspaceId: opts.workspaceId,
        folderId: parentId,
        deletedAt: null,
        ...(opts.excludeDocumentId ? { NOT: { id: opts.excludeDocumentId } } : {}),
      },
      select: { filename: true, title: true },
    }),
  ]);

  const folderClash = siblingFolders.some((f) => normalizeName(f.name) === needle);
  if (folderClash) {
    throw new HttpError(409, `A folder named "${name}" already exists here`);
  }

  const fileClash = siblingDocs.some(
    (d) => normalizeName(d.filename) === needle || normalizeName(d.title) === needle,
  );
  if (fileClash) {
    throw new HttpError(409, `A file named "${name}" already exists here`);
  }
}
