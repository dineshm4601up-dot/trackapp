import { Constants, type Database } from "@/types/database.types";

// Enum values come from the generated database types, so the UI can never
// drift from PostgreSQL.
export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskType = Database["public"]["Enums"]["task_type"];

export const TASK_STATUSES = Constants.public.Enums.task_status;
export const TASK_TYPES = Constants.public.Enums.task_type;

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "info" | "destructive";

export const TASK_STATUS_META: Record<TaskStatus, { label: string; badge: BadgeVariant }> = {
  DRAFT: { label: "Draft", badge: "outline" },
  ASSIGNED: { label: "Assigned", badge: "secondary" },
  ACCEPTED: { label: "Accepted", badge: "info" },
  ON_THE_WAY: { label: "On The Way", badge: "info" },
  ARRIVED: { label: "Arrived", badge: "info" },
  CHECKED_IN: { label: "Checked In", badge: "info" },
  IN_PROGRESS: { label: "In Progress", badge: "info" },
  COMPLETED: { label: "Completed", badge: "success" },
  PARTIALLY_COMPLETED: { label: "Partially Completed", badge: "warning" },
  FAILED: { label: "Failed", badge: "destructive" },
  CANCELLED: { label: "Cancelled", badge: "secondary" },
  RESCHEDULED: { label: "Rescheduled", badge: "warning" },
  VERIFIED: { label: "Verified", badge: "success" },
};

/**
 * Per-type behaviour. Adding a task type means adding one entry here (and the
 * enum value in the database) — no other UI code changes. Completion rules are
 * enforced by agent_complete_task(); these fields only drive the UI.
 *   products   — product lines on the task (admin form)
 *   execution  — delivery quantities, cash collection, or generic result notes
 *   proof      — photo required / any proof required / optional
 *   documents  — PDF documents accepted as proof
 *   result     — result notes required
 */
export type TaskTypeMeta = {
  label: string;
  products: "required" | "optional" | "none";
  execution: "delivery" | "cash" | "generic";
  proof: "photo-required" | "any-required" | "optional";
  documents: boolean;
  result: "required" | "optional";
};

export const TASK_TYPE_META: Record<TaskType, TaskTypeMeta> = {
  COLLECT_CASH: { label: "Collect Cash", products: "none", execution: "cash", proof: "optional", documents: false, result: "optional" },
  DELIVER_PRODUCTS: { label: "Deliver Products", products: "required", execution: "delivery", proof: "photo-required", documents: false, result: "optional" },
  PICKUP: { label: "Pickup", products: "optional", execution: "generic", proof: "optional", documents: false, result: "optional" },
  VERIFICATION: { label: "Verification", products: "none", execution: "generic", proof: "optional", documents: true, result: "required" },
  INSPECTION: { label: "Inspection", products: "none", execution: "generic", proof: "optional", documents: true, result: "required" },
  DOCUMENT_COLLECTION: { label: "Document Collection", products: "none", execution: "generic", proof: "any-required", documents: true, result: "optional" },
  REPLACEMENT: { label: "Replacement", products: "optional", execution: "generic", proof: "optional", documents: false, result: "optional" },
  SURVEY: { label: "Survey", products: "none", execution: "generic", proof: "optional", documents: true, result: "required" },
  OTHER: { label: "Other", products: "optional", execution: "generic", proof: "optional", documents: true, result: "optional" },
};

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
/** Methods that need a transaction / cheque reference. */
export const REFERENCE_REQUIRED_METHODS: readonly PaymentMethod[] = ["UPI", "BANK_TRANSFER", "CHEQUE"];

export function paymentMethodLabel(value: string | null | undefined) {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value ?? "—";
}

export const PRIORITIES = [
  { value: 1, label: "1 — Highest" },
  { value: 2, label: "2 — High" },
  { value: 3, label: "3 — Normal" },
  { value: 4, label: "4 — Low" },
  { value: 5, label: "5 — Lowest" },
] as const;

export const DEFAULT_PRIORITY = 3;

export function priorityLabel(priority: number) {
  return PRIORITIES.find((p) => p.value === priority)?.label ?? String(priority);
}

/** Admin may edit setup fields only before the agent has accepted. */
export const EDITABLE_STATUSES: readonly TaskStatus[] = ["DRAFT", "ASSIGNED"];
/** Admin may cancel before any verified on-site work (check-in) has happened. */
export const CANCELLABLE_STATUSES: readonly TaskStatus[] = ["DRAFT", "ASSIGNED", "ACCEPTED", "ON_THE_WAY", "ARRIVED"];

// ---------------------------------------------------------------- agent workflow
// UI mirror of agent_transition_task(). The database function is authoritative;
// these only decide which buttons to show.

/** Statuses where the agent still has work to do. */
export const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "CHECKED_IN",
  "IN_PROGRESS",
];
export const DONE_STATUSES: readonly TaskStatus[] = ["COMPLETED", "PARTIALLY_COMPLETED", "VERIFIED"];

/**
 * Statuses an agent may request through a plain transition. CHECKED_IN is set
 * only by the GPS check-in; COMPLETED / PARTIALLY_COMPLETED only by the
 * completion function, which validates execution data first.
 */
export const AGENT_TARGETS = [
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "IN_PROGRESS",
  "FAILED",
] as const satisfies readonly TaskStatus[];
export type AgentTarget = (typeof AGENT_TARGETS)[number];

export type AgentStep = {
  to: AgentTarget;
  label: string;
  pendingLabel: string;
  /** Ask before performing (important / irreversible steps). */
  confirm?: { title: string; description: string };
};

/** The single primary next step per status (none where the agent can't act). */
export const AGENT_NEXT_STEP: Partial<Record<TaskStatus, AgentStep>> = {
  ASSIGNED: {
    to: "ACCEPTED",
    label: "Accept Task",
    pendingLabel: "Accepting…",
    confirm: { title: "Accept this task?", description: "You'll be responsible for carrying it out as scheduled." },
  },
  ACCEPTED: { to: "ON_THE_WAY", label: "Start Travel", pendingLabel: "Starting…" },
  ON_THE_WAY: { to: "ARRIVED", label: "I've Arrived", pendingLabel: "Updating…" },
  CHECKED_IN: { to: "IN_PROGRESS", label: "Start Task", pendingLabel: "Starting…" },
};

/** Statuses from which the agent may report a failure. */
export const FAILABLE_STATUSES: readonly TaskStatus[] = ["ACCEPTED", "ON_THE_WAY", "ARRIVED", "CHECKED_IN", "IN_PROGRESS"];

export const FAILURE_REASONS = [
  "Customer unavailable",
  "Location inaccessible",
  "Product unavailable",
  "Customer rejected",
  "Payment not received",
  "Wrong address",
  "Vehicle issue",
  "Other",
] as const;

/** Milestones of the normal path, in order (for the status timeline). */
export const TIMELINE_STEPS: readonly TaskStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "CHECKED_IN",
  "IN_PROGRESS",
  "COMPLETED",
];

export const isEditable = (status: TaskStatus) => EDITABLE_STATUSES.includes(status);
export const isCancellable = (status: TaskStatus) => CANCELLABLE_STATUSES.includes(status);
