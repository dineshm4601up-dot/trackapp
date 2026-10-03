import type { Metadata } from "next";

import { ReportTable } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { LOCATION_COLUMNS } from "@/features/reports/definitions";
import { listLocationReport } from "@/features/reports/service";

export const metadata: Metadata = { title: "Location report" };

const PATH = "/admin/reports/locations";

export default async function LocationReportPage(props: PageProps<"/admin/reports/locations">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range, query } = context;
  const locations = await listLocationReport(filters, range, filters);

  return (
    <ReportShell
      title="Location report"
      description="Task volume, completion, check-in success and execution time per location. No coordinates are shown."
      path={PATH}
      context={context}
      exportReport="locations"
    >
      <ReportTable
        caption="Locations"
        columns={LOCATION_COLUMNS}
        rows={locations.rows}
        total={locations.total}
        rowKey={(row) => row.location_id}
        basePath={PATH}
        query={query}
        page={filters.page}
        sort={filters.sort}
        dir={filters.dir}
        emptyTitle="No location had tasks in this period."
      />
    </ReportShell>
  );
}
