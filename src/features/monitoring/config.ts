import type { TaskStatus } from "@/features/tasks/constants";

/** A last-known location older than this is labelled as possibly stale. */
export const LOCATION_STALE_AFTER_SECONDS = 5 * 60;

/** Default monitoring scope: everything assigned and not yet finished. */
export const MONITOR_STATUSES = ["IN_PROGRESS", "CHECKED_IN", "ARRIVED", "ON_THE_WAY", "ACCEPTED", "ASSIGNED"] as const satisfies readonly TaskStatus[];

/** Statuses during which the agent's location is shared (mirrors agent_record_location). */
export const TRACKED_STATUSES = ["ON_THE_WAY", "ARRIVED", "CHECKED_IN", "IN_PROGRESS"] as const satisfies readonly TaskStatus[];

/** Group order on the monitoring screen: most advanced field work first, then outcomes. */
export const STATUS_GROUP_ORDER: readonly TaskStatus[] = [
  ...MONITOR_STATUSES,
  "PARTIALLY_COMPLETED",
  "FAILED",
  "COMPLETED",
  "VERIFIED",
  "RESCHEDULED",
  "CANCELLED",
  "DRAFT",
];

export const MAP_MARKER_LIMIT = 200;

export function isStale(recordedAt: string, now: number) {
  return now - Date.parse(recordedAt) > LOCATION_STALE_AFTER_SECONDS * 1000;
}

/** "just now", "2 min ago", "3 h ago", "2 d ago". */
export function timeAgo(at: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export type AgentState = {
  label: "Inactive" | "Available" | "Assigned" | "On the way" | "At location" | "Working" | "Completed";
  tone: "muted" | "info" | "success" | "warning";
  /** Sharing is expected in this state, so a missing or old location is worth flagging. */
  tracked: boolean;
};

/** Operational status derived from the agent's furthest-along open task. */
export function agentState(
  agent: { is_active: boolean | null; account_active: boolean | null; current_task_status: TaskStatus | null; last_completed_at: string | null },
  today: (instant: string) => boolean,
): AgentState {
  if (!agent.is_active || !agent.account_active) return { label: "Inactive", tone: "muted", tracked: false };
  switch (agent.current_task_status) {
    case "ON_THE_WAY":
      return { label: "On the way", tone: "info", tracked: true };
    case "ARRIVED":
    case "CHECKED_IN":
      return { label: "At location", tone: "info", tracked: true };
    case "IN_PROGRESS":
      return { label: "Working", tone: "success", tracked: true };
    case "ASSIGNED":
    case "ACCEPTED":
      return { label: "Assigned", tone: "muted", tracked: false };
    default:
      return agent.last_completed_at && today(agent.last_completed_at)
        ? { label: "Completed", tone: "success", tracked: false }
        : { label: "Available", tone: "muted", tracked: false };
  }
}

/**
 * What the admin monitoring screens listen to — one channel per screen.
 * Deletes are not subscribed: operational rows are never deleted.
 */
export const MONITORING_BINDINGS = [
  { table: "tasks", event: "INSERT" },
  { table: "tasks", event: "UPDATE" },
  { table: "agent_location_events", event: "INSERT" },
  { table: "checkins", event: "INSERT" },
  { table: "task_products", event: "UPDATE" },
  { table: "cash_collections", event: "INSERT" },
  { table: "cash_collections", event: "UPDATE" },
  { table: "task_proofs", event: "INSERT" },
] as const;

/** The map only needs task status changes and new location events. */
export const MAP_BINDINGS = [
  { table: "tasks", event: "UPDATE" },
  { table: "agent_location_events", event: "INSERT" },
] as const;

/** One task, for the admin task page. */
export function taskBindings(taskId: string) {
  return [
    { table: "tasks", event: "UPDATE", filter: `id=eq.${taskId}` },
    { table: "task_status_history", event: "INSERT", filter: `task_id=eq.${taskId}` },
    { table: "agent_location_events", event: "INSERT", filter: `task_id=eq.${taskId}` },
    { table: "checkins", event: "INSERT", filter: `task_id=eq.${taskId}` },
    { table: "task_products", event: "UPDATE", filter: `task_id=eq.${taskId}` },
    { table: "cash_collections", event: "INSERT", filter: `task_id=eq.${taskId}` },
    { table: "cash_collections", event: "UPDATE", filter: `task_id=eq.${taskId}` },
    { table: "task_proofs", event: "INSERT", filter: `task_id=eq.${taskId}` },
  ] as const;
}
