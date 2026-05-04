# Roles Foundation — Design

- **Date:** 2026-05-05
- **Status:** Approved (brainstorm). Ready for implementation plan.
- **Sub-project:** #1 of 4 in the broader role/ownership/transfer/freeze rollout.

## Context

The user requested a four-part feature spanning roles, recipe ownership, transfer-with-admin-approval, and a global freeze switch. Brainstorming decomposed this into four independent sub-projects with a strict dependency order:

1. **Roles foundation** *(this spec)* — introduce `user` / `chef` / `admin` roles, with admin UI for user listing and role changes.
2. Recipe ownership (`recipes.owner_id`, chef-write RLS, chef-portal UI).
3. Ownership transfer with admin approval.
4. Global freeze switch.

Sub-projects 2–4 cannot be designed concretely until #1 ships. This spec covers #1 only.

## Goals

- Introduce three roles: `user`, `chef`, `admin`. `user` is the implicit default (absence of role).
- Provide an admin-only UI to list all users, search/filter them, and change any user's role.
- Provide an operator script for bootstrap and emergency role changes.
- Lay groundwork (`is_chef()` SQL helper) for sub-project #2 to consume.

## Non-goals (deferred)

- `recipes.owner_id` column, chef write-RLS, chef-portal UI → sub-project #2.
- `recipe_ownership_transfers` workflow → sub-project #3.
- Global freeze switch → sub-project #4.
- User suspension, deletion, impersonation, password reset.
- Per-user audit log of role changes.
- Real-time role-change push to other open tabs (other than the force-signout-on-demotion behaviour described below).

## Decisions captured

1. **Role storage** — `auth.users.app_metadata.role`. Read at query time from `auth.jwt()`. Mutated only by service-role-bearing code (edge functions or operator script). Never writable from the browser. (`user_metadata` is intentionally avoided — it is user-writable and would be a privilege-escalation hole.)
2. **Mutation path** — both an Edge Function (for the eventual admin UI and any browser-driven action) AND a local Node script (for bootstrap and emergencies). Both share the same business rules in parallel modules (Deno-side TS and Node-side JS); they cannot share imports across runtimes but stay short enough that drift is unlikely.
3. **Last-admin guard** — the role-change path refuses to demote the last remaining admin. Returns 409 `{ code: 'last_admin' }` from the edge function; same error semantics from the script.
4. **Force sign-out on demotion** — `auth.admin.signOut(targetUserId, 'global')` is called whenever the change is `admin → chef|user` or `chef → user`. Closes the stale-JWT window immediately. Promotions do not force a sign-out.
5. **Default role for new users** — implicit `'user'`. No Auth hook, no trigger. `app_metadata.role` is absent until someone is promoted. Demoting back to `'user'` clears the key (writes `null`) rather than storing the literal string `'user'`. `is_admin()` and `is_chef()` both naturally return `false` for absence-of-key.
6. **User listing path** — a `roles-list` edge function. Same security envelope as `roles-update`. No Postgres view exposing `auth.users` to the `public` schema.
7. **Admin UI scope** — two pages: `/admin/users.html` (list, search, role filter, pagination) and `/admin/user.html?id=<uuid>` (read-only identity block + role selector + save). No additional features (no password reset, saved-recipes view, suspension, etc.).

## Architecture

```
admin UI pages (/admin/users.html, /admin/user.html)
       │ supabase.functions.invoke()
       ▼
  Edge Functions (roles-list, roles-update)
       │ supabase.auth.admin.* (service-role key)
       ▼
  Supabase Auth (auth.users.app_metadata.role)
       ▲
       │ supabase.auth.admin.* (service-role key)
  scripts/set_role.mjs (operator console)
```

Three components, each with one purpose:

1. **JWT-driven role gate** — `is_admin()` (existing) and new `is_chef()`. Both read `auth.jwt() -> 'app_metadata' ->> 'role'`. No new tables, no view, no auth hook. Existing admin RLS policies untouched.
2. **Role-management API** — two Supabase Edge Functions sharing a TS helper module that encapsulates `requireAdmin(req)` (JWT validation + admin check) and `applyRoleChange(...)` (last-admin guard, write, optional force-signout).
3. **Local operator script** — `scripts/set_role.mjs`, mirrors the edge function rules. Uses service-role key from env. Used for bootstrap and emergencies.

## Schema changes

One new function. No tables, policies, views, hooks, or triggers.

```sql
CREATE OR REPLACE FUNCTION public.is_chef() RETURNS boolean AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'chef', false);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.is_chef() IS
  'Returns true when the calling JWT has app_metadata.role = "chef". Used by chef-ownership RLS policies (sub-project #2).';
```

Delivered as `data/db/migration-2026-05-05-roles-foundation.sql` (one statement, idempotent, safe to re-apply). Also folded into `data/db/schema.sql` next to `is_admin()` so a fresh apply gets it.

## Edge functions

Layout under `supabase/functions/`:

```
supabase/
  functions/
    _shared/
      auth.ts           — requireAdmin(req): { adminClient, callerUser }
      roles.ts          — applyRoleChange(adminClient, target, newRole, opts)
                          → encapsulates last-admin guard, app_metadata write,
                            optional auth.admin.signOut on demotion
    roles-list/
      index.ts
    roles-update/
      index.ts
```

### `requireAdmin(req)`

Shared helper used by both functions:

1. Reads `Authorization: Bearer <jwt>` from the request.
2. Constructs a Supabase client with the **anon key** + the caller's JWT, calls `getUser()` to verify.
3. Inspects `caller.app_metadata.role`. If not `'admin'`, throws → 403.
4. Returns `{ adminClient, callerUser }` where `adminClient` uses the **service-role key** for privileged ops.

Service-role key never reaches the browser. The JWT-bound client establishes identity; the service-role client performs privileged writes.

### `roles-list` (GET)

Query params:
- `role` ∈ `'user'|'chef'|'admin'|'all'` (default `'all'`)
- `q` — email-substring search (case-insensitive)
- `id` — single-user lookup (UUID); when present, returns at most one row and ignores `role` / `q`
- `page` (default 1)
- `per_page` (default 50, max 200)

Behaviour:
1. `requireAdmin(req)`.
2. `id` mode: calls `adminClient.auth.admin.getUserById(id)`. Returns `{ users: [...], page: 1, total: 1 }` or empty + 404 if not found.
3. List mode: calls `adminClient.auth.admin.listUsers({ page, perPage })`. Filters in-process by role + email. Acceptable for low-hundreds user counts; revisit with a SECURITY DEFINER view if it ever crosses ~200ms.
4. Returns `{ users: [{ id, email, full_name, role, created_at, last_sign_in_at, provider }], page, total }`.

`role` is normalized to `'user'` for any user with absent or null `app_metadata.role`.

### `roles-update` (POST)

Body: `{ targetUserId: string, newRole: 'user' | 'chef' | 'admin' }`.

Behaviour:
1. `requireAdmin(req)`.
2. Validates `newRole` ∈ `['user', 'chef', 'admin']`. Reject with 400 otherwise.
3. `adminClient.auth.admin.getUserById(targetUserId)` → resolve current role (absence → `'user'`).
4. **Last-admin guard:** if current role is `'admin'` and `newRole !== 'admin'`, count current admins by paging `listUsers`. If the only admin and target IS that admin → 409 `{ code: 'last_admin' }`.
5. Writes `app_metadata.role = newRole === 'user' ? null : newRole`, merged into existing `app_metadata`, via `updateUserById`.
6. **Force sign-out on demotion** (`'admin' → 'chef'|'user'` or `'chef' → 'user'`): `adminClient.auth.admin.signOut(targetUserId, 'global')`.
7. Returns `{ ok: true, user: { id, email, role: newRole } }`.

Error codes: 400 (bad input) · 401 (no/bad JWT) · 403 (caller not admin) · 404 (target not found) · 409 (last-admin) · 500 (unexpected).

### Foot-gun guard

A comment near the role-write call:

```ts
// IMPORTANT: app_metadata only. user_metadata is user-writable; storing role
// there would be a privilege escalation vulnerability.
```

Mirrored in `scripts/set_role.mjs` and noted in `USER-TODO.md` §4 alongside the role bootstrap commands.

## Local operator script

`scripts/set_role.mjs`. Node ES module, ~80 lines. Same style as `scripts/import_recipes.mjs` (env loading, supabase-js, `console.log` UX).

Invocation:

```
node scripts/set_role.mjs --user <email-or-uuid> --role <user|chef|admin> [--no-signout]
```

Behaviour:

1. Loads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env` or `.env.local`.
2. Constructs `createClient(url, serviceKey, { auth: { persistSession: false } })`.
3. Resolves target: UUID → `getUserById`; otherwise → page `listUsers` and match by email. Fail fast if not found.
4. Mirrors the edge function's `applyRoleChange` rules:
   - validates `--role`,
   - applies the last-admin guard,
   - writes `app_metadata.role` (null on `'user'`),
   - calls `auth.admin.signOut(targetId, 'global')` on demotion unless `--no-signout` is set.
5. Prints a single summary line: `[set_role] alice@example.com  user → chef  (signed out: yes)`.

`scripts/lib/roles.mjs` holds the shared rules (valid roles, `isDemotion()`, `targetMetadataPatch()`, last-admin guard).

The first admin is created via this script — service-role key bypasses RLS and the last-admin guard only triggers on demotions.

## Admin UI pages

Both pages are gated by the existing `shared/admin-gate.js`. No new gate logic.

### `/admin/users.html` + `js/admin-users-app.jsx`

Layout reuses the `/admin/recipes.html` shell (`AdminSidebar`, `AdminTopbar`, `FormCard`):

- Topbar title: "Users".
- Filter row: search input (debounced 250ms; sets `q`) + role pills `All / User / Chef / Admin` (sets `role`, resets to page 1).
- Table columns: avatar (initials), email, name, role badge, signed up (relative), last sign-in (relative), provider.
- Each row links to `user.html?id=<uuid>`.
- Empty state when no rows match.
- Pagination footer (Prev / page X / Next).

A new `Users` entry is added to `AdminSidebar` in `js/admin-shared.jsx`.

Data flow: `MFC.adminApi.listUsers({ role, q, page, perPage })` → `supabase.functions.invoke('roles-list', ...)`.

### `/admin/user.html?id=<uuid>` + `js/admin-user-app.jsx`

Layout:

- Topbar: "← Users / `<email>`".
- Identity block (read-only): email, name, provider, signed up, last sign-in, user id (mono, copyable).
- Role section: 3-way `RadioPills` (`user / chef / admin`) + Save button (disabled when unchanged).

Data flow:
- On mount: `MFC.adminApi.getUser(id)` → `roles-list?id=<uuid>`.
- On Save:
  - If demotion (current `admin` → not-admin, or `chef` → `user`): show confirmation modal — "This will sign the user out of all sessions. They'll need to sign in again to use the site." (Self-edit text variant: "This will sign **you** out of all sessions immediately. You'll need to sign in again as the new role.")
  - On confirm (or directly for promotions): `MFC.adminApi.updateRole({ targetUserId, newRole })` → `roles-update`.
  - Success: refresh identity block + role selector from response; toast.
  - 409 `last_admin`: inline error under role selector — "You can't demote the only remaining admin. Promote another user first."
  - 401 / 403: redirect to admin sign-in via `MFC.adminGate.guard()`.

**Self-demote handling:** the handler awaits `roles-update`'s `{ ok: true }`, then calls `window.MFC.auth.signOut()` itself, then navigates to `/index.html`. This avoids racing the supabase-js `SIGNED_OUT` event triggered by the now-invalidated session.

### `shared/admin-api.js` (new)

Thin wrapper, ~30 lines. `MFC.adminApi.listUsers`, `MFC.adminApi.getUser`, `MFC.adminApi.updateRole`. Translates `supabase.functions.invoke` results into `{ data, error }`-shaped returns matching the rest of `MFC.db`. Loaded only on `/admin/` pages.

## Auth / JWT handling

No changes to `shared/auth.js`, `shared/admin-gate.js`, or any RLS policy.

**Reads:** `is_admin()`, new `is_chef()`, and `admin-gate.js` all read `app_metadata.role` from the JWT. Untouched.

**Writes:** only the two edge functions and the operator script touch `app_metadata.role`, both via service-role `auth.admin.updateUserById()`. No browser path can write `app_metadata`.

**JWT freshness windows in #1:**

- *Promotion* (e.g. `user → chef`, `user → admin`): the target's existing JWT reports the old role until natural refresh (~1h) or sign-out/back-in. Zero observable effect in #1 — chef has no chef-only UI yet, and admin promotion needing a re-login is acceptable for an operator action.
- *Demotion*: force-signout invalidates all refresh tokens immediately. Their next API call → 401 → supabase-js fires `SIGNED_OUT`. Window is `<1 round-trip`.

## Bootstrap & documentation

### `docs/USER-TODO.md`

The current §4 ("how to grant the admin role via Supabase Studio SQL") is rewritten:

- **Recommended**: `node scripts/set_role.mjs --user <email> --role admin`. Idempotent.
- **Fallback**: existing Studio SQL one-liner (kept for operators without Node).
- **Edge function deployment** (one-time per project):
  ```
  supabase functions deploy roles-list
  supabase functions deploy roles-update
  ```
  No env vars to configure — Supabase auto-injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` inside functions.

### `CLAUDE.md`

Add to the "Schema layers — Admin gate" section:

> - **Roles** — `app_metadata.role ∈ {chef, admin}` (or absent for default `user`). Read via JWT in `is_admin()` / `is_chef()`. Mutated only by the `roles-update` edge function or `scripts/set_role.mjs`. Never writable from the browser.

Add a one-line entry under "Shared JS" for `shared/admin-api.js`.

### `README.md`

No change. Roles are operator/admin facing, not part of the public pitch.

## Build sequence

All steps performed by the assistant; no operator handoff.

1. Write `data/db/migration-2026-05-05-roles-foundation.sql`. Fold into `data/db/schema.sql`.
2. Apply migration to live Supabase project via the Supabase MCP — re-confirm project URL before running.
3. Build edge functions (`supabase/functions/_shared/auth.ts`, `_shared/roles.ts`, `roles-list/index.ts`, `roles-update/index.ts`).
4. Build operator script (`scripts/set_role.mjs`, `scripts/lib/roles.mjs`).
5. Deploy both edge functions to the live project (Supabase MCP if it exposes a deploy tool, otherwise `supabase functions deploy` via Bash).
6. Build admin UI: `/admin/users.html`, `/admin/user.html`, `js/admin-users-app.jsx`, `js/admin-user-app.jsx`, `shared/admin-api.js`. Add `Users` entry to `AdminSidebar` in `js/admin-shared.jsx`. Update each page's documented script load order.
7. Update `docs/USER-TODO.md` and `CLAUDE.md` per "Bootstrap & documentation" above.
8. Run `node scripts/set_role.mjs --user <your-email> --role admin` to ensure the operator user is admin (idempotent).
9. Smoke-test: load `/admin/users.html`, verify list; open a non-admin user; promote to chef → verify role badge updates; demote → verify confirmation modal + force-signout behaviour; attempt to demote the only admin → verify 409 inline error.

### Pre-implementation prerequisites

Two items the operator confirms before I start:

- **Target Supabase project URL** — current `<meta name="mfc-supabase-url">` is `https://fqjzhntqppbcwvqtjscb.supabase.co`. Confirm this is the right env vs. a staging copy.
- **Service-role key for local script** — must be in `.env.local` (or exported in shell) for `scripts/set_role.mjs` to run. The migration-via-MCP step does not require it on my side.

## Out of scope (decomposition reminder)

Explicitly NOT in #1:

- `recipes.owner_id` column, chef-write RLS, chef-portal UI → sub-project #2 (Recipe ownership). #1 only stages `is_chef()`.
- `recipe_ownership_transfers` table, request/approve workflow, admin queue UI → sub-project #3.
- `app_settings.frozen` row, freeze-aware RLS, admin freeze toggle UI → sub-project #4.
- User suspension, deletion, impersonation, password-reset email.
- Per-user audit log of role changes. (If wanted, it's a small follow-up: a `role_change_log` table written by the edge function.)
- Real-time push of role change to currently-open tabs (other than via force-signout).
