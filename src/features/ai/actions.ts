"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AI_FEATURES } from "@/lib/ai/flags";
import { generateSummary, runPredictions } from "@/lib/ai/service";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Every AI action is admin-only and advisory. None of them changes a task:
// they refresh stored estimates, or record a human decision about one.

export type AiActionResult = { ok: true; message: string } | { ok: false; message: string };

function refresh() {
  revalidatePath("/admin/ai");
  revalidatePath("/admin/ai/recommendations");
  revalidatePath("/admin/settings/ai");
}

export async function refreshPredictions(): Promise<AiActionResult> {
  await requireAdmin();
  const result = await runPredictions(await createClient(), "MANUAL");
  if (!result.ok) return { ok: false, message: result.message };
  refresh();
  revalidatePath("/admin/tasks", "layout");
  const withData = result.predictions - result.insufficient;
  return {
    ok: true,
    message: `Predictions refreshed: ${withData} estimate${withData === 1 ? "" : "s"}${result.insufficient ? `, ${result.insufficient} without enough data` : ""}${result.recommendations ? `, ${result.recommendations} new recommendation${result.recommendations === 1 ? "" : "s"}` : ""}.`,
  };
}

export async function regenerateSummary(): Promise<AiActionResult> {
  await requireAdmin();
  const result = await generateSummary(await createClient(), "MANUAL");
  if (!result.ok) return { ok: false, message: result.code === "RATE_LIMITED" ? "The summary was generated a moment ago. Please try again later." : result.message };
  refresh();
  return { ok: true, message: result.note ?? "Summary updated." };
}

const reviewSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  notes: z.string().trim().max(500).optional(),
});

/** Records the admin's decision. Accepting acknowledges the advice; it performs no action on any task. */
export async function reviewRecommendation(input: z.input<typeof reviewSchema>): Promise<AiActionResult> {
  await requireAdmin();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ai_review_recommendation", { p_id: parsed.data.id, p_decision: parsed.data.decision, p_notes: parsed.data.notes || undefined });
  if (error) return { ok: false, message: error.message === "NOT_PENDING" ? "This recommendation has already been reviewed or has expired." : "The decision could not be saved." };
  refresh();
  return { ok: true, message: parsed.data.decision === "ACCEPTED" ? "Recommendation acknowledged. No task was changed." : "Recommendation rejected." };
}

const feedbackSchema = z.object({ predictionId: z.uuid(), rating: z.enum(["USEFUL", "NOT_USEFUL", "INCORRECT"]), taskId: z.uuid().optional() });

/** Feedback is stored for later evaluation. It never retrains or changes a model by itself. */
export async function submitPredictionFeedback(input: z.input<typeof feedbackSchema>): Promise<AiActionResult> {
  await requireAdmin();
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ai_submit_feedback", { p_prediction_id: parsed.data.predictionId, p_rating: parsed.data.rating });
  if (error) return { ok: false, message: "Your feedback could not be saved." };
  if (parsed.data.taskId) revalidatePath(`/admin/tasks/${parsed.data.taskId}`);
  refresh();
  return { ok: true, message: "Thank you — feedback recorded." };
}

const settingSchema = z.object({ key: z.enum(["ai_enabled", ...AI_FEATURES.map((f) => f.key)] as [string, ...string[]]), enabled: z.boolean() });

export async function setAiSetting(input: z.input<typeof settingSchema>): Promise<AiActionResult> {
  await requireAdmin();
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ai_set_setting", { p_key: parsed.data.key, p_enabled: parsed.data.enabled });
  if (error) return { ok: false, message: "The setting could not be saved." };
  refresh();
  revalidatePath("/admin/tasks", "layout");
  return { ok: true, message: "Setting saved." };
}
