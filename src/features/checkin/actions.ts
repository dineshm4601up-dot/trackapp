"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAgent } from "@/lib/auth/session";
import { kickCommunications } from "@/lib/communication/dispatcher";
import { createClient } from "@/lib/supabase/server";

// Only raw readings are accepted. Any other field a client sends (e.g. a
// "distance" or "is_within_geofence") is stripped here and never reaches the
// database — where the check-in function computes those values itself.
const checkInSchema = z.object({
  taskId: z.uuid(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(),
  /** Position timestamp from the device (epoch ms). Freshness check only. */
  capturedAt: z.number().int().positive(),
  deviceId: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type CheckInInput = z.input<typeof checkInSchema>;

export type CheckInErrorCode =
  | "UNAUTHORIZED"
  | "TASK_NOT_FOUND"
  | "CHECKIN_ALREADY_EXISTS"
  | "INVALID_TASK_STATUS"
  | "INVALID_COORDINATES"
  | "INVALID_ACCURACY"
  | "GPS_ACCURACY_TOO_LOW"
  | "STALE_LOCATION"
  | "INVALID_LOCATION_CONFIGURATION"
  | "OUTSIDE_GEOFENCE"
  | "CHECKIN_FAILED";

export type CheckInResult =
  | { success: true; status: "CHECKED_IN"; checkedInAt: string; message: string }
  | { success: false; code: CheckInErrorCode; message: string; distanceMeters?: number; radiusMeters?: number };

const MESSAGES: Record<CheckInErrorCode, string> = {
  UNAUTHORIZED: "Your account can't check in. Please contact your administrator.",
  TASK_NOT_FOUND: "This task is no longer available for action.",
  CHECKIN_ALREADY_EXISTS: "This task is already checked in.",
  INVALID_TASK_STATUS: "Check-in is only possible after marking yourself as arrived. Please refresh the task.",
  INVALID_COORDINATES: "Your location reading was invalid. Please try again.",
  INVALID_ACCURACY: "Your location reading was invalid. Please try again.",
  GPS_ACCURACY_TOO_LOW: "Your GPS accuracy is currently too low. Please move to an open area and try again.",
  STALE_LOCATION:
    "Your location reading was out of date. Please try again, and make sure your phone's date and time are set automatically.",
  INVALID_LOCATION_CONFIGURATION:
    "This location does not have a valid check-in area configured. Please contact the administrator.",
  OUTSIDE_GEOFENCE: "You are outside the allowed check-in area. Please move closer to the assigned location and try again.",
  CHECKIN_FAILED: "We could not complete your check-in. Please try again.",
};

const fail = (code: CheckInErrorCode, extra: { distanceMeters?: number; radiusMeters?: number } = {}): CheckInResult => ({
  success: false,
  code,
  message: MESSAGES[code],
  ...extra,
});

const resultSchema = z.object({
  result: z.enum(["CHECKED_IN", "OUTSIDE_GEOFENCE"]),
  checked_in_at: z.string().optional(),
  distance_meters: z.number(),
  radius_meters: z.number(),
});

/** GPS check-in for the signed-in agent's ARRIVED task (validated and decided server-side). */
export async function checkInMyTask(input: CheckInInput): Promise<CheckInResult> {
  await requireAgent();
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    if (field === "accuracy") return fail("INVALID_ACCURACY");
    if (field === "capturedAt") return fail("STALE_LOCATION");
    if (field === "taskId") return fail("TASK_NOT_FOUND");
    return fail("INVALID_COORDINATES");
  }
  const { taskId, latitude, longitude, accuracy, capturedAt, deviceId, notes } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agent_check_in", {
    p_task_id: taskId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy: accuracy,
    p_captured_at: new Date(capturedAt).toISOString(),
    p_device_id: deviceId || undefined,
    p_notes: notes || undefined,
  });

  if (error) {
    const code = (error.message in MESSAGES ? error.message : "CHECKIN_FAILED") as CheckInErrorCode;
    if (code === "CHECKIN_FAILED") console.error("Check-in failed", { code: error.code, message: error.message });
    return fail(code);
  }

  const outcome = resultSchema.safeParse(data);
  if (!outcome.success) {
    console.error("Unexpected check-in result", { data });
    return fail("CHECKIN_FAILED");
  }

  kickCommunications();
  revalidatePath("/agent", "layout");
  revalidatePath(`/admin/tasks/${taskId}`);

  if (outcome.data.result === "OUTSIDE_GEOFENCE") {
    return fail("OUTSIDE_GEOFENCE", {
      distanceMeters: Math.round(outcome.data.distance_meters),
      radiusMeters: outcome.data.radius_meters,
    });
  }
  return {
    success: true,
    status: "CHECKED_IN",
    checkedInAt: outcome.data.checked_in_at ?? new Date().toISOString(),
    message: "Check-in successful",
  };
}
