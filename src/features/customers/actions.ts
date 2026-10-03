"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { customerSchema, type CustomerOption } from "@/features/customers/schemas";
import { requireAdmin } from "@/lib/auth/session";
import { dbErrorState, describeDbError, type UniqueMessages } from "@/lib/db-errors";
import { formValues, validationError, type ActionResult, type FormState } from "@/lib/form-state";
import { searchFilter } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

const LIST_PATH = "/admin/customers";
const UNIQUES: UniqueMessages = {
  customers_customer_code_key: {
    field: "customer_code",
    message: "A customer with this code already exists.",
  },
};

export async function createCustomer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  const parsed = customerSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert(parsed.data);
  if (error) return dbErrorState(error, "create customer", UNIQUES, values);

  revalidatePath(LIST_PATH);
  return { status: "success", message: `Customer "${parsed.data.name}" created.`, redirectTo: LIST_PATH };
}

export async function updateCustomer(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  if (!uuid.safeParse(id).success) return { status: "error", message: "Customer not found.", values };
  const parsed = customerSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").update(parsed.data).eq("id", id).select("id");
  if (error) return dbErrorState(error, "update customer", UNIQUES, values);
  if (!data.length) return { status: "error", message: "Customer not found.", values };

  revalidatePath(LIST_PATH);
  return { status: "success", message: `Customer "${parsed.data.name}" updated.`, redirectTo: LIST_PATH };
}

export async function setCustomerActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success || !z.boolean().safeParse(active).success) {
    return { ok: false, message: "Invalid request." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ is_active: active })
    .eq("id", id)
    .select("name");
  if (error) return { ok: false, message: describeDbError(error, "toggle customer").message };
  if (!data[0]) return { ok: false, message: "Customer not found." };

  revalidatePath(LIST_PATH);
  return { ok: true, message: `Customer "${data[0].name}" ${active ? "activated" : "deactivated"}.` };
}

/** Customer picker search: active customers by name or code (max 20). */
export async function searchCustomerOptions(term: string): Promise<CustomerOption[]> {
  await requireAdmin();
  const q = z.string().trim().max(100).catch("").parse(term);

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, name, customer_code, is_active")
    .eq("is_active", true)
    .order("name")
    .limit(20);
  const filter = searchFilter(["name", "customer_code"], q);
  if (filter) query = query.or(filter);

  const { data, error } = await query;
  if (error) {
    console.error("Customer search failed", { code: error.code });
    return [];
  }
  return data;
}
