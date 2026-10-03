import { FEATURE_VERSION, MIN_DURATION_SAMPLES, MIN_OVERALL_SAMPLES, MIN_TYPE_SAMPLES } from "@/lib/ai/features";

// Version 1 models. They are transparent statistics over the organisation's own
// history — not trained machine-learning models — because that is the simplest
// method that is honest at the current data volume. Each is marked
// EXPERIMENTAL in the registry until enough evaluated predictions exist.
//
// Pure functions: features in, prediction out. No database, no clock other
// than the `now` passed in, nothing that can change a task.

export type Level = "LOW" | "MEDIUM" | "HIGH";

export type Unavailable = {
  available: false;
  reason: "INSUFFICIENT_DATA" | "NO_SCHEDULE" | "DATA_QUALITY" | "NOT_APPLICABLE";
  detail: string;
};

export type TaskFeatures = {
  task_id: string;
  task_code: string;
  task_type: string;
  status: string;
  agent_id: string | null;
  location_id: string | null;
  due_at: string | null;
  minutes_to_due: number | null;
  is_overdue: boolean;
  stage_entered_at: string | null;
  minutes_in_stage: number | null;
  checkin_rejected: number;
  checkin_ok: boolean;
  baseline_scope: "TYPE" | "ALL";
  remaining_samples: number;
  remaining_p25_minutes: number | null;
  remaining_median_minutes: number | null;
  remaining_p75_minutes: number | null;
  type_closed: number;
  type_failed: number;
  type_scheduled_completed: number;
  type_late: number;
  location_closed: number;
  location_failed: number;
  all_closed: number;
  all_failed: number;
};

export type Prediction<T> = {
  model: { name: string; version: string; featureVersion: string };
  value: ({ available: true } & T) | Unavailable;
  /** How much history supports the estimate (0–1). Not a probability of the outcome. */
  confidence: number | null;
  /** Plain-language reasons, each derived from a real input. */
  factors: string[];
  fingerprint: string;
  ttlMinutes: number;
};

const model = (name: string) => ({ name, version: "1.0", featureVersion: FEATURE_VERSION });
const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
const minutes = (value: number) => {
  const m = Math.max(0, Math.round(value));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
const typeLabel = (type: string) => type.toLowerCase().replace(/_/g, " ");

/** The data-quality gate: a prediction is refused rather than made on a record that cannot support it. */
function qualityProblem(f: TaskFeatures): Unavailable | null {
  if (!f.agent_id) return { available: false, reason: "DATA_QUALITY", detail: "The task has no agent." };
  if (!f.location_id) return { available: false, reason: "DATA_QUALITY", detail: "The task has no location." };
  if (!f.stage_entered_at || f.minutes_in_stage === null || f.minutes_in_stage < 0) {
    return { available: false, reason: "DATA_QUALITY", detail: "The time the task entered its current stage is not recorded." };
  }
  return null;
}

/** Share of history behind an estimate: grows with the number of samples and is lower for a cross-type baseline. */
function support(samples: number, saturation: number, scope: "TYPE" | "ALL") {
  return round((0.5 + 0.4 * Math.min(1, samples / saturation)) * (scope === "ALL" ? 0.85 : 1), 2);
}

/**
 * Time the task is still expected to need: what similar tasks took from this
 * stage, less the time already spent in it. A task that has already been in
 * the stage longer than usual is assumed to need at least a quarter more.
 */
function remaining(typical: number, inStage: number) {
  return Math.max(typical - inStage, typical * 0.25);
}

function unavailable<T>(name: string, value: Unavailable, ttlMinutes: number): Prediction<T> {
  return { model: model(name), value, confidence: null, factors: [value.detail], fingerprint: `NA:${value.reason}`, ttlMinutes };
}

// ---------------------------------------------------------------- delay risk

export type DelayRisk = { level: Level; expected_remaining_minutes: number | null; minutes_to_due: number };

export function predictDelayRisk(f: TaskFeatures): Prediction<DelayRisk> {
  const name = "task-delay-risk";
  const ttl = 30;
  if (f.minutes_to_due === null || !f.due_at) {
    return unavailable(name, { available: false, reason: "NO_SCHEDULE", detail: "The task has no scheduled date, so it cannot be late." }, ttl);
  }
  if (f.is_overdue) {
    // A fact, not an estimate: no history is needed.
    return {
      model: model(name),
      value: { available: true, level: "HIGH", expected_remaining_minutes: null, minutes_to_due: f.minutes_to_due },
      confidence: 0.95,
      factors: [`The scheduled time passed ${minutes(-f.minutes_to_due)} ago and the task is still open.`],
      fingerprint: "HIGH:overdue",
      ttlMinutes: ttl,
    };
  }
  const problem = qualityProblem(f);
  if (problem) return unavailable(name, problem, ttl);
  if (f.remaining_samples < MIN_DURATION_SAMPLES || f.remaining_median_minutes === null || f.remaining_p75_minutes === null) {
    return unavailable(
      name,
      { available: false, reason: "INSUFFICIENT_DATA", detail: `Only ${f.remaining_samples} similar finished task(s) to compare with; at least ${MIN_DURATION_SAMPLES} are needed.` },
      ttl,
    );
  }

  const inStage = f.minutes_in_stage ?? 0;
  const typical = remaining(f.remaining_median_minutes, inStage);
  const slow = remaining(f.remaining_p75_minutes, inStage);
  const left = f.minutes_to_due;
  const lateRate = f.type_scheduled_completed >= 5 ? f.type_late / f.type_scheduled_completed : null;

  let level: Level = typical >= left ? "HIGH" : slow >= left || typical >= 0.7 * left ? "MEDIUM" : "LOW";
  const scope = f.baseline_scope === "TYPE" ? `${typeLabel(f.task_type)} tasks` : "tasks of all types";
  const factors = [
    `${minutes(left)} remain until the scheduled time.`,
    `From this stage, similar ${scope} typically needed ${minutes(f.remaining_median_minutes)} to finish (median of ${f.remaining_samples}; a quarter needed more than ${minutes(f.remaining_p75_minutes)}).`,
    `The task has been in its current stage for ${minutes(inStage)}, so about ${minutes(typical)} more is expected.`,
  ];
  if (lateRate !== null && lateRate >= 0.5) {
    if (level === "LOW") level = "MEDIUM";
    factors.push(`${Math.round(lateRate * 100)}% of ${typeLabel(f.task_type)} tasks with a scheduled end finished late (${f.type_late} of ${f.type_scheduled_completed}).`);
  }
  return {
    model: model(name),
    value: { available: true, level, expected_remaining_minutes: round(typical), minutes_to_due: left },
    confidence: support(f.remaining_samples, 30, f.baseline_scope),
    factors,
    fingerprint: level,
    ttlMinutes: ttl,
  };
}

// ---------------------------------------------------------------- failure risk

export type FailureRisk = { level: Level; estimated_rate: number; based_on: number };

export function predictFailureRisk(f: TaskFeatures): Prediction<FailureRisk> {
  const name = "task-failure-risk";
  const ttl = 360;
  const problem = qualityProblem(f);
  if (problem) return unavailable(name, problem, ttl);
  if (f.all_closed < MIN_OVERALL_SAMPLES && f.type_closed < MIN_TYPE_SAMPLES) {
    return unavailable(
      name,
      { available: false, reason: "INSUFFICIENT_DATA", detail: `Only ${f.all_closed} closed task(s) in the history; at least ${MIN_OVERALL_SAMPLES} are needed (or ${MIN_TYPE_SAMPLES} of this type).` },
      ttl,
    );
  }
  const overall = f.all_closed > 0 ? f.all_failed / f.all_closed : 0;
  // Smoothing: with few tasks of the type the estimate leans on the overall rate (5 pseudo-tasks).
  const smooth = (failed: number, closed: number) => (failed + 5 * overall) / (closed + 5);
  const useType = f.type_closed >= MIN_TYPE_SAMPLES;
  const typeRate = useType ? smooth(f.type_failed, f.type_closed) : overall;
  const useLocation = f.location_closed >= 5;
  const rate = useLocation ? (typeRate + smooth(f.location_failed, f.location_closed)) / 2 : typeRate;
  const level: Level = rate >= 0.3 ? "HIGH" : rate >= 0.1 ? "MEDIUM" : "LOW";

  const factors = [
    useType
      ? `${f.type_failed} of ${f.type_closed} closed ${typeLabel(f.task_type)} tasks failed in the last 180 days.`
      : `Too few ${typeLabel(f.task_type)} tasks to judge the type; the overall rate is used (${f.all_failed} of ${f.all_closed} closed tasks failed).`,
  ];
  if (useLocation) factors.push(`${f.location_failed} of ${f.location_closed} closed tasks at this location failed.`);
  if (f.checkin_rejected > 0 && !f.checkin_ok) {
    factors.push(`${f.checkin_rejected} check-in attempt(s) on this task were rejected so far (noted; not part of the estimate).`);
  }
  factors.push("This is how often similar tasks failed in the past, not a certainty about this task.");
  const basedOn = useType ? f.type_closed : f.all_closed;
  return {
    model: model(name),
    value: { available: true, level, estimated_rate: round(rate, 3), based_on: basedOn },
    confidence: round(0.4 + 0.5 * Math.min(1, basedOn / 50), 2),
    factors,
    fingerprint: `${level}:${Math.round(rate * 100)}`,
    ttlMinutes: ttl,
  };
}

// ---------------------------------------------------------------- ETA

export type Eta = { eta: string; earliest: string; latest: string; label: "Operational ETA" };

const ETA_STATUSES = ["ON_THE_WAY", "ARRIVED", "CHECKED_IN", "IN_PROGRESS"];

export function predictEta(f: TaskFeatures, now: Date): Prediction<Eta> {
  const name = "task-eta";
  const ttl = 30;
  if (!ETA_STATUSES.includes(f.status)) {
    return unavailable(name, { available: false, reason: "NOT_APPLICABLE", detail: "An ETA is estimated once the agent is on the way." }, ttl);
  }
  const problem = qualityProblem(f);
  if (problem) return unavailable(name, problem, ttl);
  if (f.remaining_samples < MIN_DURATION_SAMPLES || f.remaining_median_minutes === null || f.remaining_p25_minutes === null || f.remaining_p75_minutes === null) {
    return unavailable(
      name,
      { available: false, reason: "INSUFFICIENT_DATA", detail: `Only ${f.remaining_samples} similar finished task(s) to compare with; at least ${MIN_DURATION_SAMPLES} are needed.` },
      ttl,
    );
  }
  const inStage = f.minutes_in_stage ?? 0;
  const at = (m: number) => new Date(now.getTime() + m * 60_000);
  const typical = remaining(f.remaining_median_minutes, inStage);
  const fast = Math.min(typical, remaining(f.remaining_p25_minutes, inStage));
  const slow = Math.max(typical, remaining(f.remaining_p75_minutes, inStage));
  const overrun = inStage > f.remaining_p75_minutes;
  const scope = f.baseline_scope === "TYPE" ? `${typeLabel(f.task_type)} tasks` : "tasks of all types";
  const factors = [
    `From this stage, similar ${scope} needed ${minutes(f.remaining_p25_minutes)}–${minutes(f.remaining_p75_minutes)} to finish (median ${minutes(f.remaining_median_minutes)}, ${f.remaining_samples} tasks).`,
    `The task has been in this stage for ${minutes(inStage)}.`,
    "Based on past task durations only; live traffic is not used.",
  ];
  if (overrun) factors.push("It has already been in this stage longer than three quarters of similar tasks, so the estimate is less reliable.");
  const eta = at(typical);
  return {
    model: model(name),
    value: { available: true, eta: eta.toISOString(), earliest: at(fast).toISOString(), latest: at(slow).toISOString(), label: "Operational ETA" },
    confidence: round(support(f.remaining_samples, 30, f.baseline_scope) * (overrun ? 0.7 : 1), 2),
    factors,
    // Refreshed in place while the estimate stays within the same 10-minute slot.
    fingerprint: `ETA:${Math.floor(eta.getTime() / 600_000)}`,
    ttlMinutes: ttl,
  };
}

// ---------------------------------------------------------------- workload pressure

export type AgentWorkload = { agent_id: string; agent_name: string | null; active_tasks: number; due_today: number; overdue: number; in_field: number };

export const WORKLOAD_THRESHOLDS = {
  HIGH: { overdue: 2, dueToday: 8, active: 12 },
  MEDIUM: { overdue: 1, dueToday: 5, active: 7 },
} as const;

/** A workload indicator from open-task counts. It describes the schedule, not the person. */
export function workloadPressure(w: AgentWorkload): { level: Level; reasons: string[] } {
  const reasons: string[] = [];
  const over = (t: (typeof WORKLOAD_THRESHOLDS)[keyof typeof WORKLOAD_THRESHOLDS]) =>
    w.overdue >= t.overdue || w.due_today >= t.dueToday || w.active_tasks >= t.active;
  const level: Level = over(WORKLOAD_THRESHOLDS.HIGH) ? "HIGH" : over(WORKLOAD_THRESHOLDS.MEDIUM) ? "MEDIUM" : "LOW";
  reasons.push(`${w.active_tasks} open task${w.active_tasks === 1 ? "" : "s"}`);
  if (w.due_today) reasons.push(`${w.due_today} due today`);
  if (w.overdue) reasons.push(`${w.overdue} overdue`);
  return { level, reasons };
}

// ---------------------------------------------------------------- workload forecast

export type VolumeHistory = { today: string; days: { day: string; total: number }[]; by_type: { key: string; n: number }[]; by_location: { key: string | null; n: number }[] };
export type ForecastDay = { day: string; expected: number; low: number; high: number; scheduled: number; weeks: number };
export type Forecast = {
  method: string;
  horizon_days: number;
  history_days: number;
  history_tasks: number;
  days: ForecastDay[];
  by_type: { key: string; share: number }[];
  by_location: { key: string; share: number }[];
};

export const FORECAST_MIN_TASKS = 20;
const FORECAST_MIN_WEEKS = 4;
const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Transparent baseline: for each of the next 7 days, the average number of
 * tasks on the same weekday over the previous 8 weeks, with the lowest and
 * highest of those weeks as the range. No trend or seasonality is modelled.
 */
export function forecastWorkload(history: VolumeHistory): Prediction<Forecast> {
  const name = "workload-forecast";
  const ttl = 1440;
  const totals = new Map(history.days.map((d) => [d.day, d.total]));
  const past = history.days.filter((d) => d.day < history.today);
  const historyTasks = past.reduce((sum, d) => sum + d.total, 0);
  if (historyTasks < FORECAST_MIN_TASKS) {
    return unavailable(
      name,
      { available: false, reason: "INSUFFICIENT_DATA", detail: `Only ${historyTasks} task(s) in the last ${past.length} days; at least ${FORECAST_MIN_TASKS} are needed for a forecast.` },
      ttl,
    );
  }
  const days: ForecastDay[] = [];
  for (let offset = 1; offset <= 7; offset++) {
    const day = addDays(history.today, offset);
    const samples: number[] = [];
    for (let week = 1; week <= 8; week++) {
      const earlier = addDays(day, -7 * week);
      if (earlier < history.today && totals.has(earlier)) samples.push(totals.get(earlier) ?? 0);
    }
    if (samples.length < FORECAST_MIN_WEEKS) {
      return unavailable(name, { available: false, reason: "INSUFFICIENT_DATA", detail: "Fewer than 4 weeks of history are available." }, ttl);
    }
    days.push({
      day,
      expected: round(samples.reduce((a, b) => a + b, 0) / samples.length, 1),
      low: Math.min(...samples),
      high: Math.max(...samples),
      scheduled: totals.get(day) ?? 0,
      weeks: samples.length,
    });
  }
  const shares = (rows: { key: string | null; n: number }[]) => {
    const total = rows.reduce((sum, r) => sum + r.n, 0) || 1;
    return rows.map((r) => ({ key: r.key ?? "Unknown", share: round(r.n / total, 3) }));
  };
  return {
    model: model(name),
    value: {
      available: true,
      method: "Same-weekday average over the last 8 weeks",
      horizon_days: 7,
      history_days: past.length,
      history_tasks: historyTasks,
      days,
      by_type: shares(history.by_type),
      by_location: shares(history.by_location),
    },
    confidence: round(0.4 + 0.5 * Math.min(1, historyTasks / 200), 2),
    factors: [
      `Each day is the average of the same weekday in the previous ${days[0]?.weeks ?? 8} weeks (${historyTasks} tasks in ${past.length} days).`,
      "The range is the lowest and highest of those weeks. Trends, holidays and one-off events are not modelled.",
      "“Scheduled” is what is already in the system for that day; it usually grows as tasks are created.",
    ],
    fingerprint: days.map((d) => d.expected).join(","),
    ttlMinutes: ttl,
  };
}
