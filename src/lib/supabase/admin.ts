import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSupabaseEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

const secretKeySchema = z.string().min(1);

/**
 * Service-role client. BYPASSES RLS — use only for Supabase Auth admin
 * operations (creating auth users, generating password-setup links) after the
 * caller has passed `requireAdmin()`, and for removing a proof upload that the
 * server just rejected (agents have no storage delete permission). Never use it for ordinary data access:
 * those queries go through the user's session so RLS and audit attribution apply.
 */
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const secretKey = secretKeySchema.safeParse(process.env.SUPABASE_SECRET_KEY);
  if (!secretKey.success) {
    throw new Error("SUPABASE_SECRET_KEY is not configured.");
  }
  return createClient<Database>(url, secretKey.data, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
