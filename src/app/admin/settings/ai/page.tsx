import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingSwitch } from "@/features/ai/components/ai-buttons";
import { getAiAdministration } from "@/features/ai/queries";
import { AI_FEATURES } from "@/lib/ai/flags";
import { EXCLUDED_INPUTS, FEATURE_DEFINITIONS, FEATURE_VERSION } from "@/lib/ai/features";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "AI settings" };

/** Below this many evaluated predictions no quality figure is shown at all. */
const MIN_EVALUATED = 30;

export default async function AiSettingsPage() {
  await requireAdmin();
  const admin = await getAiAdministration();
  const { flags, usage } = admin;
  const descriptionOf = (key: string) => admin.settings.find((s) => s.key === key)?.description ?? "";
  const lastPredictionRun = admin.runs.find((r) => r.kind === "PREDICTIONS");

  return (
    <>
      <PageHeader
        title="AI settings"
        description="Turn AI features on or off, and see what runs, with which model versions, and how it is doing."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/ai">
              <ArrowLeft data-icon="inline-start" aria-hidden />
              AI insights
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Features</CardTitle>
            <CardDescription>With everything off, tasks, monitoring, notifications and reports work exactly as before.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SettingSwitch
              settingKey="ai_enabled"
              label="AI enabled"
              description={descriptionOf("ai_enabled")}
              enabled={flags.master.setting}
              lockedBy={flags.master.environment ? undefined : "Switched off for this deployment (AI_FEATURES_ENABLED)."}
            />
            <div className="space-y-4 border-t pt-4">
              {AI_FEATURES.map((feature) => (
                <SettingSwitch
                  key={feature.key}
                  settingKey={feature.key}
                  label={feature.label}
                  description={descriptionOf(feature.key)}
                  enabled={flags.features[feature.key].setting}
                  lockedBy={flags.features[feature.key].environment ? undefined : `Switched off for this deployment (${feature.env}).`}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Last prediction refresh</dt>
                <dd>{lastPredictionRun ? `${formatDateTime(lastPredictionRun.started_at)} (${lastPredictionRun.status.toLowerCase()})` : "Never"}</dd>
                <dt className="text-muted-foreground">Out-of-date predictions</dt>
                <dd>{admin.stalePredictions}</dd>
                <dt className="text-muted-foreground">Summary provider</dt>
                <dd>
                  {admin.provider.enabled ? (
                    <>
                      <Badge variant="success">Language model</Badge> {admin.provider.model}
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary">Built-in template</Badge>
                      <span className="mt-1 block text-xs text-muted-foreground">{admin.provider.reason}</span>
                    </>
                  )}
                </dd>
                <dt className="text-muted-foreground">Feedback received</dt>
                <dd>
                  {admin.feedback.useful} useful · {admin.feedback.notUseful} not useful · {admin.feedback.incorrect} incorrect
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage — last 30 days</CardTitle>
              <CardDescription>API keys and request contents are never recorded.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Runs</dt>
                <dd>
                  {usage.runs} ({usage.failed} failed)
                </dd>
                <dt className="text-muted-foreground">Predictions written</dt>
                <dd>
                  {usage.predictions} ({usage.insufficient} without enough data)
                </dd>
                <dt className="text-muted-foreground">Average run time</dt>
                <dd>{usage.averageMs === null ? "N/A" : `${usage.averageMs} ms`}</dd>
                <dt className="text-muted-foreground">Language-model calls</dt>
                <dd>{usage.modelCalls}</dd>
                <dt className="text-muted-foreground">Tokens used</dt>
                <dd>
                  {usage.inputTokens} in · {usage.outputTokens} out
                </dd>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>Every stored prediction records the model name, version and feature version below.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Model registry</caption>
            <thead className="text-left text-muted-foreground">
              <tr>
                {["Model", "Version", "Type", "Status", "Features", "Registered", "Method"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {admin.models.map((m) => (
                <tr key={`${m.name}-${m.version}`} className="border-t align-top">
                  <td className="px-4 py-2 font-mono text-xs">{m.name}</td>
                  <td className="px-4 py-2">{m.version}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{m.model_type.toLowerCase().replace(/_/g, " ")}</td>
                  <td className="px-4 py-2">
                    <Badge variant={m.status === "ACTIVE" ? "success" : "outline"}>{m.status === "EXPERIMENTAL" ? "Experimental" : m.status.toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-2">v{m.feature_version}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(m.created_at)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{m.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evaluation</CardTitle>
          <CardDescription>
            Once a task is closed, what really happened is stored next to each prediction made for it. No accuracy is claimed until at
            least {MIN_EVALUATED} predictions of a model have a known outcome.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {admin.evaluation.length === 0 ? (
            <p className="text-sm text-muted-foreground">No predictions with an estimate have been stored yet.</p>
          ) : (
            <ul className="space-y-2 text-sm" aria-label="Model evaluation">
              {admin.evaluation.map((e) => {
                const evaluated = Number(e.evaluated ?? 0);
                return (
                  <li key={`${e.prediction_type}-${e.model_version}`}>
                    <span className="font-mono text-xs">
                      {e.model_name} v{e.model_version}
                    </span>
                    : {Number(e.predictions ?? 0)} predictions, {evaluated} with a known outcome.{" "}
                    {evaluated < MIN_EVALUATED ? (
                      <span className="text-muted-foreground">Not enough yet to judge — still experimental.</span>
                    ) : e.prediction_type === "TASK_DELAY_RISK" ? (
                      <span>
                        Rated high: {Number(e.high_and_late)} finished late, {Number(e.high_not_late)} did not. Not rated high: {Number(e.not_high_but_late)} finished late,{" "}
                        {Number(e.not_high_not_late)} did not.
                      </span>
                    ) : e.prediction_type === "TASK_FAILURE_RISK" ? (
                      <span>
                        {Number(e.failed_total)} of the evaluated tasks failed; {Number(e.high_and_failed)} of those had been rated high.
                      </span>
                    ) : (
                      <span>
                        Mean absolute error of the completion estimate: {e.eta_mean_abs_error_minutes ?? "N/A"} minutes ({Number(e.eta_evaluated)} tasks).
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          {admin.runs.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">Nothing has run yet.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Recent AI runs</caption>
              <thead className="text-left text-muted-foreground">
                <tr>
                  {["Started", "Kind", "Trigger", "Status", "Duration", "Predictions", "No data", "Recommendations", "Provider", "Note"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {admin.runs.map((run) => (
                  <tr key={run.id} className="border-t">
                    <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(run.started_at)}</td>
                    <td className="px-4 py-2">{run.kind.toLowerCase()}</td>
                    <td className="px-4 py-2">{run.trigger.toLowerCase()}</td>
                    <td className="px-4 py-2">
                      <Badge variant={run.status === "SUCCEEDED" ? "success" : run.status === "FAILED" ? "destructive" : "secondary"}>{run.status.toLowerCase()}</Badge>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{run.duration_ms === null ? "—" : `${run.duration_ms} ms`}</td>
                    <td className="px-4 py-2">{run.predictions}</td>
                    <td className="px-4 py-2">{run.insufficient}</td>
                    <td className="px-4 py-2">{run.recommendations}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{run.provider ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{run.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What the models use (feature set v{FEATURE_VERSION})</CardTitle>
          <CardDescription>Every input exists at the moment of prediction. Baselines come only from tasks that were already closed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-1.5" aria-label="Features">
            {FEATURE_DEFINITIONS.map((f) => (
              <li key={f.name}>
                <span className="font-mono text-xs">{f.name}</span> — {f.calculation} <span className="text-muted-foreground">If missing: {f.missing}</span>
              </li>
            ))}
          </ul>
          <p className="font-medium">Never used</p>
          <ul className="list-disc pl-5 text-muted-foreground" aria-label="Excluded inputs">
            {EXCLUDED_INPUTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
