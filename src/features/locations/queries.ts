import "server-only";

import { fetchPage } from "@/lib/db-errors";
import { activeFilterValue, pageRange, searchFilter, type ListParams } from "@/lib/list-params";
import { withIds } from "@/lib/rows";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

// location_directory joins customers, so one query searches both tables.
const SEARCH_COLUMNS = ["location_name", "customer_name", "city", "state"] as const;

export async function listLocations(params: ListParams) {
  const supabase = await createClient();
  const { from, to } = pageRange(params.page);
  let query = supabase
    .from("location_directory")
    .select(
      "id, location_name, customer_name, customer_code, city, state, latitude, longitude, geofence_radius_meters, is_active, customer_active",
      { count: "exact" },
    )
    .order("location_name")
    .order("id")
    .range(from, to);

  const active = activeFilterValue(params.status);
  if (active !== null) query = query.eq("is_active", active);
  const filter = searchFilter(SEARCH_COLUMNS, params.q);
  if (filter) query = query.or(filter);

  const { rows, total } = await fetchPage(query, "locations");
  return { rows: withIds(rows), total };
}

export type LocationListRow = Awaited<ReturnType<typeof listLocations>>["rows"][number];

export async function getLocation(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("*, customer:customers(id, name, customer_code, is_active)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Unable to load location.");
  return data;
}

export type LocationWithCustomer = NonNullable<Awaited<ReturnType<typeof getLocation>>>;
