"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { accessDeniedMessages, authMessages } from "@/features/auth/messages";
import { signInSchema } from "@/features/auth/schemas";
import { loadProfile } from "@/lib/auth/profile";
import { resolvePostLoginPath } from "@/lib/auth/roles";
import { readSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type SignInState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  email?: string;
};

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = signInSchema.safeParse({ email, password: formData.get("password") });

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      email,
      fieldErrors: { email: fieldErrors.email?.[0], password: fieldErrors.password?.[0] },
    };
  }
  if (!readSupabaseEnv().success) return { email, error: authMessages.notConfigured };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    // Same message whether the email exists or not.
    if (error?.status === 429) return { email, error: authMessages.rateLimited };
    if (error && error.status && error.status < 500) {
      return { email, error: authMessages.invalidCredentials };
    }
    console.error("Sign-in failed", { code: error?.code, status: error?.status });
    return { email, error: authMessages.unavailable };
  }

  const result = await loadProfile(supabase, data.user.id);
  if (result.status !== "ok") {
    // Valid credentials but no access: end the session immediately.
    await supabase.auth.signOut({ scope: "local" });
    return {
      email,
      error:
        result.status === "denied" ? accessDeniedMessages[result.reason] : authMessages.unavailable,
    };
  }

  const next = formData.get("next");
  redirect(resolvePostLoginPath(result.profile.role, typeof next === "string" ? next : null));
}

export async function signOut() {
  const supabase = await createClient();
  // Ends this device's session only; other devices stay signed in.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
