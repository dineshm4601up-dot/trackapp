"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { subscribeToChanges, type ChangeBinding, type LiveStatus } from "@/lib/realtime/subscribe";

const DEBOUNCE_MS = 500;
/**
 * Realtime may not deliver changes made in the first moments after a
 * subscription is acknowledged; one catch-up refresh closes that gap (and the
 * one between server render and subscribing).
 */
const CATCH_UP_MS = 3_000;
/** Only used while Realtime is disconnected and the page is visible. */
const FALLBACK_POLL_MS = 60_000;

/**
 * Keeps a server-rendered screen current: any matching database change
 * re-fetches the route's data (router.refresh — no browser reload, client
 * state such as filters and open dialogs is kept). Bursts are debounced into
 * one refresh. Everything is torn down on unmount.
 */
export function useLiveRefresh(name: string, bindings: readonly ChangeBinding[]) {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [refreshing, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = JSON.stringify(bindings);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  useEffect(() => {
    let wasOffline = false;
    const unsubscribe = subscribeToChanges(
      name,
      JSON.parse(key) as ChangeBinding[],
      () => {
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(refresh, DEBOUNCE_MS);
      },
      (next) => {
        setStatus(next);
        if (next === "live") {
          // Changes may have been missed while connecting or disconnected.
          if (wasOffline) refresh();
          if (catchUp.current) clearTimeout(catchUp.current);
          catchUp.current = setTimeout(refresh, CATCH_UP_MS);
        }
        wasOffline = next === "offline";
      },
    );
    return () => {
      unsubscribe();
      if (debounce.current) clearTimeout(debounce.current);
      if (catchUp.current) clearTimeout(catchUp.current);
    };
  }, [name, key, refresh]);

  useEffect(() => {
    if (status !== "offline") return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(poll);
  }, [status, refresh]);

  return { status, refresh, refreshing };
}
