# Task creation & assignment (Phase 5)

Admins create, assign, edit, reschedule and cancel tasks. The agent side of the workflow is documented in [agent-workflow.md](agent-workflow.md).

## Routes

| Route | Purpose |
|---|---|
| `/admin/tasks` | List with search and filters (status, type, agent, customer, scheduled date, priority), 20 per page |
| `/admin/tasks/new` | Create (save as draft, or create & assign) |
| `/admin/tasks/[id]` | Details: summary, assignment, schedule, customer & location, products with totals, status history; Edit / Cancel actions |
| `/admin/tasks/[id]/edit` | Edit while `DRAFT` or `ASSIGNED`; otherwise a "can no longer be edited" notice |
| `/agent/...` | Agent workflow, see [agent-workflow.md](agent-workflow.md) |

All are `ADMIN`-only except `/agent`. Every page and Server Action calls `requireAdmin()` / `requireAgent()`.

## Lifecycle implemented now

```text
(create) ──► DRAFT ──► ASSIGNED ──► … agent workflow (next phase)
   └──────────────────────► ASSIGNED
DRAFT / ASSIGNED / ACCEPTED / ON_THE_WAY / ARRIVED ──► CANCELLED   (admin, reason required)
```

| Status | Admin can |
|---|---|
| `DRAFT` | edit everything; save as draft; assign (agent required) |
| `ASSIGNED` | edit setup fields, reassign, reschedule, change product lines; cannot go back to draft |
| `ACCEPTED`, `ON_THE_WAY`, `ARRIVED` | cancel only |
| later statuses | view only (setup locked to preserve execution history) |

There is no task deletion; tasks are cancelled and stay in history. All 13 database statuses are displayed with consistent labels and badges; transitions beyond the above belong to later phases.

## Task types

Defined once in `src/features/tasks/constants.ts` (`TASK_TYPE_META`); the enum comes from the database.

| Type | Products |
|---|---|
| Deliver Products | required (at least one line to assign) |
| Pickup, Replacement, Other | optional |
| Collect Cash, Verification, Inspection, Document Collection, Survey | not used |

Adding a type = add the enum value in a migration + one entry in `TASK_TYPE_META`.

## Creation flow

Task type → title, priority (1 Highest … 5 Lowest, default 3), instructions → customer (searchable, active only) → location (only the chosen customer's active locations) → agent (searchable, active agent with an enabled account; shows name, code, phone) → schedule (date, optional start/end time) → products (if applicable) → **Review** summary → *Save as draft* or *Create & assign*. On success the task page shows "Task created successfully." with the code, agent, date and status, plus *Create another task* / *Back to tasks*.

`task_code` (`TASK-YYYYMMDD-000001`, UTC date + database sequence), `created_by`, `assigned_at`, `status` and status history are always set by the database — never taken from the browser. Sequence numbers can have gaps (e.g. after failed saves); codes are always unique.

## Product lines

- Searchable selector over active products (SKU, name, unit, price). Choosing a product that is already on the task focuses its existing line instead of duplicating it.
- Quantity `> 0`, up to 3 decimals (`numeric(14,3)`). Unit price defaults to the product's current price and may be adjusted per task (`≥ 0`, 2 decimals). The price is stored on `task_products.unit_price`, so later product price changes never alter existing tasks.
- Line amounts and the total are computed with exact decimal arithmetic (`src/lib/decimal.ts`, scaled BigInt) for display only; nothing derived is stored.
- While a task is `DRAFT`/`ASSIGNED`, saving applies the planned lines as a set: changed lines are updated, new ones added, removed ones deleted. No execution data exists at that point.

## Schedule & time zone

`scheduled_date` (DATE) and `scheduled_*_time` (TIME) are business-local wall-clock values, stored and displayed exactly as entered — never converted. Instants (`created_at`, `assigned_at`, history) are `timestamptz` and displayed in the business time zone (`siteConfig.timeZone`, Asia/Kolkata). The default date for a new task is "today" in that time zone. Start must be before end; a time window needs a date.

## Validation & atomicity

Zod validates the submission shape server-side (`src/features/tasks/schemas.ts`). All business rules are enforced in the database function **`admin_save_task(p_task, p_products, p_assign, p_task_id?)`**, which runs as the calling admin (`SECURITY INVOKER`, so RLS applies) and does everything in **one transaction** — a rejected save leaves no partial task, lines, history or audit rows:

- caller is an active admin;
- task exists and is `DRAFT`/`ASSIGNED` (edit);
- customer exists and is active; location exists, is active and **belongs to the customer**;
- agent exists, has an active agent record and account (required to assign);
- products exist, are active (an already-linked product may stay), no duplicates, quantity > 0, price ≥ 0;
- delivery tasks need at least one product to be assigned;
- Collect Cash tasks need an **expected amount** (> 0, 2 dp) to be assigned; other types store none (Phase 8, see [task-execution.md](task-execution.md));
- priority 1–5 and time window (table constraints).

A newly linked record must be active; links that are unchanged on an existing task are kept even if the master record was deactivated later, so historical tasks never break.

`admin_cancel_task(p_task_id, p_reason)` cancels before execution with a required reason (stored on the task and in the history).

Errors come back as stable codes (e.g. `LOCATION_CUSTOMER_MISMATCH`, `AGENT_INACTIVE`) and are mapped to friendly messages next to the relevant field. Network failures keep the form and its input.

## Security

- Server Actions authenticate and require an active ADMIN; the database functions check again (`is_admin()`), and RLS applies to every read and write.
- Agents can only read their own non-draft tasks (`tasks`, `task_directory` view). They cannot create, edit, reassign or cancel tasks — directly or by replaying an admin's request.
- The browser never supplies trusted values (actor, code, timestamps, status).

## Status history & audit

Status history rows are written by trigger on create and on every status change, with `changed_by = auth.uid()` and the optional reason. Audit actions:

| Action | When |
|---|---|
| `CREATE_TASK` | task created (draft or assigned) |
| `ASSIGN_TASK` | `DRAFT → ASSIGNED` |
| `REASSIGN_TASK` | agent changed |
| `RESCHEDULE_TASK` | only date/time changed |
| `UPDATE_TASK` | other edits |
| `CANCEL_TASK` | cancelled |
| `ADD_TASK_PRODUCT` / `UPDATE_TASK_PRODUCT` / `REMOVE_TASK_PRODUCT` | product line changes |

Each records the actor, entity id, and the changed columns (old → new).
