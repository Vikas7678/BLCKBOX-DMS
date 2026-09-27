import { prisma } from "../lib/prisma";

/** Active (not deleted/disabled) users for pickers — shares, addable workspace members, etc. */
export async function searchActiveUsers(opts: {
  q?: string;
  excludeIds?: string[];
  take?: number;
}): Promise<{ id: string; email: string; name: string }[]> {
  const q = (opts.q ?? "").trim();
  const take = opts.take ?? (q.length >= 1 ? 20 : 50);
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      disabledAt: null,
      ...(opts.excludeIds?.length ? { id: { notIn: opts.excludeIds } } : {}),
      ...(q.length >= 1
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, email: true, name: true },
    take,
    orderBy: { name: "asc" },
  });
}
