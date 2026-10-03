import type { Metadata } from "next";
import Link from "next/link";
import { Settings } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecommendationActions, RefreshPredictionsButton, RegenerateSummaryButton } from "@/features/ai/components/ai-buttons";
import { Confidence, ExperimentalBadge, Provenance, RiskBadge } from "@/features/ai/components/ai-parts";
import { getAiDashboard } from "@/features/ai/queries";
import { TimeAgo } from "@/features/monitoring/components/live-time";
import { BarList, Kpi, KpiGrid, Section } from "@/features/reports/components/report-parts";
import { TaskStatusBadge } from "@/features/tasks/components/task-badges";
import { TASK_TYPE_META, type TaskType } from "@/features/tasks/constants";
import { requireAdmin } from "@/lib/auth/session";
import { formatCalendarDate, formatDateTime, formatWallTimeOfInstant } from "@/lib/format";

export const metadata: Metadata = { title: "AI insights" };

const SEVERITY = { high: "destructive", medium: "warning", low: "secondary" } as const;

export default async function AiPage() {
  await requireAdmin();
  const ai = await getAiDashboard();

  if (!ai.flags.enabled) {
    return (
      <>
        <PageHeader title="AI insights" description="Estimates and recommendations to support your decisions." />
        <Alert>
          <AlertTitle>AI features are switched off</AlertTitle>
          <AlertDescription>
            {ai.flags.disabledBy === "environment"
              ? "They are disabled for this deployment (AI_FEATURES_ENABLED)."
              : "An administrator turned them off in the AI settings."}{" "}
            Tasks, monitoring, notifications and reports work as usual.{" "}
            <Link href="/admin/settings/ai" className="underline">
              Open AI settings
            </Link>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const { counts, flags } = ai;
  const stale = ai.runIsOld;

  return (
    <>
      <PageHeader
        title="AI insights"
        description="What may happen next and what needs attention. These are estimates to support your decisions — nothing here changes a task."
        actions={
          <>
            <RefreshPredictionsButton />
            <Button variant="outline" asChild>
              <Link href="/admin/settings/ai">
                <Settings data-icon="inline-start" aria-hidden />
                AI settings
              </Link>
            </Button>
          </>
        }
      />
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
        <ExperimentalBadge />
        {ai.lastRun?.finished_at ? (
          <span title={formatDateTime(ai.lastRun.finished_at)}>
            Predictions last refreshed <TimeAgo at={ai.lastRun.finished_at} />.
          </span>
        ) : (
          <span>Predictions have not been generated yet.</span>
        )}
        {stale && <span className="font-medium text-warning">They may be out of date — refresh to update them.</span>}
        {ai.lastRun?.status === "FAILED" && <span className="font-medium text-destructive">The last refresh failed.</span>}
      </p>

      <Section id="predictive-overview" title="Predictive overview" description="Counts of open tasks by their current stored estimate.">
        <KpiGrid>
          <Kpi label="Open tasks" value={String(counts.active)} hint={`${counts.withoutEstimate} without enough data for an estimate`} href="/admin/monitoring" />
          <Kpi label="Tasks at risk" value={String(counts.atRisk)} hint="High delay risk or high failure risk" />
          <Kpi label="High delay risk" value={String(counts.highDelay)} hint={`${counts.mediumDelay} more at medium risk`} />
          <Kpi label="High failure risk" value={String(counts.highFailure)} hint="Based on how often similar tasks failed" />
          <Kpi label="Operational anomalies" value={String(ai.anomalies.length)} hint="Recent figures far from their usual level" />
          <Kpi label="Recommendations to review" value={String(ai.recommendations.total)} href="/admin/ai/recommendations" />
        </KpiGrid>
      </Section>

      {flags.features.summary.enabled && (
        <Section
          id="summary"
          title="AI operational summary"
          description="Written from today's figures only."
          action={<RegenerateSummaryButton hasSummary={ai.summary !== null} />}
        >
          <Card>
            <CardContent className="space-y-3 text-sm">
              {ai.summary ? (
                <>
                  <p className="text-base">{ai.summary.content.summary}</p>
                  {ai.summary.content.observations.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5" aria-label="Observations">
                      {ai.summary.content.observations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {ai.summary.content.attention_items.length > 0 && (
                    <div>
                      <p className="font-medium">Attention</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5" aria-label="Attention items">
                        {ai.summary.content.attention_items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="font-medium">No automatic task changes were made.</p>
                  <p className="text-xs text-muted-foreground">
                    Generated {formatDateTime(ai.summary.generatedAt)} ·{" "}
                    {ai.summary.provider === "template" ? "built-in template (no language model)" : `language model ${ai.summary.model ?? ai.summary.provider}, checked against the figures`}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">No summary has been generated for today yet.</p>
              )}
            </CardContent>
          </Card>
        </Section>
      )}

      {flags.features.recommendations.enabled && (
        <Section
          id="recommendations"
          title="Attention required"
          description="Recommendations waiting for your review. Accepting one only acknowledges it."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/ai/recommendations">All recommendations</Link>
            </Button>
          }
        >
          {ai.recommendations.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting for review.</p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2" aria-label="Recommendations to review">
              {ai.recommendations.rows.map((rec) => (
                <li key={rec.id}>
                  <Card size="sm" className="h-full">
                    <CardContent className="space-y-2 text-sm">
                      <p className="font-medium">{rec.title}</p>
                      <p className="text-muted-foreground">{rec.description}</p>
                      <div className="flex flex-wrap items-center gap-3">
                        <Confidence value={rec.confidence} />
                        {rec.entity_type === "TASK" && rec.entity_id && (
                          <Link href={`/admin/tasks/${rec.entity_id}`} className="text-xs underline">
                            View task
                          </Link>
                        )}
                      </div>
                      <RecommendationActions id={rec.id} title={rec.title} />
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {(flags.features.task_risk.enabled || flags.features.eta.enabled) && (
        <Section id="task-risk" title="Task risk and estimated completion" description="Open tasks, highest risk first. N/A means there is not enough history for an honest estimate.">
          {ai.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">There are no open tasks.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <caption className="sr-only">Open tasks with risk estimates</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    {["Task", "Agent", "Status", ...(flags.features.task_risk.enabled ? ["Delay risk", "Failure risk"] : []), ...(flags.features.eta.enabled ? ["Estimated completion"] : []), "Generated"].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ai.tasks.slice(0, 50).map((task) => {
                    const newest = task.delay ?? task.failure ?? task.eta;
                    return (
                      <tr key={task.id} className="border-t align-top">
                        <td className="px-3 py-2">
                          <Link href={`/admin/tasks/${task.id}`} className="font-mono text-xs font-medium hover:underline">
                            {task.task_code}
                          </Link>
                          <span className="block max-w-56 truncate text-xs text-muted-foreground">{task.title}</span>
                        </td>
                        <td className="px-3 py-2">{task.agent_name ?? "Unassigned"}</td>
                        <td className="px-3 py-2">
                          <TaskStatusBadge status={task.status} />
                        </td>
                        {flags.features.task_risk.enabled && (
                        <td className="px-3 py-2">
                          {task.delay ? (
                            <span className="flex flex-col items-start gap-1">
                              <RiskBadge level={task.delay.value.available ? task.delay.value.level : null} />
                              <span className="max-w-64 text-xs text-muted-foreground">{task.delay.factors[0]}</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        )}
                        {flags.features.task_risk.enabled && (
                        <td className="px-3 py-2">
                          {task.failure ? (
                            <span className="flex flex-col items-start gap-1">
                              <RiskBadge level={task.failure.value.available ? task.failure.value.level : null} />
                              {task.failure.value.available && <span className="text-xs text-muted-foreground">Estimated {Math.round(task.failure.value.estimated_rate * 100)}%</span>}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        )}
                        {flags.features.eta.enabled && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {task.eta?.value.available ? (
                            <span>
                              {formatWallTimeOfInstant(task.eta.value.eta)}
                              <span className="block text-xs text-muted-foreground">
                                {formatWallTimeOfInstant(task.eta.value.earliest)} – {formatWallTimeOfInstant(task.eta.value.latest)} · operational, no traffic
                              </span>
                            </span>
                          ) : task.eta ? (
                            <span className="text-muted-foreground">N/A</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        )}
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {newest ? (
                            <>
                              <TimeAgo at={newest.generatedAt} />
                              {newest.stale && <span className="block font-medium text-warning">Out of date</span>}
                            </>
                          ) : (
                            "Not yet"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {ai.tasks.length > 50 && <p className="text-xs text-muted-foreground">Showing the 50 highest-risk tasks of {ai.tasks.length}.</p>}
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {flags.features.forecast.enabled && (
          <Card>
            <CardHeader>
              <CardTitle>Workload forecast — next 7 days</CardTitle>
              <CardDescription>
                {ai.forecast?.value.available ? `${ai.forecast.value.method}. Based on ${ai.forecast.value.history_tasks} tasks in the last ${ai.forecast.value.history_days} days.` : "Expected task volume per day."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!ai.forecast ? (
                <p className="text-sm text-muted-foreground">No forecast has been generated yet.</p>
              ) : !ai.forecast.value.available ? (
                <p className="text-sm text-muted-foreground">Forecast: N/A — {ai.forecast.value.detail}</p>
              ) : (
                <>
                  <BarList
                    label="Expected tasks per day"
                    rows={ai.forecast.value.days.map((d) => ({
                      key: d.day,
                      label: formatCalendarDate(d.day),
                      value: d.expected,
                      display: `${d.expected} expected`,
                      note: `range ${d.low}–${d.high} · ${d.scheduled} already scheduled`,
                    }))}
                  />
                  {ai.forecast.value.by_type.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Usual mix (last 4 weeks):{" "}
                      {ai.forecast.value.by_type
                        .slice(0, 4)
                        .map((t) => `${t.key in TASK_TYPE_META ? TASK_TYPE_META[t.key as TaskType].label : t.key} ${Math.round(t.share * 100)}%`)
                        .join(" · ")}
                      {ai.forecast.value.by_location.length > 0 && ` · busiest location: ${ai.forecast.value.by_location[0]!.key} (${Math.round(ai.forecast.value.by_location[0]!.share * 100)}% of the top five)`}
                    </p>
                  )}
                  <Confidence value={ai.forecast.confidence} />
                  <Provenance generatedAt={ai.forecast.generatedAt} model={ai.forecast.model} version={ai.forecast.version} stale={ai.forecast.stale} />
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Agent workload</CardTitle>
            <CardDescription>Pressure on each agent&apos;s schedule from open-task counts. It describes the schedule, not the person, and reassigns nothing.</CardDescription>
          </CardHeader>
          <CardContent>
            {ai.workload.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agent has open tasks.</p>
            ) : (
              <ul className="divide-y text-sm" aria-label="Agent workload">
                {ai.workload.slice(0, 12).map((w) => (
                  <li key={w.agent_id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{w.agent_name ?? "Agent"}</p>
                      <p className="text-xs text-muted-foreground">{w.pressure.reasons.join(" · ")}</p>
                    </div>
                    <RiskBadge prefix="Workload pressure" level={w.pressure.level} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {flags.features.anomalies.enabled && (
        <Section id="anomalies" title="Operational anomalies" description="Recent figures that are far from their own historical baseline. An anomaly is a prompt to look, not a conclusion.">
          {ai.anomalies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No operational anomaly is currently flagged.</p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2" aria-label="Operational anomalies">
              {ai.anomalies.map((a) => (
                <li key={a.id}>
                  <Card size="sm" className="h-full">
                    <CardContent className="space-y-1.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">Operational anomaly: {a.title}</p>
                        <Badge variant={SEVERITY[a.severity]}>Severity: {a.severity}</Badge>
                      </div>
                      {a.subject && <p className="text-muted-foreground">{a.entityType === "TASK" ? `Task #${a.subject}` : a.subject}</p>}
                      <p>{a.detail}</p>
                      <p className="text-xs text-muted-foreground">
                        Observed {a.observed ?? "—"} · historical baseline {a.baseline ?? "—"} ({a.unit}) · detected {formatDateTime(a.generatedAt)}
                      </p>
                      {a.entityType === "TASK" && (
                        <Link href={`/admin/tasks/${a.entityId}`} className="text-xs underline">
                          View task
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
