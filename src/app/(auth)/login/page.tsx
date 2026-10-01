import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";
import { accessDeniedMessages, isAccessDeniedReason } from "@/features/auth/messages";
import { resolvePostLoginPath } from "@/lib/auth/roles";
import { getCurrentProfile } from "@/lib/auth/session";
import { readSupabaseEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = firstParam(searchParams.next);
  const reason = firstParam(searchParams.reason);

  // Already signed in with a usable account: skip the form.
  if (readSupabaseEnv().success) {
    const state = await getCurrentProfile();
    if (state.status === "ok") redirect(resolvePostLoginPath(state.profile.role, next));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in with the account provided by your administrator.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm
          next={next}
          notice={isAccessDeniedReason(reason) ? accessDeniedMessages[reason] : undefined}
        />
      </CardContent>
    </Card>
  );
}
