import "server-only";

import { ACTIVE_STATUSES, DONE_STATUSES } from "@/features/tasks/constants";
import { businessToday } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

// Every query runs with the agent's session: RLS returns only tasks assigned
// to the signed-in agent (never drafts). No agent id is taken from the client.

export const AGENT_VIEWS = ["today", "upcoming", "all", "completed", "failed", "cancelled"] as const;
export type AgentView = (typeof AGENT_VIEWS)[number];

const CARD_COLUMNS = `id, task_code, task_type, title, status, priority, scheduled_date, scheduled_start_time,
  scheduled_end_time, completed_at, customer:customers(name), location:locations(location_name, city)`;

const inList = (statuses: readonly string[]) => `(${statuses.join(",")})`;

export async function listMyTasks(view: AgentView, limit = 50) {
  const supabase = await createClient();
  const today = businessToday();
  let query = supabase.from("tasks").select(CARD_COLUMNS).limit(limit);

  switch (view) {
    case "today":
      // Scheduled today, plus still-open work that is overdue or unscheduled.
      query = query
        .or(
          `scheduled_date.eq.${today},and(status.in.${inList(ACTIVE_STATUSES)},or(scheduled_date.lt.${today},scheduled_date.is.null))`,
        )
        .order("scheduled_date", { ascending: true, nullsFirst: false })
        .order("scheduled_start_time", { ascending: true, nullsFirst: false })
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      break;
    case "upcoming":
      query = query
        .gt("scheduled_date", today)
        .in("status", [...ACTIVE_STATUSES])
        .order("scheduled_date", { ascending: true })
        .order("scheduled_start_time", { ascending: true, nullsFirst: false })
        .order("priority", { ascending: true });
      break;
    case "completed":
      query = query.in("status", [...DONE_STATUSES]).order("completed_at", { ascending: false, nullsFirst: false });
      break;
    case "failed":
      query = query.eq("status", "FAILED").order("updated_at", { ascending: false });
      break;
    case "cancelled":
      query = query.eq("status", "CANCELLED").order("updated_at", { ascending: false });
      break;
    case "all":
      query = query
        .order("scheduled_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load agent tasks", { code: error.code, message: error.message });
    throw new Error("Unable to load your tasks.");
  }
  return data;
}

export type MyTaskCard = Awaited<ReturnType<typeof listMyTasks>>[number];

/** Today's tasks by status group, for the home summary. */
export async function myTodayCounts() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").select("status").eq("scheduled_date", businessToday());
  if (error) throw new Error("Unable to load your tasks.");
  const count = (statuses: readonly string[]) => data.filter((t) => statuses.includes(t.status)).length;
  return {
    assigned: count(["ASSIGNED"]),
    accepted: count(["ACCEPTED", "ON_THE_WAY", "ARRIVED"]),
    inProgress: count(["CHECKED_IN", "IN_PROGRESS"]),
    completed: count(DONE_STATUSES),
  };
}

// Only what the agent needs to execute the task (no internal customer data).
const DETAIL_COLUMNS = `
  id, task_code, task_type, title, description, status, priority, expected_amount,
  scheduled_date, scheduled_start_time, scheduled_end_time,
  assigned_at, accepted_at, started_at, completed_at, failure_reason, completion_notes, cancellation_reason,
  customer:customers(name, phone, address_line1, address_line2, city, state, postal_code),
  location:locations(location_name, address_line1, address_line2, city, state, postal_code,
                     latitude, longitude, contact_person, contact_phone),
  task_products(id, assigned_quantity, delivered_quantity, delivery_notes, unit_price,
                product:products(sku, product_name, unit))
`;

export async function getMyTask(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("Failed to load agent task", { code: error.code, message: error.message });
    throw new Error("Unable to load this task.");
  }
  return data;
}

export type MyTaskDetail = NonNullable<Awaited<ReturnType<typeof getMyTask>>>;
