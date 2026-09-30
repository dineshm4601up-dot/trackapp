import type { Metadata } from "next";
import { connection } from "next/server";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkSupabaseHealth } from "@/lib/supabase/health";

import { BrowserConnectionCheck } from "./_components/browser-connection-check";
import { ConnectionResult } from "./_components/connection-result";

export const metadata: Metadata = { title: "System status" };

export default async function StatusPage() {
  await connection(); // check on every request, never at build time
  const serverResult = await checkSupabaseHealth();

  return (
    <div className="space-y-6">
      <PageHeader
        title="System status"
        description="Verifies the Supabase URL is reachable and the publishable key is accepted. No tables are read and RLS is not bypassed."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Server → Supabase</CardTitle>
            <CardDescription>Checked by the Next.js server for this request.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectionResult result={serverResult} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Browser → Supabase</CardTitle>
            <CardDescription>Checked directly from this browser (CORS and network).</CardDescription>
          </CardHeader>
          <CardContent>
            <BrowserConnectionCheck />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
