# Monitoring, realtime updates and location sharing (Phase 9)

Administrators see field activity as it happens: which tasks are open, what state each is in, where the agent was last seen, and what was delivered, collected and uploaded. Agents share their location **only for an active task, only while its screen is open, and always with a visible indicator**.

## Screens

| Route | Who | What |
|---|---|---|
| `/admin` | ADMIN | Today's operations: agents in the field, tasks per status, agent status board, recent activity |
| `/admin/monitoring` | ADMIN | Open tasks grouped by status, with last location age, check-in time, delivery / cash progress and proof count. Search and filters (status, type, agent, customer, location, date, priority), paginated in the database |
| `/admin/monitoring/map` | ADMIN | One marker per tracked task at its latest location, plus the same information as a list |
| `/admin/tasks/[id]` | ADMIN | Live status, last updated, last known location, check-in, delivery, cash, proof, and one timeline of status changes, proof uploads and the cash record |
| `/admin/agents` | ADMIN | Current task, its status and the time of the last location update (no coordinates) |
| `/agent/tasks/[id]` | AGENT | "Location Sharing" indicator while the task is active; admin changes (cancel, reschedule) arrive live |

Every admin page calls `requireAdmin()` on the server. Agents are redirected away from `/admin/*`, and the database returns nothing to them even if a query is called directly (see Security).

## Realtime architecture

```text
Database change (tasks, task_status_history, agent_location_events,
                 checkins, task_products, cash_collections, task_proofs)
      ↓  supabase_realtime publication
Supabase Realtime — checks the subscriber's RLS SELECT policy per row
      ↓  only to authorised subscribers
src/lib/realtime/subscribe.ts — one channel per screen
      ↓  "something changed" signal (row payloads are not used)
useLiveRefresh → router.refresh() → server re-reads through requireAdmin()/RLS
      ↓
Monitoring UI updates in place (no browser reload; filters and dialogs kept)
```

- **One subscription layer:** `subscribeToChanges()` is the only place a channel is opened. A screen passes all its bindings and gets one channel (`MONITORING_BINDINGS`, `MAP_BINDINGS`, `taskBindings(id)` in `src/features/monitoring/config.ts`). No channel per task or per card.
- **Authenticated socket:** the socket is given the signed-in user's access token before the channel joins. Without a session it does not subscribe at all.
- **Signal, not data:** a change triggers a debounced `router.refresh()`. The data shown always comes from the normal server queries, so realtime can never show something the user's queries would not return. Notices without row access are ignored.
- **Honest status:** the indicator shows **Live**, **Connecting…** or **Live updates temporarily unavailable**, and there is always a **Refresh** button. While disconnected, the page re-reads once a minute, and once more when the connection returns.
- **Catch-up:** one extra refresh runs 3 seconds after a subscription goes live, covering changes made while it was connecting.
- **Cleanup:** leaving a screen removes its channel and clears its timers.

## Location architecture

```text
Task enters ON_THE_WAY (or is ARRIVED / CHECKED_IN / IN_PROGRESS)
      ↓  <LocationSharing> is rendered on the agent's task screen — and only there
navigator.geolocation.watchPosition (one watcher; coordinates kept out of React state)
      ↓  first fix, then every 45 s
recordMyLocation() server action — requireAgent(), Zod: finite numbers in range
      ↓  raw latitude / longitude / accuracy / device timestamp only
agent_record_location() — agent from the session, task must be the agent's own and
                          active, values validated, rate limited, server timestamp
      ↓
agent_location_events (append-only)
      ↓  Supabase Realtime (admins only)
Monitoring board, map, task page
```

### When location is shared

| Task status | Sharing |
|---|---|
| ASSIGNED, ACCEPTED | Off — nothing is collected before travel starts |
| ON_THE_WAY, ARRIVED, CHECKED_IN, IN_PROGRESS | On, while the task screen is open |
| COMPLETED, PARTIALLY_COMPLETED, FAILED, CANCELLED | Off — the watcher is cleared and the server rejects new events |

- **Visible:** the agent sees "Location Sharing — ● Active for this task" and when it was last shared. If the browser has not been given permission yet, sharing starts only when the agent taps **Share location for this task**.
- **Stops by itself:** the watcher is cleared when the task ends, when an admin cancels it (the change arrives live), and when the agent leaves the task screen. There is no watcher in a layout or on any other page.
- **One watcher:** tracking belongs to the task screen that is open, so there is never more than one, even if the agent has several open tasks.
- **Failures:** permission denied or no signal shows "Location sharing is unavailable…" / "Location unavailable"; the task can still be worked. A failed upload is not reported as shared and is simply retried at the next interval. There is no offline queue.
- **Separate from check-in and completion:** location events never change a task. Check-in remains `agent_check_in()` (Phase 7) and completion remains `agent_complete_task()` (Phase 8).

### Server rules (`agent_record_location`)

| Check | Result |
|---|---|
| Caller is not an active agent | `UNAUTHORIZED` |
| Task is not the caller's (or does not exist) | `TASK_NOT_FOUND` |
| Task is not ON_THE_WAY / ARRIVED / CHECKED_IN / IN_PROGRESS | `TRACKING_NOT_ACTIVE` |
| Latitude / longitude missing, NaN, infinite or out of range | `INVALID_COORDINATES` |
| Accuracy missing, negative, NaN or infinite | `INVALID_ACCURACY` |
| Device timestamp older than 120 s or more than 120 s ahead | `STALE_LOCATION` |
| Accuracy worse than 2,000 m | ignored (`LOW_ACCURACY`), nothing stored |
| Another event from this agent in the last 20 s | ignored (`THROTTLED`), nothing stored |

- The function has no `agent_id` or `recorded_at` parameter, so a client cannot supply them. `recorded_at` is the server clock.
- The rate limit is per agent and serialised with an advisory lock, so parallel requests still store one event.
- Limits live in `app_settings` (`location_min_interval_seconds`, `location_max_age_seconds`, `location_max_accuracy_meters`). The client interval (45 s) is in `src/features/tracking/config.ts`.

## Latest location and staleness

- `task_monitor` (a `security_invoker` view) returns one row per task with its **latest** location event, resolved in the database through the `(task_id, recorded_at desc)` index. History is never loaded into the browser, and the map shows one marker per tracked task.
- A location older than 5 minutes (`LOCATION_STALE_AFTER_SECONDS`) is shown as **"Last known location · N min ago · Location may be stale"**, and its map marker is labelled **Stale**. A stale location does not mean the agent stopped: the screen may be closed, the signal lost or permission changed.
- Ages are re-evaluated in the browser every 30 seconds, so a location becomes stale on screen even when no new data arrives.

## Agent status

Derived from each agent's furthest-along open task (`agent_activity` view):

| Status | When |
|---|---|
| Available | no open task |
| Assigned | ASSIGNED or ACCEPTED |
| On the way | ON_THE_WAY |
| At location | ARRIVED or CHECKED_IN |
| Working | IN_PROGRESS |
| Completed | no open task, and a task completed today |

For On the way, At location and Working, the board also shows the location age under the status ("Updated 1 min ago", "No location received yet", or "Location may be stale") — this is the "offline / no recent update" signal.

## Map

`src/lib/maps/` is provider-neutral: screens build `MapMarker` objects and render `<MapView>`. The only provider-specific code is `map-view.tsx` and `provider.ts` (Leaflet with OpenStreetMap tiles; no API key). Marker labels carry the status in text, not colour alone. If the map library or tiles fail to load, the list beside the map and the monitoring board keep working.

## Security

- **Admin only:** monitoring pages verify an active ADMIN on the server. RLS lets only admins read other agents' location events, check-ins, cash and proofs.
- **Agent isolation:** an agent can read only their own location events, and the monitoring views return only their own tasks. Realtime delivers only rows the subscriber's RLS allows.
- **Append-only:** nobody using the app (agent or admin) can insert, update or delete `agent_location_events` directly; the Phase 3 direct-insert policy was removed.
- **No public location API:** coordinates are returned only by server-rendered admin pages, per request.
- **No audit duplication:** location events are their own stream and are not copied into `audit_logs`.
- **Minimal data:** latitude, longitude, accuracy and server time. No device identifier is stored for location events.

## Retention

Location events are kept until deleted; this phase does not delete anything automatically. Production deployments should choose a retention period (for example 30–90 days) and run a scheduled clean-up as the database owner, for example:

```sql
delete from public.agent_location_events where recorded_at < now() - interval '90 days';
```

The `recorded_at` indexes keep this cheap. Check-ins, status history and audit logs are separate records and are not affected.

## Limitations

- Sharing needs the task screen open in the foreground. Browsers pause web pages in the background and when the phone is locked, so there is no background tracking — by design.
- Browser GPS accuracy varies with device, signal and battery settings.
- No offline queue, no route history or replay, no ETA, no notifications.
- Anonymous Realtime subscribers receive no rows; Supabase may send them an empty "unauthorised" notice that a change occurred on a published table.
