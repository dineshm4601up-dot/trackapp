import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { siteConfig } from "@/config/site";
import { getAiFlags } from "@/lib/ai/flags";
import {
  forecastWorkload,
  predictDelayRisk,
  predictEta,
  predictFailureRisk,
  workloadPressure,
  type AgentWorkload,
  type Prediction,
  type TaskFeatures,
  type VolumeHistory,
} from "@/lib/ai/models";
import { modelSummary, summaryProvider, templateSummary, type SummaryContent, type SummaryFacts } from "@/lib/ai/summary";
import { businessToday } from "@/lib/format";
import type { Database, Json } from "@/types/database.types";

// One prediction cycle: read features → run the models → store results. It is
// called by an admin (their session, so RLS applies) or by the scheduled job
// (service client). It only ever writes to the ai_* tables.

type Client = SupabaseClient<Database>;
export type RunTrigger = "MANUAL" | "SCHEDULED";

const ORGANISATION_ID = "00000000-0000-0000-0000-000000000000";
const num = z.coerce.number();
const nullableNum = z.coerce.number().nullable();

const featureSchema = z.object({
  task_id: z.string(), task_code: z.string(), title: z.string(), task_type: z.string(), status: z.string(),
  agent_id: z.string().nullable(), agent_name: z.string().nullable(), location_id: z.string().nullable(),
  location_name: z.string().nullable(), due_at: z.string().nullable(),
  minutes_to_due: nullableNum, is_overdue: z.boolean(), stage_entered_at: z.string().nullable(), minutes_in_stage: nullableNum,
  checkin_rejected: num, checkin_ok: z.boolean(), baseline_scope: z.enum(["TYPE", "ALL"]),
  remaining_samples: z.preprocess((v) => v ?? 0, num),
  remaining_p25_minutes: nullableNum, remaining_median_minutes: nullableNum, remaining_p75_minutes: nullableNum,
  type_closed: num, type_failed: num, type_scheduled_completed: num, type_late: num,
  location_closed: num, location_failed: num, all_closed: num, all_failed: num,
});
type FeatureRow = z.infer<typeof featureSchema>;

const workloadSchema = z.object({ agent_id: z.string(), agent_name: z.string().nullable(), active_tasks: num, due_today: num, overdue: num, in_field: num });
const volumeSchema = z.object({
  today: z.string(),
  days: z.array(z.object({ day: z.string(), total: num })),
  by_type: z.array(z.object({ key: z.string(), n: num })),
  by_location: z.array(z.object({ key: z.string().nullable(), n: num })),
});
const anomalySchema = z.object({
  kind: z.string(), severity: z.enum(["low", "medium", "high"]), entity_type: z.enum(["TASK", "LOCATION", "AGENT", "ORGANISATION"]),
  entity_id: z.string(), entity_label: z.string().nullable(), title: z.string(), observed: nullableNum, baseline: nullableNum,
  unit: z.string(), detail: z.string(), dedupe_key: z.string(),
});

type StoredPrediction = {
  prediction_type: string; entity_type: string; entity_id: string; value: Json; confidence: number | null;
  model_name: string; model_version: string; feature_version: string; explanation: Json; fingerprint: string; ttl_minutes: number;
};
type StoredRecommendation = {
  recommendation_type: string; entity_type: string; entity_id: string; title: string; description: string;
  reasoning: Json; confidence: number | null; dedupe_key: string; model_name: string; model_version: string;
};

function stored<T>(type: string, entityType: string, entityId: string, p: Prediction<T>): StoredPrediction {
  return {
    prediction_type: type, entity_type: entityType, entity_id: entityId, value: p.value as Json, confidence: p.confidence,
    model_name: p.model.name, model_version: p.model.version, feature_version: p.model.featureVersion,
    explanation: { factors: p.factors }, fingerprint: p.fingerprint, ttl_minutes: p.ttlMinutes,
  };
}

/** Attention rules: which tasks, agents' schedules and anomalies an administrator should look at. Advice only. */
function recommendationsFor(
  rows: FeatureRow[],
  predictions: Map<string, { delay?: Prediction<{ level: string }>; failure?: Prediction<{ level: string }> }>,
  workload: AgentWorkload[],
  anomalies: z.infer<typeof anomalySchema>[],
  today: string,
): StoredRecommendation[] {
  const out: StoredRecommendation[] = [];
  const rule = { model_name: "attention-rules", model_version: "1.0" };
  for (const row of rows) {
    const p = predictions.get(row.task_id);
    const reasons: string[] = [];
    let confidence: number | null = null;
    if (p?.delay?.value.available && p.delay.value.level === "HIGH") {
      reasons.push(row.is_overdue ? "Past its scheduled time and still open" : "High estimated delay risk", ...p.delay.factors);
      confidence = p.delay.confidence;
    }
    if (p?.failure?.value.available && p.failure.value.level === "HIGH") {
      reasons.push("High estimated failure risk", ...p.failure.factors.slice(0, 2));
      confidence ??= p.failure.confidence;
    }
    if (row.checkin_rejected >= 2 && !row.checkin_ok) reasons.push(`${row.checkin_rejected} check-in attempts were rejected and none has been accepted`);
    if (reasons.length === 0) continue;
    out.push({
      recommendation_type: "TASK_ATTENTION", entity_type: "TASK", entity_id: row.task_id,
      title: `Task #${row.task_code} needs attention`,
      description: reasons[0]!,
      // The stored priority of the task is not touched: this is a separate, advisory attention level.
      reasoning: { recommended_attention: "HIGH", reasons },
      confidence, dedupe_key: `attention:${row.task_id}:${today}`, ...rule,
    });
  }
  for (const w of workload) {
    const pressure = workloadPressure(w);
    if (pressure.level !== "HIGH") continue;
    out.push({
      recommendation_type: "WORKLOAD_PRESSURE", entity_type: "AGENT", entity_id: w.agent_id,
      title: `High workload pressure on ${w.agent_name ?? "an agent"}'s schedule`,
      description: `${pressure.reasons.join(", ")}. Consider reviewing the schedule.`,
      reasoning: { workload_pressure: "HIGH", reasons: pressure.reasons },
      confidence: null, dedupe_key: `workload:${w.agent_id}:${today}`, ...rule,
    });
  }
  for (const a of anomalies) {
    if (a.severity !== "high") continue;
    out.push({
      recommendation_type: "ANOMALY_REVIEW", entity_type: a.entity_type, entity_id: a.entity_id,
      title: `Operational anomaly: ${a.title}`,
      description: a.detail,
      reasoning: { observed: a.observed, baseline: a.baseline, unit: a.unit, subject: a.entity_label },
      confidence: null, dedupe_key: `anomaly:${a.dedupe_key}`, ...rule,
    });
  }
  return out;
}

export type RunResult =
  | { ok: true; predictions: number; insufficient: number; recommendations: number; outcomes: number }
  | { ok: false; code: "AI_DISABLED" | "RATE_LIMITED" | "NOT_ALLOWED" | "FAILED"; message: string };

const RUN_ERRORS: Record<string, { code: "AI_DISABLED" | "RATE_LIMITED" | "NOT_ALLOWED"; message: string }> = {
  AI_DISABLED: { code: "AI_DISABLED", message: "AI features are switched off." },
  RATE_LIMITED: { code: "RATE_LIMITED", message: "Predictions were refreshed a moment ago. Please wait a little before refreshing again." },
  NOT_ALLOWED: { code: "NOT_ALLOWED", message: "You are not allowed to do this." },
};

/** Runs every enabled model once and stores the results. Safe to call repeatedly: it is rate limited in the database. */
export async function runPredictions(supabase: Client, trigger: RunTrigger): Promise<RunResult> {
  const flags = await getAiFlags(supabase);
  if (!flags.enabled) return { ok: false, ...RUN_ERRORS.AI_DISABLED! };

  const begin = await supabase.rpc("ai_begin_run", { p_kind: "PREDICTIONS", p_trigger: trigger, p_min_interval_seconds: trigger === "MANUAL" ? 20 : 60 });
  if (begin.error) return { ok: false, ...(RUN_ERRORS[begin.error.message] ?? { code: "FAILED" as const, message: "Predictions could not be started." }) };
  const runId = begin.data;
  const tz = { p_tz: siteConfig.timeZone };

  try {
    const needTasks = flags.features.task_risk.enabled || flags.features.eta.enabled || flags.features.recommendations.enabled;
    const [features, workload, volume, anomalies] = await Promise.all([
      needTasks ? supabase.rpc("ai_task_features", tz) : null,
      flags.features.recommendations.enabled ? supabase.rpc("ai_agent_workload", tz) : null,
      flags.features.forecast.enabled ? supabase.rpc("ai_volume_history", tz) : null,
      flags.features.anomalies.enabled ? supabase.rpc("ai_detect_anomalies", tz) : null,
    ]);
    for (const result of [features, workload, volume, anomalies]) if (result?.error) throw new Error(result.error.message);

    const rows = z.array(featureSchema).parse(features?.data ?? []);
    const now = new Date();
    const items: StoredPrediction[] = [];
    const byTask = new Map<string, { delay?: Prediction<{ level: string }>; failure?: Prediction<{ level: string }> }>();
    for (const row of rows) {
      const f: TaskFeatures = row;
      const entry: { delay?: Prediction<{ level: string }>; failure?: Prediction<{ level: string }> } = {};
      if (flags.features.task_risk.enabled) {
        entry.delay = predictDelayRisk(f);
        entry.failure = predictFailureRisk(f);
        items.push(stored("TASK_DELAY_RISK", "TASK", row.task_id, entry.delay), stored("TASK_FAILURE_RISK", "TASK", row.task_id, entry.failure));
      }
      if (flags.features.eta.enabled) {
        const eta = predictEta(f, now);
        // "Not applicable yet" is not a prediction worth storing.
        if (eta.value.available || eta.value.reason !== "NOT_APPLICABLE") items.push(stored("TASK_ETA", "TASK", row.task_id, eta));
      }
      byTask.set(row.task_id, entry);
    }
    if (volume?.data) items.push(stored("WORKLOAD_FORECAST", "ORGANISATION", ORGANISATION_ID, forecastWorkload(volumeSchema.parse(volume.data) as VolumeHistory)));
    const anomalyRows = z.array(anomalySchema).parse(anomalies?.data ?? []);
    for (const a of anomalyRows) {
      items.push({
        prediction_type: "ANOMALY", entity_type: a.entity_type, entity_id: a.entity_id,
        value: { available: true, kind: a.kind, severity: a.severity, title: a.title, subject: a.entity_label, observed: a.observed, baseline: a.baseline, unit: a.unit },
        confidence: null, model_name: "operational-anomalies", model_version: "1.0", feature_version: "1",
        explanation: { factors: [a.detail] }, fingerprint: a.dedupe_key, ttl_minutes: 1440,
      });
    }

    const insufficient = items.filter((item) => (item.value as { available?: boolean }).available === false).length;
    const saved = items.length ? await supabase.rpc("ai_store_predictions", { p_items: items as unknown as Json }) : { data: 0, error: null };
    if (saved.error) throw new Error(saved.error.message);

    let recommendations = 0;
    if (flags.features.recommendations.enabled) {
      const recs = recommendationsFor(rows, byTask, z.array(workloadSchema).parse(workload?.data ?? []), anomalyRows, businessToday());
      const result = await supabase.rpc("ai_store_recommendations", { p_items: recs as unknown as Json });
      if (result.error) throw new Error(result.error.message);
      recommendations = result.data;
    }
    const outcomes = await supabase.rpc("ai_record_outcomes", tz);

    await supabase.rpc("ai_finish_run", { p_run: runId, p_status: "SUCCEEDED", p_predictions: items.length, p_insufficient: insufficient, p_recommendations: recommendations });
    return { ok: true, predictions: items.length, insufficient, recommendations, outcomes: outcomes.data ?? 0 };
  } catch (error) {
    const message = (error as Error).message.slice(0, 300);
    console.error("AI prediction run failed", { message });
    await supabase.rpc("ai_finish_run", { p_run: runId, p_status: "FAILED", p_error: message });
    return { ok: false, code: "FAILED", message: "Predictions could not be refreshed. The rest of the application is not affected." };
  }
}

// ---------------------------------------------------------------- summary

const totalsSchema = z.object({
  eligible: num, completed: num, active: num, overdue: num, failed: num, partial: num, cancelled: num,
  cash_expected: num, cash_collected: num, checkin_attempts: num, checkin_rejected: num,
});

/** The figures the summary is written from: today's validated analytics plus current AI counts. */
export async function buildSummaryFacts(supabase: Client): Promise<SummaryFacts> {
  const today = businessToday();
  const nowIso = new Date().toISOString();
  const [overview, risks, anomalies, pending] = await Promise.all([
    supabase.rpc("report_overview", { p_from: today, p_to: today, p_tz: siteConfig.timeZone }),
    supabase.from("ai_current_predictions").select("prediction_type, prediction_value").in("prediction_type", ["TASK_DELAY_RISK", "TASK_FAILURE_RISK"]).eq("is_stale", false),
    supabase.from("ai_predictions").select("prediction_value").eq("prediction_type", "ANOMALY").gt("expires_at", nowIso),
    supabase.from("ai_recommendations").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
  ]);
  if (overview.error) throw new Error(overview.error.message);
  const t = totalsSchema.parse((overview.data as { totals: unknown }).totals);
  const high = (type: string) =>
    (risks.data ?? []).filter((r) => r.prediction_type === type && (r.prediction_value as { level?: string } | null)?.level === "HIGH").length;
  const kinds = [...new Set((anomalies.data ?? []).map((a) => String((a.prediction_value as { title?: string } | null)?.title ?? "")).filter(Boolean))];
  return {
    period: today,
    tasks: { scheduled: t.eligible, completed: t.completed, active: t.active, overdue: t.overdue, failed: t.failed, partially_completed: t.partial, cancelled: t.cancelled },
    cash: { expected: t.cash_expected, collected: t.cash_collected, outstanding: Math.max(0, Math.round((t.cash_expected - t.cash_collected) * 100) / 100) },
    checkins: { accepted: t.checkin_attempts - t.checkin_rejected, rejected: t.checkin_rejected },
    ai: { high_delay_risk: high("TASK_DELAY_RISK"), high_failure_risk: high("TASK_FAILURE_RISK"), anomalies: (anomalies.data ?? []).length, pending_recommendations: pending.count ?? 0 },
    anomaly_kinds: kinds,
  };
}

export type SummaryResult =
  | { ok: true; content: SummaryContent; provider: string; note: string | null }
  | { ok: false; code: string; message: string };

/**
 * Writes today's summary. A language model is used only if one is configured;
 * if it fails or its output does not pass validation, the built-in template is
 * used and the reason is recorded — the page never shows unvalidated text.
 */
export async function generateSummary(supabase: Client, trigger: RunTrigger): Promise<SummaryResult> {
  const flags = await getAiFlags(supabase);
  if (!flags.features.summary.enabled) return { ok: false, code: "AI_DISABLED", message: "The operational summary is switched off." };
  const provider = summaryProvider();
  // Language-model calls cost money: at most one every five minutes. The template is free: 20 seconds.
  const begin = await supabase.rpc("ai_begin_run", { p_kind: "SUMMARY", p_trigger: trigger, p_min_interval_seconds: provider.enabled ? 300 : 20 });
  if (begin.error) return { ok: false, ...(RUN_ERRORS[begin.error.message] ?? { code: "FAILED", message: "The summary could not be started." }) };
  const runId = begin.data;
  try {
    const facts = await buildSummaryFacts(supabase);
    let content = templateSummary(facts);
    let usedProvider = "template";
    let model: string | null = null;
    let note: string | null = null;
    let tokens: { input?: number; output?: number } = {};
    if (provider.enabled) {
      const result = await modelSummary(facts, provider.model);
      tokens = { input: result.inputTokens, output: result.outputTokens };
      if (result.ok) {
        content = result.content;
        usedProvider = provider.provider;
        model = result.model;
      } else {
        note = `${result.error} The built-in summary is shown instead.`;
      }
    }
    const saved = await supabase.rpc("ai_store_summary", { p_period: facts.period, p_content: content as Json, p_facts: facts as unknown as Json, p_provider: usedProvider, p_model: model ?? undefined });
    if (saved.error) throw new Error(saved.error.message);
    await supabase.rpc("ai_finish_run", {
      p_run: runId, p_status: "SUCCEEDED", p_predictions: 1, p_provider: usedProvider, p_model: model ?? undefined,
      p_input_tokens: tokens.input, p_output_tokens: tokens.output, p_error: note ?? undefined,
    });
    return { ok: true, content, provider: usedProvider, note };
  } catch (error) {
    const message = (error as Error).message.slice(0, 300);
    console.error("AI summary failed", { message });
    await supabase.rpc("ai_finish_run", { p_run: runId, p_status: "FAILED", p_error: message });
    return { ok: false, code: "FAILED", message: "The summary could not be generated. The rest of the application is not affected." };
  }
}
