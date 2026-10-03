import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, Kpi, KpiGrid, ReportTable, Section } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { StackedColumns } from "@/features/reports/components/stacked-columns";
import { CHECKIN_TASK_COLUMNS } from "@/features/reports/definitions";
import { reportHref } from "@/features/reports/filters";
import { getCheckinSummary, listTaskFacts } from "@/features/reports/service";
import { formatCount, formatRate, KPI_DEFINITIONS, rate } from "@/lib/analytics/definitions";
import { formatShortCalendarDate } from "@/lib/format";

export const metadata: Metadata = { title: "Check-in report" };

const PATH = "/admin/reports/checkins";
const TASKS = "/admin/reports/tasks";

const SERIES = [
  { key: "ok", label: "Accepted", color: "var(--viz-completed)" },
  { key: "rejected", label: "Rejected (outside the allowed area)", color: "var(--viz-failed)" },
];

const metres = (value: number | null) => (value === null ? "N/A" : value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`);

export default async function CheckinReportPage(props: PageProps<"/admin/reports/checkins">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range, query } = context;
  const [summary, rejected] = await Promise.all([getCheckinSummary(filters, range), listTaskFacts(filters, range, filters, "rejected_checkin")]);
  const t = summary.totals;

  return (
    <ReportShell
      title="Check-in report"
      description={`${KPI_DEFINITIONS.checkinSuccess} Distances and accuracy are averages; no coordinates are shown.`}
      path={PATH}
      context={context}
      exportReport="checkins"
    >
      <KpiGrid>
        <Kpi label="Check-in attempts" value={formatCount(t.attempts)} hint={`on ${formatCount(t.tasks)} tasks`} />
        <Kpi label="Accepted" value={formatCount(t.ok)} hint={`Success rate ${formatRate(rate(t.ok, t.attempts))}`} />
        <Kpi label="Rejected" value={formatCount(t.rejected)} hint={`${formatCount(t.tasks_with_rejections)} tasks had a rejected attempt`} href={reportHref(TASKS, query, { segment: "rejected_checkin" })} />
        <Kpi label="Average GPS accuracy" value={t.avg_accuracy_m === null ? "N/A" : `±${Math.round(t.avg_accuracy_m)} m`} hint="Accepted check-ins" />
        <Kpi label="Average distance from site" value={metres(t.avg_distance_m)} hint="Accepted check-ins" />
        <Kpi label="Average rejected distance" value={metres(t.avg_rejected_distance_m)} hint="How far away rejected attempts were" />
      </KpiGrid>

      <Section id="by-day" title="By day" description="Check-in attempts by the day they were made.">
        <Card>
          <CardContent>
            {summary.by_day.length === 0 ? (
              <p className="text-sm text-muted-foreground">No check-in attempts in this period.</p>
            ) : (
              <StackedColumns
                label="Check-in attempts per day"
                series={SERIES}
                data={summary.by_day.map((d) => ({ label: d.day.slice(5).replace("-", "/"), title: formatShortCalendarDate(d.day), values: { ok: d.ok, rejected: d.rejected } }))}
              />
            )}
          </CardContent>
        </Card>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By agent</CardTitle>
            <CardDescription>Attempts, with how many were rejected.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Check-in attempts by agent"
              rows={summary.by_agent.map((row) => ({
                key: row.id ?? "none",
                label: row.name ?? "Unassigned",
                value: row.attempts,
                display: formatCount(row.attempts),
                note: `${row.rejected} rejected · ${formatRate(rate(row.ok, row.attempts))} accepted`,
                href: row.id ? reportHref(PATH, query, { agent: row.id }) : undefined,
              }))}
              empty="No check-in attempts in this period."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By location</CardTitle>
            <CardDescription>Locations with the most rejected attempts first. Many rejections at one site can mean its pin or radius needs checking.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Check-in attempts by location"
              rows={summary.by_location.slice(0, 12).map((row) => ({
                key: row.id ?? "none",
                label: row.name ?? "Unknown location",
                value: row.attempts,
                display: formatCount(row.attempts),
                note: `${row.rejected} rejected`,
                href: row.id ? reportHref(PATH, query, { location: row.id }) : undefined,
              }))}
              empty="No check-in attempts in this period."
            />
          </CardContent>
        </Card>
      </div>

      <Section id="rejected" title="Tasks with rejected check-ins" description="Open a task to see each attempt.">
        <ReportTable
          caption="Tasks with rejected check-ins"
          columns={CHECKIN_TASK_COLUMNS}
          rows={rejected.rows}
          total={rejected.total}
          rowKey={(row) => row.id}
          basePath={PATH}
          query={query}
          page={filters.page}
          sort={filters.sort}
          dir={filters.dir}
          emptyTitle="No rejected check-ins in this period."
        />
      </Section>
    </ReportShell>
  );
}
