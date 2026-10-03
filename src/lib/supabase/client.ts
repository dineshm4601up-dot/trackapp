import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Supabase client for Client Components. Uses the publishable key and the
 * user's session cookie, so every query is subject to RLS. The underlying
 * client is a singleton in the browser.
 */
export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
