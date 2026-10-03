import { timingSafeEqual } from "node:crypto";

import { runPredictions } from "@/lib/ai/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // not configured: the endpoint is off
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduler entry point for AI: refreshes the stored predictions, forecast,
 * anomalies and recommendations, and records outcomes of finished tasks.
 * Call it every 15–30 minutes with `Authorization: Bearer $CRON_SECRET`.
 * It is rate limited in the database, and it never calls a language model
 * (the summary is generated on request by an administrator).
 */
export async function GET(request: Request) {
  const ok = authorised(request);
  if (ok === null) return Response.json({ error: "Scheduler is not configured." }, { status: 503 });
  if (!ok) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const result = await runPredictions(createAdminClient(), "SCHEDULED");
  if (!result.ok) {
    // Disabled or run-too-recently are normal outcomes for a scheduler, not errors.
    return Response.json({ ok: false, code: result.code }, { status: result.code === "FAILED" ? 500 : 200 });
  }
  return Response.json(result);
}
