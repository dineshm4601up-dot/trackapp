import type { Metadata } from "next";

import { ReportTable } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { CUSTOMER_COLUMNS } from "@/features/reports/definitions";
import { listCustomerReport } from "@/features/reports/service";

export const metadata: Metadata = { title: "Customer report" };

const PATH = "/admin/reports/customers";

export default async function CustomerReportPage(props: PageProps<"/admin/reports/customers">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range, query } = context;
  const customers = await listCustomerReport(filters, range, filters);

  return (
    <ReportShell
      title="Customer report"
      description="Tasks, deliveries and cash per customer. Open a customer to see its locations, then the tasks."
      path={PATH}
      context={context}
      exportReport="customers"
    >
      <ReportTable
        caption="Customers"
        columns={CUSTOMER_COLUMNS}
        rows={customers.rows}
        total={customers.total}
        rowKey={(row) => row.customer_id}
        basePath={PATH}
        query={query}
        page={filters.page}
        sort={filters.sort}
        dir={filters.dir}
        emptyTitle="No customer had tasks in this period."
      />
    </ReportShell>
  );
}
