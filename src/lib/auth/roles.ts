// Client-safe role definitions. Mirrors the `public.user_role` enum.
export const USER_ROLES = ["ADMIN", "AGENT"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const homePaths: Record<UserRole, string> = {
  ADMIN: "/admin",
  AGENT: "/agent",
};

export function homePathFor(role: UserRole) {
  return homePaths[role];
}

/**
 * Post-login destination: the requested path if it is a same-origin path
 * inside the role's own area, otherwise the role's home. Prevents open
 * redirects (`//evil.com`, absolute URLs) and cross-role bouncing.
 */
export function resolvePostLoginPath(role: UserRole, next: string | null | undefined) {
  const home = homePathFor(role);
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return home;
  }
  return next === home || next.startsWith(`${home}/`) ? next : home;
}
