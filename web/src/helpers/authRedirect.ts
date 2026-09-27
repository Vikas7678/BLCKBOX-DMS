/** Same-app post-login redirect path only (blocks open redirects). */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

/** Build `/login?next=…` from the current location (or an explicit path). */
export function loginWithNext(pathWithSearch: string): string {
  const next = safeNextPath(pathWithSearch, "/");
  if (next === "/") return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}
