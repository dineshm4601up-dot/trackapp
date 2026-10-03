import "server-only";

import { MAP_MARKER_LIMIT, MONITOR_STATUSES, TRACKED_STATUSES } from "@/features/monitoring/config";
import type { TaskStatus } from "@/features/tasks/constants";
import type { TaskFilters } from "@/features/tasks/schemas";
import { fetchPage } from "@/lib/db-errors";
import { pageRange, searchFilter } from "@/lib/list-params";
import { withIds } from "@/lib/rows";
import { createClient } from "@/lib/supabase/server";

// Every query here runs with the caller's session, and every page that uses
// them calls requireAdmin() first. The views are security_invoker, so RLS on
// tasks, location events, check-ins, cash and proofs decides what is returned:
// an agent calling the same views would only ever see their own rows.

export const MONITOR_PAGE_SIZE = 30;

const SEARCH_COLUMNS = ["task_code", "customer_name", "customer_code", "agent_name", "employee_code", "location_name"] as const;

const MONITOR_COLUMNS = `id, task_code, task_type, status, priority, title, scheduled_date, scheduled_start_time,
  customer_name, location_name, location_city, agent_id, agent_name, employee_code, updated_at, expected_amount,
  last_accuracy_meters, last_location_at, checked_in_at, line_count, assigned_total, delivered_total,
  collected_amount, proof_count`;

/** Monitoring list: open tasks by default, or whatever the filters select. Paginated and filtered in the database. */
export async function listMonitorTasks(filters: TaskFilters) {
  const supabase = await createClient();
  const { from, to } = pageRange(filters.page, MONITOR_PAGE_SIZE);
  let query = supabase
    .from("task_monitor")
    .select(MONITOR_COLUMNS, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (filters.status) query = query.eq("status", filters.status);
  else if (!filters.date) query = query.in("status", [...MONITOR_STATUSES]);
  else query = query.neq("status", "DRAFT");
  if (filters.type) query = query.eq("task_type", filters.type);
  if (filters.agent) query = query.eq("agent_id", filters.agent);
  if (filters.customer) query = query.eq("customer_id", filters.customer);
  if (filters.location) query = query.eq("location_id", filters.location);
  if (filters.date) query = query.eq("scheduled_date", filters.date);
  if (filters.priority) query = query.eq("priority", filters.priority);
  const search = searchFilter(SEARCH_COLUMNS, filters.q);
  if (search) query = query.or(search);

  const { rows, total } = await fetchPage(query, "monitoring tasks");
  return { rows: withIds(rows), total };
}

export type MonitorTask = Awaited<ReturnType<typeof listMonitorTasks>>["rows"][number];

/**
 * Latest location per task that is currently being tracked — one row per task,
 * resolved in the database (index on task_id, recorded_at desc). History is
 * never loaded.
 */
export async function getMapPoints() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_monitor")
    .select(
      "id, task_code, task_type, status, customer_name, agent_name, last_latitude, last_longitude, last_accuracy_meters, last_location_at",
    )
    .in("status", [...TRACKED_STATUSES])
    .not("last_location_at", "is", null)
    .order("last_location_at", { ascending: false })
    .limit(MAP_MARKER_LIMIT);
  if (error) {
    console.error("Failed to load map points", { code: error.code, message: error.message });
    throw new Error("Unable to load agent locations.");
  }
  return withIds(data);
}

/** Tracked tasks that have not shared a location yet (shown beside the map, never as a marker). */
export async function getTrackedWithoutLocation() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("task_monitor")
    .select("id, task_code, status, agent_name, customer_name")
    .in("status", [...TRACKED_STATUSES])
    .is("last_location_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  return withIds(data ?? []);
}

/** One task's monitoring row (last known location etc.) for the task detail page. */
export async function getTaskMonitor(taskId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("task_monitor")
    .select("updated_at, last_latitude, last_longitude, last_accuracy_meters, last_location_at")
    .eq("id", taskId)
    .maybeSingle();
  return data;
}

/** Today's tasks (plus anything still in the field) per status, counted in the database. */
export async function getStatusCounts(today: string): Promise<Partial<Record<TaskStatus, number>> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_status_counts", { p_date: today });
  if (error) {
    console.error("Failed to load status counts", { code: error.code, message: error.message });
    return null;
  }
  return Object.fromEntries(data.map((row) => [row.status, Number(row.total)]));
}

const AGENT_COLUMNS =
  "id, full_name, employee_code, is_active, account_active, current_task_id, current_task_code, current_task_status, open_tasks, last_location_at, last_completed_at";

/** Active agents with their current task and last location time (no coordinates). */
export async function getAgentBoard(limit = 30) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_activity")
    .select(AGENT_COLUMNS)
    .eq("is_active", true)
    .eq("account_active", true)
    .order("current_task_status", { ascending: false, nullsFirst: false })
    .order("full_name")
    .limit(limit);
  if (error) {
    console.error("Failed to load agent activity", { code: error.code, message: error.message });
    return [];
  }
  return withIds(data);
}

export type AgentBoardRow = Awaited<ReturnType<typeof getAgentBoard>>[number];

/** Activity for specific agents (the page of the agent list being shown). */
export async function getAgentActivity(agentIds: string[]) {
  if (agentIds.length === 0) return new Map<string, AgentBoardRow>();
  const supabase = await createClient();
  const { data } = await supabase.from("agent_activity").select(AGENT_COLUMNS).in("id", agentIds);
  return new Map(withIds(data ?? []).map((row) => [row.id, row]));
}

/** Agents with a task in the field right now. */
export async function countAgentsInField() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("agent_activity")
    .select("id", { count: "exact", head: true })
    .in("current_task_status", [...TRACKED_STATUSES]);
  return error ? null : count;
}

/** Rendered as "<actor> <text> <task code>". */
export type ActivityItem = { id: string; at: string; taskId: string; taskCode: string; actor: string; text: string };

const STATUS_TEXT: Partial<Record<TaskStatus, string>> = {
  ASSIGNED: "assigned",
  ACCEPTED: "accepted",
  ON_THE_WAY: "started travel for",
  ARRIVED: "arrived for",
  CHECKED_IN: "checked in to",
  IN_PROGRESS: "started",
  COMPLETED: "completed",
  PARTIALLY_COMPLETED: "partially completed",
  FAILED: "reported a failure on",
  CANCELLED: "cancelled",
  RESCHEDULED: "rescheduled",
  VERIFIED: "verified",
};

/**
 * A short feed built from existing records: status history, plus proof uploads
 * and cash submissions from the audit log. Only the newest few rows of each
 * are read.
 */
export async function getRecentActivity(limit = 12): Promise<ActivityItem[]> {
  const supabase = await createClient();
  const [history, audit] = await Promise.all([
    supabase
      .from("task_status_history")
      .select("id, new_status, changed_at, task:tasks(id, task_code), actor:profiles(full_name)")
      .neq("new_status", "DRAFT")
      .order("changed_at", { ascending: false })
      .limit(limit),
    supabase
      .from("audit_logs")
      .select("id, action, created_at, new_values, actor:profiles(full_name)")
      .in("action", ["UPLOAD_TASK_PROOF", "SUBMIT_CASH_COLLECTION"])
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const auditRows = (audit.data ?? []).flatMap((row) => {
    const taskId = (row.new_values as { task_id?: unknown } | null)?.task_id;
    return typeof taskId === "string" ? [{ ...row, taskId }] : [];
  });
  const codes = new Map<string, string>();
  if (auditRows.length) {
    const { data } = await supabase.from("tasks").select("id, task_code").in("id", [...new Set(auditRows.map((r) => r.taskId))]);
    for (const task of data ?? []) codes.set(task.id, task.task_code);
  }

  const items: ActivityItem[] = [
    ...(history.data ?? []).flatMap((row) =>
      row.task
        ? [
            {
              id: `h-${row.id}`,
              at: row.changed_at,
              taskId: row.task.id,
              taskCode: row.task.task_code,
              actor: row.actor?.full_name ?? "System",
              text: STATUS_TEXT[row.new_status] ?? "updated",
            },
          ]
        : [],
    ),
    ...auditRows.flatMap((row) =>
      codes.has(row.taskId)
        ? [
            {
              id: `a-${row.id}`,
              at: row.created_at,
              taskId: row.taskId,
              taskCode: codes.get(row.taskId)!,
              actor: row.actor?.full_name ?? "System",
              text: row.action === "UPLOAD_TASK_PROOF" ? "uploaded proof for" : "recorded a cash collection for",
            },
          ]
        : [],
    ),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
