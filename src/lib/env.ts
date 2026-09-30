import { z } from "zod";

// Browser-safe variables only. NEXT_PUBLIC_* values are inlined at build time,
// so each must be referenced literally (no dynamic process.env[key] access).
// Server-only secrets live in a separate `server-only` module when first needed.
const supabaseEnvSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(1),
});

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;

export function readSupabaseEnv() {
  return supabaseEnvSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getSupabaseEnv(): SupabaseEnv {
  const result = readSupabaseEnv();
  if (!result.success) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example).",
    );
  }
  return result.data;
}
