"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkSupabaseHealth, type SupabaseHealth } from "@/lib/supabase/health";

import { ConnectionResult } from "./connection-result";

export function BrowserConnectionCheck() {
  const [result, setResult] = useState<SupabaseHealth | null>(null);
  const [pending, startTransition] = useTransition();

  function runCheck() {
    startTransition(async () => {
      const health = await checkSupabaseHealth();
      setResult(health);
    });
  }

  return (
    <div className="space-y-4">
      {result ? (
        <ConnectionResult result={result} />
      ) : (
        <p className="text-sm text-muted-foreground">Not run yet.</p>
      )}
      <Button variant="outline" onClick={runCheck} disabled={pending}>
        {pending && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
        {pending ? "Checking…" : "Run browser check"}
      </Button>
    </div>
  );
}
