import "server-only";

import { z } from "zod";

import { siteConfig } from "@/config/site";
import { ACTIVE_STATUSES } from "@/features/tasks/constants";
import { getAiFlags } from "@/lib/ai/flags";
import { workloadPressure, type Level } from "@/lib/ai/models";
import { summaryProvider, summarySchema } from "@/lib/ai/summary";
import { fetchPage } from "@/lib/db-errors";
import { pageRange } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { businessToday } from "@/lib/format";

// Read side of the AI screens. Everything is read with the admin's session
// (RLS: the ai_* tables are admin-only), and pages call requireAdmin() first.
// Nothing here computes a prediction: pages show what the last run stored.

const levelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const unavailable = z.object({ available: z.literal(false), reason: z.string(), detail: z.string() });
const delayValue = z.union([unavailable, z.object({ available: z.literal(true), level: levelSchema, expected_remaining_minutes: z.number().nullable(), minutes_to_due: z.number() })]);
const failureValue = z.union([unavailable, z.object({ available: z.literal(true), level: levelSchema, estimated_rate: z.number(), based_on: z.number() })]);
const etaValue = z.union([unavailable, z.object({ available: z.literal(true), eta: z.string(), earliest: z.string(), latest: z.string(), label: z.string() })]);
const forecastValue = z.union([
  unavailable,
  z.object({
    available: z.literal(true), method: z.string(), horizon_days: z.number(), history_days: z.number(), history_tasks: z.number(),
    days: z.array(z.object({ day: z.string(), expected: z.number(), low: z.number(), high: z.number(), scheduled: z.number(), weeks: z.number() })),
    by_type: z.array(z.object({ key: z.string(), share: z.number() })),
    by_location: z.array(z.object({ key: z.string(), share: z.number() })),
  }),
]);
const anomalyValue = z.object({
  kind: z.string(), severity: z.enum(["low", "medium", "high"]), title: z.string(), subject: z.string().nullable(),
  observed: z.number().nullable(), baseline: z.number().nullable(), unit: z.string(),
});
const factorsOf = (explanation: unknown) => z.object({ factors: z.array(z.string()) }).catch({ factors: [] }).parse(explanation).factors;

export type StoredPrediction<V> = {
  id: string; value: V; confidence: number | null; factors: string[]; model: string; version: string;
  generatedAt: string; stale: boolean;
};
type Row = { id: string | null; prediction_type: string | null; entity_id: string | null; prediction_value: unknown; confidence: number | null; explanation: unknown; model_name: string | null; model_version: string | null; generated_at: string | null; is_stale: boolean | null };

function parse<V>(row: Row, schema: z.ZodType<V>): StoredPrediction<V> | null {
  const value = schema.safeParse(row.prediction_value);
  if (!value.success || !row.id || !row.generated_at) return null;
  return { id: row.id, value: value.data, confidence: row.confidence, factors: factorsOf(row.explanation), model: row.model_name ?? "", version: row.model_version ?? "", generatedAt: row.generated_at, stale: row.is_stale ?? false };
}

const PREDICTION_COLUMNS = "id, prediction_type, entity_id, prediction_value, confidence, explanation, model_name, model_version, generated_at, is_stale";

export type TaskInsights = {
  delay: StoredPrediction<z.infer<typeof delayValue>> | null;
  failure: StoredPrediction<z.infer<typeof failureValue>> | null;
  eta: StoredPrediction<z.infer<typeof etaValue>> | null;
};

/** Stored results of a feature that has been switched off are not shown. */
function insightsFrom(rows: Row[], show: { risk: boolean; eta: boolean }): TaskInsights {
  const find = (type: string, on: boolean) => (on ? rows.find((r) => r.prediction_type === type) : undefined);
  const d = find("TASK_DELAY_RISK", show.risk), f = find("TASK_FAILURE_RISK", show.risk), e = find("TASK_ETA", show.eta);
  return { delay: d ? parse(d, delayValue) : null, failure: f ? parse(f, failureValue) : null, eta: e ? parse(e, etaValue) : null };
}

/** The stored insights for one task, with the signed-in admin's own feedback on each. */
export async function getTaskInsights(taskId: string, userId: string) {
  const supabase = await createClient();
  const flags = await getAiFlags(supabase);
  if (!flags.enabled || (!flags.features.task_risk.enabled && !flags.features.eta.enabled)) return null;
  const { data } = await supabase.from("ai_current_predictions").select(PREDICTION_COLUMNS).eq("entity_type", "TASK").eq("entity_id", taskId);
  const insights = insightsFrom(data ?? [], { risk: flags.features.task_risk.enabled, eta: flags.features.eta.enabled });
  const ids = [insights.delay?.id, insights.failure?.id, insights.eta?.id].filter((id): id is string => Boolean(id));
  const feedback = ids.length
    ? ((await supabase.from("ai_feedback").select("prediction_id, rating").eq("user_id", userId).in("prediction_id", ids)).data ?? [])
    : [];
  return { insights, feedback: Object.fromEntries(feedback.map((f) => [f.prediction_id, f.rating])) as Record<string, string>, flags };
}

export type AiTaskRow = { id: string; task_code: string; title: string; status: (typeof ACTIVE_STATUSES)[number]; agent_name: string | null; location_name: string | null } & TaskInsights;

const RANK: Record<Level, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const levelOf = (p: StoredPrediction<{ available: boolean; level?: Level }> | null) => (p?.value.available && p.value.level ? RANK[p.value.level] : 0);

/** Everything the AI dashboard shows, from stored results (plus live open-task counts per agent). */
export async function getAiDashboard() {
  const supabase = await createClient();
  const flags = await getAiFlags(supabase);
  const nowIso = new Date().toISOString();
  const [tasks, predictions, forecast, anomalies, pending, summary, lastRun, workload] = await Promise.all([
    supabase.from("task_directory").select("id, task_code, title, status, agent_name, location_name").in("status", [...ACTIVE_STATUSES]).limit(300),
    supabase.from("ai_current_predictions").select(PREDICTION_COLUMNS).eq("entity_type", "TASK").in("prediction_type", ["TASK_DELAY_RISK", "TASK_FAILURE_RISK", "TASK_ETA"]).limit(1500),
    supabase.from("ai_current_predictions").select(PREDICTION_COLUMNS).eq("prediction_type", "WORKLOAD_FORECAST").maybeSingle(),
    supabase.from("ai_predictions").select("id, entity_type, entity_id, prediction_value, explanation, generated_at").eq("prediction_type", "ANOMALY").gt("expires_at", nowIso).order("generated_at", { ascending: false }).limit(50),
    supabase.from("ai_recommendations").select("id, recommendation_type, entity_type, entity_id, title, description, confidence, created_at", { count: "exact" }).eq("status", "PENDING").order("created_at", { ascending: false }).limit(6),
    supabase.from("ai_summaries").select("content, provider, model, generated_at, period").eq("period", businessToday()).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ai_runs").select("status, started_at, finished_at, predictions, insufficient, error").eq("kind", "PREDICTIONS").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    flags.features.recommendations.enabled || flags.features.task_risk.enabled ? supabase.rpc("ai_agent_workload", { p_tz: siteConfig.timeZone }) : null,
  ]);

  const byTask = new Map<string, Row[]>();
  for (const row of predictions.data ?? []) if (row.entity_id) byTask.set(row.entity_id, [...(byTask.get(row.entity_id) ?? []), row]);
  const rows: AiTaskRow[] = (tasks.data ?? [])
    .flatMap((t) => (t.id && t.task_code && t.status ? [{ id: t.id, task_code: t.task_code, title: t.title ?? "", status: t.status as AiTaskRow["status"], agent_name: t.agent_name, location_name: t.location_name, ...insightsFrom(byTask.get(t.id) ?? [], { risk: flags.features.task_risk.enabled, eta: flags.features.eta.enabled }) }] : []))
    .sort((a, b) => levelOf(b.delay) * 10 + levelOf(b.failure) - (levelOf(a.delay) * 10 + levelOf(a.failure)));

  const count = (pick: (r: AiTaskRow) => StoredPrediction<{ available: boolean; level?: Level }> | null, level: Level) =>
    rows.filter((r) => { const p = pick(r); return p?.value.available && p.value.level === level; }).length;
  const summaryContent = summary.data ? summarySchema.safeParse(summary.data.content) : null;

  return {
    flags,
    tasks: rows,
    counts: {
      active: rows.length,
      highDelay: count((r) => r.delay, "HIGH"),
      mediumDelay: count((r) => r.delay, "MEDIUM"),
      highFailure: count((r) => r.failure, "HIGH"),
      atRisk: rows.filter((r) => levelOf(r.delay) === 3 || levelOf(r.failure) === 3).length,
      withoutEstimate: rows.filter((r) => !r.delay?.value.available && !r.failure?.value.available).length,
    },
    forecast: forecast.data && flags.features.forecast.enabled ? parse(forecast.data, forecastValue) : null,
    anomalies: (flags.features.anomalies.enabled ? (anomalies.data ?? []) : []).flatMap((a) => {
      const value = anomalyValue.safeParse(a.prediction_value);
      return value.success ? [{ id: a.id, entityType: a.entity_type, entityId: a.entity_id, generatedAt: a.generated_at, detail: factorsOf(a.explanation)[0] ?? "", ...value.data }] : [];
    }),
    recommendations: { rows: pending.data ?? [], total: pending.count ?? 0 },
    summary: summary.data && summaryContent?.success ? { content: summaryContent.data, provider: summary.data.provider, model: summary.data.model, generatedAt: summary.data.generated_at } : null,
    lastRun: lastRun.data,
    /** No successful refresh in the last hour: the screen says so rather than presenting old estimates as current. */
    runIsOld: !lastRun.data?.finished_at || Date.now() - Date.parse(lastRun.data.finished_at) > 60 * 60_000,
    workload: (workload?.data ?? [])
      .map((w) => ({ ...w, active_tasks: Number(w.active_tasks), due_today: Number(w.due_today), overdue: Number(w.overdue), in_field: Number(w.in_field) }))
      .map((w) => ({ ...w, pressure: workloadPressure(w) }))
      .sort((a, b) => RANK[b.pressure.level] - RANK[a.pressure.level] || b.active_tasks - a.active_tasks),
  };
}

export const RECOMMENDATION_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
export const RECOMMENDATION_PAGE_SIZE = 20;

export async function listRecommendations(status: (typeof RECOMMENDATION_STATUSES)[number] | undefined, page: number) {
  const supabase = await createClient();
  const { from, to } = pageRange(page, RECOMMENDATION_PAGE_SIZE);
  let query = supabase
    .from("ai_recommendations")
    .select("id, recommendation_type, entity_type, entity_id, title, description, reasoning, confidence, status, created_at, reviewed_at, review_notes, model_name, model_version, reviewer:profiles(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status) query = query.eq("status", status);
  return fetchPage(query, "recommendations");
}

/** Settings page: flags, model registry, recent runs, usage and the evaluation foundation. */
export async function getAiAdministration() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [flags, settings, models, runs, usage, evaluation, stale, feedback] = await Promise.all([
    getAiFlags(supabase),
    supabase.from("ai_settings").select("key, enabled, description, updated_at").order("key"),
    supabase.from("ai_models").select("name, version, model_type, status, feature_version, description, created_at").order("name"),
    supabase.from("ai_runs").select("id, kind, status, trigger, started_at, duration_ms, predictions, insufficient, recommendations, provider, model, input_tokens, output_tokens, error").order("started_at", { ascending: false }).limit(12),
    supabase.from("ai_runs").select("kind, status, duration_ms, predictions, insufficient, input_tokens, output_tokens").gte("started_at", since).limit(5000),
    supabase.from("ai_evaluation").select("*"),
    supabase.from("ai_current_predictions").select("id", { count: "exact", head: true }).eq("is_stale", true).in("prediction_type", ["TASK_DELAY_RISK", "TASK_FAILURE_RISK", "TASK_ETA"]),
    supabase.from("ai_feedback").select("rating").limit(5000),
  ]);
  const u = usage.data ?? [];
  const sum = (pick: (r: (typeof u)[number]) => number | null) => u.reduce((total, r) => total + (pick(r) ?? 0), 0);
  const durations = u.flatMap((r) => (r.duration_ms === null ? [] : [r.duration_ms]));
  return {
    flags,
    settings: settings.data ?? [],
    models: models.data ?? [],
    runs: runs.data ?? [],
    usage: {
      runs: u.length,
      failed: u.filter((r) => r.status === "FAILED").length,
      predictions: sum((r) => r.predictions),
      insufficient: sum((r) => r.insufficient),
      averageMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      inputTokens: sum((r) => r.input_tokens),
      outputTokens: sum((r) => r.output_tokens),
      modelCalls: u.filter((r) => r.kind === "SUMMARY" && r.input_tokens !== null).length,
    },
    evaluation: evaluation.data ?? [],
    stalePredictions: stale.count ?? 0,
    feedback: {
      useful: (feedback.data ?? []).filter((f) => f.rating === "USEFUL").length,
      notUseful: (feedback.data ?? []).filter((f) => f.rating === "NOT_USEFUL").length,
      incorrect: (feedback.data ?? []).filter((f) => f.rating === "INCORRECT").length,
    },
    provider: summaryProvider(),
  };
}
