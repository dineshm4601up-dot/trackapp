# Database architecture

PostgreSQL on Supabase. All schema changes live in `supabase/migrations/` (idempotent, non-destructive). Security tests live in `supabase/tests/`.

| Migration | Contents |
|---|---|
| `20261001090000_auth_profiles.sql` | `user_role` enum, `profiles`, auth-user trigger, `get_my_role()`, profile RLS |
| `20261001100000_core_schema.sql` | Business tables, enums, constraints, indexes, RLS helpers, policies, status-history and audit triggers |
| `20261002090000_master_data_admin.sql` | Admin edit of profile name/phone, `agent_directory` / `location_directory` search views, `ACTIVATE_` / `DEACTIVATE_` audit actions |
| `20261003090000_task_management.sql` | `admin_save_task` / `admin_cancel_task` functions, `task_directory` search view, semantic task audit actions |
| `20261004090000_agent_workflow.sql` | `agent_transition_task` (agent status changes), `tasks.completion_notes`, history notes, admin cancel up to ARRIVED, audit actions per status step |
| `20261010090000_ai.sql` | AI decision support: `ai_settings`, `ai_models` (registry), `ai_predictions`, `ai_recommendations`, `ai_feedback`, `ai_runs`, `ai_summaries`; admin-read-only RLS, no direct writes; feature functions (`ai_task_features`, `ai_agent_workload`, `ai_volume_history`, `ai_detect_anomalies`); controlled writers (`ai_begin_run` with rate limit, `ai_store_*`, `ai_record_outcomes`, `ai_review_recommendation`, `ai_submit_feedback`, `ai_set_setting`); `ai_current_predictions` / `ai_evaluation` views. No AI function writes to an operational table — see [ai.md](ai.md) |
| `20261009090000_reporting.sql` | Read-only reporting functions: `report_task_facts` (one row per task), `report_overview`, `report_agents`, `report_customers`, `report_locations`, `report_products`, `report_cash`, `report_checkins`, `report_durations`, `report_data_quality`, `my_task_summary`; partial index for unscheduled tasks — see [analytics.md](analytics.md) |
| `20261008090000_notifications.sql` | `notifications`, `communication_queue` (outbox + delivery history), `notification_preferences`, `communication_log` view; event triggers on status history, tasks, cash and proofs; `publish_notification` (idempotent, preference-aware); read-marking, outbox and reminder functions; `notifications` added to Realtime — see [notifications.md](notifications.md) |
| `20261007090000_monitoring.sql` | `agent_record_location` (the only writer of location events: ownership, active status, validation, rate limit, server time), direct-insert policy removed, `task_monitor` / `agent_activity` views, `task_status_counts`, indexes for latest location and the activity feed, operational tables added to the Realtime publication — see [monitoring.md](monitoring.md) |
| `20261006090000_task_execution.sql` | `agent_complete_task` (delivery / cash / generic completion, server-decided outcome), `agent_add_task_proof`, `tasks.expected_amount`, `task_products.delivery_notes`, `task_proofs.sha256`, one cash collection per task, collected ≤ expected, private `task-proofs` bucket + storage policies, execution audit actions — see [task-execution.md](task-execution.md) |
| `20261005090000_gps_checkin.sql` | `agent_check_in` (GPS check-in), `haversine_meters`, `app_settings` + `app_setting()`, one successful check-in per task, `TASK_CHECK_IN` audit |

## Relationships

```text
auth.users
   │ 1:1 (cascade)
PROFILE ─────────────────────────────┐ created_by / verified_by / changed_by / actor
   │ 1:0..1 (cascade)                │
AGENT                                │
   │ 1:N                             │
TASK ──────────── CUSTOMER           │
 │  └─(location_id, customer_id)──► LOCATION  (location must belong to the task's customer)
 │                                   │
 ├── TASK_PRODUCTS ── PRODUCT        │
 ├── CHECKINS            (agent)     │
 ├── TASK_PROOFS         (agent)     │
 ├── CASH_COLLECTIONS    (agent)     │
 ├── TASK_STATUS_HISTORY ────────────┤
 └── AGENT_LOCATION_EVENTS (agent, optional task)
AUDIT_LOGS ──────────────────────────┘
```

Deletion rules: only `profiles → agents` and `tasks → task_products` cascade. Everything that records history (`tasks`, `checkins`, `task_proofs`, `cash_collections`, `task_status_history`, `audit_logs`) uses `ON DELETE RESTRICT`, so deleting a referenced agent, customer, location, product or acting user fails instead of erasing history. Master data is retired with `is_active = false`; tasks with status `CANCELLED`.

## Tables

| Table | Purpose | Key rules |
|---|---|---|
| `profiles` | One row per auth user: name, email, phone, `role` (`ADMIN`/`AGENT`), `is_active` | Created by trigger as active `AGENT`. Users can't write it. |
| `agents` | Field-agent record for an `AGENT` profile: `employee_code`, `is_active` | `profile_id` unique and immutable; profile must have role `AGENT`. Name/phone come from `profiles` (not duplicated). |
| `customers` | Business/person served | `customer_code` unique; soft delete. |
| `locations` | Physical site of a customer: address, lat/lng (`numeric(10,7)`), geofence radius, contact | lat ∈ [-90, 90], lng ∈ [-180, 180], both or neither; radius 10–5000 m. |
| `products` | Catalog item: `sku`, name, unit, price | `sku` unique; price ≥ 0. |
| `tasks` | Central entity: `task_type`, `status`, agent, customer, location, schedule, lifecycle timestamps | `task_code` generated by DB (`TASK-YYYYMMDD-000001`, UTC); priority 1–5 (default 3); non-draft tasks need an agent; end time after start time. |
| `task_products` | Product lines on a task | One line per product per task; assigned > 0; 0 ≤ delivered ≤ assigned. |
| `checkins` | GPS check-ins and rejected attempts | Written only by `agent_check_in()`; one successful row per task; immutable. |
| `app_settings` | Operator-managed thresholds (check-in accuracy, age, clock skew, max radius) | Admin read-only; read by functions. |
| `task_proofs` | Metadata for proof files in Supabase Storage | `proof_type` ∈ PHOTO / DOCUMENT / SIGNATURE / OTHER; immutable. |
| `cash_collections` | Expected vs collected money per task | Money is `numeric(14,2)`; ISO currency code; collected > 0 requires method and time; method ∈ CASH / UPI / CARD / BANK_TRANSFER / CHEQUE / OTHER. |
| `task_status_history` | Immutable lifecycle log | Written only by trigger on every task insert/status change, with actor (`auth.uid()`) and optional reason. |
| `agent_location_events` | Task-scoped location samples shared during active field work | Append-only. Written only by `agent_record_location()`; no direct insert, update or delete for any app user. |
| `audit_logs` | Who / what / when / entity / old → new | Written by trigger on profiles, agents, customers, locations, products, tasks, task_products, cash_collections. Records only changed columns. Read-only for admins; nobody can edit or delete. |

`notifications` is **deferred** to the notifications phase: nothing produces notifications yet, and the table design depends on that phase's delivery channels.

### Enums

- `user_role`: `ADMIN`, `AGENT`
- `task_type`: `COLLECT_CASH`, `DELIVER_PRODUCTS`, `PICKUP`, `VERIFICATION`, `INSPECTION`, `DOCUMENT_COLLECTION`, `REPLACEMENT`, `SURVEY`, `OTHER`
- `task_status`: `DRAFT`, `ASSIGNED`, `ACCEPTED`, `ON_THE_WAY`, `ARRIVED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED`, `CANCELLED`, `RESCHEDULED`, `VERIFIED`

New values can be added later with `ALTER TYPE … ADD VALUE` without rewriting data. Status *transitions* are not enforced in the database yet; that's the task-workflow phase.

## Row Level Security

RLS is enabled on every table. `anon` has no privileges on any table. Grants to `authenticated` are the minimum the policies need; anything not granted is impossible, whatever the policies say.

Helper functions (`SECURITY DEFINER`, `search_path = ''`, executable only by `authenticated`):

| Function | Returns |
|---|---|
| `is_admin()` | caller's profile is active and `ADMIN` |
| `is_agent()` | caller's profile is active and `AGENT` |
| `current_agent_id()` | caller's `agents.id` if profile **and** agent record are active, else NULL |
| `is_my_task(task_id)` | task is assigned to the caller and not `DRAFT` |
| `agent_check_in(…)` | the only way to reach `CHECKED_IN`: server-side distance + geofence decision; `SECURITY DEFINER` — see [gps-checkin.md](gps-checkin.md) |
| `agent_transition_task(…)` | the only way an agent changes task status; ownership + expected-status + transition checks; `SECURITY DEFINER` — see [agent-workflow.md](agent-workflow.md) |
| `agent_record_location(…)` | the only way a location event is written; task must be the caller's own and in an active field state; rate limited; `SECURITY DEFINER` — see [monitoring.md](monitoring.md) |
| `agent_complete_task(…)` / `agent_add_task_proof(…)` | the only way to complete a task or register proof; validates execution data and decides COMPLETED vs PARTIALLY_COMPLETED; `SECURITY DEFINER` — see [task-execution.md](task-execution.md) |
| `admin_save_task(…)` / `admin_cancel_task(…)` | task writes with business validation; `SECURITY INVOKER` (RLS applies), admin-only — see [tasks.md](tasks.md) |
| `get_my_role()` | caller's role if active, else NULL |

Roles always come from `profiles` via `auth.uid()`, never from JWT claims or the browser.

| Table | ADMIN | AGENT |
|---|---|---|
| profiles | read all; update `full_name`, `phone` | read own |
| agents | read, create, update `employee_code`/`is_active` | read own |
| customers, locations, products | read, create, update | read only rows used by own tasks |
| tasks | read, create, update (not `task_code`/`created_by`) | read own non-draft tasks |
| task_products | full | read own tasks' lines |
| checkins | read | read own |
| task_proofs | read | read own; add for own task as self |
| cash_collections | read, create, update | read own |
| task_status_history | read | read own tasks' history |
| agent_location_events | read | read own; add only through `agent_record_location()` (own active task) |
| notifications | read all (delivery log); mark own as read | read own; mark own as read (functions only) |
| communication_queue | read; retry a failed message | no access |
| notification_preferences | own row | own row |
| audit_logs | read | none |

The search views `agent_directory` (agents + profile) and `location_directory` (locations + customer) are `security_invoker`, so the caller's RLS on the underlying tables applies: agents see only their own row and their tasks' locations.

Nobody, including admins, can delete through the API, rewrite `task_code`, insert check-ins, edit proofs, status history or audit logs, or change `profiles.role` / `is_active`. Role changes and deactivation are operator tasks (SQL editor or service role) until admin user management is built.

**Why agents can't write tasks, check-ins or cash directly:** those writes need values the server must compute or verify (geofence distance, valid status transitions, amounts). The workflow phases add `SECURITY DEFINER` functions that validate and write them atomically.

## Indexes

Unique constraints index `task_code`, `sku`, `customer_code`, `employee_code`, `agents.profile_id` and `task_products(task_id, product_id)`. Additional indexes:

| Index | Serves |
|---|---|
| `tasks(agent_id, scheduled_date, status)` | Agent's tasks for a day: 0.07 ms at 20k tasks (also serves `agent_id`-only lookups) |
| `tasks(scheduled_date, status)` | Admin board by date (also serves date-only lookups) |
| `tasks(status)`, `tasks(customer_id)`, `tasks(location_id)` | Status filters, FK lookups |
| `locations(customer_id)`, `task_products(product_id)` | FK lookups |
| `checkins(task_id)`, `checkins(agent_id, checked_in_at desc)`, `checkins(checked_in_at)` | Per task, per agent, by time |
| `task_proofs(task_id)`, `task_proofs(agent_id)`, `cash_collections(task_id)`, `cash_collections(agent_id)` | Per task / per agent |
| `task_status_history(task_id, changed_at)` | Task timeline |
| `agent_location_events(agent_id, recorded_at desc)` | Latest event per agent; rate limit |
| `agent_location_events(task_id, recorded_at desc)` | Latest location per task (monitoring, map) |
| `task_status_history(changed_at desc)`, `audit_logs(action, created_at desc)` | Recent-activity feed |
| `audit_logs(actor_user_id)`, `audit_logs(entity_type, entity_id, created_at desc)` | Audit by actor / entity |

Not indexed on purpose: `tasks(task_type)` (low selectivity), standalone `tasks(agent_id)` / `tasks(scheduled_date)` (covered by the composites above).

## Storage (planned, not created)

Private buckets, added with their storage policies in the proof-upload phase: `task-proofs`, `task-documents`, `task-signatures`. Files are accessed only through short-lived signed URLs; `task_proofs.storage_path` holds the object path.

## Testing

`supabase/tests/rls_security_test.sql` runs 405 checks as the real `authenticated` and `anon` roles with per-user JWT claims, inside a transaction that is rolled back. Run it with `psql "$SUPABASE_DB_URL" -f supabase/tests/rls_security_test.sql`. It raises an error if any check fails.
