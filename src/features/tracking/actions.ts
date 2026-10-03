"use server";

import { z } from "zod";

import { requireAgent } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Raw readings only. Any other key (e.g. "agent_id", "recorded_at") is
// stripped here; agent_record_location() has no parameter for them and takes
// the agent from the session and the time from the server clock.
const locationSchema = z.object({
  taskId: z.uuid(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(),
  /** Position timestamp from the device (epoch ms). Freshness check only. */
  capturedAt: z.number().int().positive(),
});

export type LocationInput = z.input<typeof locationSchema>;

export type LocationResult =
  /** stored: a new event was written. ignored: valid but skipped (rate limit or poor accuracy). */
  | { ok: true; outcome: "stored" | "ignored" }
  /** stop: sharing must end for this task (finished, cancelled, reassigned, or not authorised). */
  | { ok: false; stop: boolean; code: string };

const STOP_CODES = ["UNAUTHORIZED", "TASK_NOT_FOUND", "TRACKING_NOT_ACTIVE"];
const KNOWN_CODES = [...STOP_CODES, "INVALID_COORDINATES", "INVALID_ACCURACY", "STALE_LOCATION"];

/** Records one task-related location event for the signed-in agent (validated and authorised server-side). */
export async function recordMyLocation(input: LocationInput): Promise<LocationResult> {
  await requireAgent();
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    if (field === "taskId") return { ok: false, stop: true, code: "TASK_NOT_FOUND" };
    return { ok: false, stop: false, code: field === "accuracy" ? "INVALID_ACCURACY" : field === "capturedAt" ? "STALE_LOCATION" : "INVALID_COORDINATES" };
  }
  const { taskId, latitude, longitude, accuracy, capturedAt } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agent_record_location", {
    p_task_id: taskId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy: accuracy,
    p_captured_at: new Date(capturedAt).toISOString(),
  });
  if (error) {
    const code = KNOWN_CODES.includes(error.message) ? error.message : "FAILED";
    if (code === "FAILED") console.error("Location event failed", { code: error.code, message: error.message });
    return { ok: false, stop: STOP_CODES.includes(code), code };
  }
  const result = z.object({ result: z.enum(["RECORDED", "THROTTLED", "LOW_ACCURACY"]) }).parse(data);
  return { ok: true, outcome: result.result === "RECORDED" ? "stored" : "ignored" };
}
