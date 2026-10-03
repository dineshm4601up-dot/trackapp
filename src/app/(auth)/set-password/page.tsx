import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifySetupLink } from "@/features/auth/actions";
import { SetPasswordForm } from "@/features/auth/components/set-password-form";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Set your password" };

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Step 1 (link with ?token_hash): confirm with a button press, which verifies
 * the one-time token server-side. Step 2 (signed in): choose a password.
 */
export default async function SetPasswordPage(props: PageProps<"/set-password">) {
  const searchParams = await props.searchParams;
  const tokenHash = firstParam(searchParams.token_hash);
  const type = firstParam(searchParams.type);

  if (tokenHash) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Set up your account</CardTitle>
          <CardDescription>Continue to choose the password you&apos;ll use to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={verifySetupLink}>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type ?? "recovery"} />
            <Button type="submit" size="xl" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a password</CardTitle>
        <CardDescription>
          {user.email ? `For ${user.email}. ` : ""}You&apos;ll use it with your email to sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SetPasswordForm />
      </CardContent>
    </Card>
  );
}
