/** Folder tree helpers shared by workspace routes and purge jobs. */

/**
 * Root folder id plus every descendant under it (BFS via parentId links).
 * Used for cascade soft-delete / permanent purge of a folder subtree.
 */
export function collectDescendantFolderIds(
  rootId: string,
  folders: { id: string; parentId: string | null }[],
): string[] {
  const byParent = new Map<string | null, string[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(f.id);
    byParent.set(key, list);
  }
  const ids: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const current = stack.pop()!;
    ids.push(current);
    const children = byParent.get(current) ?? [];
    for (const childId of children) stack.push(childId);
  }
  return ids;
}
