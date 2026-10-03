import { z } from "zod";

import { siteConfig } from "@/config/site";
import { TASK_STATUSES, TASK_TYPES } from "@/features/tasks/constants";
import { DEFAULT_PRESET, RANGE_PRESETS, resolveRange, type RangePreset, type ResolvedRange } from "@/lib/analytics/range";

// Every report and export reads the same URL parameters through this module,
// so a KPI, its drill-down table and its export always describe the same slice.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional().catch(undefined);
const presetKeys = RANGE_PRESETS.map((p) => p.key) as [RangePreset, ...RangePreset[]];

/**
 * Named slices of the task report that KPIs link to. Each maps to conditions on
 * columns computed by report_task_facts(), so the drill-down shows exactly the
 * rows the KPI counted.
 */
export const SEGMENTS = {
  eligible: { label: "Eligible tasks", where: { is_eligible: true } },
  active: { label: "Active tasks", where: { is_active: true } },
  completed: { label: "Completed", where: { is_completed: true } },
  partial: { label: "Partially completed", where: { is_partial: true } },
  failed: { label: "Failed", where: { is_failed: true } },
  cancelled: { label: "Cancelled", where: { is_cancelled: true } },
  overdue: { label: "Overdue", where: { is_overdue: true } },
  on_time: { label: "Completed on time", where: { on_time: true } },
  late: { label: "Completed late", where: { on_time: false } },
  needs_verification: { label: "Awaiting verification", where: { needs_verification: true } },
  missing_proof: { label: "Missing required proof", where: { missing_proof: true } },
  rejected_checkin: { label: "Had a rejected check-in", gt: { checkin_rejected: 0 } },
  cash: { label: "Closed cash tasks", in: { cash_outcome: ["FULL", "PARTIAL", "ZERO", "OVER"] } },
  cash_outstanding: { label: "Cash outstanding", in: { cash_outcome: ["PARTIAL", "ZERO"] } },
  cash_partial: { label: "Partial collection", where: { cash_outcome: "PARTIAL" } },
  cash_zero: { label: "Nothing collected", where: { cash_outcome: "ZERO" } },
  cash_full: { label: "Collected in full", where: { cash_outcome: "FULL" } },
  cash_over: { label: "Collected more than expected", where: { cash_outcome: "OVER" } },
  cash_open: { label: "Awaiting collection", where: { cash_outcome: "OPEN" } },
  delivery: { label: "Closed deliveries", in: { delivery_outcome: ["FULL", "PARTIAL", "FAILED"] } },
  delivery_full: { label: "Delivered in full", where: { delivery_outcome: "FULL" } },
  delivery_partial: { label: "Partial deliveries", where: { delivery_outcome: "PARTIAL" } },
  delivery_failed: { label: "Failed deliveries", where: { delivery_outcome: "FAILED" } },
} as const satisfies Record<
  string,
  { label: string; where?: Record<string, boolean | string>; in?: Record<string, readonly string[]>; gt?: Record<string, number> }
>;
export type Segment = keyof typeof SEGMENTS;
const segmentKeys = Object.keys(SEGMENTS) as [Segment, ...Segment[]];

export const reportFiltersSchema = z.object({
  range: z.enum(presetKeys).catch(DEFAULT_PRESET),
  from: z.string().regex(DATE).optional().catch(undefined),
  to: z.string().regex(DATE).optional().catch(undefined),
  agent: z.uuid().optional().catch(undefined),
  type: optionalEnum(TASK_TYPES),
  status: optionalEnum(TASK_STATUSES),
  customer: z.uuid().optional().catch(undefined),
  location: z.uuid().optional().catch(undefined),
  priority: z.coerce.number().int().min(1).max(5).optional().catch(undefined),
  segment: optionalEnum(segmentKeys),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  sort: z.string().max(40).regex(/^[a-z_]+$/).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

type SearchParams = Record<string, string | string[] | undefined>;

/** Validated filters plus the resolved period. Anything invalid falls back to a safe default. */
export function parseReportFilters(searchParams: SearchParams, today: string): { filters: ReportFilters; range: ResolvedRange } {
  const first = (key: string) => {
    const value = searchParams[key];
    const v = Array.isArray(value) ? value[0] : value;
    return v === "" ? undefined : v;
  };
  const filters = reportFiltersSchema.parse(
    Object.fromEntries(Object.keys(reportFiltersSchema.shape).map((key) => [key, first(key)])),
  );
  return { filters, range: resolveRange(filters.range, today, filters.from, filters.to) };
}

/** Arguments shared by every report_* function. The time zone is the configured business zone, never the browser's. */
export function reportArgs(filters: ReportFilters, range: ResolvedRange) {
  return {
    p_from: range.from,
    p_to: range.to,
    p_tz: siteConfig.timeZone,
    p_agent: filters.agent,
    p_type: filters.type,
    p_status: filters.status,
    p_customer: filters.customer,
    p_location: filters.location,
    p_priority: filters.priority,
  };
}

/** The filters as URL parameters (no paging / sorting), for links that keep the current context. */
export function filterQuery(filters: ReportFilters, range: ResolvedRange): Record<string, string | undefined> {
  return {
    range: range.preset,
    from: range.preset === "custom" ? range.from : undefined,
    to: range.preset === "custom" ? range.to : undefined,
    agent: filters.agent,
    type: filters.type,
    status: filters.status,
    customer: filters.customer,
    location: filters.location,
    priority: filters.priority ? String(filters.priority) : undefined,
  };
}

/** A link to a report that keeps the current period and filters, with overrides (e.g. a segment). */
export function reportHref(path: string, query: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...overrides })) if (value) search.set(key, value);
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
