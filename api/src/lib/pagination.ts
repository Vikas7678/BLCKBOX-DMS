export type PaginationQuery = {
  page: number;
  limit: number;
  skip: number;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Parse `page` / `limit` from Express query (1-based page). */
export function parsePagination(query: Record<string, unknown>): PaginationQuery {
  const rawPage = Number(query.page ?? 1);
  const rawLimit = Number(query.limit ?? DEFAULT_LIMIT);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  return {
    page: Math.min(page, totalPages),
    limit,
    total,
    totalPages,
  };
}

export function slicePage<T>(items: T[], page: number, limit: number): {
  items: T[];
  meta: PaginationMeta;
} {
  const total = items.length;
  const meta = paginationMeta(total, page, limit);
  const start = (meta.page - 1) * limit;
  return { items: items.slice(start, start + limit), meta };
}
