// The one list of features the predictive models use. They are computed in
// PostgreSQL by ai_task_features() / ai_agent_workload() / ai_volume_history();
// models read them from there and never build their own ad hoc inputs.
//
// Leakage rule: every feature is known at the moment of prediction. Historical
// baselines are taken only from tasks that are already closed, and never
// include the task being predicted.

export const FEATURE_VERSION = "1";

/** Fewest similar finished tasks before a time-based estimate is made at all. */
export const MIN_DURATION_SAMPLES = 5;
/** Fewest closed tasks of the same type before its own failure rate is used. */
export const MIN_TYPE_SAMPLES = 5;
/** Fewest closed tasks overall before the organisation-wide rate may stand in. */
export const MIN_OVERALL_SAMPLES = 10;
export const HISTORY_DAYS = 180;

export type FeatureDefinition = {
  name: string;
  type: "number" | "boolean" | "category";
  source: string;
  calculation: string;
  /** When the value exists, relative to the moment of prediction. */
  availability: string;
  missing: string;
};

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  { name: "status", type: "category", source: "tasks.status", calculation: "Current workflow stage of the task.", availability: "Now", missing: "Never missing." },
  { name: "task_type", type: "category", source: "tasks.task_type", calculation: "As stored.", availability: "At task creation", missing: "Never missing." },
  { name: "minutes_to_due", type: "number", source: "tasks.scheduled_date + end / start time", calculation: "Minutes from now until the scheduled end (or start, or end of day), in the business time zone.", availability: "Now", missing: "No schedule → delay risk is N/A (NO_SCHEDULE)." },
  { name: "is_overdue", type: "boolean", source: "minutes_to_due", calculation: "Open and past its scheduled time.", availability: "Now", missing: "False when unscheduled." },
  { name: "minutes_in_stage", type: "number", source: "task timestamps, task_status_history", calculation: "Minutes since the task entered its current stage.", availability: "Now", missing: "No stage timestamp → prediction is N/A (DATA_QUALITY)." },
  { name: "remaining_median_minutes", type: "number", source: `closed tasks of the same type, last ${HISTORY_DAYS} days`, calculation: "Median time finished tasks took from this stage to completion (25th and 75th percentiles alongside).", availability: "History before now", missing: `Fewer than ${MIN_DURATION_SAMPLES} samples of the type → all types are used; still too few → N/A (INSUFFICIENT_DATA).` },
  { name: "remaining_samples", type: "number", source: "same as above", calculation: "Number of finished tasks behind the duration estimate.", availability: "History before now", missing: "0." },
  { name: "type_failure_rate", type: "number", source: `closed tasks of the same type, last ${HISTORY_DAYS} days`, calculation: "Failed ÷ closed, smoothed towards the overall rate.", availability: "History before now", missing: `Fewer than ${MIN_TYPE_SAMPLES} → overall rate if at least ${MIN_OVERALL_SAMPLES} closed tasks exist, else N/A.` },
  { name: "location_failure_rate", type: "number", source: "closed tasks at the same location", calculation: "Failed ÷ closed at the location.", availability: "History before now", missing: "Fewer than 5 → not used." },
  { name: "type_late_rate", type: "number", source: "completed tasks of the type that had a scheduled end", calculation: "Completed late ÷ completed with a scheduled end.", availability: "History before now", missing: "Fewer than 5 → not used." },
  { name: "checkin_rejected", type: "number", source: "checkins", calculation: "Rejected check-in attempts on this task so far.", availability: "Now", missing: "0." },
  { name: "agent_open_tasks", type: "number", source: "tasks", calculation: "Open tasks, tasks due today and overdue tasks per agent.", availability: "Now", missing: "0." },
  { name: "daily_task_volume", type: "number", source: "tasks by task date", calculation: "Eligible tasks per day for the last 56 days, and tasks already scheduled for the next 7.", availability: "History before today", missing: "0 for a day without tasks." },
];

/** Not used by any model, by design. */
export const EXCLUDED_INPUTS = [
  "agent location history (agent_location_events)",
  "any personal attribute of an agent or customer (name, phone, e-mail, age, gender)",
  "completed_at or any other value recorded after the moment of prediction",
];
