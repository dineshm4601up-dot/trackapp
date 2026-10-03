// Client-safe notification metadata. The database decides who is notified and
// what the text says; this only drives presentation and filters.

export const NOTIFICATION_TYPES = [
  "TASK_ASSIGNED",
  "TASK_REASSIGNED",
  "TASK_ACCEPTED",
  "TASK_CHECKED_IN",
  "TASK_STARTED",
  "TASK_COMPLETED",
  "TASK_PARTIALLY_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "TASK_RESCHEDULED",
  "TASK_VERIFIED",
  "CASH_COLLECTION_RECORDED",
  "PROOF_UPLOADED",
  "TASK_REMINDER",
  "SYSTEM",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationTone = "info" | "success" | "warning" | "destructive" | "muted";

export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string; tone: NotificationTone }> = {
  TASK_ASSIGNED: { label: "Task assigned", tone: "info" },
  TASK_REASSIGNED: { label: "Task reassigned", tone: "warning" },
  TASK_ACCEPTED: { label: "Task accepted", tone: "info" },
  TASK_CHECKED_IN: { label: "Checked in", tone: "info" },
  TASK_STARTED: { label: "Task started", tone: "info" },
  TASK_COMPLETED: { label: "Task completed", tone: "success" },
  TASK_PARTIALLY_COMPLETED: { label: "Partially completed", tone: "warning" },
  TASK_FAILED: { label: "Task failed", tone: "destructive" },
  TASK_CANCELLED: { label: "Task cancelled", tone: "muted" },
  TASK_RESCHEDULED: { label: "Task rescheduled", tone: "warning" },
  TASK_VERIFIED: { label: "Task verified", tone: "success" },
  CASH_COLLECTION_RECORDED: { label: "Cash recorded", tone: "success" },
  PROOF_UPLOADED: { label: "Proof uploaded", tone: "info" },
  TASK_REMINDER: { label: "Reminder", tone: "warning" },
  SYSTEM: { label: "System", tone: "muted" },
};

export function notificationTypeMeta(type: string) {
  return type in NOTIFICATION_TYPE_META ? NOTIFICATION_TYPE_META[type as NotificationType] : { label: type, tone: "muted" as const };
}

export const LOG_CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] as const;
export const CHANNEL_LABELS: Record<(typeof LOG_CHANNELS)[number], string> = {
  IN_APP: "In-app",
  EMAIL: "E-mail",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

export const LOG_STATUSES = ["DELIVERED", "READ", "PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED"] as const;
export const STATUS_LABELS: Record<(typeof LOG_STATUSES)[number], { label: string; badge: "secondary" | "success" | "warning" | "destructive" | "info" }> = {
  DELIVERED: { label: "Delivered (unread)", badge: "info" },
  READ: { label: "Read", badge: "secondary" },
  PENDING: { label: "Queued", badge: "warning" },
  PROCESSING: { label: "Sending", badge: "warning" },
  SENT: { label: "Sent", badge: "success" },
  FAILED: { label: "Failed", badge: "destructive" },
  CANCELLED: { label: "Not sent", badge: "secondary" },
};

export const NOTIFICATION_PAGE_SIZE = 20;
export const BELL_PREVIEW_SIZE = 6;

/** Preference switches. Assignment, reassignment and cancellation always appear in-app. */
export const PREFERENCE_FIELDS = [
  { key: "task_assignment", label: "Task assignments", hint: "E-mail for new and reassigned tasks. These always appear in the app." },
  { key: "task_status", label: "Task status updates", hint: "Accepted, checked in, started, completed, failed, verified, rescheduled." },
  { key: "task_reminder", label: "Reminders", hint: "Tasks starting soon and overdue tasks." },
  { key: "cash_collection", label: "Cash collections", hint: "When a cash collection is recorded." },
  { key: "proof_upload", label: "Proof uploads", hint: "When proof is uploaded for a task." },
] as const;
export type PreferenceKey = (typeof PREFERENCE_FIELDS)[number]["key"] | "email_enabled";
