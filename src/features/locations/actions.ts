"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { locationSchema } from "@/features/locations/schemas";
import { requireAdmin } from "@/lib/auth/session";
import { dbErrorState, describeDbError } from "@/lib/db-errors";
import { searchPlaces } from "@/lib/maps/geocoding";
import type { PlaceResult } from "@/lib/maps/types";
import { formValues, validationError, type ActionResult, type FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

const LIST_PATH = "/admin/locations";
type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/** New links must point at an existing, active customer. */
async function checkCustomer(supabase: SupabaseServer, customerId: string) {
  const { data } = await supabase.from("customers").select("is_active").eq("id", customerId).maybeSingle();
  if (!data) return "The selected customer no longer exists.";
  if (!data.is_active) return "The selected customer is inactive. Activate it or choose another customer.";
  return null;
}

export async function createLocation(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  const parsed = locationSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createClient();
  const customerProblem = await checkCustomer(supabase, parsed.data.customer_id);
  if (customerProblem) {
    return { status: "error", message: customerProblem, fieldErrors: { customer_id: customerProblem }, values };
  }

  const { error } = await supabase.from("locations").insert(parsed.data);
  if (error) return dbErrorState(error, "create location", {}, values);

  revalidatePath(LIST_PATH);
  return { status: "success", message: `Location "${parsed.data.location_name}" created.`, redirectTo: LIST_PATH };
}

export async function updateLocation(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  if (!uuid.safeParse(id).success) return { status: "error", message: "Location not found.", values };
  const parsed = locationSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createClient();
  const { data: current } = await supabase.from("locations").select("customer_id").eq("id", id).maybeSingle();
  if (!current) return { status: "error", message: "Location not found.", values };

  // Re-linking to a different customer requires that customer to be active.
  if (current.customer_id !== parsed.data.customer_id) {
    const customerProblem = await checkCustomer(supabase, parsed.data.customer_id);
    if (customerProblem) {
      return { status: "error", message: customerProblem, fieldErrors: { customer_id: customerProblem }, values };
    }
  }

  const { error } = await supabase.from("locations").update(parsed.data).eq("id", id);
  if (error) {
    // Tasks pin (location, customer) pairs; moving a used location to another customer is refused.
    if (error.code === "23503") {
      return {
        status: "error",
        message: "This location is used by existing tasks, so its customer can't be changed.",
        fieldErrors: { customer_id: "Location already has tasks for its current customer." },
        values,
      };
    }
    return dbErrorState(error, "update location", {}, values);
  }

  revalidatePath(LIST_PATH);
  return { status: "success", message: `Location "${parsed.data.location_name}" updated.`, redirectTo: LIST_PATH };
}

export async function setLocationActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success || !z.boolean().safeParse(active).success) {
    return { ok: false, message: "Invalid request." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .update({ is_active: active })
    .eq("id", id)
    .select("location_name");
  if (error) return { ok: false, message: describeDbError(error, "toggle location").message };
  if (!data[0]) return { ok: false, message: "Location not found." };

  revalidatePath(LIST_PATH);
  return { ok: true, message: `Location "${data[0].location_name}" ${active ? "activated" : "deactivated"}.` };
}

const placeQuery = z.string().trim().min(3).max(200);

export type PlaceSearchResult = { ok: true; results: PlaceResult[] } | { ok: false; message: string };

/** Place search for the location form. Admin-only; nothing is saved. */
export async function searchLocationPlaces(query: string): Promise<PlaceSearchResult> {
  await requireAdmin();
  const parsed = placeQuery.safeParse(query);
  if (!parsed.success) return { ok: false, message: "Enter at least 3 characters to search." };
  try {
    return { ok: true, results: await searchPlaces(parsed.data) };
  } catch {
    return { ok: false, message: "Unable to search this location. Please try again." };
  }
}
