/** Platform-level role helpers for UI gating. */
export type PlatformRole = "admin" | "owner" | "member";

export function canAccessSettings(role: PlatformRole | undefined): boolean {
  return role === "admin";
}

export function canAccessUsers(role: PlatformRole | undefined): boolean {
  return role === "admin" || role === "owner";
}

export function canManageUsers(role: PlatformRole | undefined): boolean {
  return role === "admin";
}

export function canAccessTrash(role: PlatformRole | undefined): boolean {
  return role === "admin" || role === "owner";
}

export function canCreateWorkspace(role: PlatformRole | undefined): boolean {
  return role === "admin" || role === "owner";
}

export function canDeleteContent(role: PlatformRole | undefined): boolean {
  return role === "admin" || role === "owner";
}
