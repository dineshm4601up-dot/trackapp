import { NextResponse, type NextRequest } from "next/server";

import { isAccessDeniedReason } from "@/features/auth/messages";
import { readSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Forced sign-out for sessions that are valid but must not access the app
 * (inactive account, missing profile, unknown role). Server Components cannot
 * clear cookies, so `requireUser()` redirects here. User-initiated sign-out
 * uses the `signOut` Server Action instead.
 */
export async function GET(request: NextRequest) {
  if (readSupabaseEnv().success) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  }

  const reason = request.nextUrl.searchParams.get("reason");
  const url = new URL("/login", request.url);
  if (isAccessDeniedReason(reason)) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}
