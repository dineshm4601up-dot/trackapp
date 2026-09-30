import { readSupabaseEnv } from "@/lib/env";

export type SupabaseHealth =
  | { status: "connected"; latencyMs: number }
  | { status: "not_configured" | "error"; message: string };

const TIMEOUT_MS = 8000;

/**
 * Verifies the project URL is reachable and the publishable key is accepted,
 * using the Auth health endpoint. Reads no tables and never uses the secret
 * key, so RLS is not involved or bypassed. Safe to call from server or browser.
 */
export async function checkSupabaseHealth(): Promise<SupabaseHealth> {
  const env = readSupabaseEnv();
  if (!env.success) {
    return {
      status: "not_configured",
      message:
        "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or invalid.",
    };
  }

  const startedAt = performance.now();
  try {
    const response = await fetch(`${env.data.url}/auth/v1/health`, {
      headers: { apikey: env.data.publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (response.ok) return { status: "connected", latencyMs };
    if (response.status === 401 || response.status === 403) {
      return {
        status: "error",
        message: "Supabase rejected the API key. Check NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
      };
    }
    return { status: "error", message: `Supabase responded with HTTP ${response.status}.` };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      status: "error",
      message: timedOut
        ? `No response from Supabase within ${TIMEOUT_MS / 1000}s.`
        : "Could not reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL and your network.",
    };
  }
}
