"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChangeBinding } from "@/lib/realtime/subscribe";
import { useLiveRefresh } from "@/lib/realtime/use-live-refresh";
import { cn } from "@/lib/utils";

type LiveUpdatesProps = {
  /** Channel name; one channel per screen. */
  channel: string;
  bindings: readonly ChangeBinding[];
  /** Subscribe without showing the indicator (agent screens). */
  hidden?: boolean;
};

/** Subscribes the screen to live changes and shows whether it really is live, with a manual refresh. */
export function LiveUpdates({ channel, bindings, hidden }: LiveUpdatesProps) {
  const { status, refresh, refreshing } = useLiveRefresh(channel, bindings);
  if (hidden) return null;
  const label =
    status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Live updates temporarily unavailable";
  return (
    <div className="flex items-center gap-2 text-sm" role="status">
      <span className={cn("flex items-center gap-1.5", status === "live" ? "text-success" : "text-muted-foreground")}>
        <span
          aria-hidden
          className={cn("size-2 rounded-full", status === "live" ? "bg-success" : status === "offline" ? "bg-warning" : "bg-muted-foreground")}
        />
        {label}
      </span>
      <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
        <RefreshCw className={cn(refreshing && "animate-spin")} data-icon="inline-start" aria-hidden />
        Refresh
      </Button>
    </div>
  );
}
