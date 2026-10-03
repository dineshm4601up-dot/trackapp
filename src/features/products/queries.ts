import "server-only";

import { fetchPage } from "@/lib/db-errors";
import { activeFilterValue, pageRange, searchFilter, type ListParams } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

const SEARCH_COLUMNS = ["sku", "product_name", "description"] as const;

export async function listProducts(params: ListParams) {
  const supabase = await createClient();
  const { from, to } = pageRange(params.page);
  let query = supabase
    .from("products")
    .select("id, sku, product_name, unit, price, is_active, created_at", { count: "exact" })
    .order("product_name")
    .order("id")
    .range(from, to);

  const active = activeFilterValue(params.status);
  if (active !== null) query = query.eq("is_active", active);
  const filter = searchFilter(SEARCH_COLUMNS, params.q);
  if (filter) query = query.or(filter);

  return fetchPage(query, "products");
}

export type ProductListRow = Awaited<ReturnType<typeof listProducts>>["rows"][number];

export async function getProduct(id: string) {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to load product.");
  return data;
}

export type Product = NonNullable<Awaited<ReturnType<typeof getProduct>>>;
