"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { authMessages, loginNoticeMessages } from "@/features/auth/messages";
import { SETUP_LINK_TYPES, setPasswordSchema, signInSchema } from "@/features/auth/schemas";
import { loadProfile } from "@/lib/auth/profile";
import { homePathFor, resolvePostLoginPath } from "@/lib/auth/roles";
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
        result.status === "denied" ? loginNoticeMessages[result.reason] : authMessages.unavailable,
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

/**
 * Exchanges a one-time setup link for a session. Runs on an explicit button
 * press (POST), so link previews in chat apps can't consume the token.
 */
export async function verifySetupLink(formData: FormData) {
  const parsed = z
    .object({ token_hash: z.string().min(10).max(500), type: z.enum(SETUP_LINK_TYPES) })
    .safeParse({ token_hash: formData.get("token_hash"), type: formData.get("type") });
  if (!parsed.success) redirect("/login?reason=link_invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp(parsed.data);
  if (error) redirect("/login?reason=link_invalid");
  redirect("/set-password");
}

export type SetPasswordState = { error?: string; fieldErrors?: { password?: string; confirm?: string } };

/** Sets the signed-in user's password, then sends them to their home area. */
export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  // Passwords are never echoed back to the browser.
  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return { fieldErrors: { password: fieldErrors.password?.[0], confirm: fieldErrors.confirm?.[0] } };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/login?reason=link_invalid");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "weak_password") {
      return { fieldErrors: { password: "This password is too weak. Use a longer, less common password." } };
    }
    if (error.code === "same_password") {
      return { fieldErrors: { password: "Choose a password different from your current one." } };
    }
    console.error("updateUser(password) failed", { code: error.code, status: error.status });
    return { error: "We couldn't save your password. Please try again." };
  }

  const result = await loadProfile(supabase, claims.claims.sub);
  if (result.status !== "ok") {
    await supabase.auth.signOut({ scope: "local" });
    redirect(result.status === "denied" ? `/login?reason=${result.reason}` : "/login");
  }
  redirect(homePathFor(result.profile.role));
}
