# Analytics and reports (Phase 11)

Admins get dashboards, reports and exports built from the operational data of Phases 1–10. Every figure is computed in PostgreSQL, and every important number links to the tasks it was counted from.

## Architecture

```text
Operational tables (tasks, task_products, cash_collections, checkins, task_proofs, task_status_history)
        ↓
report_task_facts()         one row per task: outcome flags, timings, delivery, cash, check-in, proof
        ↓
report_*() functions        SQL aggregation (overview, agents, customers, locations, products, cash, check-ins, durations, data quality)
        ↓
src/features/reports/service.ts    server-only analytics service (validates results)
        ↓
src/lib/analytics/definitions.ts   ratios and formatting (one definition per KPI)
        ↓
Pages, charts, tables  ·  /admin/reports/export (CSV / XLSX)
```

- **No second database, no materialized views.** Reports read the live tables through indexed queries; there is no cache, so a refresh shows current data.
- **No analytical SQL in components.** Pages call the service; the service calls the functions.
- **One definition per report.** `src/features/reports/definitions.ts` lists each report's columns once; the on-screen table and the export are both generated from it.
- **Analytics is not realtime.** Charts do not subscribe to changes. Every report has a **Refresh** button. Live operations stay on the monitoring screens.

## Reports

| Route | Content |
|---|---|
| `/admin/analytics` | Overview KPIs, tasks per day by outcome, rates, breakdown by type / status / priority, deliveries, cash, check-ins, exceptions |
| `/admin/reports` | Index of reports and the KPI definitions |
| `/admin/reports/tasks` | One row per task; time between workflow stages |
| `/admin/reports/agents` | Workload, outcomes, on-time and timing per agent (not a ranking) |
| `/admin/reports/deliveries` | Assigned / delivered / outstanding per product; partial deliveries |
| `/admin/reports/cash` | Expected / collected / outstanding, reconciliation, by payment method and day |
| `/admin/reports/checkins` | Accepted and rejected check-ins by day, agent and location |
| `/admin/reports/customers` | Tasks, deliveries and cash per customer → locations → tasks |
| `/admin/reports/locations` | Volume, completion, check-in success and execution time per location |
| `/admin/reports/exceptions` | Overdue, failed, partial, rejected check-ins, cash outstanding, missing proof, awaiting verification, failed messages, data-quality findings |
| `/admin/reports/data-quality` | Inconsistent or incomplete records |
| `/agent` | "My last 30 days": the agent's own tasks, completed, pending, failed and completion rate |

## Period and time zone

- **One rule for every report:** a task belongs to the day it is **scheduled** for. An unscheduled task belongs to the day it was **created**.
- **One time zone:** the business time zone (`siteConfig.timeZone`, currently `Asia/Kolkata`). The server passes it to every reporting function; the browser's and the database server's zones are never used. Date presets are resolved on the server from today's date in that zone.
- **Presets:** Today, Yesterday, Last 7 days, Last 30 days (default), This week, Last week (Monday–Sunday), This month, Last month, Custom range (up to two years).
- **Filters:** agent, customer, location, task type, status, priority. They are URL parameters, so every number, table and export on a page describes the same slice, and links between reports keep them.
- **Trend buckets:** by day up to 92 days, by week up to a year, by month beyond.

## KPI definitions

| KPI | Definition |
|---|---|
| Eligible tasks ("Total tasks") | All tasks in the period except Draft, Cancelled and Rescheduled |
| Completed | Status Completed or Verified |
| Active | Assigned, Accepted, On the way, Arrived, Checked in, In progress |
| **Completion rate** | Completed ÷ Eligible. Open tasks count as not yet completed |
| Partial rate | Partially completed ÷ Eligible |
| **Failure rate** | Failed ÷ Eligible |
| **On-time rate** | Completed on or before the scheduled end ÷ Completed tasks that had a scheduled end time. Tasks without an end time are neither on time nor late |
| Overdue | Open, and now is past the scheduled end (or the start, or the end of the day if no time was set). Unscheduled tasks are never overdue. The task status is not changed |
| **Fulfilment** | Delivered quantity ÷ Assigned quantity, over **closed** delivery tasks (Completed, Verified, Partially completed, Failed). A failed delivery counts as nothing delivered. Open deliveries are shown separately ("still to deliver") |
| **Collection rate** | Collected ÷ Expected, over **closed** cash tasks. Open cash tasks are shown separately ("awaiting collection") |
| Cash outstanding | Expected − Collected on closed cash tasks |
| Cash reconciliation | Each closed cash task is exactly one of: collected in full, partial, nothing collected, more than expected. Over-collection is blocked by the system; if it ever appears it is shown, not capped |
| Check-in success | Accepted check-ins ÷ All check-in attempts |
| Stage durations | From the first time each status was reached. A stage is measured only when both times exist and are in order |
| Execution time | Started → Completed, for completed and partially completed tasks |

**N/A, not zero.** A rate whose denominator is zero is shown as N/A (and exported as an empty cell). A duration with no valid sample is N/A. Averages state the number of tasks measured when it is below five.

**Agent report.** It presents the metrics side by side and does not compute an overall score or ranking: agents differ in workload, task types, locations and schedules. Filter by task type to compare like with like, and open the tasks behind any number.

## Drill-down

KPIs link to the task report with a **segment** — a named condition on the fact columns (for example `completed`, `overdue`, `late`, `cash_outstanding`, `delivery_partial`, `missing_proof`, `rejected_checkin`). The segment uses the same column the KPI counted, so the list always has exactly that many rows. From a task row, the task code opens the task page with its timeline, delivery, cash, check-in and proof.

```text
KPI (Completed: 142) → /admin/reports/tasks?segment=completed&<same period and filters> → task → execution details
Customer → locations of that customer → tasks at a location → task
```

## Exports

`GET /admin/reports/export?report=<key>&format=csv|xlsx&<filters>` — keys: `tasks`, `agents`, `customers`, `locations`, `deliveries`, `delivery-tasks`, `cash`, `checkins`, `data-quality`.

- Generated on the server by the same query as the report, with the same filters, segment and sort.
- The role is read from the session: unauthenticated requests are refused, agents get 403, and the reporting functions refuse non-admins as well.
- Up to 10,000 rows per file (`X-Report-Truncated: true` when the limit is reached).
- CSV is UTF-8 with a byte-order mark. XLSX is written by a small built-in writer (one sheet, bold frozen header, numeric cells) — no third-party library.
- Text that starts with `=`, `+`, `-` or `@` is prefixed with `'` so spreadsheets never run it as a formula.
- Numbers are exported as numbers; percentages as 0–100 with one decimal; N/A as an empty cell. No PDF export.

## Security and privacy

- Every analytics page calls `requireAdmin()`; nothing trusts a role sent by the browser.
- All reporting functions are `SECURITY INVOKER` and `STABLE`: they cannot write, and the caller's RLS applies to every table. The organisation-wide ones also require an admin, so an agent calling them directly gets an error or no rows.
- An agent calling `report_task_facts()` or `my_task_summary()` sees only their own tasks; other agents' tasks, cash, check-ins and proofs do not exist for them.
- **Location history is not used.** No report reads `agent_location_events`: there are no distance, movement or route metrics. Check-in analytics are aggregates (counts, average accuracy, average distance from the site) and never return coordinates.

## Data quality

`/admin/reports/data-quality` lists, for the period:

| Severity | Finding |
|---|---|
| High | Delivered more than assigned; collected more than expected; completed before it started; accepted before it was assigned; checked in after completion; assigned task with no agent |
| Medium | Finished without a completion time; finished without a verified check-in; cash task closed without a collection record; cash task without an expected amount; delivery task without products; required proof missing |
| Low | Execution longer than 12 hours or shorter than 30 seconds |

Nothing is corrected automatically. Inverted timestamps are excluded from averages rather than counted as zero or negative.

## Performance

- Filtering, aggregation, sorting and paging happen in SQL; tables show 25 rows per page.
- The period filter uses `tasks(scheduled_date, status)` and a new partial index `tasks(created_at) where scheduled_date is null`. Per-task lookups use existing indexes on `task_id`.
- `report_task_facts()` is deliberately inlinable (plain `STABLE` SQL, no `SET` clause), so the planner pushes the caller's filters and row limit into it and skips joins a report does not use. On 20,000 synthetic tasks, a month (about 3,000 tasks) took about 16 ms, against about 235 ms when the function was opaque.
- The dashboard makes two round trips for figures (overview, exceptions); exception previews load five rows each.

## Limitations

- Reports are as live as the last page load; use Refresh.
- A rescheduled task is counted on its current scheduled date only.
- Tasks are attributed to their current agent; work before a reassignment is not split.
- Stage durations depend on status history; tasks moved by an administrator without going through the workflow have gaps (shown as N/A).
- "Awaiting verification" lists all completed and partially completed tasks: there is no verification screen yet.
- Exports are capped at 10,000 rows; there is no PDF export.
- No forecasting, route analysis, payroll or attendance metrics.
