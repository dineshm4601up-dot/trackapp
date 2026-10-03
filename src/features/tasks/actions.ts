"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CustomerOption } from "@/features/customers/schemas";
import {
  taskFormSchema,
  type AgentOption,
  type LocationOption,
  type ProductOption,
  type TaskFormInput,
} from "@/features/tasks/schemas";
import { requireAdmin } from "@/lib/auth/session";
import { formValues, validationError, type ActionResult, type FormState } from "@/lib/form-state";
import { searchFilter } from "@/lib/list-params";
import { withIds } from "@/lib/rows";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

const LIST_PATH = "/admin/tasks";

// Business-rule codes raised by admin_save_task / admin_cancel_task.
const RULE_ERRORS: Record<string, { field?: string; message: string }> = {
  NOT_ADMIN: { message: "You don't have permission to do that." },
  TASK_NOT_FOUND: { message: "This task no longer exists." },
  TASK_NOT_EDITABLE: { message: "This task can no longer be edited." },
  TASK_NOT_CANCELLABLE: { message: "This task can no longer be cancelled." },
  REASON_REQUIRED: { field: "reason", message: "Enter a reason (at least 3 characters)." },
  CUSTOMER_NOT_FOUND: { field: "customer_id", message: "The selected customer no longer exists." },
  CUSTOMER_INACTIVE: { field: "customer_id", message: "The selected customer is inactive." },
  LOCATION_NOT_FOUND: { field: "location_id", message: "The selected location no longer exists." },
  LOCATION_CUSTOMER_MISMATCH: {
    field: "location_id",
    message: "The selected location does not belong to the selected customer.",
  },
  LOCATION_INACTIVE: { field: "location_id", message: "The selected location is inactive." },
  AGENT_REQUIRED: { field: "agent_id", message: "Select an agent to assign this task." },
  AGENT_NOT_FOUND: { field: "agent_id", message: "The selected agent no longer exists." },
  AGENT_INACTIVE: { field: "agent_id", message: "The selected agent is inactive." },
  PRODUCT_NOT_FOUND: { field: "products", message: "A selected product no longer exists." },
  PRODUCT_INACTIVE: { field: "products", message: "The selected product is inactive." },
  PRODUCT_DUPLICATE: { field: "products", message: "Each product can appear only once." },
  PRODUCTS_REQUIRED: { field: "products", message: "Add at least one product to a delivery task." },
  PRODUCTS_INVALID: { field: "products", message: "Invalid product lines." },
  QUANTITY_INVALID: { field: "products", message: "Quantities must be greater than 0." },
  PRICE_INVALID: { field: "products", message: "Unit prices must be 0 or more." },
  EXPECTED_AMOUNT_REQUIRED: { field: "expected_amount", message: "Enter the amount to collect." },
  AMOUNT_INVALID: { field: "expected_amount", message: "Expected amount must be greater than 0 (up to 2 decimals)." },
};

type RpcError = { code?: string; message?: string };

/** Maps a database error to user-facing text; raw details are only logged server-side. */
function ruleError(error: RpcError, action: "created" | "updated" | "cancelled") {
  const known = error.message ? RULE_ERRORS[error.message] : undefined;
  if (known) return known;
  if (error.code === "23514") return { message: "Some values are not allowed. Check priority and the time window." };
  if (error.code === "42501") return { message: "You don't have permission to do that." };
  console.error(`Task could not be ${action}`, { code: error.code, message: error.message });
  return { message: `The task could not be ${action}.` };
}

function failure(error: RpcError, action: "created" | "updated", values: Record<string, string>): FormState {
  const { field, message } = ruleError(error, action);
  return field
    ? { status: "error", message: "Please correct the highlighted fields.", fieldErrors: { [field]: message }, values }
    : { status: "error", message, values };
}

function rpcArgs(input: TaskFormInput) {
  return {
    p_task: {
      task_type: input.task_type,
      title: input.title,
      description: input.description,
      priority: input.priority,
      customer_id: input.customer_id,
      location_id: input.location_id,
      agent_id: input.agent_id,
      scheduled_date: input.scheduled_date,
      scheduled_start_time: input.scheduled_start_time,
      scheduled_end_time: input.scheduled_end_time,
      expected_amount: input.task_type === "COLLECT_CASH" ? input.expected_amount : null,
    },
    p_products: input.products,
  };
}

/** Create a task (DRAFT, or ASSIGNED with intent "assign") with its product lines, atomically. */
export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  const parsed = taskFormSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createClient();
  const { data: taskId, error } = await supabase.rpc("admin_save_task", {
    ...rpcArgs(parsed.data),
    p_assign: parsed.data.intent === "assign",
  });
  if (error) return failure(error, "created", values);

  revalidatePath(LIST_PATH);
  return { status: "success", message: "Task created successfully.", redirectTo: `${LIST_PATH}/${taskId}?created=1` };
}

/** Update a DRAFT/ASSIGNED task. An ASSIGNED task stays assigned; a draft is assigned with intent "assign". */
export async function updateTask(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  if (!uuid.safeParse(id).success) return { status: "error", message: "This task no longer exists.", values };
  const parsed = taskFormSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_task", {
    ...rpcArgs(parsed.data),
    p_assign: parsed.data.intent === "assign",
    p_task_id: id,
  });
  if (error) return failure(error, "updated", values);

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  return {
    status: "success",
    message: parsed.data.intent === "assign" ? "Task saved and assigned." : "Task saved.",
    redirectTo: `${LIST_PATH}/${id}`,
  };
}

export async function cancelTask(id: string, reason: string): Promise<ActionResult> {
  await requireAdmin();
  const input = z.object({ id: uuid, reason: z.string().trim().min(3).max(500) }).safeParse({ id, reason });
  if (!input.success) return { ok: false, message: "Enter a reason (at least 3 characters)." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_task", { p_task_id: input.data.id, p_reason: input.data.reason });
  if (error) return { ok: false, message: ruleError(error, "cancelled").message };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${input.data.id}`);
  return { ok: true, message: "Task cancelled." };
}

// ---------------------------------------------------------------- picker searches

const term = (value: string) => z.string().trim().max(100).catch("").parse(value);

/** Active customers for new tasks; all customers (incl. inactive) for list filters. */
export async function searchTaskCustomers(value: string, includeInactive = false): Promise<CustomerOption[]> {
  await requireAdmin();
  const supabase = await createClient();
  let query = supabase.from("customers").select("id, name, customer_code, is_active").order("name").limit(20);
  if (!z.boolean().parse(includeInactive)) query = query.eq("is_active", true);
  const filter = searchFilter(["name", "customer_code"], term(value));
  if (filter) query = query.or(filter);
  const { data } = await query;
  return data ?? [];
}

/** Active locations of one customer (the customer/location link is re-checked on save). */
export async function searchTaskLocations(customerId: string, value: string): Promise<LocationOption[]> {
  await requireAdmin();
  if (!uuid.safeParse(customerId).success) return [];
  const supabase = await createClient();
  let query = supabase
    .from("locations")
    .select("id, location_name, city, is_active")
    .eq("customer_id", customerId)
    .eq("is_active", true)
    .order("location_name")
    .limit(50);
  const filter = searchFilter(["location_name", "city"], term(value));
  if (filter) query = query.or(filter);
  const { data } = await query;
  return data ?? [];
}

/** Assignable agents (active agent record and account) or, for filters, all agents. */
export async function searchTaskAgents(value: string, includeInactive = false): Promise<AgentOption[]> {
  await requireAdmin();
  const supabase = await createClient();
  let query = supabase
    .from("agent_directory")
    .select("id, full_name, employee_code, phone, is_active, account_active")
    .order("full_name")
    .limit(20);
  if (!z.boolean().parse(includeInactive)) query = query.eq("is_active", true).eq("account_active", true);
  const filter = searchFilter(["full_name", "employee_code", "phone"], term(value));
  if (filter) query = query.or(filter);
  const { data } = await query;
  return withIds(data ?? []).map((a) => ({
    id: a.id,
    full_name: a.full_name,
    employee_code: a.employee_code,
    phone: a.phone,
    is_active: Boolean(a.is_active && a.account_active),
  }));
}

/** Active products for new task lines. */
export async function searchTaskProducts(value: string): Promise<ProductOption[]> {
  await requireAdmin();
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("id, sku, product_name, unit, price, is_active")
    .eq("is_active", true)
    .order("product_name")
    .limit(20);
  const filter = searchFilter(["sku", "product_name"], term(value));
  if (filter) query = query.or(filter);
  const { data } = await query;
  return data ?? [];
}
