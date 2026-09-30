# FieldTrack

Field task tracking: admins assign tasks (delivery, cash collection, pickup, inspection, …) at customer locations; agents travel there, check in by GPS, perform the task, submit proof, and admins verify.

**Status:** Phase 1 — project foundation. Authentication and business features arrive in later phases.

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

## Routes (Phase 1)

| Route | Description |
|---|---|
| `/` | Landing page with entry points |
| `/login` | Sign-in UI (not wired until Phase 2) |
| `/admin` | Admin dashboard — sidebar layout; other sections are placeholders |
| `/agent` | Agent home — mobile layout with bottom navigation |
| `/status` | Supabase connection check |

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
└─ lib/
   ├─ env.ts             # Zod-validated public environment
   ├─ supabase/          # browser client, server client, health check
   └─ utils.ts           # cn() class helper
```

Domain code goes in `src/features/<domain>/` (components, actions, queries, schemas) as each phase adds it. Database migrations will live in `supabase/` from Phase 3.

## Security notes

- Authorization is enforced by Postgres RLS, not by the UI or the proxy.
- The Supabase secret key must only be read in modules that import `server-only`.
- Security headers (frame denial, nosniff, referrer and permissions policy) are set in `next.config.ts`.
