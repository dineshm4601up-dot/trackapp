import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { loadProfile, type Profile, type ProfileResult } from "@/lib/auth/profile";
import { homePathFor, type UserRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string | null };

/**
 * The authenticated user for this request, or null. Uses `getClaims()`, which
 * verifies the session JWT — never `getSession()`, whose cookie data is not
 * trustworthy on the server. Deduplicated per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return { id: data.claims.sub, email: data.claims.email ?? null };
});

export type AuthState =
  | { status: "unauthenticated" }
  | ({ user: CurrentUser } & ProfileResult);

/** The current user plus their validated, active profile. Deduplicated per request. */
export const getCurrentProfile = cache(async (): Promise<AuthState> => {
  const user = await getCurrentUser();
  if (!user) return { status: "unauthenticated" };
  const supabase = await createClient();
  return { user, ...(await loadProfile(supabase, user.id)) };
});

export type AuthContext = { user: CurrentUser; profile: Profile };

/**
 * Requires a signed-in user with an active, valid profile. Otherwise redirects:
 * no session → /login; denied account → forced sign-out with a reason.
 * Infrastructure failures throw so the route's error boundary shows a safe message.
 */
export async function requireUser(): Promise<AuthContext> {
  const state = await getCurrentProfile();
  switch (state.status) {
    case "unauthenticated":
      redirect("/login");
    case "denied":
      redirect(`/auth/signout?reason=${state.reason}`);
    case "error":
      throw new Error("Unable to verify the current session.");
    case "ok":
      return { user: state.user, profile: state.profile };
  }
}

async function requireRole(role: UserRole): Promise<AuthContext> {
  const context = await requireUser();
  if (context.profile.role !== role) redirect(homePathFor(context.profile.role));
  return context;
}

export function requireAdmin() {
  return requireRole("ADMIN");
}

export function requireAgent() {
  return requireRole("AGENT");
}
