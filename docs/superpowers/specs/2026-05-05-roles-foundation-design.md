# Roles Foundation — Design

- **Date:** 2026-05-05
- **Status:** Approved (brainstorm). Ready for implementation plan.
- **Sub-project:** #1 of 4 in the broader role/ownership/transfer/freeze rollout.
- **Revision:** 2 — re-evaluated after the major repo refactor (`web/`, `automation/`, Python CLI, Makefile). Edge functions dropped in favour of the existing CLI automation; browser admin UI is read-only with copyable terminal-command suggestions (Option C from the re-evaluation).

## Context

The user requested a four-part feature spanning roles, recipe ownership, transfer-with-admin-approval, and a global freeze switch. Brainstorming decomposed this into four independent sub-projects with a strict dependency order:

1. **Roles foundation** *(this spec)* — introduce `user` / `chef` / `admin` roles, with admin UI for user listing.
2. Recipe ownership (`recipes.owner_id`, chef-write RLS, chef-portal UI).
3. Ownership transfer with admin approval.
4. Global freeze switch.

Sub-projects 2–4 cannot be designed concretely until #1 ships. This spec covers #1 only.

## Goals

- Introduce three roles: `user`, `chef`, `admin`. `user` is the implicit default (absence of role).
- Provide CLI commands for listing users and changing roles. The CLI is the single privileged mutation surface.
- Provide a read-only browser admin UI (`/admin/users.html`, `/admin/user.html`) so admins can browse users; role changes from the UI are not in scope — instead, the user-detail page shows copyable `make` commands the operator runs in a terminal.
- Lay groundwork (`is_chef()` SQL helper) for sub-project #2 to consume.

## Non-goals (deferred)

- Browser-driven role mutation. The detail page is read-only + suggestion text.
- Edge functions of any kind. The repo's automation pattern (Python CLI + Makefile) is the privileged surface.
- `recipes.owner_id` column, chef write-RLS, chef-portal UI → sub-project #2.
- `recipe_ownership_transfers` workflow → sub-project #3.
- Global freeze switch → sub-project #4.
- User suspension, deletion, impersonation, password reset.
- Per-user audit log of role changes.
- Real-time role-change push to other open tabs (other than the force-signout-on-demotion behaviour described below).

## Decisions captured

1. **Role storage** — `auth.users.app_metadata.role`. Read at query time from `auth.jwt()`. Mutated only by service-role-bearing code (the CLI). Never writable from the browser. (`user_metadata` is intentionally avoided — it is user-writable and would be a privilege-escalation hole.)
2. **Mutation path** — local Python CLI only. `mfc set-role --user <email|uuid> --role <user|chef|admin>` exposed via `make set-role USER=<...> ROLE=<...>`. No edge function, no browser-driven write.
3. **Last-admin guard** — `mfc set-role` refuses to demote the last remaining admin. Inline error; non-zero exit.
4. **Force sign-out on demotion** — when the change is `admin → chef|user` or `chef → user`, the CLI invalidates all of the target's sessions immediately. Preferred path: supabase-py admin API (`client.auth.admin.sign_out(user_id)` if exposed in the installed version). Fallback: `DELETE FROM auth.refresh_tokens WHERE user_id = %s` via psycopg, plus session deletion if the API path doesn't cover it. Skippable with `--no-signout`.
5. **Default role for new users** — implicit `'user'`. No Auth hook, no trigger. `app_metadata.role` is absent until someone is promoted. Demoting back to `'user'` clears the key (writes `null`) rather than storing the literal string `'user'`. `is_admin()` and `is_chef()` both naturally return `false` for absence-of-key.
6. **User listing path** — a `public.list_app_users(...)` SECURITY DEFINER SQL function. Browser calls it via `supabase.rpc()`; the body asserts `is_admin()`. The CLI uses the same function via supabase-py service-role client (or queries `auth.users` directly via psycopg — service-role bypasses everything anyway).
7. **Admin UI scope** — two pages. `/admin/users.html` lists and paginates. `/admin/user.html?id=<uuid>` shows identity + current role badge + three "suggested terminal command" rows with Copy buttons. No save button, no role selector.

## Architecture

```
        ┌─ Browser (read-only)
        │     /admin/users.html, /admin/user.html
        │            │
        │            │  supabase.rpc('list_app_users', ...)
        │            ▼
        │     public.list_app_users(...)        ← SECURITY DEFINER, asserts is_admin()
        │            │
        │            ▼
        │     auth.users
        │            ▲
        ▼            │
  Operator terminal  │
   make set-role / list-users
        │            │
        ▼            │
   automation/mfc CLI │
        │            │
        ▼            │
   supabase-py service-role client
        │            │
        ├────────────┘
        ▼
   auth.users.raw_app_meta_data.role  + auth.refresh_tokens (force-signout)
```

Three components, each with one purpose:

1. **JWT-driven role gate** — `is_admin()` (existing) and new `is_chef()`. Both read `auth.jwt() -> 'app_metadata' ->> 'role'`. No new tables, no view, no auth hook. Existing admin RLS policies untouched.
2. **`list_app_users` SECURITY DEFINER function** — the only DB-level privilege escalation. Reads `auth.users`, normalises role from `raw_app_meta_data`, supports filter/search/pagination. EXECUTE granted only to `authenticated`. Body asserts `is_admin()`.
3. **CLI commands** — `mfc list-users` (read; mirrors the function for terminal use) and `mfc set-role` (write). Same business rules as before: validate role value, last-admin guard, write `app_metadata.role`, optional force-signout on demotion. Layered as `commands → ops → clients` per the existing automation convention.

## Schema changes

One new helper function (`is_chef()`) and one new SECURITY DEFINER function (`list_app_users`). No tables, no policies, no views, no hooks.

```sql
-- Helper for sub-project #2; mirrors is_admin() shape.
CREATE OR REPLACE FUNCTION public.is_chef() RETURNS boolean AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'chef', false);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.is_chef() IS
  'Returns true when the calling JWT has app_metadata.role = "chef". Used by chef-ownership RLS policies (sub-project #2).';

-- Browser-readable users list. SECURITY DEFINER so it can read auth.users;
-- body asserts is_admin() so callers must hold an admin JWT.
CREATE OR REPLACE FUNCTION public.list_app_users(
  p_role     text DEFAULT 'all',          -- 'user' | 'chef' | 'admin' | 'all'
  p_q        text DEFAULT NULL,           -- email substring; ILIKE
  p_page     int  DEFAULT 1,
  p_per_page int  DEFAULT 50              -- clamped to 200 in body
) RETURNS TABLE (
  id              uuid,
  email           text,
  full_name       text,
  role            text,                   -- normalised: 'user' for null/absent
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  provider        text,
  total_count     bigint                  -- echoed on every row, for client-side pagination math
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offset int;
  v_per    int := least(greatest(p_per_page, 1), 200);
  v_role   text := lower(coalesce(p_role, 'all'));
  v_q      text := nullif(trim(coalesce(p_q, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_offset := greatest(p_page - 1, 0) * v_per;

  RETURN QUERY
  WITH base AS (
    SELECT
      u.id,
      u.email::text,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') AS full_name,
      coalesce(u.raw_app_meta_data ->> 'role', 'user') AS role,
      u.created_at,
      u.last_sign_in_at,
      coalesce(u.raw_app_meta_data ->> 'provider', 'email') AS provider
    FROM auth.users u
    WHERE
      (v_role = 'all' OR coalesce(u.raw_app_meta_data ->> 'role', 'user') = v_role)
      AND (v_q IS NULL OR u.email ILIKE '%' || v_q || '%')
  ),
  counted AS (SELECT count(*)::bigint AS n FROM base)
  SELECT b.id, b.email, b.full_name, b.role, b.created_at, b.last_sign_in_at, b.provider, c.n
  FROM base b CROSS JOIN counted c
  ORDER BY b.created_at DESC
  LIMIT v_per OFFSET v_offset;
END $$;

REVOKE ALL ON FUNCTION public.list_app_users(text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_app_users(text, text, int, int) TO authenticated;

COMMENT ON FUNCTION public.list_app_users(text, text, int, int) IS
  'Admin-only browser-callable function returning auth.users with role normalised. SECURITY DEFINER; body asserts is_admin().';
```

Delivered as `automation/db/migration-2026-05-05-roles-foundation.sql` (idempotent, safe to re-apply via `mfc apply-schema` mechanics or as a one-off). Both functions also folded into `automation/db/schema.sql` §8 next to `is_admin()` so a fresh `make apply-schema` gets them.

## CLI

Layout under `automation/mfc/` follows the documented `commands → ops → clients` layering.

```
automation/mfc/
  ops/
    users.py        — list_users(...) + set_role(...) (the work)
  commands/
    list_users.py   — `mfc list-users` argparse wrapper
    set_role.py     — `mfc set-role` argparse wrapper
  cli.py            — append both to COMMAND_MODULES
```

### `ops/users.py`

```python
from dataclasses import dataclass
from ..clients import sb as sb_client
from ..core.config import Config

VALID_ROLES = ('user', 'chef', 'admin')

@dataclass(frozen=True)
class AppUser:
    id: str
    email: str
    full_name: str | None
    role: str           # 'user' | 'chef' | 'admin'
    created_at: str
    last_sign_in_at: str | None
    provider: str

class RoleError(RuntimeError):
    """Raised for guard failures: invalid role, last-admin, target-not-found."""

def list_users(config, *, role='all', q=None, page=1, per_page=50) -> list[AppUser]:
    """Pages auth.admin.list_users, filters in-process, returns AppUser rows."""

def set_role(config, *, target: str, new_role: str, force_signout: bool = True) -> tuple[AppUser, AppUser]:
    """Resolves target (UUID or email), applies last-admin guard, writes
    app_metadata.role (None for 'user'), force-signs-out on demotion.
    Returns (before, after). Raises RoleError on guard failures."""
```

Implementation notes:
- Last-admin guard: count current admins by paging `auth.admin.list_users()` until exhausted. Cheap for low-hundred user counts.
- Demotion definition: `admin → chef|user` or `chef → user`. Promotions never trigger force-signout.
- Force-signout: prefer `client.auth.admin.sign_out(user_id)` if supabase-py exposes it; otherwise fall back to a `DELETE FROM auth.refresh_tokens WHERE user_id = %s` via psycopg `pg.exec_sql`. (We'll detect at runtime; both paths are compatible.)
- Idempotency: if `new_role == current_role`, `set_role` is a no-op (returns identical before/after, no signout) — operator gets a friendly summary rather than an error.

### `commands/list_users.py`

`mfc list-users [--role user|chef|admin|all] [--q <substr>] [--page N] [--per-page N]`. Prints a tidy table to stdout (`core.log`-styled), columns: email, name, role badge, created, last sign-in, provider. Empty list → "no users match" warn.

### `commands/set_role.py`

`mfc set-role --user <email|uuid> --role <user|chef|admin> [--no-signout]`.
- Validates `--role` against `VALID_ROLES`.
- Resolves target; fails fast with a clear error if not found.
- For demotions: prompts via `core.prompts.confirm` ("Demote alice@example.com from admin to chef? Their session will be ended."). Honours global `--yes` flag for non-TTY runs.
- Calls `ops.users.set_role(...)` and prints the one-line summary on success: `[set_role] alice@example.com  user → chef  (signed out: yes)`.
- `RoleError` (last-admin, target not found, etc.) → `log.error` + non-zero exit.

Both registered in `cli.py` (appended to `COMMAND_MODULES` after `import_recipes`, before `drop_schema`).

## Makefile

Two new targets at the root `Makefile`:

```make
list-users: ## list users; optional ROLE=chef Q=alice
	@$(UV) run mfc list-users $(if $(ROLE),--role $(ROLE)) $(if $(Q),--q $(Q))

set-role: ## change role; required USER=<email-or-uuid> ROLE=<user|chef|admin>
	@$(UV) run mfc set-role --user "$(USER)" --role "$(ROLE)"
```

Caveat: the `USER=` make var collides with `$USER` shell env var. Make's command-line `USER=alice` override wins for the recipe's lifetime, so it works correctly. If a future operator preference shifts (e.g. to `EMAIL=`), the rename is one line.

`make help` will surface both via the existing grep-based help target.

## Browser admin UI (read-only)

Both pages gated by existing `web/assets/js/lib/admin-gate.js`. Both use existing components from `web/assets/js/lib/admin-shared.jsx`.

### `web/admin/users.html` + `web/assets/js/app/admin-users-app.jsx`

Layout reuses the existing `/admin/recipes.html` shell (`AdminSidebar`, `AdminTopbar`, `FormCard`).

- AdminSidebar gains a `Users` entry (added to `web/assets/js/lib/admin-shared.jsx`).
- Topbar title: "Users".
- Filter row: search input (debounced 250ms; sets `q`) + role pills `All / User / Chef / Admin`. Changing either resets to page 1.
- Banner above the table: "Role changes are made from the terminal. Open a user to see the exact command."
- Table columns: avatar (initials), email, name, role badge, signed up (relative), last sign-in (relative), provider.
- Each row links to `user.html?id=<uuid>`.
- Empty state when no rows match.
- Pagination footer (Prev / page X / Next), driven by `total_count` from the RPC.

Data via `supabase.rpc('list_app_users', { p_role, p_q, p_page, p_per_page })`. Surfaces 401/403 by routing through `MFC.adminGate.guard()`.

### `web/admin/user.html?id=<uuid>` + `web/assets/js/app/admin-user-app.jsx`

Layout:

- Topbar: "← Users / `<email>`".
- Identity block (read-only): email, name, provider, signed up, last sign-in, user id (mono, copyable).
- Role panel:
  - Current role displayed as the same role badge component used in the table.
  - Below it, two suggestion rows (one for each non-current role). Each row:
    - Mono-styled command: `make set-role USER=<email> ROLE=<role>`
    - Copy-to-clipboard button.
    - One-line caption explaining the consequence. Promotions: "Grants chef-level write access to recipes they own." Demotions: "Will sign Alice out of all sessions immediately."
  - No Save button. No editable selector.

Data: `supabase.rpc('list_app_users', { p_q: <email-or-uuid>, p_per_page: 1 })`. We accept this is mildly awkward (passing the id through the email-substring filter) — keeps the RPC surface to one function. If single-row lookup becomes painful, a tiny `public.get_app_user(uuid)` companion is a small follow-up; not in #1.

No new shared lib JS file. The two RPC calls are direct `supabase.rpc(...)` inside the app jsx. Two call sites doesn't justify a wrapper.

## Auth / JWT handling

No changes to `web/assets/js/lib/auth.js`, `web/assets/js/lib/admin-gate.js`, or any RLS policy.

**Reads:** `is_admin()` and new `is_chef()` continue to read `app_metadata.role` from the JWT. `admin-gate.js` checks `user.app_metadata.role === 'admin'`. Untouched.

**Writes:** only `mfc set-role` touches `app_metadata.role`, via supabase-py service-role client. `app_metadata` is server-only — there is no path from the browser that can write it.

**JWT freshness windows in #1:**

- *Promotion* (`user → chef`, `user → admin`): the target's existing JWT reports the old role until natural refresh (~1h) or sign-out/back-in. Zero observable effect in #1 — chef has no chef-only UI yet (deferred to #2), and admin promotion needing a re-login is acceptable for an operator action.
- *Demotion*: force-signout invalidates all refresh tokens immediately (default). Their next API call → 401 → supabase-js fires `SIGNED_OUT`. Window is `<1 round-trip`.

**`user_metadata` foot-gun guard:** a comment near the role-write call site in `ops/users.py`:

```python
# IMPORTANT: app_metadata only. user_metadata is user-writable; storing role
# there would be a privilege escalation vulnerability.
```

Mirrored in the bullet point added to `CLAUDE.md` (see Documentation).

## Documentation

### `docs/USER-TODO.md`

§4 ("Grant yourself the admin role") rewritten:

- **Recommended**: `make set-role USER=<your-email> ROLE=admin`. Idempotent.
- **Fallback**: existing copy-paste SQL one-liner (kept for operators who haven't run `make sync` yet).

### `CLAUDE.md`

Add to "Schema layers — Admin gate" section:

> - **Roles** — `app_metadata.role ∈ {chef, admin}` (or absent for default `user`). Read via JWT in `is_admin()` / `is_chef()`. Mutated only by `mfc set-role` (= `make set-role`). Never writable from the browser.

Add to the "Dev" section's Make-target list:

> ```
> make list-users  # supabase: list users; optional ROLE=chef Q=alice
> make set-role    # supabase: change role; USER=<email> ROLE=<user|chef|admin>
> ```

### `README.md`

No change. Roles are operator/admin-facing, not part of the public pitch.

## Build sequence

All steps performed by the assistant; no operator handoff.

1. Write `automation/db/migration-2026-05-05-roles-foundation.sql`. Fold both functions into `automation/db/schema.sql` §8.
2. Apply migration to live Supabase project via the Supabase MCP — re-confirm project URL before running.
3. Implement `automation/mfc/ops/users.py` (`AppUser` dataclass, `list_users`, `set_role`, `RoleError`, `VALID_ROLES`).
4. Implement `automation/mfc/commands/list_users.py` and `commands/set_role.py`. Register both in `cli.py` (`COMMAND_MODULES`).
5. Add `list-users` and `set-role` Makefile targets.
6. Run `make set-role USER=<your-email> ROLE=admin` once to ensure operator user is admin (idempotent).
7. Build `web/admin/users.html`, `web/admin/user.html`, `web/assets/js/app/admin-users-app.jsx`, `web/assets/js/app/admin-user-app.jsx`. Add `Users` entry to `AdminSidebar` in `web/assets/js/lib/admin-shared.jsx`. Update each page's documented script load order.
8. Update `docs/USER-TODO.md` and `CLAUDE.md` per Documentation above.
9. Smoke-test:
   - `make list-users` returns at least the operator row with `role=admin`.
   - `/admin/users.html` loads, filter pills work, search works, pagination works.
   - `/admin/user.html?id=<your-id>` shows identity, current role badge, and the two terminal-command suggestion rows with Copy buttons.
   - `make set-role USER=<another-user> ROLE=chef` flips role; refresh `/admin/users.html` to confirm.
   - `make set-role USER=<self> ROLE=user` (still only admin) → CLI refuses with last-admin error.
   - After promoting a second admin, `make set-role USER=<that-admin> ROLE=user` → demotion succeeds, refresh tokens for that user are gone (verifiable via `select count(*) from auth.refresh_tokens where user_id = '<id>'`).

### Pre-implementation prerequisite

- **Target Supabase project URL** — current `automation/.env` references `https://fqjzhntqppbcwvqtjscb.supabase.co`. I'll re-confirm before running the migration.

## Out of scope (decomposition reminder)

Explicitly NOT in #1:

- `recipes.owner_id` column, chef-write RLS, chef-portal UI → sub-project #2 (Recipe ownership). #1 only stages `is_chef()`.
- `recipe_ownership_transfers` table, request/approve workflow, admin queue UI → sub-project #3.
- `app_settings.frozen` row, freeze-aware RLS, admin freeze toggle UI → sub-project #4.
- Browser-driven role mutation. (If it becomes a priority, candidates: a SECURITY DEFINER `public.set_user_role(...)` function paired with a refresh-token cleanup, OR resurrecting the edge-function path. Both add infra; both deferred.)
- User suspension, deletion, impersonation, password-reset email.
- Per-user audit log of role changes.
- Real-time push of role change to currently-open tabs (other than via force-signout).
