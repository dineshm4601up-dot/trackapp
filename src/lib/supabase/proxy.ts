import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseEnv } from "@/lib/env";

const PROTECTED_PREFIXES = ["/admin", "/agent"];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and sends visitors
 * without a session away from protected areas. This is an optimistic UX check
 * only — role and active-status authorization happen server-side in
 * `requireAdmin()` / `requireAgent()` and in database RLS.
 */
export async function updateSession(request: NextRequest) {
  const env = readSupabaseEnv();
  if (!env.success) {
    return isProtected(request.nextUrl.pathname) ? redirectToLogin(request) : NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.data.url, env.data.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): the call
  // validates the JWT and refreshes an expired session via the refresh token.
  const { data } = await supabase.auth.getClaims();

  if (!data && isProtected(request.nextUrl.pathname)) {
    return redirectToLogin(request, response);
  }
  return response;
}

function redirectToLogin(request: NextRequest, sessionResponse?: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  const redirect = NextResponse.redirect(url);
  // Carry over any cookie changes (e.g. clearing an invalid session).
  sessionResponse?.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
