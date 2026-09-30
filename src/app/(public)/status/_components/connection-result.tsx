import { Badge } from "@/components/ui/badge";
import type { SupabaseHealth } from "@/lib/supabase/health";

const statusBadge = {
  connected: { label: "Connected", variant: "success" },
  not_configured: { label: "Not configured", variant: "warning" },
  error: { label: "Failed", variant: "destructive" },
} as const;

export function ConnectionResult({ result }: { result: SupabaseHealth }) {
  const badge = statusBadge[result.status];

  return (
    <div className="space-y-2" aria-live="polite">
      <Badge variant={badge.variant}>{badge.label}</Badge>
      <p className="text-sm text-muted-foreground">
        {result.status === "connected"
          ? `Supabase responded in ${result.latencyMs} ms.`
          : result.message}
      </p>
    </div>
  );
}
