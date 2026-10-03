import "server-only";

import { getAppOrigin } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * One-time link that lets a user choose their own password. Generated with the
 * Auth admin API (no email is sent) and pointing at our own /set-password page,
 * which verifies it server-side. Callers must have passed `requireAdmin()`.
 * The link is a credential: show it only to the admin who requested it.
 */
export async function createPasswordSetupLink(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("generateLink failed", { code: error?.code, status: error?.status });
    throw new Error("Unable to create a password setup link.");
  }

  const url = new URL("/set-password", await getAppOrigin());
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "recovery");
  return url.toString();
}
