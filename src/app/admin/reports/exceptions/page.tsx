import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadReportContext, ReportShell } from "@/features/reports/components/report-shell";
import { reportHref } from "@/features/reports/filters";
import { getExceptions, type ExceptionSegment } from "@/features/reports/service";
import { TaskStatusBadge } from "@/features/tasks/components/task-badges";
import { formatCount } from "@/lib/analytics/definitions";
import { businessUtcOffset, formatMoney, formatShortCalendarDate } from "@/lib/format";

export const metadata: Metadata = { title: "Exceptions" };

const PATH = "/admin/reports/exceptions";
const TASKS = "/admin/reports/tasks";

const KINDS: Record<ExceptionSegment, { title: string; description: string }> = {
  overdue: { title: "Overdue tasks", description: "Still open after the scheduled time. The task status is not changed." },
  failed: { title: "Failed tasks", description: "Reported as failed by the agent." },
  partial: { title: "Partially completed", description: "Finished with a shortfall." },
  rejected_checkin: { title: "Rejected check-ins", description: "Tasks with at least one check-in attempt outside the allowed area." },
  cash_outstanding: { title: "Cash outstanding", description: "Closed cash tasks not collected in full." },
  missing_proof: { title: "Missing proof", description: "Finished deliveries or document collections with no proof on file." },
  needs_verification: { title: "Awaiting verification", description: "Completed or partially completed, not yet verified." },
};

export default async function ExceptionsPage(props: PageProps<"/admin/reports/exceptions">) {
  const context = await loadReportContext(props.searchParams);
  const { filters, range, query } = context;
  const exceptions = await getExceptions(filters, range, businessUtcOffset());

  return (
    <ReportShell
      title="Operational exceptions"
      description="Records that need attention in the selected period. Each one links to the task."
      path={PATH}
      context={context}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {exceptions.lists.map(({ segment, total, rows }) => (
          <Card key={segment}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{KINDS[segment].title}</span>
                <Badge variant={total ? "warning" : "secondary"}>{formatCount(total)}</Badge>
              </CardTitle>
              <CardDescription>{KINDS[segment].description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">None in this period.</p>
              ) : (
                <ul className="divide-y text-sm" aria-label={KINDS[segment].title}>
                  {rows.map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/admin/tasks/${row.id}`} className="font-mono text-xs font-medium hover:underline">
                          {row.task_code}
                        </Link>
                        <p className="truncate">{row.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[row.agent_name ?? "Unassigned", row.customer_name, formatShortCalendarDate(row.task_date)].filter(Boolean).join(" · ")}
                          {segment === "cash_outstanding" && row.outstanding_amount !== null && ` · ${formatMoney(Number(row.outstanding_amount).toFixed(2))} outstanding`}
                          {segment === "rejected_checkin" && ` · ${row.checkin_rejected} rejected`}
                        </p>
                      </div>
                      <TaskStatusBadge status={row.status} />
                    </li>
                  ))}
                </ul>
              )}
              {total > rows.length && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={reportHref(TASKS, query, { segment })}>View all {formatCount(total)}</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>Failed messages</span>
              <Badge variant={exceptions.failedCommunications ? "warning" : "secondary"}>{formatCount(exceptions.failedCommunications)}</Badge>
            </CardTitle>
            <CardDescription>E-mails that could not be delivered after all attempts.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/notifications?view=log&status=FAILED">Open the delivery log</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>Data-quality findings</span>
              <Badge variant={exceptions.dataQuality ? "warning" : "secondary"}>{formatCount(exceptions.dataQuality)}</Badge>
            </CardTitle>
            <CardDescription>Records with inconsistent or incomplete data.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href={reportHref("/admin/reports/data-quality", query)}>Open data quality</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </ReportShell>
  );
}
