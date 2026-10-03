import "server-only";

import { fetchPage } from "@/lib/db-errors";
import { activeFilterValue, pageRange, searchFilter, type ListParams } from "@/lib/list-params";
import { withIds } from "@/lib/rows";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

// agent_directory joins agents with their profile (name, email, phone).
const SEARCH_COLUMNS = ["employee_code", "full_name", "phone", "email"] as const;
const COLUMNS = "id, employee_code, full_name, email, phone, is_active, account_active, created_at";

export async function listAgents(params: ListParams) {
  const supabase = await createClient();
  const { from, to } = pageRange(params.page);
  let query = supabase
    .from("agent_directory")
    .select(COLUMNS, { count: "exact" })
    .order("full_name")
    .order("id")
    .range(from, to);

  const active = activeFilterValue(params.status);
  if (active !== null) query = query.eq("is_active", active);
  const filter = searchFilter(SEARCH_COLUMNS, params.q);
  if (filter) query = query.or(filter);

  const { rows, total } = await fetchPage(query, "agents");
  return { rows: withIds(rows), total };
}

export type AgentListRow = Awaited<ReturnType<typeof listAgents>>["rows"][number];

export async function getAgent(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_directory").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load agent.");
  return data?.id ? { ...data, id: data.id } : null;
}

export type Agent = NonNullable<Awaited<ReturnType<typeof getAgent>>>;
