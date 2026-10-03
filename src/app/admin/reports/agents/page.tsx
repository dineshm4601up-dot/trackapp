import type { Metadata } from "next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReportTable } from "@/features/reports/components/report-parts";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { AGENT_COLUMNS } from "@/features/reports/definitions";
import { listAgentReport } from "@/features/reports/service";

export const metadata: Metadata = { title: "Agent report" };

const PATH = "/admin/reports/agents";

export default async function AgentReportPage(props: PageProps<"/admin/reports/agents">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range, query } = context;
  const agents = await listAgentReport(filters, range, filters);

  return (
    <ReportShell
      title="Agent report"
      description="Workload, outcomes and timing per agent for the selected period."
      path={PATH}
      context={context}
      exportReport="agents"
    >
      <Alert>
        <AlertDescription>
          These figures describe each agent&apos;s tasks; they are not a ranking. Agents differ in workload, task types,
          locations and schedules, so compare like with like (filter by task type) and open the tasks behind a number before
          drawing a conclusion. Averages show the number of tasks measured when it is small.
        </AlertDescription>
      </Alert>
      <ReportTable
        caption="Agents"
        columns={AGENT_COLUMNS}
        rows={agents.rows}
        total={agents.total}
        rowKey={(row) => row.agent_id}
        basePath={PATH}
        query={query}
        page={filters.page}
        sort={filters.sort}
        dir={filters.dir}
        emptyTitle="No agent had tasks in this period."
      />
    </ReportShell>
  );
}
