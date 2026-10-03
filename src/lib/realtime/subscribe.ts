import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

/** Tables in the supabase_realtime publication (see the Phase 9 migration). */
export type RealtimeTable =
  | "tasks"
  | "task_status_history"
  | "agent_location_events"
  | "checkins"
  | "task_products"
  | "cash_collections"
  | "task_proofs"
  | "notifications";

export type ChangeBinding = {
  table: RealtimeTable;
  event: "INSERT" | "UPDATE" | "*";
  /** Postgres-changes filter, e.g. `id=eq.<uuid>`. */
  filter?: string;
};

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * The one place a Realtime channel is opened. A page passes all its bindings
 * and gets a single channel; the returned function removes it.
 *
 * The socket is authenticated with the signed-in user's session before the
 * channel joins, so Realtime applies that user's RLS policies to every change
 * and only delivers rows they may read. Callers treat a change as a signal to
 * re-read data through the normal authorised queries — row payloads are
 * deliberately not used.
 */
export function subscribeToChanges(
  name: string,
  bindings: readonly ChangeBinding[],
  onChange: (table: RealtimeTable) => void,
  onStatus: (status: LiveStatus) => void,
): () => void {
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  void (async () => {
    // Without a session the socket would join anonymously: never subscribe that way.
    const { data } = await supabase.auth.getSession();
    if (cancelled) return;
    if (!data.session) return onStatus("offline");
    await supabase.realtime.setAuth(); // the user's access token, kept fresh by the client
    if (cancelled) return;

    // A unique topic per subscription: if a screen is left and re-entered quickly
    // (or mounted twice in development), the old channel leaving can never take
    // the new one down with it.
    let next = supabase.channel(`${name}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
    for (const { table, event, filter } of bindings) {
      next = next.on("postgres_changes", { event, schema: "public", table, ...(filter ? { filter } : {}) }, (payload) => {
        // A notice without access to the row is not a change this user may act on.
        if (payload.errors?.length) return;
        onChange(table);
      });
    }
    channel = next;
    next.subscribe((status) => {
      if (!cancelled) onStatus(status === "SUBSCRIBED" ? "live" : "offline");
    });
  })().catch(() => {
    if (!cancelled) onStatus("offline");
  });

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
