# Agent task execution (Phase 6)

The mobile workflow an agent follows for a task assigned by an admin. The step from `ARRIVED` to `CHECKED_IN` is the GPS check-in described in [gps-checkin.md](gps-checkin.md).

## Routes (agent only)

| Route | Purpose |
|---|---|
| `/agent` | Greeting, today's counts (Assigned / Accepted / In progress / Completed), next 3 open tasks |
| `/agent/tasks?view=today\|upcoming\|all\|completed\|failed\|cancelled` | Task cards; default **Today** = scheduled today plus open tasks that are overdue or unscheduled, ordered by date → start time → priority → creation |
| `/agent/tasks/[id]` | Task screen: instructions, task-type section, location (Navigate), customer (Call), progress timeline, sticky action bar |
| `/agent/history` | Completed / failed / cancelled tasks |

Every query runs with the agent's session; RLS returns only tasks assigned to that agent (never drafts). Another agent's task id shows "not found". The agent sees only what is needed: customer name, phone and address; location address and on-site contact.

**Navigate** opens the device's maps app with directions to the task location (coordinates if set, otherwise the address). It is navigation only — it does not read the agent's position and verifies nothing.

## Status workflow

```text
ASSIGNED ─Accept─► ACCEPTED ─Start Travel─► ON_THE_WAY ─I've Arrived─► ARRIVED
                                                                          │
                       GPS check-in (gps-checkin.md) ─────────────────────┘
                                                                          ▼
COMPLETED / PARTIALLY_COMPLETED ◄─Review & complete (execution form)─ IN_PROGRESS ◄─Start Task─ CHECKED_IN
FAILED ◄─Report a problem (reason)── from ACCEPTED, ON_THE_WAY, ARRIVED, CHECKED_IN, IN_PROGRESS
```

| Step | Sets (server time) | Confirmation |
|---|---|---|
| Accept | `accepted_at` | "Accept this task?" |
| Start Travel | — (time in status history) | — |
| I've Arrived | — | — (shown as self-reported) |
| Start Task | `started_at` | — |
| Review & complete | `completed_at`, `completion_notes`; outcome decided by `agent_complete_task` | summary of quantities / amounts; reason required for a shortfall — see [task-execution.md](task-execution.md) |
| Report a problem | `failure_reason` = reason (+ note) | reason required (+ note; note required for "Other") |

Exactly one primary action is shown per status. At `ARRIVED` it is **Check In at Location** (GPS check-in); "Arrived" itself is self-reported.

Agents cannot cancel; cancellation stays with admins, who can now cancel up to `ARRIVED` (before any verified on-site work).

## Transition security

All agent status changes go through one database function, **`agent_transition_task(task, expected_status, to_status, reason?, notes?)`**, called by the `transitionMyTask` Server Action (`src/features/tasks/agent-actions.ts`). In one transaction it:

1. derives the agent from the session (`current_agent_id()`: active profile + active agent record) — never from the request;
2. locks the task row and checks it belongs to that agent and is not a draft (otherwise "not found");
3. checks the task is still in `expected_status` — a stale screen (e.g. the admin cancelled meanwhile) gets "This task has changed. Please refresh the task." and nothing is overwritten;
4. checks the step against the transition table above; **`CHECKED_IN` can never be requested here** — only `agent_check_in()` (GPS) sets it;
5. updates status and timestamps; the status-history and audit triggers record it with the agent as actor.

Agents still have no direct `UPDATE` on `tasks` (the function is `SECURITY DEFINER` precisely so this stays true), so they cannot change `agent_id`, `created_by`, `verified_by`, or any master data. Admin and anonymous callers are rejected by the function.

Nothing is shown as successful until the server confirms it. A dropped connection shows "Unable to update task. Please check your connection and try again." and keeps the screen as it was.

The UI mirror of the transition table (`AGENT_NEXT_STEP`, `FAILABLE_STATUSES`, `AGENT_TARGETS` in `src/features/tasks/constants.ts`) only decides which buttons to show; the database function is authoritative.

## Task-type sections

`src/features/tasks/execution/task-execution-view.tsx` maps each task type to a section — the extension point for later modules:

| Type | Shown now |
|---|---|
| Deliver Products / Pickup / Replacement | product lines (name, SKU, quantity + unit, unit price) |
| Collect Cash | expected amount (from `cash_collections`) — no collection recording yet |
| Verification / Inspection / Document Collection / Survey / Other | guidance; the instructions card carries the details |

## Status history, timeline & audit

- Every transition writes `task_status_history` (old → new, `changed_by`, `changed_at`, reason, notes).
- `TaskStatusTimeline` (agent and admin task pages) shows the milestones Assigned → … → Completed with the real times from history (none are invented), and failed / cancelled / partial outcomes.
- Audit actions: `ACCEPT_TASK`, `START_TRAVEL`, `MARK_ARRIVED`, `START_TASK`, `COMPLETE_TASK`, `PARTIALLY_COMPLETE_TASK`, `REPORT_TASK_FAILURE` (plus `CHECK_IN_TASK` and `VERIFY_TASK` reserved for later phases), each with the agent as actor and the changed fields.

## Deferred

Delivered-quantity capture, cash collection, photo/document/signature proof, live or background location, realtime updates (agents use **Refresh** / reload), push notifications, reports.
