# FieldTrack

Field task tracking: admins assign tasks (delivery, cash collection, pickup, inspection, …) at customer locations; agents travel there, check in by GPS, perform the task, submit proof, and admins verify.

**Status:** Phases 1–12 — foundation, authentication & roles, database & RLS, master data, task creation & assignment, the agent task workflow, GPS check-in with server-side geofence validation, task execution (delivery quantities, cash collection, photo/document proof, failure reporting), admin monitoring (live task updates, task-scoped agent location sharing, operational map), notifications (in-app notification centres with live updates, e-mail through a provider abstraction, preferences, reminders), analytics (KPI dashboard, reports with drill-down, CSV / Excel export, data-quality checks), and experimental AI decision support (delay and failure risk, operational ETA, workload forecast, anomalies, recommendations, operational summary — advisory only).

## Technology stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict) |
| UI | Tailwind CSS v4, shadcn/ui (Radix, Nova preset), Lucide icons, Sonner toasts |
| Backend | Supabase — Postgres, Auth, Storage, Realtime, Row Level Security |
| Supabase SDK | `@supabase/supabase-js`, `@supabase/ssr` (cookie-based sessions) |
| Validation | Zod |
| Hosting | Vercel (Node.js 24) |

## Prerequisites

- Node.js **24 LTS** (see `.nvmrc`; `engines` pins `24.x` for Vercel)
- npm 10+
- A Supabase project (Dashboard → Project Settings → API Keys)

## Environment variables

Copy the template and fill it in. `.env.local` is git-ignored — never commit it.

```bash
cp .env.example .env.local
```

| Variable | Exposed to browser | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable key (`sb_publishable_…`) or legacy anon key. Safe: data is protected by RLS |
| `NEXT_PUBLIC_MAPS_API_KEY` | Yes | Maps key, referrer-restricted (used from the maps phase) |
| `NEXT_PUBLIC_APP_URL` | Yes | Base URL for auth redirects and for the "Open task" link in notification e-mails |
| `SUPABASE_SECRET_KEY` | **Never** | Secret / service-role key. Bypasses RLS; server-only. Used for agent provisioning, removing rejected proof uploads, and the notification outbox |
| `EMAIL_PROVIDER` | **Never** | `resend`, or empty to keep e-mail disabled |
| `EMAIL_API_KEY` | **Never** | API key of the e-mail provider |
| `EMAIL_FROM` | **Never** | Verified sender, e.g. `FieldTrack <notifications@example.com>` |
| `CRON_SECRET` | **Never** | Secret for the scheduler endpoints `/api/cron/notifications` and `/api/cron/ai` |
| `AI_FEATURES_ENABLED`, `AI_*_ENABLED` | **Never** | Set to `false` to switch AI (or one AI feature) off for the deployment; default on |
| `AI_SUMMARY_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_SUMMARY_MODEL` | **Never** | Optional language model for the operational summary (`anthropic`); without them a built-in template is used |

Only `NEXT_PUBLIC_*` variables are ever bundled into client JavaScript. The app builds without any variables set; pages that need Supabase report "not configured" instead of crashing.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev                  # http://localhost:3000
```

Open `/status` to verify the Supabase connection from both the server and the browser.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc --noEmit` |
| `npm run db:types` | Regenerate `src/types/database.types.ts` from the database (needs `SUPABASE_DB_URL`) |
| `npm run dev:webpack` / `npm run build:webpack` | Same as `dev` / `build` with Webpack + WASM. Use when Windows Smart App Control blocks Next's native compiler. |

## Routes

| Route | Access | Description |
|---|---|---|
| `/` | Public | Landing page |
| `/login` | Public | Email/password sign-in (no public registration) |
| `/status` | Public | Supabase connection check |
| `/set-password` | Link holder | Agent onboarding: one-time setup link → choose password |
| `/admin` | `ADMIN` | Dashboard with master-data counts |
| `/admin/agents`, `/customers`, `/locations`, `/products` | `ADMIN` | Master data management, see [docs/master-data.md](docs/master-data.md) |
| `/admin/monitoring`, `/admin/monitoring/map` | `ADMIN` | Live task board and map of last known agent locations, see [docs/monitoring.md](docs/monitoring.md) |
| `/admin/tasks` | `ADMIN` | Task creation, assignment, editing and cancellation, see [docs/tasks.md](docs/tasks.md) |
| `/admin/notifications` | `ADMIN` | Own notifications, delivery log of everything sent, preferences and channel status |
| `/agent/notifications` | `AGENT` | Notification centre (also the bell in the header) |
| `/api/cron/notifications` | Scheduler secret | Creates reminders and sends / retries queued messages |
| `/admin/analytics`, `/admin/reports/*` | `ADMIN` | KPI dashboard and reports (tasks, agents, deliveries, cash, check-ins, customers, locations, exceptions, data quality) with export, see [docs/analytics.md](docs/analytics.md) |
| `/admin/reports/export` | `ADMIN` | Server-generated CSV / XLSX of a report with its current filters |
| `/admin/ai`, `/admin/ai/recommendations` | `ADMIN` | Experimental predictions, forecast, anomalies, operational summary; recommendation review — see [docs/ai.md](docs/ai.md) |
| `/admin/settings`, `/admin/settings/ai` | `ADMIN` | AI feature switches, model registry, usage, feature list, evaluation counts |
| `/api/cron/ai` | Scheduler secret | Refreshes predictions, anomalies and recommendations |
| `/agent`, `/agent/tasks`, `/agent/tasks/[id]`, `/agent/history` | `AGENT` | Mobile task workflow (accept → travel → arrive → GPS check-in → start → record delivery / cash / proof → complete, or report a failure), see [docs/agent-workflow.md](docs/agent-workflow.md), [docs/gps-checkin.md](docs/gps-checkin.md) and [docs/task-execution.md](docs/task-execution.md) |
| `/auth/signout` | — | Forced sign-out for inactive/unprovisioned accounts |

## Database migrations

SQL migrations live in `supabase/migrations/` and are idempotent (safe to re-run, never drop data). Apply them in order using either:

- **Supabase Dashboard → SQL Editor:** paste the file contents and run, or
- **Supabase CLI:** `npx supabase db push --db-url "$SUPABASE_DB_URL"`.

Schema, relationships, RLS rules and indexes are documented in [docs/database.md](docs/database.md). The RLS security suite (`supabase/tests/rls_security_test.sql`) runs as real API roles and rolls back all test data.

## Authentication & roles

- Supabase Auth, email + password. Sessions live in HTTP-only cookies managed by `@supabase/ssr`; `src/proxy.ts` refreshes them on each request.
- Each auth user has one row in `public.profiles` (`id` = `auth.users.id`), created automatically by the `on_auth_user_created` trigger with `role = 'AGENT'` and `is_active = true`.
- Users can read **only their own** profile. Admins can edit agents' name and phone; nobody can change `role` or account `is_active` through the app. Those are operator tasks (SQL Editor / service role).
- An AGENT can use the app only with an **active agent record** (created under Admin → Agents).
- Server-side guards in `src/lib/auth/session.ts` — `requireUser()`, `requireAdmin()`, `requireAgent()` — protect every admin/agent layout and page. An agent opening `/admin` is sent to `/agent` and vice-versa; inactive or unprovisioned accounts are signed out with an explanation.

**Required Supabase setting:** Dashboard → Authentication → Sign In / Providers → turn **off "Allow new users to sign up"**. Accounts are created by administrators only; with sign-ups enabled, anyone holding the public key could register an (agent) account.

### Creating users

- **Agents:** Admin → Agents → *Add agent*. The admin receives a one-time link for the agent to set their own password. Entering the email of an existing AGENT account links that account instead.
- **Admins** (operator task, deliberately not in the UI): Dashboard → **Authentication → Users → Add user** (tick **Auto Confirm User**), then in **SQL Editor**:

```sql
update public.profiles set full_name = 'Jane Admin', role = 'ADMIN', is_active = true
where email = 'jane@example.com';
```

- **Block any account entirely:** `update public.profiles set is_active = false where email = '…';` (agents can also be deactivated from the Agents page).

Never commit real credentials or test passwords to the repository.

## Project structure

```text
src/
├─ app/
│  ├─ (public)/          # landing + /status (connection check)
│  ├─ (auth)/login/      # sign-in page
│  ├─ admin/             # admin shell; [section] = placeholder for unbuilt modules
│  └─ agent/             # mobile agent shell; [section] = placeholder screens
├─ components/
│  ├─ ui/                # shadcn/ui primitives (generated, owned by us)
│  ├─ layout/            # brand, admin sidebar/header, agent header/bottom nav
│  └─ shared/            # page header, empty state, stat card, route error
├─ config/               # site branding, navigation definitions
├─ features/
│  ├─ auth/              # sign-in/out, password setup
│  ├─ agents/ customers/ locations/ products/   # master data
│  └─ tasks/             # task creation & assignment
├─ lib/
│  ├─ auth/              # roles, profile loading, requireAdmin/requireAgent guards
│  ├─ env.ts             # Zod-validated public environment
│  ├─ supabase/          # browser, server and proxy clients; health check
│  └─ utils.ts           # cn() class helper
└─ proxy.ts              # session refresh + redirect of signed-out visitors
supabase/
├─ migrations/           # SQL migrations (idempotent)
└─ tests/                # database security tests (rolled back)
docs/
├─ database.md           # schema, relationships, RLS
├─ master-data.md, tasks.md, agent-workflow.md, gps-checkin.md
├─ task-execution.md     # delivery, cash, proof, completion
├─ monitoring.md         # realtime monitoring, location sharing, map
├─ notifications.md      # notification events, outbox, providers, scheduler
├─ analytics.md          # KPI definitions, reports, exports, time zone
└─ ai.md                 # predictions, methods, data requirements, privacy, provider
```

Domain code goes in `src/features/<domain>/` (components, actions, queries, schemas) as each phase adds it.

## Notifications

Full reference: [docs/notifications.md](docs/notifications.md).

- **Flow:** a task event (assignment, reassignment, accept, check-in, start, complete, partial, fail, cancel, verify, reschedule, cash, proof, reminder) → database trigger in the same transaction → `notifications` row for each recipient → Supabase Realtime → bell and notification centre. Important types also write an outbox row (`communication_queue`) that the server sends afterwards through a provider adapter.
- **Tables:** `notifications`, `communication_queue` (outbox and delivery history), `notification_preferences`, and the `communication_log` view.
- **RLS:** users read only their own notifications and mark only their own as read; nobody can create, edit or retarget one from the client; the outbox is admin-read-only and processed with the service key on the server.
- **Providers:** in-app is always on. **E-mail: Resend, when configured.** **SMS and WhatsApp: interface only, not enabled.** Business code depends on `src/lib/communication/types.ts`, never on a provider.
- **E-mail setup:** set `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM` and `NEXT_PUBLIC_APP_URL` on the server. Without them e-mails are recorded as "Not sent" and everything else works.
- **Retries:** up to 3 attempts (after 1 and 5 minutes) for temporary failures; permanent failures stop at once; messages older than 24 hours are cancelled. A failed e-mail never affects the task.
- **Scheduler (production):** call `GET /api/cron/notifications` with `Authorization: Bearer $CRON_SECRET` every few minutes (Vercel Cron or any external scheduler). It creates reminders and retries queued messages. No `vercel.json` is committed — see the doc for the snippet and the Hobby-plan limit.
- **Local development:** nothing to configure for in-app notifications. Trigger the scheduler by hand with `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/notifications`.
- **Troubleshooting:** the Settings tab of `/admin/notifications` shows which channels are enabled and why not; the Delivery log shows each message with its attempts and error.

## Analytics and reports

Full reference, including every formula: [docs/analytics.md](docs/analytics.md).

- **Architecture:** operational tables → `report_task_facts()` (one row per task) → `report_*()` SQL aggregations → server-only analytics service → pages and exports. No second database, no cache, no materialized views.
- **Period:** a task is counted on its scheduled date (creation date if unscheduled) in the business time zone (`siteConfig.timeZone`). Presets from Today to Last month, plus a custom range.
- **Filters:** agent, customer, location, task type, status, priority — in the URL, shared by every number, table and export on the page.
- **Key formulas:** completion rate = completed ÷ eligible (all statuses except Draft, Cancelled, Rescheduled); on-time rate = completed by the scheduled end ÷ completed tasks with a scheduled end; fulfilment = delivered ÷ assigned on closed deliveries; collection rate = collected ÷ expected on closed cash tasks. A rate with nothing to divide by is **N/A**, never 0%.
- **Drill-down:** every KPI opens the task report filtered to exactly the rows it counted; each row opens the task.
- **Exports:** CSV and Excel, generated on the server with the current filters, admin-only, capped at 10,000 rows, formula-safe.
- **Security:** reporting functions run with the caller's rights (RLS applies) and are read-only; organisation-wide reports require an admin. Agents see only their own summary on their home screen.
- **Privacy:** no report uses the location history; check-in analytics are aggregates without coordinates.
- **Data quality:** `/admin/reports/data-quality` lists inconsistent records; nothing is corrected automatically.

## AI decision support

Full reference: [docs/ai.md](docs/ai.md).

- **Advisory only.** AI estimates and recommends; it never changes a task, assignment, schedule, payment or status. Accepting a recommendation only records that an admin acknowledged it.
- **Experimental.** Version 1 uses transparent statistics over the last 180 days of closed tasks (medians, quartiles, smoothed frequencies, same-weekday averages, baseline rules), not trained models. No accuracy is claimed; outcomes are recorded so it can be measured later.
- **Predictions:** task delay risk, task failure risk, operational ETA (no traffic data), 7-day workload forecast, agent workload pressure, operational anomalies. Each shows its reasons, a confidence (how much history supports it), the model version and when it was generated.
- **Not enough data → N/A** with the reason; nothing is invented.
- **Summary:** built-in template by default. Optionally Claude through the Anthropic API (`AI_SUMMARY_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`): it receives aggregate figures only — no names, contact details, coordinates or ids — and its output is schema-checked and number-checked before display, with the template as fallback.
- **Switches:** environment (`AI_FEATURES_ENABLED`, `AI_*_ENABLED`) and `/admin/settings/ai`. With AI off, the rest of the app is unaffected.
- **Security:** admin-only; `ai_*` tables are read-only for admins under RLS and invisible to agents; writes go through database functions; keys are server-only. Location history is not an input.
- **Scheduler:** call `GET /api/cron/ai` with `Authorization: Bearer $CRON_SECRET` every 15–30 minutes; otherwise predictions refresh when an admin presses **Refresh predictions**.

## Security notes

- Authorization is enforced by Postgres RLS, not by the UI or the proxy.
- The Supabase secret key must only be read in modules that import `server-only`.
- Security headers (frame denial, nosniff, referrer and permissions policy) are set in `next.config.ts`.
