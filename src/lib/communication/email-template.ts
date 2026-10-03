import "server-only";

import { z } from "zod";

import { siteConfig } from "@/config/site";
import { TASK_TYPE_META, type TaskType } from "@/features/tasks/constants";
import { formatCalendarDate, formatWallTime } from "@/lib/format";

/** Everything dynamic passes through this before it reaches HTML. */
export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The snapshot written by notification_task_data(). Unknown keys are ignored.
const payloadSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  task_code: z.string().optional(),
  task_type: z.string().optional(),
  task_title: z.string().optional(),
  customer: z.string().optional(),
  location: z.string().optional(),
  city: z.string().optional(),
  scheduled_date: z.string().optional(),
  scheduled_start_time: z.string().optional(),
  priority: z.number().optional(),
  path: z.string().optional(),
});

/** Opening line per notification type; anything else uses the stored message alone. */
const INTRO: Record<string, string> = {
  TASK_ASSIGNED: "A new task has been assigned to you.",
  TASK_REASSIGNED: "A task is no longer assigned to you.",
  TASK_COMPLETED: "A task has been completed.",
  TASK_PARTIALLY_COMPLETED: "A task was only partially completed and may need follow-up.",
  TASK_FAILED: "A task could not be completed and needs your attention.",
  TASK_CANCELLED: "A task assigned to you has been cancelled. No action is needed.",
  TASK_RESCHEDULED: "The schedule of a task assigned to you has changed.",
  TASK_VERIFIED: "A task you completed has been verified.",
  TASK_REMINDER: "A reminder about one of your tasks.",
};

export type RenderedEmail = { subject: string; html: string; text: string };

/**
 * One responsive template for every notification e-mail. Content is the
 * notification's own title and message plus a few task details — no internal
 * ids, coordinates, amounts or contact data.
 */
export function renderNotificationEmail(input: {
  subject: string | null;
  message: string;
  payload: unknown;
  /** Absolute app origin for the "Open task" link; omitted when unknown. */
  origin: string | null;
}): RenderedEmail {
  const parsed = payloadSchema.safeParse(input.payload);
  const p = parsed.success ? parsed.data : {};
  const title = p.title ?? "Notification";
  const subject = (input.subject ?? title).replace(/[\r\n]+/g, " ").slice(0, 200);

  const schedule = p.scheduled_date
    ? `${formatCalendarDate(p.scheduled_date)}${p.scheduled_start_time ? `, ${formatWallTime(p.scheduled_start_time)}` : ""}`
    : null;
  const typeLabel = p.task_type && p.task_type in TASK_TYPE_META ? TASK_TYPE_META[p.task_type as TaskType].label : null;
  const rows: [string, string | null | undefined][] = [
    ["Task", p.task_code],
    ["Type", typeLabel],
    ["Title", p.task_title],
    ["Customer", p.customer],
    ["Location", [p.location, p.city].filter(Boolean).join(", ") || null],
    ["Scheduled", schedule],
    ["Priority", p.priority ? `P${p.priority}` : null],
  ];
  const details = rows.filter((row): row is [string, string] => Boolean(row[1]));
  // Only same-app paths are ever linked.
  const link = input.origin && p.path && /^\/(admin|agent)\/[A-Za-z0-9/-]*$/.test(p.path) ? `${input.origin}${p.path}` : null;
  const intro = p.type ? INTRO[p.type] : undefined;

  const text = [
    title,
    "",
    input.message,
    ...(details.length ? ["", ...details.map(([label, value]) => `${label}: ${value}`)] : []),
    ...(link ? ["", `Open: ${link}`] : []),
    "",
    `— ${siteConfig.name}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
<tr><td style="padding:20px 24px 0;font-size:13px;font-weight:600;color:#71717a;">${escapeHtml(siteConfig.name)}</td></tr>
<tr><td style="padding:8px 24px 0;font-size:20px;font-weight:600;line-height:1.3;">${escapeHtml(title)}</td></tr>
${intro ? `<tr><td style="padding:8px 24px 0;font-size:14px;line-height:1.5;color:#52525b;">${escapeHtml(intro)}</td></tr>` : ""}
<tr><td style="padding:12px 24px 0;font-size:15px;line-height:1.5;">${escapeHtml(input.message)}</td></tr>
${
  details.length
    ? `<tr><td style="padding:16px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;border-top:1px solid #e4e4e7;">
${details
  .map(
    ([label, value]) =>
      `<tr><td style="padding:8px 12px 0 0;color:#71717a;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 0 0;">${escapeHtml(value)}</td></tr>`,
  )
  .join("\n")}
</table></td></tr>`
    : ""
}
${
  link
    ? `<tr><td style="padding:20px 24px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">Open task</a></td></tr>`
    : ""
}
<tr><td style="padding:24px;font-size:12px;line-height:1.5;color:#a1a1aa;">You receive this because of your notification settings in ${escapeHtml(siteConfig.name)}. You can change them in the app.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
