"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AGENT_TARGETS, TASK_STATUSES, type TaskStatus } from "@/features/tasks/constants";
import { requireAgent } from "@/lib/auth/session";
import { kickCommunications } from "@/lib/communication/dispatcher";
import { createClient } from "@/lib/supabase/server";

const transitionSchema = z.object({
  taskId: z.uuid(),
  expected: z.enum(TASK_STATUSES),
  to: z.enum(AGENT_TARGETS),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type TransitionInput = z.input<typeof transitionSchema>;
export type TransitionResult =
  | { ok: true; status: TaskStatus; message: string }
  | { ok: false; code: string; message: string };

const ERRORS: Record<string, string> = {
  NOT_AGENT: "Your account can't update tasks. Please contact your administrator.",
  TASK_NOT_FOUND: "This task is no longer available for action.",
  STATUS_CHANGED: "This task has changed. Please refresh the task.",
  TRANSITION_NOT_ALLOWED: "You cannot perform this action from the current task status.",
  CHECK_IN_REQUIRED: "Check-in at the location is required first.",
  REASON_REQUIRED: "Please give a reason (at least 3 characters).",
  TEXT_TOO_LONG: "The reason or notes are too long.",
};

const SUCCESS: Partial<Record<TaskStatus, string>> = {
  ACCEPTED: "Task accepted.",
  ON_THE_WAY: "Travel started. Drive safely.",
  ARRIVED: "Marked as arrived. Check in at the location next.",
  IN_PROGRESS: "Task started.",
  COMPLETED: "Task completed.",
  PARTIALLY_COMPLETED: "Task marked as partially completed.",
  FAILED: "Problem reported. Your administrator has been informed.",
};

/**
 * The agent's only way to change a task status. Identity and ownership come
 * from the session inside agent_transition_task(); the client only names the
 * task, the status it saw (stale-screen protection) and the requested step.
 */
export async function transitionMyTask(input: TransitionInput): Promise<TransitionResult> {
  await requireAgent();
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID", message: "Invalid request." };
  const { taskId, expected, to, reason, notes } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agent_transition_task", {
    p_task_id: taskId,
    p_expected_status: expected,
    p_to_status: to,
    p_reason: reason || undefined,
    p_notes: notes || undefined,
  });

  if (error) {
    const known = error.message ? ERRORS[error.message] : undefined;
    if (!known) console.error("Task transition failed", { code: error.code, message: error.message });
    return { ok: false, code: error.message ?? "UNKNOWN", message: known ?? "The task could not be updated." };
  }

  kickCommunications();
  revalidatePath("/agent", "layout");
  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: true, status: data, message: SUCCESS[data] ?? "Task updated." };
}
