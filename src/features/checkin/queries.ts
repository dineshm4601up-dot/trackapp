import "server-only";

import { createClient } from "@/lib/supabase/server";

/** The successful check-in of a task, as visible to the caller (RLS: own for agents, all for admins). */
export async function getSuccessfulCheckIn(taskId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("checkins")
    .select("checked_in_at")
    .eq("task_id", taskId)
    .eq("is_within_geofence", true)
    .maybeSingle();
  if (error) throw new Error("Unable to load check-in.");
  return data;
}

/** Admin view: the successful check-in (with readings) plus the number of rejected attempts. */
export async function getCheckInSummary(taskId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("checkins")
    .select(
      `id, checked_in_at, latitude, longitude, accuracy_meters, distance_from_location_meters,
       geofence_radius_meters, is_within_geofence, device_id,
       agent:agents(employee_code, profile:profiles(full_name))`,
    )
    .eq("task_id", taskId)
    .order("checked_in_at", { ascending: false });
  if (error) throw new Error("Unable to load check-ins.");
  return {
    success: data.find((c) => c.is_within_geofence) ?? null,
    rejectedAttempts: data.filter((c) => !c.is_within_geofence).length,
    lastRejected: data.find((c) => !c.is_within_geofence) ?? null,
  };
}

export type CheckInSummary = Awaited<ReturnType<typeof getCheckInSummary>>;
