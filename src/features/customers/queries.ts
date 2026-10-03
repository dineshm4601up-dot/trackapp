import "server-only";

import { fetchPage } from "@/lib/db-errors";
import { activeFilterValue, pageRange, searchFilter, type ListParams } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

const SEARCH_COLUMNS = ["customer_code", "name", "phone", "email", "city"] as const;

export async function listCustomers(params: ListParams) {
  const supabase = await createClient();
  const { from, to } = pageRange(params.page);
  let query = supabase
    .from("customers")
    .select("id, customer_code, name, phone, email, city, state, is_active", { count: "exact" })
    .order("name")
    .order("id")
    .range(from, to);

  const active = activeFilterValue(params.status);
  if (active !== null) query = query.eq("is_active", active);
  const filter = searchFilter(SEARCH_COLUMNS, params.q);
  if (filter) query = query.or(filter);

  return fetchPage(query, "customers");
}

export type CustomerListRow = Awaited<ReturnType<typeof listCustomers>>["rows"][number];

export async function getCustomer(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load customer.");
  return data;
}

export type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;
