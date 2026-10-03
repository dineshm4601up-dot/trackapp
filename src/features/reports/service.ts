import "server-only";

import { z } from "zod";

import { siteConfig } from "@/config/site";
import {
  AGENT_COLUMNS,
  CUSTOMER_COLUMNS,
  LOCATION_COLUMNS,
  PRODUCT_COLUMNS,
  QUALITY_COLUMNS,
  TASK_COLUMNS,
  type ReportColumn,
} from "@/features/reports/definitions";
import { reportArgs, SEGMENTS, type ReportFilters, type Segment } from "@/features/reports/filters";
import type { ResolvedRange } from "@/lib/analytics/range";
import { createClient } from "@/lib/supabase/server";

// The analytics service. Every figure is computed in PostgreSQL by a report_*
// function called with the signed-in user's session, so RLS applies and the
// organisation-wide functions themselves refuse non-admins. Pages additionally
// call requireAdmin(). Nothing is aggregated in the browser.

export const REPORT_PAGE_SIZE = 25;
/** Exports are capped; the file says so when the cap is reached. */
export const EXPORT_ROW_LIMIT = 10_000;

const num = z.coerce.number();

function fail(context: string, error: { code?: string; message?: string }): never {
  console.error(`Report failed (${context})`, { code: error.code, message: error.message });
  throw new Error("Unable to load this report.");
}

// ---------------------------------------------------------------- overview

const overviewSchema = z.object({
  bucket: z.enum(["day", "week", "month"]),
  totals: z.object({
    total: num, eligible: num, active: num, completed: num, partial: num, failed: num, cancelled: num, rescheduled: num,
    overdue: num, on_time: num, late: num, today: num, active_agents: num,
    checkin_ok: num, checkin_attempts: num, checkin_rejected: num,
    cash_expected: num, cash_collected: num, cash_open: num, cash_tasks_closed: num,
    qty_assigned: num, qty_delivered: num, qty_open: num, delivery_tasks_closed: num,
  }),
  by_status: z.array(z.object({ key: z.string(), n: num })),
  by_type: z.array(
    z.object({
      key: z.string(), total: num, eligible: num, completed: num, partial: num, failed: num, cancelled: num,
      avg_execution_seconds: num.nullable(), execution_samples: num,
    }),
  ),
  by_priority: z.array(z.object({ key: num, total: num, eligible: num, completed: num, failed: num })),
  trend: z.array(
    z.object({ bucket: z.string(), total: num, eligible: num, completed: num, partial: num, failed: num, cancelled: num, active: num, collected: num }),
  ),
});
export type Overview = z.infer<typeof overviewSchema>;

export async function getOverview(filters: ReportFilters, range: ResolvedRange): Promise<Overview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_overview", reportArgs(filters, range));
  if (error) fail("overview", error);
  return overviewSchema.parse(data);
}

// ---------------------------------------------------------------- cash, check-ins, durations

const cashSchema = z.object({
  totals: z.object({
    tasks_closed: num, expected: num, collected: num, outstanding: num, over: num, tasks_open: num, expected_open: num,
    full: num, partial: num, zero: num, over_count: num,
  }),
  by_method: z.array(z.object({ key: z.string(), n: num, amount: num })),
  by_day: z.array(z.object({ day: z.string(), expected: num, collected: num, n: num })),
});
export type CashSummary = z.infer<typeof cashSchema>;

export async function getCashSummary(filters: ReportFilters, range: ResolvedRange): Promise<CashSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_cash", reportArgs(filters, range));
  if (error) fail("cash", error);
  return cashSchema.parse(data);
}

const checkinSchema = z.object({
  totals: z.object({
    attempts: num, ok: num, rejected: num, tasks: num, tasks_with_rejections: num,
    avg_accuracy_m: num.nullable(), avg_distance_m: num.nullable(), avg_rejected_distance_m: num.nullable(),
  }),
  by_day: z.array(z.object({ day: z.string(), ok: num, rejected: num })),
  by_agent: z.array(z.object({ id: z.string().nullable(), name: z.string().nullable(), attempts: num, ok: num, rejected: num, avg_accuracy_m: num.nullable() })),
  by_location: z.array(z.object({ id: z.string().nullable(), name: z.string().nullable(), attempts: num, ok: num, rejected: num, avg_distance_m: num.nullable() })),
});
export type CheckinSummary = z.infer<typeof checkinSchema>;

export async function getCheckinSummary(filters: ReportFilters, range: ResolvedRange): Promise<CheckinSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_checkins", reportArgs(filters, range));
  if (error) fail("check-ins", error);
  return checkinSchema.parse(data);
}

export async function getDurations(filters: ReportFilters, range: ResolvedRange) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_durations", reportArgs(filters, range)).order("stage_order");
  if (error) fail("durations", error);
  return data;
}

// ---------------------------------------------------------------- row reports

type Paging = { page: number; sort?: string; dir: "asc" | "desc"; all?: boolean };

/** Sorting is allowed only on columns the report declares sortable. */
function sortOf<Row>(columns: ReportColumn<Row>[], paging: Paging, fallback: string) {
  const column = columns.find((c) => c.sort && c.sort === paging.sort);
  return { column: column?.sort ?? fallback, ascending: column ? paging.dir === "asc" : false };
}

function windowOf(paging: Paging) {
  if (paging.all) return { from: 0, to: EXPORT_ROW_LIMIT - 1 };
  const from = (paging.page - 1) * REPORT_PAGE_SIZE;
  return { from, to: from + REPORT_PAGE_SIZE - 1 };
}

type Page<Row> = { rows: Row[]; total: number };
function page<Row>(context: string, result: { data: Row[] | null; count: number | null; error: { code?: string; message?: string } | null }): Page<Row> {
  if (result.error) {
    if (result.error.code === "PGRST103") return { rows: [], total: 0 }; // page past the end
    fail(context, result.error);
  }
  return { rows: result.data ?? [], total: result.count ?? 0 };
}

/** The task-level report. `segment` narrows it to exactly the rows a KPI counted. */
export async function listTaskFacts(filters: ReportFilters, range: ResolvedRange, paging: Paging, segment: Segment | undefined = filters.segment) {
  const supabase = await createClient();
  const { column, ascending } = sortOf(TASK_COLUMNS, paging, "task_date");
  const { from, to } = windowOf(paging);
  let query = supabase
    .rpc("report_task_facts", reportArgs(filters, range), { count: "exact" })
    .order(column, { ascending, nullsFirst: false })
    .order("task_code", { ascending: false })
    .range(from, to);
  if (segment) {
    const spec: { where?: Record<string, boolean | string>; in?: Record<string, readonly string[]>; gt?: Record<string, number> } = SEGMENTS[segment];
    for (const [key, value] of Object.entries(spec.where ?? {})) query = query.eq(key, value);
    for (const [key, values] of Object.entries(spec.in ?? {})) query = query.in(key, [...values]);
    for (const [key, value] of Object.entries(spec.gt ?? {})) query = query.gt(key, value);
  }
  return page("tasks", await query);
}

export async function listAgentReport(filters: ReportFilters, range: ResolvedRange, paging: Paging) {
  const supabase = await createClient();
  const { column, ascending } = sortOf(AGENT_COLUMNS, paging, "assigned");
  const { from, to } = windowOf(paging);
  return page(
    "agents",
    await supabase.rpc("report_agents", reportArgs(filters, range), { count: "exact" }).order(column, { ascending, nullsFirst: false }).order("agent_id").range(from, to),
  );
}

export async function listCustomerReport(filters: ReportFilters, range: ResolvedRange, paging: Paging) {
  const supabase = await createClient();
  const { column, ascending } = sortOf(CUSTOMER_COLUMNS, paging, "tasks");
  const { from, to } = windowOf(paging);
  return page(
    "customers",
    await supabase.rpc("report_customers", reportArgs(filters, range), { count: "exact" }).order(column, { ascending, nullsFirst: false }).order("customer_id").range(from, to),
  );
}

export async function listLocationReport(filters: ReportFilters, range: ResolvedRange, paging: Paging) {
  const supabase = await createClient();
  const { column, ascending } = sortOf(LOCATION_COLUMNS, paging, "tasks");
  const { from, to } = windowOf(paging);
  return page(
    "locations",
    await supabase.rpc("report_locations", reportArgs(filters, range), { count: "exact" }).order(column, { ascending, nullsFirst: false }).order("location_id").range(from, to),
  );
}

export async function listProductReport(filters: ReportFilters, range: ResolvedRange, paging: Paging) {
  const supabase = await createClient();
  const { column, ascending } = sortOf(PRODUCT_COLUMNS, paging, "assigned_qty");
  const { from, to } = windowOf(paging);
  return page(
    "products",
    await supabase.rpc("report_products", reportArgs(filters, range), { count: "exact" }).order(column, { ascending, nullsFirst: false }).order("sku").range(from, to),
  );
}

export async function listDataQuality(range: ResolvedRange, paging: Paging) {
  const supabase = await createClient();
  const { column, ascending } = sortOf(QUALITY_COLUMNS, paging, "severity");
  const { from, to } = windowOf(paging);
  return page(
    "data quality",
    await supabase
      .rpc("report_data_quality", { p_from: range.from, p_to: range.to, p_tz: siteConfig.timeZone }, { count: "exact" })
      .order(column, { ascending: paging.sort ? ascending : true })
      .order("task_code")
      .range(from, to),
  );
}

// ---------------------------------------------------------------- exceptions

/** Failed external messages created in the period (Phase 10 delivery history). */
async function countFailedCommunications(range: ResolvedRange, offset: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("communication_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "FAILED")
    .gte("created_at", `${range.from}T00:00:00${offset}`)
    .lte("created_at", `${range.to}T23:59:59.999${offset}`);
  return count ?? 0;
}

const EXCEPTION_SEGMENTS = ["overdue", "failed", "partial", "rejected_checkin", "cash_outstanding", "missing_proof", "needs_verification"] as const;
export type ExceptionSegment = (typeof EXCEPTION_SEGMENTS)[number];

/** Counts and the first few records of each exception, in parallel (one pass per kind, 5 rows each). */
export async function getExceptions(filters: ReportFilters, range: ResolvedRange, utcOffset: string) {
  const preview: Paging = { page: 1, dir: "desc" };
  const [lists, quality, failedCommunications] = await Promise.all([
    Promise.all(
      EXCEPTION_SEGMENTS.map(async (segment) => {
        const supabase = await createClient();
        let query = supabase
          .rpc("report_task_facts", reportArgs(filters, range), { count: "exact" })
          .select("id, task_code, title, agent_name, customer_name, status, task_date, outstanding_amount, checkin_rejected, due_at")
          .order("task_date", { ascending: false })
          .range(0, 4);
        const spec: { where?: Record<string, boolean | string>; in?: Record<string, readonly string[]>; gt?: Record<string, number> } = SEGMENTS[segment];
        for (const [key, value] of Object.entries(spec.where ?? {})) query = query.eq(key, value);
        for (const [key, values] of Object.entries(spec.in ?? {})) query = query.in(key, [...values]);
        for (const [key, value] of Object.entries(spec.gt ?? {})) query = query.gt(key, value);
        const { data, count, error } = await query;
        if (error) fail(`exceptions:${segment}`, error);
        return { segment, total: count ?? 0, rows: data ?? [] };
      }),
    ),
    listDataQuality(range, preview),
    countFailedCommunications(range, utcOffset),
  ]);
  return { lists, dataQuality: quality.total, failedCommunications };
}

// ---------------------------------------------------------------- agent's own numbers

const mySummarySchema = z.object({ eligible: num, active: num, completed: num, partial: num, failed: num, on_time: num, late: num });
export type MySummary = z.infer<typeof mySummarySchema>;

/** The signed-in agent's own figures. RLS shows them only their own tasks; nothing about anyone else is reachable. */
export async function getMySummary(range: ResolvedRange): Promise<MySummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_task_summary", { p_from: range.from, p_to: range.to, p_tz: siteConfig.timeZone });
  if (error) return null;
  return mySummarySchema.parse(data);
}
