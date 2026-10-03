import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { USER_ROLES } from "@/lib/auth/roles";
import type { Database } from "@/types/database.types";

const profileSchema = z.object({
  id: z.uuid(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(USER_ROLES),
  is_active: z.boolean(),
});

export type Profile = z.infer<typeof profileSchema>;

/** Why an authenticated user may not use the app. Shown on /login via `?reason=`. */
export type AccessDeniedReason = "inactive" | "no_profile" | "invalid_role";

export type ProfileResult =
  | { status: "ok"; profile: Profile }
  | { status: "denied"; reason: AccessDeniedReason }
  | { status: "error" };

/**
 * Loads and validates the signed-in user's own profile. Runs under RLS with the
 * user's session, so it can only ever return the caller's row.
 *
 * Agents additionally need an active `agents` record: an AGENT profile without
 * one was never provisioned by an admin (or was deactivated) and gets no access.
 */
export async function loadProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, is_active, agents(is_active)")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load profile", { userId, code: error.code });
    return { status: "error" };
  }
  if (!data) return { status: "denied", reason: "no_profile" };

  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) return { status: "denied", reason: "invalid_role" };
  if (!parsed.data.is_active) return { status: "denied", reason: "inactive" };

  if (parsed.data.role === "AGENT") {
    if (!data.agents) return { status: "denied", reason: "no_profile" };
    if (!data.agents.is_active) return { status: "denied", reason: "inactive" };
  }

  return { status: "ok", profile: parsed.data };
}
