/**
 * Shared HTTP client for the BLCKBOX API.
 * Base URL is VITE_API_URL (e.g. http://app.blckbox.localapp/api).
 * Auth uses httpOnly cookies — every call sends credentials: "include".
 */
import { DEFAULT_PAGE_LIMIT } from "../pagination";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export type ListParams = {
  page?: number;
  limit?: number;
  q?: string;
};

/** Build ?page=&limit=&q= for list endpoints. */
export function listQuery(params?: ListParams): string {
  const sp = new URLSearchParams();
  sp.set("page", String(params?.page ?? 1));
  sp.set("limit", String(params?.limit ?? DEFAULT_PAGE_LIMIT));
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  return sp.toString();
}

/**
 * Typed fetch wrapper.
 * - JSON body by default; FormData skips Content-Type so the browser sets the boundary.
 * - Non-OK responses throw Error with `data.error` from the API when present.
 */
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}
