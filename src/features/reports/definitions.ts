import { paymentMethodLabel, TASK_STATUS_META, TASK_TYPE_META } from "@/features/tasks/constants";
import { formatCount, formatDuration, formatRate, rate, SMALL_SAMPLE } from "@/lib/analytics/definitions";
import { formatQuantity } from "@/lib/decimal";
import { formatCalendarDate, formatDateTime, formatMoney } from "@/lib/format";
import type { Database } from "@/types/database.types";

// A report is a database function plus a list of columns. The same definition
// renders the on-screen table and the CSV / XLSX export, so they cannot drift.

type Fn = Database["public"]["Functions"];
export type TaskFact = Fn["report_task_facts"]["Returns"][number];
export type AgentRow = Fn["report_agents"]["Returns"][number];
export type CustomerRow = Fn["report_customers"]["Returns"][number];
export type LocationRow = Fn["report_locations"]["Returns"][number];
export type ProductRow = Fn["report_products"]["Returns"][number];
export type QualityRow = Fn["report_data_quality"]["Returns"][number];

export type ReportColumn<Row> = {
  key: string;
  header: string;
  align?: "right";
  /** Sort by this database column (server-side). */
  sort?: string;
  /** Raw value for exports: numbers stay numbers, missing stays empty. */
  value: (row: Row) => string | number | null;
  /** Text shown on screen (defaults to the raw value). */
  display?: (row: Row) => string;
  /** Drill-down link; receives the current filter query. */
  href?: (row: Row, query: Record<string, string | undefined>) => string | null;
  /** Hidden on small screens. */
  wide?: boolean;
};

const n = (value: number | null | undefined) => Number(value ?? 0);
const count = (value: number | null | undefined) => formatCount(n(value));
const qty = (value: number | null | undefined) => (value === null || value === undefined ? "—" : formatQuantity(Number(value).toFixed(3)));
const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : formatMoney(Number(value).toFixed(2)));
const pct = (num: number, den: number) => formatRate(rate(num, den));
/** Exported ratios are numbers (0–100, 1 decimal) or empty for N/A. */
const pctValue = (num: number, den: number) => {
  const r = rate(num, den);
  return r === null ? null : Math.round(r * 1000) / 10;
};
const duration = (seconds: number | null, samples: number | null) =>
  seconds === null ? "N/A" : `${formatDuration(seconds)}${n(samples) < SMALL_SAMPLE ? ` (n=${n(samples)})` : ""}`;
const withQuery = (path: string, query: Record<string, string | undefined>, extra: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...extra })) if (value) search.set(key, value);
  return `${path}?${search}`;
};

export const TASK_COLUMNS: ReportColumn<TaskFact>[] = [
  { key: "task_code", header: "Task", sort: "task_code", value: (r) => r.task_code, href: (r) => `/admin/tasks/${r.id}` },
  { key: "task_date", header: "Date", sort: "task_date", value: (r) => r.task_date, display: (r) => formatCalendarDate(r.task_date) },
  { key: "task_type", header: "Type", sort: "task_type", value: (r) => TASK_TYPE_META[r.task_type].label },
  { key: "status", header: "Status", sort: "status", value: (r) => TASK_STATUS_META[r.status].label },
  { key: "priority", header: "Priority", sort: "priority", align: "right", value: (r) => r.priority, display: (r) => `P${r.priority}`, wide: true },
  { key: "agent_name", header: "Agent", sort: "agent_name", value: (r) => r.agent_name ?? "" },
  { key: "customer_name", header: "Customer", sort: "customer_name", value: (r) => r.customer_name ?? "" },
  { key: "location_name", header: "Location", sort: "location_name", value: (r) => r.location_name ?? "", wide: true },
  {
    key: "on_time",
    header: "On time",
    value: (r) => (r.on_time === null ? null : r.on_time ? "Yes" : "No"),
    display: (r) => (r.on_time === null ? "N/A" : r.on_time ? "Yes" : "Late"),
  },
  { key: "is_overdue", header: "Overdue", value: (r) => (r.is_overdue ? "Yes" : "No"), wide: true },
  {
    key: "execution_seconds",
    header: "Execution (min)",
    sort: "execution_seconds",
    align: "right",
    value: (r) => (r.execution_seconds === null ? null : Math.round(Number(r.execution_seconds) / 6) / 10),
    display: (r) => formatDuration(r.execution_seconds === null ? null : Number(r.execution_seconds)),
    wide: true,
  },
  { key: "assigned_qty", header: "Assigned qty", align: "right", value: (r) => r.assigned_qty, display: (r) => qty(r.assigned_qty), wide: true },
  { key: "delivered_qty", header: "Delivered qty", align: "right", value: (r) => r.delivered_qty, display: (r) => qty(r.delivered_qty), wide: true },
  { key: "expected_amount", header: "Expected", sort: "expected_amount", align: "right", value: (r) => r.expected_amount, display: (r) => money(r.expected_amount), wide: true },
  { key: "collected_amount", header: "Collected", align: "right", value: (r) => r.collected_amount, display: (r) => money(r.collected_amount), wide: true },
  { key: "outstanding_amount", header: "Outstanding", sort: "outstanding_amount", align: "right", value: (r) => r.outstanding_amount, display: (r) => money(r.outstanding_amount), wide: true },
  { key: "payment_method", header: "Method", value: (r) => (r.payment_method ? paymentMethodLabel(r.payment_method) : null), display: (r) => (r.payment_method ? paymentMethodLabel(r.payment_method) : "—"), wide: true },
  { key: "checkin", header: "Check-in", value: (r) => (r.checkin_ok ? "Verified" : r.checkin_rejected ? "Rejected only" : "None"), wide: true },
  { key: "checkin_rejected", header: "Rejected check-ins", align: "right", value: (r) => r.checkin_rejected, wide: true },
  { key: "proof_count", header: "Proofs", align: "right", value: (r) => r.proof_count, wide: true },
  { key: "completed_at", header: "Completed at", sort: "completed_at", value: (r) => r.completed_at, display: (r) => formatDateTime(r.completed_at), wide: true },
];

/** Narrower column sets for the focused reports (same rows, same export shape). */
const pick = (keys: string[]) => keys.map((key) => TASK_COLUMNS.find((c) => c.key === key)!).map((c) => ({ ...c, wide: false }));
export const CASH_TASK_COLUMNS = pick(["task_code", "task_date", "agent_name", "customer_name", "status", "expected_amount", "collected_amount", "outstanding_amount", "payment_method"]);
export const DELIVERY_TASK_COLUMNS = pick(["task_code", "task_date", "agent_name", "customer_name", "location_name", "status", "assigned_qty", "delivered_qty"]);
export const CHECKIN_TASK_COLUMNS = pick(["task_code", "task_date", "agent_name", "location_name", "status", "checkin", "checkin_rejected"]);

export const AGENT_COLUMNS: ReportColumn<AgentRow>[] = [
  { key: "agent_name", header: "Agent", sort: "agent_name", value: (r) => r.agent_name ?? r.employee_code ?? "", href: (r, q) => withQuery("/admin/reports/tasks", q, { agent: r.agent_id }) },
  { key: "assigned", header: "Assigned", sort: "assigned", align: "right", value: (r) => n(r.assigned), display: (r) => count(r.assigned), href: (r, q) => withQuery("/admin/reports/tasks", q, { agent: r.agent_id, segment: "eligible" }) },
  { key: "accepted", header: "Accepted", sort: "accepted", align: "right", value: (r) => n(r.accepted), wide: true },
  { key: "started", header: "Started", sort: "started", align: "right", value: (r) => n(r.started), wide: true },
  { key: "active", header: "Open", sort: "active", align: "right", value: (r) => n(r.active) },
  { key: "completed", header: "Completed", sort: "completed", align: "right", value: (r) => n(r.completed), href: (r, q) => withQuery("/admin/reports/tasks", q, { agent: r.agent_id, segment: "completed" }) },
  { key: "partial", header: "Partial", sort: "partial", align: "right", value: (r) => n(r.partial) },
  { key: "failed", header: "Failed", sort: "failed", align: "right", value: (r) => n(r.failed), href: (r, q) => withQuery("/admin/reports/tasks", q, { agent: r.agent_id, segment: "failed" }) },
  { key: "cancelled", header: "Cancelled", sort: "cancelled", align: "right", value: (r) => n(r.cancelled), wide: true },
  { key: "completion_rate", header: "Completion %", align: "right", value: (r) => pctValue(n(r.completed), n(r.assigned)), display: (r) => pct(n(r.completed), n(r.assigned)) },
  { key: "on_time_rate", header: "On-time %", align: "right", value: (r) => pctValue(n(r.on_time), n(r.on_time) + n(r.late)), display: (r) => `${pct(n(r.on_time), n(r.on_time) + n(r.late))}${n(r.on_time) + n(r.late) ? ` (${n(r.on_time)}/${n(r.on_time) + n(r.late)})` : ""}` },
  { key: "overdue", header: "Overdue", sort: "overdue", align: "right", value: (r) => n(r.overdue), wide: true },
  { key: "avg_accept_seconds", header: "Avg time to accept", sort: "avg_accept_seconds", align: "right", value: (r) => r.avg_accept_seconds, display: (r) => duration(r.avg_accept_seconds, r.accept_samples), wide: true },
  { key: "avg_checkin_seconds", header: "Avg arrival → check-in", align: "right", value: (r) => r.avg_checkin_seconds, display: (r) => duration(r.avg_checkin_seconds, r.checkin_samples), wide: true },
  { key: "avg_start_seconds", header: "Avg check-in → start", align: "right", value: (r) => r.avg_start_seconds, display: (r) => duration(r.avg_start_seconds, r.start_samples), wide: true },
  { key: "avg_execution_seconds", header: "Avg execution", sort: "avg_execution_seconds", align: "right", value: (r) => r.avg_execution_seconds, display: (r) => duration(r.avg_execution_seconds, r.execution_samples) },
  { key: "execution_samples", header: "Execution samples", align: "right", value: (r) => n(r.execution_samples), wide: true },
  { key: "checkins_ok", header: "Check-ins OK", align: "right", value: (r) => n(r.checkins_ok), wide: true },
  { key: "checkins_rejected", header: "Check-ins rejected", sort: "checkins_rejected", align: "right", value: (r) => n(r.checkins_rejected), wide: true },
  { key: "qty_delivered", header: "Qty delivered", align: "right", value: (r) => r.qty_delivered, display: (r) => `${qty(r.qty_delivered)} / ${qty(r.qty_assigned)}`, wide: true },
  { key: "cash_collected", header: "Cash collected", sort: "cash_collected", align: "right", value: (r) => r.cash_collected, display: (r) => money(r.cash_collected), wide: true },
  { key: "cash_outstanding", header: "Cash outstanding", align: "right", value: (r) => n(r.cash_expected) - n(r.cash_collected), display: (r) => money(n(r.cash_expected) - n(r.cash_collected)), wide: true },
];

export const CUSTOMER_COLUMNS: ReportColumn<CustomerRow>[] = [
  { key: "customer_name", header: "Customer", sort: "customer_name", value: (r) => r.customer_name ?? "", href: (r, q) => withQuery("/admin/reports/locations", q, { customer: r.customer_id }) },
  { key: "locations", header: "Locations", align: "right", value: (r) => n(r.locations) },
  { key: "tasks", header: "Tasks", sort: "tasks", align: "right", value: (r) => n(r.tasks), href: (r, q) => withQuery("/admin/reports/tasks", q, { customer: r.customer_id, segment: "eligible" }) },
  { key: "active", header: "Open", sort: "active", align: "right", value: (r) => n(r.active), wide: true },
  { key: "completed", header: "Completed", sort: "completed", align: "right", value: (r) => n(r.completed) },
  { key: "partial", header: "Partial", sort: "partial", align: "right", value: (r) => n(r.partial) },
  { key: "failed", header: "Failed", sort: "failed", align: "right", value: (r) => n(r.failed) },
  { key: "completion_rate", header: "Completion %", align: "right", value: (r) => pctValue(n(r.completed), n(r.tasks)), display: (r) => pct(n(r.completed), n(r.tasks)) },
  { key: "qty_assigned", header: "Qty assigned", align: "right", value: (r) => r.qty_assigned, display: (r) => qty(r.qty_assigned), wide: true },
  { key: "qty_delivered", header: "Qty delivered", align: "right", value: (r) => r.qty_delivered, display: (r) => qty(r.qty_delivered), wide: true },
  { key: "cash_expected", header: "Cash expected", sort: "cash_expected", align: "right", value: (r) => r.cash_expected, display: (r) => money(r.cash_expected), wide: true },
  { key: "cash_collected", header: "Cash collected", align: "right", value: (r) => r.cash_collected, display: (r) => money(r.cash_collected), wide: true },
  { key: "cash_outstanding", header: "Cash outstanding", align: "right", value: (r) => n(r.cash_expected) - n(r.cash_collected), display: (r) => money(n(r.cash_expected) - n(r.cash_collected)) },
];

export const LOCATION_COLUMNS: ReportColumn<LocationRow>[] = [
  { key: "location_name", header: "Location", sort: "location_name", value: (r) => r.location_name ?? "", href: (r, q) => withQuery("/admin/reports/tasks", q, { location: r.location_id }) },
  { key: "location_city", header: "City", sort: "location_city", value: (r) => r.location_city ?? "", wide: true },
  { key: "customer_name", header: "Customer", sort: "customer_name", value: (r) => r.customer_name ?? "" },
  { key: "tasks", header: "Tasks", sort: "tasks", align: "right", value: (r) => n(r.tasks) },
  { key: "completed", header: "Completed", sort: "completed", align: "right", value: (r) => n(r.completed) },
  { key: "completion_rate", header: "Completion %", align: "right", value: (r) => pctValue(n(r.completed), n(r.tasks)), display: (r) => pct(n(r.completed), n(r.tasks)) },
  { key: "failure_rate", header: "Failure %", align: "right", value: (r) => pctValue(n(r.failed), n(r.tasks)), display: (r) => pct(n(r.failed), n(r.tasks)) },
  { key: "partial_delivery_rate", header: "Partial delivery %", align: "right", value: (r) => pctValue(n(r.deliveries_partial), n(r.deliveries_closed)), display: (r) => pct(n(r.deliveries_partial), n(r.deliveries_closed)), wide: true },
  { key: "checkin_success", header: "Check-in success %", align: "right", value: (r) => pctValue(n(r.checkin_attempts) - n(r.checkins_rejected), n(r.checkin_attempts)), display: (r) => pct(n(r.checkin_attempts) - n(r.checkins_rejected), n(r.checkin_attempts)) },
  { key: "checkins_rejected", header: "Rejected check-ins", sort: "checkins_rejected", align: "right", value: (r) => n(r.checkins_rejected), wide: true },
  { key: "avg_execution_seconds", header: "Avg execution", sort: "avg_execution_seconds", align: "right", value: (r) => r.avg_execution_seconds, display: (r) => duration(r.avg_execution_seconds, r.execution_samples), wide: true },
];

export const PRODUCT_COLUMNS: ReportColumn<ProductRow>[] = [
  { key: "sku", header: "SKU", sort: "sku", value: (r) => r.sku },
  { key: "product_name", header: "Product", sort: "product_name", value: (r) => r.product_name },
  { key: "unit", header: "Unit", value: (r) => r.unit, wide: true },
  { key: "tasks", header: "Tasks", sort: "tasks", align: "right", value: (r) => n(r.tasks) },
  { key: "assigned_qty", header: "Assigned", sort: "assigned_qty", align: "right", value: (r) => r.assigned_qty, display: (r) => qty(r.assigned_qty) },
  { key: "delivered_qty", header: "Delivered", sort: "delivered_qty", align: "right", value: (r) => r.delivered_qty, display: (r) => qty(r.delivered_qty) },
  { key: "outstanding_qty", header: "Outstanding", sort: "outstanding_qty", align: "right", value: (r) => r.outstanding_qty, display: (r) => qty(r.outstanding_qty) },
  { key: "fulfilment", header: "Fulfilment %", align: "right", value: (r) => pctValue(n(r.delivered_qty), n(r.assigned_qty)), display: (r) => pct(n(r.delivered_qty), n(r.assigned_qty)) },
  { key: "partial_lines", header: "Short lines", align: "right", value: (r) => n(r.partial_lines), wide: true },
];

export const QUALITY_COLUMNS: ReportColumn<QualityRow>[] = [
  { key: "severity", header: "Severity", sort: "severity", value: (r) => r.severity },
  { key: "issue", header: "Issue", sort: "issue", value: (r) => r.issue },
  { key: "task_code", header: "Task", sort: "task_code", value: (r) => r.task_code, href: (r) => `/admin/tasks/${r.task_id}` },
  { key: "detail", header: "Detail", value: (r) => r.detail },
];
