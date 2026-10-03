"use client";

import { useEffect, useState } from "react";

import { isStale, timeAgo } from "@/features/monitoring/config";

/** Re-renders its users every 30 s so "2 min ago" and staleness stay truthful without new data. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function TimeAgo({ at }: { at: string }) {
  const now = useNow();
  return <span suppressHydrationWarning>{timeAgo(at, now)}</span>;
}

type LocationAgeProps = {
  at: string | null;
  accuracy?: number | null;
  /** The task is in a state where location sharing is expected. */
  tracked?: boolean;
};

/**
 * Age of the last received location. Old readings are called what they are —
 * a last known location that may be stale — never a current position.
 */
export function LocationAge({ at, accuracy, tracked = true }: LocationAgeProps) {
  const now = useNow();
  if (!at) return <span className="text-muted-foreground">{tracked ? "No location received yet" : "—"}</span>;
  const stale = isStale(at, now);
  return (
    <span suppressHydrationWarning className={stale ? "text-warning" : undefined}>
      {stale ? "Last known location · " : "Updated "}
      {timeAgo(at, now)}
      {accuracy != null && ` · ±${Math.round(accuracy)} m`}
      {stale && tracked && " · Location may be stale"}
    </span>
  );
}
