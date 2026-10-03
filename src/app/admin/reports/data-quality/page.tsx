import type { Metadata } from "next";

import { ReportTable } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { QUALITY_COLUMNS } from "@/features/reports/definitions";
import { listDataQuality } from "@/features/reports/service";

export const metadata: Metadata = { title: "Data quality" };

const PATH = "/admin/reports/data-quality";

export default async function DataQualityPage(props: PageProps<"/admin/reports/data-quality">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range } = context;
  // Only the period applies here: findings are about records, whatever their agent or type.
  const query = { range: context.query.range, from: context.query.from, to: context.query.to };
  const findings = await listDataQuality(range, filters);

  return (
    <ReportShell
      title="Data quality"
      description="Records that look inconsistent or incomplete. Nothing is changed automatically — open the task to review it."
      path={PATH}
      context={{ ...context, query }}
      exportReport="data-quality"
      hide={["agent", "type", "status", "customer", "location", "priority"]}
    >
      <ReportTable
        caption="Data-quality findings"
        columns={QUALITY_COLUMNS}
        rows={findings.rows}
        total={findings.total}
        rowKey={(row, index) => `${row.task_id}-${row.issue}-${index}`}
        basePath={PATH}
        query={query}
        page={filters.page}
        sort={filters.sort}
        dir={filters.dir}
        emptyTitle="No data-quality findings in this period."
      />
    </ReportShell>
  );
}
