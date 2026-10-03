import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, Kpi, KpiGrid, ReportTable, Section } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { CASH_TASK_COLUMNS } from "@/features/reports/definitions";
import { reportHref } from "@/features/reports/filters";
import { getCashSummary, listTaskFacts } from "@/features/reports/service";
import { paymentMethodLabel } from "@/features/tasks/constants";
import { formatCount, formatRate, KPI_DEFINITIONS, rate } from "@/lib/analytics/definitions";
import { formatMoney, formatShortCalendarDate } from "@/lib/format";

export const metadata: Metadata = { title: "Cash report" };

const PATH = "/admin/reports/cash";

export default async function CashReportPage(props: PageProps<"/admin/reports/cash">) {
  const context = await loadReportContext(props.searchParams);
  const { range, query } = context;
  const filters = { ...context.filters, type: "COLLECT_CASH" as const };
  const segment = context.filters.segment ?? "cash";
  const [summary, tasks] = await Promise.all([getCashSummary(filters, range), listTaskFacts(filters, range, context.filters, segment)]);
  const t = summary.totals;
  const money = (value: number) => formatMoney(value.toFixed(2));
  const slice = (name: string) => reportHref(PATH, query, { segment: name });

  return (
    <ReportShell
      title="Cash report"
      description={KPI_DEFINITIONS.collectionRate}
      path={PATH}
      context={context}
      exportReport="cash"
      hide={["type", "status"]}
    >
      <KpiGrid>
        <Kpi label="Expected" value={money(t.expected)} hint={`${formatCount(t.tasks_closed)} closed cash tasks`} href={slice("cash")} />
        <Kpi label="Collected" value={money(t.collected)} hint={`Collection rate ${formatRate(rate(t.collected, t.expected))}`} />
        <Kpi label="Outstanding" value={money(t.outstanding)} hint="Expected but not collected on closed tasks" href={slice("cash_outstanding")} />
        <Kpi label="Awaiting collection" value={money(t.expected_open)} hint={`${formatCount(t.tasks_open)} open cash tasks (not in the figures above)`} href={slice("cash_open")} />
      </KpiGrid>

      <Section id="reconciliation" title="Reconciliation" description="Each closed cash task falls into exactly one group. Amounts are shown as recorded; nothing is capped.">
        <KpiGrid>
          <Kpi label="Collected in full" value={formatCount(t.full)} href={slice("cash_full")} />
          <Kpi label="Partial collection" value={formatCount(t.partial)} href={slice("cash_partial")} />
          <Kpi label="Nothing collected" value={formatCount(t.zero)} hint="Includes failed cash tasks" href={slice("cash_zero")} />
          <Kpi label="More than expected" value={formatCount(t.over_count)} hint={t.over_count ? `${money(t.over)} over in total` : "The system does not allow over-collection"} href={slice("cash_over")} />
        </KpiGrid>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By payment method</CardTitle>
            <CardDescription>Amount collected and number of collections.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Collected by payment method"
              rows={summary.by_method.map((row) => ({
                key: row.key,
                label: paymentMethodLabel(row.key === "UNKNOWN" ? null : row.key),
                value: row.amount,
                display: money(row.amount),
                note: `${row.n} collection${row.n === 1 ? "" : "s"}`,
              }))}
              empty="No collections in this period."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By day</CardTitle>
            <CardDescription>Collected against expected, by task date.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              label="Collected by day"
              rows={summary.by_day.slice(-14).map((row) => ({
                key: row.day,
                label: formatShortCalendarDate(row.day),
                value: row.collected,
                display: money(row.collected),
                note: `of ${money(row.expected)} · ${formatRate(rate(row.collected, row.expected))}`,
              }))}
              empty="No closed cash tasks in this period."
            />
            {summary.by_day.length > 14 && <p className="mt-3 text-xs text-muted-foreground">Showing the latest 14 days; the export has every task.</p>}
          </CardContent>
        </Card>
      </div>

      <Section id="tasks" title="Cash tasks" description="Expected, collected and outstanding per task.">
        <ReportTable
          caption="Cash tasks"
          columns={CASH_TASK_COLUMNS}
          rows={tasks.rows}
          total={tasks.total}
          rowKey={(row) => row.id}
          basePath={PATH}
          query={query}
          extra={{ segment: context.filters.segment }}
          page={context.filters.page}
          sort={context.filters.sort}
          dir={context.filters.dir}
          emptyTitle="No cash tasks match."
        />
      </Section>
    </ReportShell>
  );
}
