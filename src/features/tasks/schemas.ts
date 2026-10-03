import { z } from "zod";

import { TASK_STATUSES, TASK_TYPE_META, TASK_TYPES } from "@/features/tasks/constants";
import { optionalText, requiredText } from "@/lib/validation/fields";

const formString = z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().trim());
const optionalUuid = (message: string) =>
  formString.refine((v) => v === "" || z.uuid().safeParse(v).success, message).transform((v) => v || null);
const requiredUuid = (message: string) => formString.pipe(z.uuid(message));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const optionalDate = formString
  .refine((v) => v === "" || (DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), "Enter a valid date.")
  .transform((v) => v || null);
const optionalTime = formString.refine((v) => v === "" || TIME.test(v), "Enter a valid time.").transform((v) => v || null);

export const QUANTITY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/; // numeric(14,3)
export const PRICE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/; // numeric(14,2)

export const productLineSchema = z.object({
  product_id: z.uuid("Invalid product."),
  assigned_quantity: z
    .string()
    .trim()
    .regex(QUANTITY_PATTERN, "Quantity must be a number with up to 3 decimal places.")
    .refine((v) => Number(v) > 0, "Quantity must be greater than 0."),
  unit_price: z
    .string()
    .trim()
    .refine((v) => v === "" || PRICE_PATTERN.test(v), "Unit price must be 0 or more, with up to 2 decimal places.")
    .transform((v) => (v === "" ? null : v)),
});

export type ProductLineInput = z.infer<typeof productLineSchema>;

const productLines = formString
  .transform((value, ctx) => {
    try {
      return value ? (JSON.parse(value) as unknown) : [];
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid product lines." });
      return z.NEVER;
    }
  })
  .pipe(z.array(productLineSchema).max(100, "A task can have at most 100 product lines."));

export const TASK_INTENTS = ["draft", "assign"] as const;

/** Task form submission. Server-only values (created_by, assigned_at, status, task_code) are never accepted. */
export const taskFormSchema = z
  .object({
    task_type: z.enum(TASK_TYPES, "Select a task type."),
    title: requiredText("Title", 200),
    description: optionalText("Description", 4000),
    priority: formString
      .refine((v) => /^[1-5]$/.test(v), "Priority must be 1–5.")
      .transform(Number),
    customer_id: requiredUuid("Select a customer."),
    location_id: requiredUuid("Select a location."),
    agent_id: optionalUuid("Select a valid agent."),
    scheduled_date: optionalDate,
    scheduled_start_time: optionalTime,
    scheduled_end_time: optionalTime,
    products: productLines,
    // numeric(14,2); required to assign a cash-collection task
    expected_amount: formString
      .refine((v) => v === "" || PRICE_PATTERN.test(v), "Enter an amount with up to 2 decimal places.")
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || Number(v) > 0, "Expected amount must be greater than 0."),
    intent: z.enum(TASK_INTENTS).catch("assign"),
  })
  .superRefine((v, ctx) => {
    if (v.scheduled_start_time && v.scheduled_end_time && v.scheduled_end_time <= v.scheduled_start_time) {
      ctx.addIssue({ code: "custom", path: ["scheduled_end_time"], message: "End time must be after the start time." });
    }
    if (v.scheduled_end_time && !v.scheduled_start_time) {
      ctx.addIssue({ code: "custom", path: ["scheduled_start_time"], message: "Enter a start time for the time window." });
    }
    if ((v.scheduled_start_time || v.scheduled_end_time) && !v.scheduled_date) {
      ctx.addIssue({ code: "custom", path: ["scheduled_date"], message: "Enter a date for the time window." });
    }
    if (v.intent === "assign" && !v.agent_id) {
      ctx.addIssue({ code: "custom", path: ["agent_id"], message: "Select an agent to assign this task." });
    }
    const ids = v.products.map((line) => line.product_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["products"], message: "Each product can appear only once." });
    }
    if (v.task_type === "COLLECT_CASH" && v.intent === "assign" && !v.expected_amount) {
      ctx.addIssue({ code: "custom", path: ["expected_amount"], message: "Enter the amount to collect." });
    }
    const productsRule = TASK_TYPE_META[v.task_type].products;
    if (productsRule === "none" && v.products.length > 0) {
      ctx.addIssue({ code: "custom", path: ["products"], message: "This task type doesn't take products." });
    }
    if (productsRule === "required" && v.intent === "assign" && v.products.length === 0) {
      ctx.addIssue({ code: "custom", path: ["products"], message: "Add at least one product to a delivery task." });
    }
  });

export type TaskFormInput = z.infer<typeof taskFormSchema>;

// ---------------------------------------------------------------- list filters

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

export const taskFiltersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  status: optionalEnum(TASK_STATUSES),
  type: optionalEnum(TASK_TYPES),
  agent: z.uuid().optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  date: z.string().regex(DATE).optional().catch(undefined),
  priority: z.coerce.number().int().min(1).max(5).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type TaskFilters = z.infer<typeof taskFiltersSchema>;

export function parseTaskFilters(searchParams: Record<string, string | string[] | undefined>): TaskFilters {
  const first = (key: string) => {
    const value = searchParams[key];
    const v = Array.isArray(value) ? value[0] : value;
    return v === "" ? undefined : v;
  };
  return taskFiltersSchema.parse({
    q: first("q") ?? "",
    status: first("status"),
    type: first("type"),
    agent: first("agent"),
    customer: first("customer"),
    date: first("date"),
    priority: first("priority"),
    page: first("page"),
  });
}

/** Filters for pagination links. */
export function taskFilterQuery(f: TaskFilters): Record<string, string | undefined> {
  return {
    q: f.q || undefined,
    status: f.status,
    type: f.type,
    agent: f.agent,
    customer: f.customer,
    date: f.date,
    priority: f.priority ? String(f.priority) : undefined,
  };
}

// ---------------------------------------------------------------- picker options

export type LocationOption = {
  id: string;
  location_name: string;
  city: string | null;
  is_active: boolean;
};

export type AgentOption = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
  phone: string | null;
  is_active: boolean;
};

export type ProductOption = {
  id: string;
  sku: string;
  product_name: string;
  unit: string;
  price: number | null;
  is_active: boolean;
};
