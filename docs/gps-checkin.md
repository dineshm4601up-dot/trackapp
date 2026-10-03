# GPS check-in & geofence validation (Phase 7)

An agent whose task is `ARRIVED` confirms the visit with a GPS check-in. The browser only supplies a raw reading; **the database decides** whether it is inside the location's geofence and, only then, moves the task to `CHECKED_IN`.

## Flow

```text
Agent taps "Check In at Location"          (permission is requested only now — never on page load)
  → navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20 s, maximumAge: 0 })
  → Server Action checkInMyTask()           Zod: finite lat/lng in range, accuracy ≥ 0, timestamp;
                                            any other field (distance, is_within_geofence, radius…) is dropped
  → RPC agent_check_in()                    one transaction, task row locked:
       1. caller is an active agent (current_agent_id())
       2. task is theirs and not a draft            → else TASK_NOT_FOUND
       3. no successful check-in yet                → else CHECKIN_ALREADY_EXISTS
       4. status is ARRIVED (read under the lock)   → else INVALID_TASK_STATUS
       5. lat −90…90, lng −180…180 (NaN/∞ fail)     → else INVALID_COORDINATES
       6. accuracy finite ≥ 0                       → else INVALID_ACCURACY
          accuracy ≤ max accuracy                   → else GPS_ACCURACY_TOO_LOW
       7. reading not older than max age, not ahead by more than max skew → else STALE_LOCATION
       8. location coordinates + radius from the DB (0 < radius ≤ max)    → else INVALID_LOCATION_CONFIGURATION
       9. distance = haversine(location, reading), rounded to 0.01 m
      10. inside  (distance ≤ radius): insert check-in (within = true) + ARRIVED → CHECKED_IN
          outside (distance > radius): insert attempt (within = false); task stays ARRIVED
```

Status history (`ARRIVED → CHECKED_IN`, reason "GPS geofence check-in", note with distance/radius/accuracy) and the audit event `TASK_CHECK_IN` are written by the existing triggers in the same transaction, with the agent as actor. Any error rolls everything back.

## Thresholds

Stored in `public.app_settings` and read by `agent_check_in()` itself. They are deliberately **not** environment variables or function parameters: agents can call database functions directly through the API, so a threshold passed in by a caller could be relaxed by that caller.

| Key | Default | Meaning |
|---|---|---|
| `checkin_max_accuracy_meters` | 100 | Reject readings with worse reported accuracy |
| `checkin_max_location_age_seconds` | 300 | Reject readings older than 5 minutes (device timestamp) |
| `checkin_max_clock_skew_seconds` | 120 | Tolerate a device clock up to 2 minutes ahead |
| `checkin_max_geofence_radius_meters` | 5000 | Larger radii are treated as misconfigured |

Change one (operator, SQL Editor): `update public.app_settings set value = 75 where key = 'checkin_max_accuracy_meters';`. Admins can read the table; nobody can change it through the app. Each location's own radius (10–5000 m, default 100 m) is set on the location.

No new environment variables are required.

## Data

Reuses the Phase 3 `checkins` table: `task_id`, `agent_id`, `latitude`, `longitude`, `accuracy_meters`, `distance_from_location_meters`, `geofence_radius_meters`, `is_within_geofence`, `checked_in_at` (server time), `device_id`, `notes`.

- A partial unique index allows **one successful check-in per task**; concurrent taps are also serialised by the task row lock — the second gets "already checked in".
- Rejected (outside-geofence) attempts are kept as rows with `is_within_geofence = false` so admins can see them. Errors before the distance step (bad input, accuracy, stale reading, wrong status) are not stored.
- Agents can read their own check-ins; admins all; nobody can insert or edit check-ins directly — only `agent_check_in()` writes them.
- `device_id` is an optional random id kept in the browser's local storage. It is informational only (not a fingerprint, never required, never used for security).

## What users see

**Agent** (`/agent/tasks/[id]` at `ARRIVED`): *Check In at Location* → "Getting your current location…" → "Validating your location…" → success ("✓ Checked in · 10:42 am · Location verified", then *Start Task*) or a specific message with *Try Again*:

| Case | Message |
|---|---|
| Permission denied | Location permission is required to check in. Please allow location access in your browser settings and try again. |
| Position unavailable | Your current location could not be determined. Please move to an area with better GPS signal and try again. |
| Timeout | Location detection timed out. Please try again. |
| Accuracy too low | Your GPS accuracy is currently too low. Please move to an open area and try again. |
| Outside geofence | You are outside the allowed check-in area… (+ "Detected distance: about 145 m · Required: within 100 m") |
| Network failure | We could not confirm your check-in. Please check your internet connection and try again. |

Coordinates are never shown to the agent. Nothing is shown as successful until the server confirms; there is no offline queue.

**Admin** (`/admin/tasks/[id]`): *Check-in* card — Verified / Not completed, time, agent, GPS accuracy, server-calculated distance, allowed radius, number of rejected attempts (and the last one's distance), and links to the assigned location and the check-in point on a map. The progress timeline shows "GPS geofence check-in" at *Checked In*.

## Limitations (important)

- **Browser GPS is not proof of physical presence.** The server validates the coordinates, accuracy, freshness, geofence distance, the authenticated agent and task ownership — but a determined user can feed a browser fake coordinates (developer tools, mock-location apps). This raises the bar and creates an audit trail; it is not tamper-proof. Stronger guarantees would need a native app with OS-level mock-location detection.
- The freshness check relies on the device clock; it rejects obviously stale or future-dated readings but cannot prove when the reading was taken.
- Check-in requires a secure context (HTTPS, or `localhost` in development).
- There is **no continuous, background or live tracking**: the location is read once, when the agent taps the button. `agent_location_events` remains unused.
- No admin override check-in exists; the only path to `CHECKED_IN` is `agent_check_in()`.
