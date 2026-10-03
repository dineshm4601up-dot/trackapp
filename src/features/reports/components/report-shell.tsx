import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { siteConfig } from "@/config/site";
import { ReportFilterBar, type FilterKey } from "@/features/reports/components/report-filter-bar";
import { ExportButtons } from "@/features/reports/components/report-parts";
import { filterQuery, parseReportFilters, reportHref, SEGMENTS, type ReportFilters } from "@/features/reports/filters";
import { getFilterSelections } from "@/features/tasks/queries";
import type { ResolvedRange } from "@/lib/analytics/range";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday, formatCalendarDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const REPORT_PAGES = [
  { path: "/admin/analytics", label: "Overview" },
  { path: "/admin/reports/tasks", label: "Tasks" },
  { path: "/admin/reports/agents", label: "Agents" },
  { path: "/admin/reports/deliveries", label: "Deliveries" },
  { path: "/admin/reports/cash", label: "Cash" },
  { path: "/admin/reports/checkins", label: "Check-ins" },
  { path: "/admin/reports/customers", label: "Customers" },
  { path: "/admin/reports/locations", label: "Locations" },
  { path: "/admin/reports/exceptions", label: "Exceptions" },
  { path: "/admin/reports/data-quality", label: "Data quality" },
] as const;

export type ReportContext = { filters: ReportFilters; range: ResolvedRange; query: Record<string, string | undefined> };

/**
 * First thing every report page does: verify an active admin on the server,
 * then validate the URL parameters and resolve the period in the business
 * time zone.
 */
export async function loadReportContext(searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<ReportContext> {
  await requireAdmin();
  const { filters, range } = parseReportFilters(await searchParams, businessToday());
  return { filters, range, query: filterQuery(filters, range) };
}

type ReportShellProps = {
  title: string;
  description: string;
  path: string;
  context: ReportContext;
  /** Export key (see /admin/reports/export) for the page's main table. */
  exportReport?: string;
  hide?: FilterKey[];
  children: React.ReactNode;
};

/** Page frame shared by the analytics dashboard and every report: navigation, period, filters, export. */
export async function ReportShell({ title, description, path, context, exportReport, hide, children }: ReportShellProps) {
  const { filters, range, query } = context;
  const selections = await getFilterSelections({ ...filters, q: "" });
  const segment = filters.segment ? SEGMENTS[filters.segment] : null;

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={exportReport ? <ExportButtons report={exportReport} query={{ ...query, segment: filters.segment, sort: filters.sort, dir: filters.sort ? filters.dir : undefined }} /> : undefined}
      />
      <nav aria-label="Reports" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 text-sm">
        {REPORT_PAGES.map((page) => (
          <Link
            key={page.path}
            href={reportHref(page.path, query)}
            aria-current={page.path === path ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 font-medium whitespace-nowrap",
              page.path === path ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {page.label}
          </Link>
        ))}
      </nav>
      <ReportFilterBar
        preset={range.preset}
        from={range.from}
        to={range.to}
        selectedAgent={selections.agent}
        selectedCustomer={selections.customer}
        selectedLocation={selections.location}
        hide={hide}
      />
      <p className="text-sm text-muted-foreground" role="status">
        <span className="font-medium text-foreground">
          {range.label}: {formatCalendarDate(range.from)}
          {range.from !== range.to && ` – ${formatCalendarDate(range.to)}`}
        </span>{" "}
        ({range.days} day{range.days === 1 ? "" : "s"}, {siteConfig.timeZone} time). Tasks are counted on their scheduled date.
        {segment && (
          <>
            {" "}
            Showing only: <span className="font-medium text-foreground">{segment.label}</span>.{" "}
            <Link href={reportHref(path, query)} className="underline">
              Show all
            </Link>
          </>
        )}
      </p>
      {children}
    </>
  );
}
