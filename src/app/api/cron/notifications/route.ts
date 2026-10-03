import { timingSafeEqual } from "node:crypto";

import { dispatchCommunications, runReminders, type DispatchSummary } from "@/lib/communication/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BATCHES = 5;

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // not configured: the endpoint is off
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduler entry point: creates due reminders and sends / retries queued
 * messages. Call it every few minutes with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends this header automatically when CRON_SECRET is set).
 */
export async function GET(request: Request) {
  const ok = authorised(request);
  if (ok === null) return Response.json({ error: "Scheduler is not configured." }, { status: 503 });
  if (!ok) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const reminders = await runReminders();
  const total: DispatchSummary = { claimed: 0, sent: 0, retry: 0, failed: 0, cancelled: 0 };
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const summary = await dispatchCommunications(50);
    for (const key of Object.keys(total) as (keyof DispatchSummary)[]) total[key] += summary[key];
    if (summary.claimed < 50) break;
  }
  return Response.json({ reminders, ...total });
}
