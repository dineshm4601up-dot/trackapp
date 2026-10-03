import {
  AGENT_COLUMNS,
  CASH_TASK_COLUMNS,
  CHECKIN_TASK_COLUMNS,
  CUSTOMER_COLUMNS,
  DELIVERY_TASK_COLUMNS,
  LOCATION_COLUMNS,
  PRODUCT_COLUMNS,
  QUALITY_COLUMNS,
  TASK_COLUMNS,
  type ReportColumn,
} from "@/features/reports/definitions";
import { parseReportFilters, type ReportFilters } from "@/features/reports/filters";
import {
  EXPORT_ROW_LIMIT,
  listAgentReport,
  listCustomerReport,
  listDataQuality,
  listLocationReport,
  listProductReport,
  listTaskFacts,
} from "@/features/reports/service";
import type { ResolvedRange } from "@/lib/analytics/range";
import { getCurrentProfile } from "@/lib/auth/session";
import { toCsv, type Cell } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";
import { businessToday } from "@/lib/format";

export const dynamic = "force-dynamic";

type Exportable = { name: string; headers: string[]; rows: Cell[][] };

function table<Row>(name: string, columns: ReportColumn<Row>[], rows: Row[]): Exportable {
  return { name, headers: columns.map((c) => c.header), rows: rows.map((row) => columns.map((c) => c.value(row))) };
}

const all = (filters: ReportFilters) => ({ page: 1, sort: filters.sort, dir: filters.dir, all: true });

/** Each export runs the same server-side query as its report, with the same filters. */
const REPORTS: Record<string, (filters: ReportFilters, range: ResolvedRange) => Promise<Exportable>> = {
  tasks: async (f, r) => table("Tasks", TASK_COLUMNS, (await listTaskFacts(f, r, all(f))).rows),
  agents: async (f, r) => table("Agents", AGENT_COLUMNS, (await listAgentReport(f, r, all(f))).rows),
  customers: async (f, r) => table("Customers", CUSTOMER_COLUMNS, (await listCustomerReport(f, r, all(f))).rows),
  locations: async (f, r) => table("Locations", LOCATION_COLUMNS, (await listLocationReport(f, r, all(f))).rows),
  deliveries: async (f, r) => table("Deliveries by product", PRODUCT_COLUMNS, (await listProductReport(f, r, all(f))).rows),
  "delivery-tasks": async (f, r) => table("Delivery tasks", DELIVERY_TASK_COLUMNS, (await listTaskFacts(f, r, all(f), f.segment ?? "delivery")).rows),
  cash: async (f, r) => table("Cash collections", CASH_TASK_COLUMNS, (await listTaskFacts(f, r, all(f), f.segment ?? "cash")).rows),
  checkins: async (f, r) => table("Check-ins by task", CHECKIN_TASK_COLUMNS, (await listTaskFacts(f, r, all(f))).rows),
  "data-quality": async (f, r) => table("Data quality", QUALITY_COLUMNS, (await listDataQuality(r, all(f))).rows),
};

/**
 * GET /admin/reports/export?report=tasks&format=csv|xlsx&<filters>
 * The role is resolved from the session on the server; query parameters can
 * only narrow the data, and the reporting functions refuse non-admins anyway.
 */
export async function GET(request: Request) {
  const state = await getCurrentProfile();
  if (state.status !== "ok") return new Response("Unauthorized", { status: 401 });
  if (state.profile.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const build = REPORTS[url.searchParams.get("report") ?? ""];
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  if (!build) return new Response("Unknown report", { status: 400 });

  const { filters, range } = parseReportFilters(Object.fromEntries(url.searchParams), businessToday());
  let data: Exportable;
  try {
    data = await build(filters, range);
  } catch {
    return new Response("The report could not be generated.", { status: 500 });
  }

  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const filename = `${slug}_${range.from}_to_${range.to}.${format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Report-Rows": String(data.rows.length),
    "X-Report-Truncated": String(data.rows.length >= EXPORT_ROW_LIMIT),
  };
  if (format === "xlsx") {
    return new Response(new Uint8Array(toXlsx(data.name, data.headers, data.rows)), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
  }
  return new Response(toCsv(data.headers, data.rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
