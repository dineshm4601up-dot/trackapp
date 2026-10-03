import "server-only";

import { z } from "zod";

import {
  BELL_PREVIEW_SIZE,
  LOG_CHANNELS,
  LOG_STATUSES,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_TYPES,
} from "@/features/notifications/constants";
import { fetchPage } from "@/lib/db-errors";
import { pageRange, searchFilter } from "@/lib/list-params";
import { createClient } from "@/lib/supabase/server";

// All reads use the caller's session. RLS returns a user only their own
// notifications; the recipient filter below additionally keeps an admin's
// personal inbox to their own rows (admins may read everyone's for the log).

const COLUMNS = "id, type, title, message, task_id, is_read, created_at";
// The bell is on every page: it gets only what it displays (no task ids or snapshots).
const BELL_COLUMNS = "id, title, message, is_read, created_at";

/** Unread count and the newest few, for the header bell. One indexed query each. */
export async function getBellNotifications(userId: string) {
  const supabase = await createClient();
  const [unread, latest] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", userId).eq("is_read", false),
    supabase
      .from("notifications")
      .select(BELL_COLUMNS)
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(BELL_PREVIEW_SIZE),
  ]);
  return { unread: unread.error ? 0 : (unread.count ?? 0), items: latest.data ?? [] };
}

export type BellNotifications = Awaited<ReturnType<typeof getBellNotifications>>;

export const inboxParamsSchema = z.object({
  filter: z.enum(["all", "unread"]).catch("all"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type InboxParams = z.infer<typeof inboxParamsSchema>;

export async function listMyNotifications(userId: string, params: InboxParams) {
  const supabase = await createClient();
  const { from, to } = pageRange(params.page, NOTIFICATION_PAGE_SIZE);
  let query = supabase
    .from("notifications")
    .select(COLUMNS, { count: "exact" })
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (params.filter === "unread") query = query.eq("is_read", false);
  return fetchPage(query, "notifications");
}

const PREFERENCE_COLUMNS = "email_enabled, task_assignment, task_status, task_reminder, cash_collection, proof_upload";

export const DEFAULT_PREFERENCES = {
  email_enabled: true,
  task_assignment: true,
  task_status: true,
  task_reminder: true,
  cash_collection: true,
  proof_upload: true,
};
export type Preferences = typeof DEFAULT_PREFERENCES;

/** The user's saved preferences, or the defaults if they never changed any. */
export async function getMyPreferences(userId: string): Promise<Preferences> {
  const supabase = await createClient();
  const { data } = await supabase.from("notification_preferences").select(PREFERENCE_COLUMNS).eq("user_id", userId).maybeSingle();
  return data ?? DEFAULT_PREFERENCES;
}

// ---------------------------------------------------------------- admin delivery log

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional().catch(undefined);

export const logFiltersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  type: optionalEnum(NOTIFICATION_TYPES),
  channel: optionalEnum(LOG_CHANNELS),
  status: optionalEnum(LOG_STATUSES),
  from: z.string().regex(DATE).optional().catch(undefined),
  to: z.string().regex(DATE).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type LogFilters = z.infer<typeof logFiltersSchema>;

export function logFilterQuery(f: LogFilters): Record<string, string | undefined> {
  return { view: "log", q: f.q || undefined, type: f.type, channel: f.channel, status: f.status, from: f.from, to: f.to };
}

/**
 * Every notification with each of its channels (in-app, e-mail, …), newest
 * first. Admin only: the view applies RLS, and the page calls requireAdmin().
 * `q` searches recipient name, address and task code.
 */
export async function listCommunicationLog(filters: LogFilters, timeZoneOffset: string) {
  const supabase = await createClient();
  const { from, to } = pageRange(filters.page, NOTIFICATION_PAGE_SIZE);
  let query = supabase
    .from("communication_log")
    .select(
      "id, queue_id, created_at, type, title, task_id, task_code, recipient_name, channel, status, provider, recipient_address, attempt_count, sent_at, failed_at, last_error",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.channel) query = query.eq("channel", filters.channel);
  if (filters.status) query = query.eq("status", filters.status);
  // Day boundaries in the business time zone.
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00${timeZoneOffset}`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999${timeZoneOffset}`);
  const search = searchFilter(["recipient_name", "recipient_address", "task_code"], filters.q);
  if (search) query = query.or(search);
  return fetchPage(query, "notification log");
}

export type LogRow = Awaited<ReturnType<typeof listCommunicationLog>>["rows"][number];
