import type { Metadata } from "next";
import { Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Sign in" };

// UI shell only — sign-in is wired to Supabase Auth in Phase 2.
export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Use the account provided by your administrator.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" aria-describedby="login-unavailable">
          <fieldset disabled className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or employee code</Label>
              <Input
                id="identifier"
                name="identifier"
                autoComplete="username"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="h-11"
              />
            </div>
            <Button type="submit" size="xl" className="w-full">
              Sign in
            </Button>
          </fieldset>
          <Alert id="login-unavailable">
            <Info aria-hidden />
            <AlertDescription>Sign-in will be enabled in Phase 2.</AlertDescription>
          </Alert>
        </form>
      </CardContent>
    </Card>
  );
}
