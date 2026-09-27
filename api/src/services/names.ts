import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../middleware/error";

type DbClient = Prisma.TransactionClient | typeof prisma;

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

/**
 * Ensures no non-deleted file or folder already uses this name
 * at the same workspace level (root or under the same parent folder).
 */
export async function assertUniqueNameAtLevel(
  opts: {
    workspaceId: string;
    parentFolderId: string | null;
    name: string;
    excludeDocumentId?: string;
    excludeFolderId?: string;
  },
  db: DbClient = prisma,
) {
  const name = opts.name.trim();
  if (!name) {
    throw new HttpError(400, "Name is required");
  }
  const needle = normalizeName(name);
  const parentId = opts.parentFolderId;

  const [siblingFolders, siblingDocs] = await Promise.all([
    db.folder.findMany({
      where: {
        workspaceId: opts.workspaceId,
        parentId,
        deletedAt: null,
        ...(opts.excludeFolderId ? { NOT: { id: opts.excludeFolderId } } : {}),
      },
      select: { name: true },
    }),
    db.document.findMany({
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
