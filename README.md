# FieldTrack

Field task tracking: admins assign tasks (delivery, cash collection, pickup, inspection, …) at customer locations; agents travel there, check in by GPS, perform the task, submit proof, and admins verify.

**Status:** Phases 1–8 — foundation, authentication & roles, database & RLS, master data, task creation & assignment, the agent task workflow, GPS check-in with server-side geofence validation, and task execution (delivery quantities, cash collection, photo/document proof, failure reporting).

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
| `NEXT_PUBLIC_APP_URL` | Yes | Base URL for auth redirects (later phases) |
| `SUPABASE_SECRET_KEY` | **Never** | Secret / service-role key. Bypasses RLS; server-only, used from the agent-provisioning phase |

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
| `/admin/tasks` | `ADMIN` | Task creation, assignment, editing and cancellation, see [docs/tasks.md](docs/tasks.md) |
| `/admin/monitoring`, `/reports`, `/settings` | `ADMIN` | Placeholders for later phases |
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
└─ task-execution.md     # delivery, cash, proof, completion
```

Domain code goes in `src/features/<domain>/` (components, actions, queries, schemas) as each phase adds it.

## Security notes

- Authorization is enforced by Postgres RLS, not by the UI or the proxy.
- The Supabase secret key must only be read in modules that import `server-only`.
- Security headers (frame denial, nosniff, referrer and permissions policy) are set in `next.config.ts`.
