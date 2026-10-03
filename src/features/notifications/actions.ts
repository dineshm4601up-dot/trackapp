"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { kickCommunications } from "@/lib/communication/dispatcher";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Users can only ever act on their own notifications: the database functions
// take the recipient from the session, never from the request.

export type NotificationActionResult = { ok: true; message?: string } | { ok: false; message: string };

function refreshCentres() {
  revalidatePath("/admin", "layout");
  revalidatePath("/agent", "layout");
}

export async function markNotificationRead(id: string): Promise<NotificationActionResult> {
  await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) return { ok: false, message: "Could not update the notification. Please try again." };
  refreshCentres();
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return { ok: false, message: "Could not update your notifications. Please try again." };
  refreshCentres();
  return { ok: true, message: data ? `${data} notification${data === 1 ? "" : "s"} marked as read.` : "Nothing to mark." };
}

/**
 * Opens a notification: marks it read and goes to its task. The destination is
 * built on the server from the caller's role and the notification's own task —
 * RLS returns the row only to its recipient, and nothing from the client is
 * used as a URL.
 */
export async function openNotification(id: string): Promise<void> {
  const { user, profile } = await requireUser();
  const home = profile.role === "ADMIN" ? "/admin/notifications" : "/agent/notifications";
  if (!z.uuid().safeParse(id).success) redirect(home);

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, task_id, type, is_read")
    .eq("id", id)
    .eq("recipient_user_id", user.id)
    .maybeSingle();
  if (!data) redirect(home);
  if (!data.is_read) {
    await supabase.rpc("mark_notification_read", { p_id: data.id });
    refreshCentres();
  }
  // A task that was reassigned away can no longer be opened by the previous agent.
  if (!data.task_id || data.type === "TASK_REASSIGNED") redirect(profile.role === "ADMIN" ? "/admin/tasks" : "/agent/tasks");
  redirect(`${profile.role === "ADMIN" ? "/admin/tasks" : "/agent/tasks"}/${data.task_id}`);
}

const preferencesSchema = z.object({
  email_enabled: z.boolean(),
  task_assignment: z.boolean(),
  task_status: z.boolean(),
  task_reminder: z.boolean(),
  cash_collection: z.boolean(),
  proof_upload: z.boolean(),
});

/** Saves the caller's own preferences (the user id comes from the session; RLS enforces it too). */
export async function saveNotificationPreferences(input: z.input<typeof preferencesSchema>): Promise<NotificationActionResult> {
  const { user } = await requireUser();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  // Update, then insert if there was no row yet (user_id itself is never updatable).
  const updated = await supabase.from("notification_preferences").update(parsed.data).eq("user_id", user.id).select("id");
  const error =
    updated.error ??
    (updated.data.length === 0
      ? (await supabase.from("notification_preferences").insert({ user_id: user.id, ...parsed.data })).error
      : null);
  if (error) {
    console.error("Could not save notification preferences", { code: error.code, message: error.message });
    return { ok: false, message: "Could not save your preferences. Please try again." };
  }
  return { ok: true, message: "Notification preferences saved." };
}

/** Admin: queue a failed message for another round of attempts. */
export async function retryCommunication(queueId: string): Promise<NotificationActionResult> {
  await requireAdmin();
  if (!z.uuid().safeParse(queueId).success) return { ok: false, message: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_retry_communication", { p_id: queueId });
  if (error) return { ok: false, message: "Could not retry this message." };
  if (!data) return { ok: false, message: "This message can no longer be retried." };
  kickCommunications();
  revalidatePath("/admin/notifications");
  return { ok: true, message: "Message queued again." };
}
