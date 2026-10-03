import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// The operational summary.
//
//   database → validated analytics (report_overview, AI counts) → SummaryFacts (JSON)
//        → template (always available)  or  language model (optional)
//        → validated { summary, observations, attention_items }
//
// The language model receives only the figures below: counts and totals, no
// names, addresses, phone numbers, coordinates, payment references or ids. It
// has no database access and no tools. Its output is checked against the
// figures before it is shown; anything that does not hold up is discarded and
// the template is used instead.

export type SummaryFacts = {
  period: string;
  tasks: { scheduled: number; completed: number; active: number; overdue: number; failed: number; partially_completed: number; cancelled: number };
  cash: { expected: number; collected: number; outstanding: number };
  checkins: { accepted: number; rejected: number };
  ai: { high_delay_risk: number; high_failure_risk: number; anomalies: number; pending_recommendations: number };
  /** Anomaly kinds only, e.g. "Repeated rejected check-ins at a location". No place or person names. */
  anomaly_kinds: string[];
};

export const summarySchema = z.object({
  summary: z.string().min(1).max(700),
  observations: z.array(z.string().min(1).max(240)).max(8),
  attention_items: z.array(z.string().min(1).max(240)).max(8),
});
export type SummaryContent = z.infer<typeof summarySchema>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);

/** Deterministic summary built directly from the figures. Used when no model is configured, and as the fallback. */
export function templateSummary(facts: SummaryFacts): SummaryContent {
  const t = facts.tasks;
  const observations = [
    `${plural(t.scheduled, "task")} scheduled; ${t.completed} completed, ${t.active} still open, ${t.failed} failed, ${t.partially_completed} partially completed.`,
  ];
  if (t.cancelled) observations.push(`${plural(t.cancelled, "task")} cancelled.`);
  if (facts.cash.expected > 0) {
    observations.push(`Cash on closed tasks: ${money(facts.cash.collected)} collected of ${money(facts.cash.expected)} expected; ${money(facts.cash.outstanding)} outstanding.`);
  }
  if (facts.checkins.accepted + facts.checkins.rejected > 0) {
    observations.push(`Check-ins: ${facts.checkins.accepted} accepted, ${facts.checkins.rejected} rejected.`);
  }
  const attention: string[] = [];
  if (t.overdue) attention.push(`${plural(t.overdue, "task")} ${t.overdue === 1 ? "is" : "are"} overdue.`);
  if (facts.ai.high_delay_risk) attention.push(`${plural(facts.ai.high_delay_risk, "active task")} ${facts.ai.high_delay_risk === 1 ? "has" : "have"} a high estimated delay risk.`);
  if (facts.ai.high_failure_risk) attention.push(`${plural(facts.ai.high_failure_risk, "active task")} ${facts.ai.high_failure_risk === 1 ? "has" : "have"} a high estimated failure risk.`);
  for (const kind of facts.anomaly_kinds.slice(0, 4)) attention.push(`Operational anomaly: ${kind}.`);
  if (facts.ai.pending_recommendations) attention.push(`${plural(facts.ai.pending_recommendations, "recommendation")} waiting for review.`);
  return {
    summary:
      t.scheduled === 0
        ? "No tasks are scheduled for today."
        : `Today has ${plural(t.scheduled, "scheduled task")}: ${t.completed} completed and ${t.active} still open${t.overdue ? `, of which ${t.overdue} ${t.overdue === 1 ? "is" : "are"} overdue` : ""}.`,
    observations,
    attention_items: attention,
  };
}

// ---------------------------------------------------------------- language model (optional)

export type SummaryProviderState = { enabled: true; provider: "anthropic"; model: string } | { enabled: false; reason: string };

/** Which model writes the summary. A language model is used only when explicitly configured. */
export function summaryProvider(): SummaryProviderState {
  if ((process.env.AI_SUMMARY_PROVIDER ?? "").toLowerCase() !== "anthropic") {
    return { enabled: false, reason: "No language model is configured (AI_SUMMARY_PROVIDER); the built-in template is used." };
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { enabled: false, reason: "AI_SUMMARY_PROVIDER is set but no Anthropic credential is configured; the built-in template is used." };
  }
  return { enabled: true, provider: "anthropic", model: process.env.AI_SUMMARY_MODEL || "claude-opus-5" };
}

const SYSTEM_PROMPT = `You write a short daily operations summary for the administrators of a field-task company.

You are given one JSON object with today's figures. Write only from those figures:
- Use the numbers exactly as given. Do not calculate new numbers, percentages or averages, and do not estimate anything.
- Do not mention people, customers or places: none are in the data.
- Do not recommend changing, cancelling or reassigning any task. You may say what deserves attention.
- If a figure is zero, you may leave it out.

"summary": two sentences at most. "observations": plain facts from the figures. "attention_items": only things that need a person's attention (overdue tasks, high risks, anomalies, pending recommendations); an empty list if there are none.`;

/** Every number mentioned by the model must be one of the figures it was given. */
function allowedNumbers(facts: SummaryFacts) {
  const allowed = new Set<string>();
  const add = (value: number) => {
    allowed.add(String(value));
    allowed.add(value.toFixed(2));
    allowed.add(String(Math.round(value)));
  };
  const walk = (value: unknown) => {
    if (typeof value === "number") add(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(facts);
  for (const part of facts.period.split("-")) add(Number(part));
  return allowed;
}

export function isGrounded(content: SummaryContent, facts: SummaryFacts) {
  const allowed = allowedNumbers(facts);
  const text = [content.summary, ...content.observations, ...content.attention_items].join(" ");
  const numbers = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return numbers.every((raw) => {
    const value = Number(raw.replace(/,/g, ""));
    return allowed.has(String(value)) || allowed.has(value.toFixed(2));
  });
}

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

export type ModelSummary =
  | { ok: true; content: SummaryContent; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; inputTokens?: number; outputTokens?: number };

/** One structured request; the result is validated twice (schema, then grounding) before anyone sees it. */
export async function modelSummary(facts: SummaryFacts, model: string): Promise<ModelSummary> {
  const client = new Anthropic({ maxRetries: 1, timeout: 45_000 });
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
      output_config: { effort: "low", format: zodOutputFormat(summarySchema) },
    });
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    if (response.stop_reason === "refusal") return { ok: false, error: "The model declined the request.", ...usage };
    const parsed = summarySchema.safeParse(response.parsed_output);
    if (!parsed.success) return { ok: false, error: "The model returned a malformed summary.", ...usage };
    const content: SummaryContent = {
      summary: clean(parsed.data.summary),
      observations: parsed.data.observations.map(clean).filter(Boolean),
      attention_items: parsed.data.attention_items.map(clean).filter(Boolean),
    };
    if (!isGrounded(content, facts)) return { ok: false, error: "The model's summary contained a figure that is not in the data.", ...usage };
    return { ok: true, content, model: response.model, ...usage };
  } catch (error) {
    // Typed errors, most specific first. No key, token or request body is ever logged.
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: "The AI provider rejected the credential." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "The AI provider is rate limiting requests." };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, error: "The AI provider could not be reached." };
    if (error instanceof Anthropic.APIError) return { ok: false, error: `The AI provider returned an error (HTTP ${error.status ?? "?"}).` };
    return { ok: false, error: "The summary could not be generated." };
  }
}
