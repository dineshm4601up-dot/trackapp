# Master data management (Phase 4)

Admin-only CRUD for the records tasks are built from: **agents, customers, locations, products**.

## Routes

| Module | List | Create | Edit |
|---|---|---|---|
| Agents | `/admin/agents` | `/admin/agents/new` | `/admin/agents/[id]/edit` |
| Customers | `/admin/customers` | `/admin/customers/new` | `/admin/customers/[id]/edit` |
| Locations | `/admin/locations` | `/admin/locations/new` | `/admin/locations/[id]/edit` |
| Products | `/admin/products` | `/admin/products/new` | `/admin/products/[id]/edit` |
| Agent onboarding | — | `/set-password?token_hash=…` (one-time link) | — |

Every list supports search (`?q=`), status filter (`?status=all|active|inactive`) and pagination (`?page=`, 20 per page). All of it is done in the database; the browser only receives the current page.

## Security model

```text
Browser → session cookie → requireAdmin() (server) → Zod validation → Supabase query as the admin → RLS
```

- Every page **and** every Server Action calls `requireAdmin()`. Agents are redirected to `/agent`; unauthenticated visitors to `/login`. Hiding links is not relied on.
- Data writes use the **admin's own session**, so Phase 3 RLS applies and the audit trigger records the admin as actor.
- The service-role client (`src/lib/supabase/admin.ts`, `server-only`) is used **only** for Supabase Auth admin calls: creating an agent's login and generating password-setup links.
- IDs, search terms, filters and pages are validated server-side. Search terms are escaped for both `LIKE` wildcards and PostgREST filter syntax; searchable columns are fixed allow-lists. Sorting is fixed per list (name, then id) and not client-controlled.
- Database errors are mapped to friendly messages (`src/lib/db-errors.ts`); raw errors are only logged server-side.

## Behaviour

**No hard deletes.** Records are activated/deactivated (`is_active`). Deactivation asks for confirmation and never touches tasks, check-ins, proofs, cash records, history or audit logs. Inactive records are flagged so later phases' selectors can exclude them; the location form already offers only active customers.

### Agents

- An agent is `auth.users → profiles → agents`. Name and phone are stored on the profile (single source); employee code and active flag on the agent record.
- **Create:** the admin enters name, employee code, phone and email.
  - New email → a login is created server-side with **no password**, and the admin is shown a **one-time setup link** (copy button) to share privately. The agent opens it, presses *Continue* (the token is consumed only on this POST, so chat-app link previews can't burn it) and chooses a password.
  - Email of an existing AGENT account without an agent record → that account is **linked** (no duplicate login).
  - Email of an ADMIN account or an existing agent → refused.
  - If anything fails after the login was created, the login is deleted again.
- **Edit:** employee code, name, phone, active. Email is read-only; **there is no role field**. Role and account status remain operator-only (Phase 2 rules).
- **Sign-in access card** (edit page): generate a new one-time link, also used as a password reset. Links expire per Supabase's email OTP expiry (1 hour by default).
- **Access rule:** an AGENT can use the app only with an active agent record. Deactivating an agent signs them out on their next request. An AGENT account that was never provisioned as an agent sees "not set up" at login.

### Customers

Name required; optional code (unique, upper-cased), phone, email, address, city, state, postal code (6-digit PIN for India), country (default India).

### Locations

Customer (searchable picker over active customers), name, address, coordinates (both or neither; lat −90…90, lng −180…180, up to 7 decimals), geofence radius (10–5000 m, default 100), on-site contact. A *Preview on map* link opens the coordinates in Google Maps. No device GPS or location permission is used. A location used by tasks can't be moved to another customer.

### Products

SKU (required, unique, upper-cased), name, description, unit (default `PCS`, with suggestions), price (≥ 0, up to 2 decimals). Prices are validated as text and stored in `numeric(14,2)`; no floating-point arithmetic is done. Task lines keep their own `unit_price`, so editing a product never rewrites history.

## Validation

Shared Zod schemas (`src/features/*/schemas.ts`, field helpers in `src/lib/validation/fields.ts`) run on the server for every submission; the database constraints from Phase 3 remain the final guard. Business codes (SKU, customer code, employee code) are upper-cased to prevent accidental duplicates such as `c-001` vs `C-001`.

## Audit

The Phase 3 audit trigger records every change with actor, entity, old and new values (changed columns only). Phase 4 adds explicit action names for activation toggles:

`CREATE_/UPDATE_/ACTIVATE_/DEACTIVATE_` + `AGENT`, `CUSTOMER`, `LOCATION`, `PRODUCT`; agent name/phone changes appear as `UPDATE_PROFILE`.

## Code layout

```text
src/features/<agents|customers|locations|products>/
  schemas.ts      Zod schemas (client + server)
  queries.ts      server-only reads (paginated, filtered)
  actions.ts      Server Actions (requireAdmin → validate → write)
  components/     list (server) and form (client) components
src/components/shared/   list toolbar, pagination, responsive table/cards,
                         activate/deactivate dialog, form fields
```
