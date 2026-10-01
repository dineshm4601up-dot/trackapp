import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { USER_ROLES } from "@/lib/auth/roles";

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

const PROFILE_COLUMNS = "id, full_name, email, phone, role, is_active";

/**
 * Loads and validates the signed-in user's own profile. Runs under RLS with the
 * user's session, so it can only ever return the caller's row.
 */
export async function loadProfile(supabase: SupabaseClient, userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
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

  return { status: "ok", profile: parsed.data };
}
