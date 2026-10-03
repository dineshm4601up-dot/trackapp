import type { Metadata } from "next";

import { Card, CardContent } from "@/components/ui/card";
import { ReportTable, Section } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { TASK_COLUMNS } from "@/features/reports/definitions";
import { getDurations, listTaskFacts } from "@/features/reports/service";
import { formatDuration, SMALL_SAMPLE } from "@/lib/analytics/definitions";

export const metadata: Metadata = { title: "Task report" };

const PATH = "/admin/reports/tasks";

export default async function TaskReportPage(props: PageProps<"/admin/reports/tasks">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range, query } = context;
  const [tasks, durations] = await Promise.all([listTaskFacts(filters, range, filters), getDurations(filters, range)]);

  return (
    <ReportShell
      title="Task report"
      description="One row per task, with its outcome, timing, delivery, cash and check-in figures."
      path={PATH}
      context={context}
      exportReport="tasks"
    >
      <ReportTable
        caption="Tasks"
        columns={TASK_COLUMNS}
        rows={tasks.rows}
        total={tasks.total}
        rowKey={(row) => row.id}
        basePath={PATH}
        query={query}
        extra={{ segment: filters.segment }}
        page={filters.page}
        sort={filters.sort}
        dir={filters.dir}
      />

      <Section
        id="durations"
        title="Time between stages"
        description="From the status history of all tasks matching the filters. A stage is counted only when both of its times exist and are in order; missing times are never treated as zero."
      >
        <Card>
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full text-sm">
              <caption className="sr-only">Time between workflow stages</caption>
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Stage
                  </th>
                  {["Tasks measured", "Average", "Median", "Shortest", "Longest"].map((heading) => (
                    <th key={heading} scope="col" className="px-4 py-2 text-right font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {durations.map((row) => {
                  const samples = Number(row.samples);
                  const show = (seconds: number | null) => (samples === 0 ? "N/A" : formatDuration(seconds === null ? null : Number(seconds)));
                  return (
                    <tr key={row.stage} className="border-t">
                      <th scope="row" className="px-4 py-2 text-left font-normal">
                        {row.stage}
                      </th>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {samples}
                        {samples > 0 && samples < SMALL_SAMPLE && <span className="text-xs text-muted-foreground"> (small sample)</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{show(row.avg_seconds)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{show(row.median_seconds)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{show(row.min_seconds)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{show(row.max_seconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </Section>
    </ReportShell>
  );
}
