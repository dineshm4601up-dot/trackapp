import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, CalendarClock, CircleAlert, CircleCheck, ClipboardList, MapPinCheck, Package, Play, Timer, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, Kpi, KpiGrid, Meter, Section } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { StackedColumns } from "@/features/reports/components/stacked-columns";
import { reportHref } from "@/features/reports/filters";
import { getExceptions, getOverview } from "@/features/reports/service";
import { priorityLabel, TASK_STATUS_META, TASK_TYPE_META, type TaskStatus, type TaskType } from "@/features/tasks/constants";
import { formatCount, formatDuration, formatRate, KPI_DEFINITIONS, rate, SMALL_SAMPLE } from "@/lib/analytics/definitions";
import { formatQuantity } from "@/lib/decimal";
import { businessUtcOffset, formatMoney, formatShortCalendarDate } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics" };

const PATH = "/admin/analytics";
const TASKS = "/admin/reports/tasks";

const SERIES = [
  { key: "completed", label: "Completed", color: "var(--viz-completed)" },
  { key: "partial", label: "Partially completed", color: "var(--viz-partial)" },
  { key: "active", label: "Open", color: "var(--viz-open)" },
  { key: "failed", label: "Failed", color: "var(--viz-failed)" },
];

export default async function AnalyticsPage(props: PageProps<"/admin/analytics">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range, query } = context;
  const [overview, exceptions] = await Promise.all([getOverview(filters, range), getExceptions(filters, range, businessUtcOffset())]);
  const t = overview.totals;
  const to = (segment: string) => reportHref(TASKS, query, { segment });
  const money = (value: number) => formatMoney(value.toFixed(2));
  const qty = (value: number) => formatQuantity(value.toFixed(3));
  const scheduledCompleted = t.on_time + t.late;
  const bucketTitle = (bucket: string) =>
    overview.bucket === "day" ? formatShortCalendarDate(bucket) : `${overview.bucket === "week" ? "Week of" : "Month of"} ${formatShortCalendarDate(bucket)}`;
  const exceptionCount = (segment: string) => exceptions.lists.find((l) => l.segment === segment)?.total ?? 0;

  return (
    <ReportShell
      title="Analytics"
      description="How field work went in the selected period. Every number opens the records behind it."
      path={PATH}
      context={context}
    >
      <Section id="overview" title="Overview" description={KPI_DEFINITIONS.eligible}>
        <KpiGrid>
          <Kpi label="Total tasks" value={formatCount(t.eligible)} hint={`${formatCount(t.cancelled)} cancelled and ${formatCount(t.rescheduled)} rescheduled are not counted`} href={to("eligible")} icon={ClipboardList} />
          <Kpi label="Completed" value={formatCount(t.completed)} hint={`Completion rate ${formatRate(rate(t.completed, t.eligible))}`} href={to("completed")} icon={CircleCheck} />
          <Kpi label="Active" value={formatCount(t.active)} hint={`${formatCount(t.active_agents)} agent${t.active_agents === 1 ? "" : "s"} with open tasks`} href={to("active")} icon={Play} />
          <Kpi label="Overdue" value={formatCount(t.overdue)} hint="Open past the scheduled time" href={to("overdue")} icon={CalendarClock} />
          <Kpi label="Partially completed" value={formatCount(t.partial)} hint={`Partial rate ${formatRate(rate(t.partial, t.eligible))}`} href={to("partial")} />
          <Kpi label="Failed" value={formatCount(t.failed)} hint={`Failure rate ${formatRate(rate(t.failed, t.eligible))}`} href={to("failed")} icon={CircleAlert} />
          <Kpi label="Cancelled" value={formatCount(t.cancelled)} href={to("cancelled")} />
          <Kpi
            label="On-time completion"
            value={formatRate(rate(t.on_time, scheduledCompleted))}
            hint={scheduledCompleted ? `${t.on_time} of ${scheduledCompleted} completed tasks with a scheduled end` : "No completed task had a scheduled end time"}
            href={to("late")}
            icon={Timer}
          />
        </KpiGrid>
      </Section>

      <Section id="trend" title="Task performance" description={`Tasks per ${overview.bucket} by outcome. Cancelled tasks are left out of the chart.`}>
        <Card>
          <CardContent>
            {t.total === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks in this period.</p>
            ) : (
              <StackedColumns
                label={`Tasks per ${overview.bucket} by outcome`}
                series={SERIES}
                data={overview.trend.map((b) => ({
                  label: overview.bucket === "month" ? b.bucket.slice(0, 7) : b.bucket.slice(5).replace("-", "/"),
                  title: bucketTitle(b.bucket),
                  values: { completed: b.completed, partial: b.partial, active: b.active, failed: b.failed },
                }))}
              />
            )}
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Rates</CardTitle>
              <CardDescription>Share of eligible tasks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Meter label="Completion rate" value={rate(t.completed, t.eligible)} display={formatRate(rate(t.completed, t.eligible))} detail={`${t.completed} completed of ${t.eligible} eligible`} />
              <Meter label="On-time rate" value={rate(t.on_time, scheduledCompleted)} display={formatRate(rate(t.on_time, scheduledCompleted))} detail={`${t.on_time} on time of ${scheduledCompleted} with a scheduled end`} />
              <Meter label="Failure rate" value={rate(t.failed, t.eligible)} display={formatRate(rate(t.failed, t.eligible))} detail={`${t.failed} failed of ${t.eligible} eligible`} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By task type</CardTitle>
              <CardDescription>Tasks, completion rate and average execution time.</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList
                label="Tasks by type"
                rows={overview.by_type.map((row) => ({
                  key: row.key,
                  label: row.key in TASK_TYPE_META ? TASK_TYPE_META[row.key as TaskType].label : row.key,
                  value: row.total,
                  display: formatCount(row.total),
                  note: `${formatRate(rate(row.completed, row.eligible))} done · ${
                    row.avg_execution_seconds === null ? "N/A" : formatDuration(row.avg_execution_seconds)
                  }${row.execution_samples > 0 && row.execution_samples < SMALL_SAMPLE ? ` (n=${row.execution_samples})` : ""}`,
                  href: reportHref(TASKS, query, { type: row.key }),
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>By status</CardTitle>
              <CardDescription>Where the period&apos;s tasks stand now.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <BarList
                label="Tasks by status"
                rows={overview.by_status.map((row) => ({
                  key: row.key,
                  label: row.key in TASK_STATUS_META ? TASK_STATUS_META[row.key as TaskStatus].label : row.key,
                  value: row.n,
                  display: formatCount(row.n),
                  href: reportHref(TASKS, query, { status: row.key }),
                }))}
              />
              <p className="text-sm font-medium">By priority</p>
              <BarList
                label="Tasks by priority"
                rows={overview.by_priority.map((row) => ({
                  key: String(row.key),
                  label: priorityLabel(row.key),
                  value: row.total,
                  display: formatCount(row.total),
                  note: `${formatRate(rate(row.completed, row.eligible))} done`,
                  href: reportHref(TASKS, query, { priority: String(row.key) }),
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="operations" title="Deliveries, cash and check-ins" description="Closed tasks only; work still open is shown separately.">
        <KpiGrid>
          <Kpi
            label="Products delivered"
            value={`${qty(t.qty_delivered)} / ${qty(t.qty_assigned)}`}
            hint={`Fulfilment ${formatRate(rate(t.qty_delivered, t.qty_assigned))} over ${t.delivery_tasks_closed} closed deliveries · ${qty(t.qty_open)} still to deliver`}
            href={reportHref("/admin/reports/deliveries", query)}
            icon={Package}
          />
          <Kpi
            label="Cash collected"
            value={money(t.cash_collected)}
            hint={`of ${money(t.cash_expected)} expected · collection rate ${formatRate(rate(t.cash_collected, t.cash_expected))}`}
            href={reportHref("/admin/reports/cash", query)}
            icon={Banknote}
          />
          <Kpi
            label="Cash outstanding"
            value={money(Math.max(0, t.cash_expected - t.cash_collected))}
            hint={`${money(t.cash_open)} more is awaiting collection on open tasks`}
            href={reportHref(TASKS, query, { segment: "cash_outstanding" })}
          />
          <Kpi
            label="Check-ins"
            value={`${formatCount(t.checkin_attempts - t.checkin_rejected)} accepted`}
            hint={`${formatCount(t.checkin_rejected)} rejected · success ${formatRate(rate(t.checkin_attempts - t.checkin_rejected, t.checkin_attempts))}`}
            href={reportHref("/admin/reports/checkins", query)}
            icon={MapPinCheck}
          />
        </KpiGrid>
      </Section>

      <Section
        id="exceptions"
        title="Exceptions"
        description="Things that need attention in this period."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href={reportHref("/admin/reports/exceptions", query)}>Open exceptions</Link>
          </Button>
        }
      >
        <KpiGrid>
          <Kpi label="Overdue tasks" value={formatCount(exceptionCount("overdue"))} href={to("overdue")} />
          <Kpi label="Failed tasks" value={formatCount(exceptionCount("failed"))} href={to("failed")} />
          <Kpi label="Partially completed" value={formatCount(exceptionCount("partial"))} href={to("partial")} />
          <Kpi label="Rejected check-ins" value={formatCount(exceptionCount("rejected_checkin"))} hint="Tasks with at least one rejected attempt" href={to("rejected_checkin")} />
          <Kpi label="Cash outstanding" value={formatCount(exceptionCount("cash_outstanding"))} hint="Closed cash tasks not collected in full" href={to("cash_outstanding")} />
          <Kpi label="Missing proof" value={formatCount(exceptionCount("missing_proof"))} href={to("missing_proof")} />
          <Kpi label="Failed messages" value={formatCount(exceptions.failedCommunications)} hint="E-mails that could not be delivered" href="/admin/notifications?view=log&status=FAILED" />
          <Kpi label="Data-quality findings" value={formatCount(exceptions.dataQuality)} href={reportHref("/admin/reports/data-quality", query)} icon={Users} />
        </KpiGrid>
      </Section>
    </ReportShell>
  );
}
