# Notifications and communication (Phase 10)

The app tells the right person about meaningful task events — in the app, and by e-mail for the important ones — without tying the task system to any messaging provider.

**Channels today:** in-app is always on. E-mail is on when a provider is configured (Resend is supported). SMS and WhatsApp have the interface and queue support but **no provider is implemented**, so they are off.

## Architecture

```text
Task event (status change, assignment, reassignment, schedule change, cash, proof)
    ↓  database trigger, in the same transaction as the change
publish_notification()          recipient → preferences → idempotent in-app row
    ↓
notifications                   → Supabase Realtime → bell and notification centre
    ↓  (important types only, if the recipient wants e-mail)
communication_queue (outbox, PENDING)
    ↓  after the request, and from the scheduler
dispatcher (server) → provider registry → provider adapter (Resend) → e-mail
    ↓
communication_queue (SENT / FAILED / CANCELLED, attempts, provider id, error) + audit log
```

- **Events come from the database.** Every task change already goes through Postgres functions, so triggers on `task_status_history`, `tasks`, `cash_collections` and `task_proofs` see every event, whichever screen or function caused it. A notification exists only if the change committed.
- **No provider call inside a transaction.** The trigger writes an outbox row; sending happens afterwards. A provider outage cannot fail or roll back a task.
- **Notification errors are contained.** If creating a notification fails, the trigger logs a warning and the task operation continues.
- **Business code has no provider code.** `src/lib/communication/` holds the contracts (`types.ts`), the registry (`providers/index.ts`), the Resend adapter, the e-mail template and the dispatcher. Server actions only call `kickCommunications()`, which means "try to send what was just queued".

## Who is notified

| Event | Recipient | In-app title | E-mail |
|---|---|---|---|
| Task assigned (new or draft → assigned) | assigned agent | New Task Assigned | yes |
| Task reassigned | previous agent / new agent | Task Reassigned / New Task Assigned | yes |
| Schedule changed on an assigned task | assigned agent | Task Rescheduled | yes |
| Agent accepted | admins | Task Accepted | no |
| GPS check-in | admins | Agent Checked In | no |
| Work started | admins | Task In Progress | no |
| Completed | admins | Task Completed | yes |
| Partially completed | admins | Task Partially Completed | yes |
| Failed | admins | Task Failed | yes |
| Cancelled | assigned agent | Task Cancelled | yes |
| Verified | assigned agent | Task Verified | yes |
| Cash collection recorded | admins | Cash Collection Recorded | no |
| Proof uploaded (once per task) | admins | Proof Uploaded | no |
| Starts within 60 minutes | assigned agent | Task Starting Soon | yes |
| Overdue by 30 minutes | assigned agent and admins | Task Overdue | yes |

- "Admins" means every active admin except the one who performed the action. Nobody is notified about their own action.
- **Not notified:** start of travel, arrival, location events, and edits that change nothing the agent needs to know. Those are visible live on the monitoring screens.
- The previous agent of a reassigned task is told only that the task is no longer theirs.
- Messages use the task code and contain no amounts, payment references, coordinates, phone numbers or internal ids.

## Tables

| Table | Purpose |
|---|---|
| `notifications` | One row per recipient per event: `type`, `title`, `message`, `data` (display snapshot and link path), `dedupe_key`, `is_read`, `read_at` |
| `communication_queue` | Outbox and delivery history for external channels: channel, address, subject, status, attempts, provider, provider message id, last error, timestamps |
| `notification_preferences` | One row per user: `email_enabled`, `sms_enabled`, `whatsapp_enabled`, and the categories `task_assignment`, `task_status`, `task_reminder`, `cash_collection`, `proof_upload` |
| `communication_log` (view) | Every notification with each of its channels, for the admin delivery log |

Indexes follow the queries: inbox `(recipient_user_id, created_at desc)`, unread count (partial, `where not is_read`), `(task_id)`, `(type, created_at desc)`, due messages `(scheduled_at) where status in (PENDING, PROCESSING)`.

### Idempotency

`notifications` has `unique (recipient_user_id, dedupe_key)`, and `communication_queue` has `unique (notification_id, channel)`. The key is the business event:

| Event | Key |
|---|---|
| Status change | `status:<task_status_history.id>` |
| Reassignment / schedule change | task id + transaction time |
| Cash collection | `cash:<cash_collections.id>` |
| Proof | `proof:<task id>` (one per task) |
| Reminder | `reminder:start:<task>:<start time>` / `reminder:overdue:<task>:<date>` |

Refreshes, retries, duplicate requests and realtime reconnects cannot create a second notification, because none of them creates a second event. The provider request carries the queue row id as an idempotency key.

## Security (RLS)

| | Agent | Admin |
|---|---|---|
| `notifications` | read own | read own and others' (delivery log) |
| create / edit / delete a notification | no | no |
| mark as read | own only, through `mark_notification_read()` / `mark_all_notifications_read()` | own only |
| `communication_queue` | no access | read only; `admin_retry_communication()` for a failed message |
| `notification_preferences` | read / create / update own row | own row |

- Notifications are created only by `SECURITY DEFINER` functions that no app user can call. A client cannot choose a recipient, type or text.
- Inactive users are never recipients and can read nothing. Anonymous users have no access.
- The outbox is processed with the service key on the server only (`claim_communications`, `complete_communication`, `enqueue_task_reminders` are executable by `service_role` alone).
- Realtime delivers a `notifications` row only to subscribers whose RLS allows it; the bell additionally filters on the user's own id.
- E-mail HTML escapes every dynamic value, and only same-app `/admin/…` or `/agent/…` paths are linked.
- Audit log entries: `SEND_NOTIFICATION`, `NOTIFICATION_FAILED`, `RETRY_NOTIFICATION`, `CREATE_NOTIFICATION_PREFERENCES`, `UPDATE_NOTIFICATION_PREFERENCES`. Reading a notification is not audited.

## Preferences

Users set their own preferences (agent: **Profile**; admin: **Notifications → Settings**).

- **E-mail notifications** turns all e-mail to that user on or off.
- A category switched off is not delivered at all, with one exception: **new, reassigned and cancelled tasks always appear in the app**, because the agent must know their work changed. Switching "Task assignments" off stops only the e-mail.

## Delivery, retries and expiry

| Outcome of an attempt | Result |
|---|---|
| Provider accepted | `SENT`, provider message id and time recorded |
| Temporary failure (network, timeout, HTTP 429 or 5xx) | queued again: after 1 minute, then after 5 minutes |
| Third temporary failure | `FAILED` (limit: `communication_max_attempts` = 3) |
| Permanent failure (other HTTP 4xx: bad address, rejected sender, bad key) | `FAILED` immediately |
| No provider configured for the channel | `CANCELLED` ("Not sent") with the reason — never recorded as sent |
| Still queued after 24 hours (`communication_max_age_hours`) | `CANCELLED` — a late message would no longer be true |

- Messages are claimed with `FOR UPDATE SKIP LOCKED`, so two dispatchers never send the same one.
- A message stuck in `PROCESSING` for 10 minutes (a crashed worker) is given back within the attempt limit.
- An admin can press **Retry** on a failed message in the delivery log, which gives it a fresh set of attempts.

## Scheduler (required in production)

Two things need a scheduled job: **reminders** and **retries**. First-attempt e-mails are also sent right after the request that caused them (Next.js `after()`), but that is best effort and must not be relied on alone.

The job is `GET /api/cron/notifications` with the header `Authorization: Bearer $CRON_SECRET`. It creates due reminders and sends or retries queued messages. Without `CRON_SECRET` the endpoint answers 503; with a wrong secret, 401.

**Vercel Cron** — add to `vercel.json` (Vercel sends the header automatically when `CRON_SECRET` is set):

```json
{ "crons": [{ "path": "/api/cron/notifications", "schedule": "*/5 * * * *" }] }
```

Vercel's Hobby plan only allows daily cron jobs; a five-minute schedule needs a paid plan or an external scheduler (any service that can send the request above every few minutes). `vercel.json` is not committed, so deployments do not fail on plans that reject the schedule.

Reminder timing is only as precise as the schedule: with a five-minute job, a "starts within 60 minutes" reminder arrives 55–60 minutes before the start.

## Setup

### E-mail (Resend)

1. Create a Resend account, verify your sending domain, and create an API key.
2. Set on the server (Vercel → Environment Variables, or `.env.local`):

```env
EMAIL_PROVIDER=resend
EMAIL_API_KEY=re_...
EMAIL_FROM="FieldTrack <notifications@your-domain.com>"
CRON_SECRET=<long random string>
NEXT_PUBLIC_APP_URL=https://your-app.example.com
```

`NEXT_PUBLIC_APP_URL` is used for the "Open task" link in e-mails; without it the link is left out. None of the other variables may be prefixed with `NEXT_PUBLIC_`.

To add another provider (SendGrid, SES, SMTP), implement `EmailProvider` and add a case in `getEmailProvider()` in `src/lib/communication/providers/index.ts`. Nothing else changes.

### SMS / WhatsApp

Not enabled. To add one: implement `MessageProvider` for the provider, return it from `getMessageProvider()` based on a server-only variable (for example `SMS_PROVIDER` / `SMS_API_KEY`), and set `channel_sms_enabled` or `channel_whatsapp_enabled` to `1` in `app_settings`. Users then opt in with `sms_enabled` / `whatsapp_enabled`. Until then nothing is queued for these channels.

### Local development

- With no e-mail variables, in-app notifications work fully and queued e-mails end as "Not sent — No e-mail provider is configured".
- `EMAIL_API_BASE_URL` (optional) points the Resend adapter at another host. The test suite uses it to send to a local mock instead of the real API.
- Run the scheduler by hand: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/notifications`.

## Screens

| Route | What |
|---|---|
| Header bell (admin) | Unread badge and a dropdown of the latest notifications; updates live |
| Header bell (agent) | Unread badge; opens the notification centre |
| `/agent/notifications` | All / Unread, mark one or all as read, open the task |
| `/admin/notifications` | **My notifications**, **Delivery log** (recipient, task, channel, status, attempts, error; filters by recipient or task, type, channel, status and date range), **Settings** (preferences and which channels are enabled) |

Lists show 20 per page. The bell runs two indexed queries (unread count, latest six) and one Realtime channel per screen.

## Troubleshooting

| Symptom | Check |
|---|---|
| No e-mails, delivery log shows "Not sent" | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` on the server; Settings tab shows the reason |
| E-mails "Failed" with HTTP 401/403/422 | API key, verified sender domain, recipient address |
| E-mails stay "Queued" | The scheduler is not running, or `CRON_SECRET` is missing |
| No reminders | Scheduler not running; task has no scheduled date and start time; task is not ASSIGNED or ACCEPTED |
| Bell does not update live | "Live updates temporarily unavailable" elsewhere on the page means Realtime is disconnected; the page still updates on refresh |
| A user gets no notifications of one kind | Their preferences; inactive accounts receive nothing |
