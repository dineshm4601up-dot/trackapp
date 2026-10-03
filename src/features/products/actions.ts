"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { productSchema } from "@/features/products/schemas";
import { requireAdmin } from "@/lib/auth/session";
import { dbErrorState, describeDbError, type UniqueMessages } from "@/lib/db-errors";
import { formValues, validationError, type ActionResult, type FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

const LIST_PATH = "/admin/products";
const UNIQUES: UniqueMessages = {
  products_sku_key: { field: "sku", message: "A product with this SKU already exists." },
};

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  const parsed = productSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(parsed.data);
  if (error) return dbErrorState(error, "create product", UNIQUES, values);

  revalidatePath(LIST_PATH);
  return { status: "success", message: `Product "${parsed.data.product_name}" created.`, redirectTo: LIST_PATH };
}

export async function updateProduct(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  if (!uuid.safeParse(id).success) return { status: "error", message: "Product not found.", values };
  const parsed = productSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  // Editing a product never rewrites history: task lines keep their own unit_price.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update(parsed.data)
    .eq("id", id)
    .select("id");
  if (error) return dbErrorState(error, "update product", UNIQUES, values);
  if (!data.length) return { status: "error", message: "Product not found.", values };

  revalidatePath(LIST_PATH);
  return { status: "success", message: `Product "${parsed.data.product_name}" updated.`, redirectTo: LIST_PATH };
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success || !z.boolean().safeParse(active).success) {
    return { ok: false, message: "Invalid request." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: active })
    .eq("id", id)
    .select("product_name");
  if (error) return { ok: false, message: describeDbError(error, "toggle product").message };
  if (!data[0]) return { ok: false, message: "Product not found." };

  revalidatePath(LIST_PATH);
  return { ok: true, message: `Product "${data[0].product_name}" ${active ? "activated" : "deactivated"}.` };
}
