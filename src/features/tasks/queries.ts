import "server-only";

import type { TaskFilters } from "@/features/tasks/schemas";
import { fetchPage } from "@/lib/db-errors";
import { pageRange, searchFilter } from "@/lib/list-params";
import { withIds } from "@/lib/rows";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

// task_directory joins customer, location and agent, so one query lists,
// searches and filters (no N+1). RLS applies through the view.
const SEARCH_COLUMNS = [
  "task_code",
  "customer_name",
  "customer_code",
  "agent_name",
  "employee_code",
  "location_name",
] as const;

export async function listTasks(filters: TaskFilters) {
  const supabase = await createClient();
  const { from, to } = pageRange(filters.page);
  let query = supabase
    .from("task_directory")
    .select(
      "id, task_code, task_type, status, priority, title, scheduled_date, scheduled_start_time, created_at, customer_name, customer_code, location_name, agent_name, employee_code",
      { count: "exact" },
    )
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.type) query = query.eq("task_type", filters.type);
  if (filters.agent) query = query.eq("agent_id", filters.agent);
  if (filters.customer) query = query.eq("customer_id", filters.customer);
  if (filters.location) query = query.eq("location_id", filters.location);
  if (filters.date) query = query.eq("scheduled_date", filters.date);
  if (filters.priority) query = query.eq("priority", filters.priority);
  const search = searchFilter(SEARCH_COLUMNS, filters.q);
  if (search) query = query.or(search);

  const { rows, total } = await fetchPage(query, "tasks");
  return { rows: withIds(rows), total };
}

export type TaskListRow = Awaited<ReturnType<typeof listTasks>>["rows"][number];

const TASK_DETAIL = `
  *,
  customer:customers(id, name, customer_code, phone, is_active),
  location:locations(id, location_name, address_line1, address_line2, city, state, postal_code,
                     latitude, longitude, geofence_radius_meters, contact_person, contact_phone, is_active),
  agent:agents(id, employee_code, is_active, profile:profiles(full_name, email, phone, is_active)),
  creator:profiles!tasks_created_by_fkey(full_name, email),
  task_products(id, product_id, assigned_quantity, delivered_quantity, unit_price, notes, delivery_notes,
                product:products(id, sku, product_name, unit, price, is_active))
`;

export async function getTask(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").select(TASK_DETAIL).eq("id", id).maybeSingle();
  if (error) {
    console.error("Failed to load task", { code: error.code, message: error.message });
    throw new Error("Unable to load task.");
  }
  return data;
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTask>>>;

export async function getTaskHistory(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_status_history")
    .select("id, old_status, new_status, changed_at, reason, notes, actor:profiles(full_name, email)")
    .eq("task_id", id)
    .order("changed_at", { ascending: true });
  if (error) throw new Error("Unable to load task history.");
  return data;
}

/** Labels for the agent/customer/location filter chips (any status, so history stays filterable). */
export async function getFilterSelections(filters: TaskFilters) {
  const supabase = await createClient();
  const [agent, customer, location] = await Promise.all([
    filters.agent
      ? supabase
          .from("agent_directory")
          .select("id, full_name, employee_code, phone, is_active")
          .eq("id", filters.agent)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    filters.customer
      ? supabase.from("customers").select("id, name, customer_code, is_active").eq("id", filters.customer).maybeSingle()
      : Promise.resolve({ data: null }),
    filters.location
      ? supabase.from("locations").select("id, location_name, city, is_active").eq("id", filters.location).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const agentRow = agent.data;
  return {
    agent:
      agentRow?.id
        ? {
            id: agentRow.id,
            full_name: agentRow.full_name,
            employee_code: agentRow.employee_code,
            phone: agentRow.phone,
            is_active: agentRow.is_active ?? false,
          }
        : null,
    customer: customer.data ?? null,
    location: location.data ?? null,
  };
}

/** The signed-in agent's open tasks (RLS returns only their own, non-draft). */
export async function listMyOpenTasks() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, task_code, task_type, title, status, priority, scheduled_date, scheduled_start_time, location:locations(location_name, city)")
    .not("status", "in", "(COMPLETED,PARTIALLY_COMPLETED,VERIFIED,CANCELLED,FAILED)")
    .order("scheduled_date", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true })
    .limit(50);
  if (error) throw new Error("Unable to load your tasks.");
  return data;
}
