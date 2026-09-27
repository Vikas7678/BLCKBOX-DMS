export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export const DEFAULT_PAGE_LIMIT = 20;

export function emptyMeta(limit = DEFAULT_PAGE_LIMIT): PaginationMeta {
  return { page: 1, limit, total: 0, totalPages: 1 };
}

export function toPaginationMeta(
  res: Pick<PaginationMeta, "page" | "limit" | "total" | "totalPages">,
): PaginationMeta {
  return {
    page: res.page,
    limit: res.limit,
    total: res.total,
    totalPages: res.totalPages,
  };
}
