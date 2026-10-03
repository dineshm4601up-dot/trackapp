import "server-only";

import { after } from "next/server";
import { z } from "zod";

import { siteConfig } from "@/config/site";
import { renderNotificationEmail } from "@/lib/communication/email-template";
import { getEmailProvider, getMessageProvider } from "@/lib/communication/providers";
import type { SendResult } from "@/lib/communication/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database.types";

type QueueRow = Database["public"]["Tables"]["communication_queue"]["Row"];

export type DispatchSummary = { claimed: number; sent: number; retry: number; failed: number; cancelled: number };

/** Origin for links in messages. There may be no request here (scheduler), so only the configured URL is used. */
function appOrigin() {
  const configured = z.url().safeParse(process.env.NEXT_PUBLIC_APP_URL);
  return configured.success ? new URL(configured.data).origin : null;
}

async function deliver(row: QueueRow): Promise<{ outcome: "SENT" | "RETRY" | "FAILED" | "CANCELLED"; provider: string | null; result?: SendResult; reason?: string }> {
  if (row.channel === "EMAIL") {
    const email = getEmailProvider();
    // No provider: say so. Nothing is ever recorded as sent without a real send.
    if (!email.enabled) return { outcome: "CANCELLED", provider: null, reason: email.reason };
    const rendered = renderNotificationEmail({ subject: row.subject, message: row.message, payload: row.payload, origin: appOrigin() });
    const result = await email.provider.sendEmail({ to: row.recipient_address, ...rendered, idempotencyKey: row.id });
    return { outcome: result.ok ? "SENT" : result.permanent ? "FAILED" : "RETRY", provider: email.provider.name, result };
  }
  const messaging = getMessageProvider(row.channel === "SMS" ? "SMS" : "WHATSAPP");
  if (!messaging.enabled) return { outcome: "CANCELLED", provider: null, reason: messaging.reason };
  const result = await messaging.provider.sendMessage({ to: row.recipient_address, body: row.message, idempotencyKey: row.id });
  return { outcome: result.ok ? "SENT" : result.permanent ? "FAILED" : "RETRY", provider: messaging.provider.name, result };
}

/**
 * Sends due outbox messages. Runs on the server with the service client (the
 * queue is not writable by any app user). Each message is claimed atomically
 * (FOR UPDATE SKIP LOCKED), so parallel runs never send the same one twice;
 * the database applies the bounded retry policy.
 */
export async function dispatchCommunications(limit = 20): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, retry: 0, failed: 0, cancelled: 0 };
  const admin = createAdminClient();
  const { data: rows, error } = await admin.rpc("claim_communications", { p_limit: limit });
  if (error) {
    console.error("Could not claim communications", { code: error.code, message: error.message });
    return summary;
  }
  summary.claimed = rows.length;

  for (const row of rows) {
    let delivery: Awaited<ReturnType<typeof deliver>>;
    try {
      delivery = await deliver(row);
    } catch (e) {
      delivery = { outcome: "RETRY", provider: null, reason: `Unexpected error: ${(e as Error).name}` };
    }
    const errorText = delivery.result && !delivery.result.ok ? delivery.result.error : delivery.reason;
    const { data: status, error: completeError } = await admin.rpc("complete_communication", {
      p_id: row.id,
      p_outcome: delivery.outcome,
      p_provider: delivery.provider ?? undefined,
      p_provider_message_id: delivery.result?.ok ? (delivery.result.messageId ?? undefined) : undefined,
      p_error: errorText,
    });
    if (completeError) {
      console.error("Could not record communication result", { id: row.id, message: completeError.message });
      continue;
    }
    if (status === "SENT") summary.sent++;
    else if (status === "PENDING") summary.retry++;
    else if (status === "FAILED") summary.failed++;
    else if (status === "CANCELLED") summary.cancelled++;
  }
  return summary;
}

/**
 * After the current response is sent, try to deliver whatever the request just
 * queued. Best effort only — the scheduled job is what guarantees delivery and
 * retries — and it can never fail or slow down the task operation.
 */
export function kickCommunications() {
  try {
    after(async () => {
      try {
        await dispatchCommunications();
      } catch (error) {
        console.error("Background dispatch failed", { message: (error as Error).message });
      }
    });
  } catch {
    // Outside a request scope (e.g. a script): the scheduler will pick it up.
  }
}

/** Creates due reminders (once each). Called by the scheduler only. */
export async function runReminders(): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("enqueue_task_reminders", { p_time_zone: siteConfig.timeZone });
  if (error) {
    console.error("Could not create reminders", { code: error.code, message: error.message });
    return 0;
  }
  return data;
}
