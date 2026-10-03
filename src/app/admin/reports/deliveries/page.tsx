import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Kpi, KpiGrid, ReportTable, Section } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { DELIVERY_TASK_COLUMNS, PRODUCT_COLUMNS } from "@/features/reports/definitions";
import { reportHref } from "@/features/reports/filters";
import { getOverview, listProductReport, listTaskFacts } from "@/features/reports/service";
import { formatCount, formatRate, KPI_DEFINITIONS, rate } from "@/lib/analytics/definitions";
import { formatQuantity } from "@/lib/decimal";

export const metadata: Metadata = { title: "Delivery report" };

const PATH = "/admin/reports/deliveries";
const TASKS = "/admin/reports/tasks";

export default async function DeliveryReportPage(props: PageProps<"/admin/reports/deliveries">) {
  const context = await loadReportContext(props.searchParams);
  const { range, query } = context;
  // This report is about delivery tasks whatever type filter is set elsewhere.
  const filters = { ...context.filters, type: "DELIVER_PRODUCTS" as const };
  const first = { page: 1, dir: "desc" as const };
  const [overview, products, full, partial, failed, open] = await Promise.all([
    getOverview(filters, range),
    listProductReport(filters, range, filters),
    listTaskFacts(filters, range, first, "delivery_full"),
    listTaskFacts(filters, range, first, "delivery_partial"),
    listTaskFacts(filters, range, first, "delivery_failed"),
    listTaskFacts(filters, range, first, "active"),
  ]);
  const t = overview.totals;
  const qty = (value: number) => formatQuantity(value.toFixed(3));
  const deliveryQuery = { ...query, type: "DELIVER_PRODUCTS" };

  return (
    <ReportShell
      title="Delivery report"
      description={KPI_DEFINITIONS.fulfilment}
      path={PATH}
      context={context}
      exportReport="deliveries"
      hide={["type", "status"]}
    >
      <KpiGrid>
        <Kpi label="Quantity assigned" value={qty(t.qty_assigned)} hint={`${formatCount(t.delivery_tasks_closed)} closed delivery tasks`} href={reportHref(TASKS, deliveryQuery, { segment: "delivery" })} />
        <Kpi label="Quantity delivered" value={qty(t.qty_delivered)} hint={`Fulfilment ${formatRate(rate(t.qty_delivered, t.qty_assigned))}`} />
        <Kpi label="Quantity outstanding" value={qty(t.qty_assigned - t.qty_delivered)} hint="Assigned but not delivered on closed tasks" href={reportHref(TASKS, deliveryQuery, { segment: "delivery_partial" })} />
        <Kpi label="Still to deliver" value={qty(t.qty_open)} hint={`${formatCount(open.total)} open delivery tasks (not in the figures above)`} href={reportHref(TASKS, deliveryQuery, { segment: "active" })} />
        <Kpi label="Full deliveries" value={formatCount(full.total)} href={reportHref(TASKS, deliveryQuery, { segment: "delivery_full" })} />
        <Kpi label="Partial deliveries" value={formatCount(partial.total)} hint={`${formatRate(rate(partial.total, t.delivery_tasks_closed))} of closed deliveries`} href={reportHref(TASKS, deliveryQuery, { segment: "delivery_partial" })} />
        <Kpi label="Failed deliveries" value={formatCount(failed.total)} hint="Counted as nothing delivered" href={reportHref(TASKS, deliveryQuery, { segment: "delivery_failed" })} />
      </KpiGrid>

      <Section id="by-product" title="By product" description="Assigned, delivered and outstanding quantity per product over closed delivery tasks.">
        <ReportTable
          caption="Deliveries by product"
          columns={PRODUCT_COLUMNS}
          rows={products.rows}
          total={products.total}
          rowKey={(row) => row.product_id}
          basePath={PATH}
          query={query}
          page={context.filters.page}
          sort={context.filters.sort}
          dir={context.filters.dir}
          emptyTitle="No closed delivery tasks in this period."
        />
      </Section>

      <Section
        id="shortfalls"
        title="Partial deliveries"
        description="The most recent tasks delivered short."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={reportHref(TASKS, deliveryQuery, { segment: "delivery_partial" })}>View all</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={reportHref("/admin/reports/export", deliveryQuery, { report: "delivery-tasks", format: "csv" })} download>
                Export delivery tasks (CSV)
              </a>
            </Button>
          </div>
        }
      >
        <ReportTable
          caption="Partial deliveries"
          columns={DELIVERY_TASK_COLUMNS.map((c) => ({ ...c, sort: undefined }))}
          rows={partial.rows.slice(0, 10)}
          total={Math.min(partial.total, 10)}
          rowKey={(row) => row.id}
          basePath={PATH}
          query={query}
          page={1}
          dir="desc"
          emptyTitle="No partial deliveries in this period."
        />
      </Section>
    </ReportShell>
  );
}
