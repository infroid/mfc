# Roles Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce three roles (`user`, `chef`, `admin`) stored in `auth.users.app_metadata.role`, with `mfc set-role` / `mfc list-users` CLI commands as the only privileged mutation surface and a read-only browser admin UI for browsing users.

**Architecture:** Role mutations live exclusively in the Python CLI (`automation/mfc/`) following the existing `commands → ops → clients` layering. Role *reads* exposed to the browser via a SECURITY DEFINER SQL function `public.list_app_users()` gated by `is_admin()`. Browser admin pages are read-only; the user-detail page shows copyable `make set-role ...` commands instead of a save button. Force-signout-on-demotion is implemented by deleting from `auth.refresh_tokens` + `auth.sessions` via psycopg (the `supabase-py` `sign_out` method takes a JWT, not a user id, so it doesn't fit).

**Tech Stack:** Python 3.10+ (psycopg, supabase-py, argparse), PL/pgSQL (SECURITY DEFINER functions), Makefile, vanilla React via Babel-standalone (browser admin UI), Supabase MCP for live migration apply.

**Spec:** [`docs/superpowers/specs/2026-05-05-roles-foundation-design.md`](../specs/2026-05-05-roles-foundation-design.md)

**Verification approach:** No pytest. The repo follows a "smoke-test against live Supabase" convention (see existing `apply-schema`, `import-recipes`, `status` commands — none have unit tests). Each task ends with a concrete verification step using `make`, `psql`, or browser load. The live project URL is captured in `automation/.env` (`https://fqjzhntqppbcwvqtjscb.supabase.co`); re-confirm before any destructive call.

---

## Task 1: Schema migration — add `is_chef()` and `list_app_users()`

**Files:**
- Create: `automation/db/migration-2026-05-05-roles-foundation.sql`
- Modify: `automation/db/schema.sql` (§8 admin section)

- [ ] **Step 1: Write the migration SQL**

Create `automation/db/migration-2026-05-05-roles-foundation.sql` with this content:

```sql
-- Migration: roles foundation (sub-project #1)
-- Adds:
--   1. public.is_chef()         — JWT helper for sub-project #2
--   2. public.list_app_users()  — SECURITY DEFINER browser-callable users list
--
-- Idempotent: safe to re-apply. Folded into schema.sql §8.

-- ── 1. is_chef() ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_chef() RETURNS boolean AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'chef', false);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.is_chef() IS
  'Returns true when the calling JWT has app_metadata.role = "chef". Used by chef-ownership RLS policies (sub-project #2).';

-- ── 2. list_app_users() ──────────────────────────────────────────────────
-- SECURITY DEFINER lets the function read auth.users; the body asserts
-- is_admin() so callers must hold an admin JWT. Returns role normalised
-- (null/absent → 'user'), supports filter + email search + pagination.
CREATE OR REPLACE FUNCTION public.list_app_users(
  p_role     text DEFAULT 'all',
  p_q        text DEFAULT NULL,
  p_page     int  DEFAULT 1,
  p_per_page int  DEFAULT 50
) RETURNS TABLE (
  id              uuid,
  email           text,
  full_name       text,
  role            text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  provider        text,
  total_count     bigint
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
      u.email::text                                                              AS email,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') AS full_name,
      coalesce(u.raw_app_meta_data  ->> 'role',     'user')                      AS role,
      u.created_at,
      u.last_sign_in_at,
      coalesce(u.raw_app_meta_data  ->> 'provider', 'email')                     AS provider
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
  'Admin-only browser-callable. Returns auth.users with role normalised. SECURITY DEFINER; body asserts is_admin().';
```

- [ ] **Step 2: Fold both functions into `automation/db/schema.sql` §8**

Locate §8 (search for `-- 8. ADMIN`). The current content ends with `is_admin()` and the admin write policies. Insert the two new functions immediately AFTER the `is_admin()` block but BEFORE the `CREATE POLICY` statements. The chunk to add (verbatim copy of the migration body, minus the file header):

```sql
-- ── role helper for sub-project #2 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_chef() RETURNS boolean AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'chef', false);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.is_chef() IS
  'Returns true when the calling JWT has app_metadata.role = "chef". Used by chef-ownership RLS policies (sub-project #2).';

-- ── browser-callable admin user listing ────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_app_users(
  p_role     text DEFAULT 'all',
  p_q        text DEFAULT NULL,
  p_page     int  DEFAULT 1,
  p_per_page int  DEFAULT 50
) RETURNS TABLE (
  id              uuid,
  email           text,
  full_name       text,
  role            text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  provider        text,
  total_count     bigint
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
      u.email::text                                                              AS email,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') AS full_name,
      coalesce(u.raw_app_meta_data  ->> 'role',     'user')                      AS role,
      u.created_at,
      u.last_sign_in_at,
      coalesce(u.raw_app_meta_data  ->> 'provider', 'email')                     AS provider
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
  'Admin-only browser-callable. Returns auth.users with role normalised. SECURITY DEFINER; body asserts is_admin().';
```

Also extend the §8 header comment to mention `is_chef()`:

Find:
```
-- 8. ADMIN — role gate + write policies for catalog and library
-- JWT app_metadata.role = 'admin' grants write access.
-- See USER-TODO.md §4 for how to grant the admin role.
```
Replace with:
```
-- 8. ADMIN — role gate + write policies for catalog and library
-- JWT app_metadata.role ∈ {'admin','chef'} (or absent for default 'user').
-- is_admin()/is_chef() helpers + list_app_users() for the admin UI.
-- See USER-TODO.md §4 for how to grant a role.
```

- [ ] **Step 3: Apply the migration to the live Supabase project via MCP**

The Supabase MCP tools are deferred. Load them first:

```
ToolSearch: select:mcp__plugin_supabase_supabase__authenticate,mcp__plugin_supabase_supabase__complete_authentication
```

Then authenticate. Once authenticated, search for the SQL-execution tool:

```
ToolSearch: query="apply migration sql execute" max_results=10
```

Likely tool names: `mcp__plugin_supabase_supabase__apply_migration` or `mcp__plugin_supabase_supabase__execute_sql`. Confirm the project URL matches `https://fqjzhntqppbcwvqtjscb.supabase.co` from `automation/.env` BEFORE running anything. If the MCP exposes a `list_projects` tool, use it to confirm.

Apply the migration file's contents (the `is_chef()` and `list_app_users()` definitions, including the GRANT/REVOKE/COMMENT statements). Idempotent — re-apply is safe.

If the Supabase MCP can't apply DDL (some MCP variants are read-only), fall back to running the SQL via psycopg from the CLI:

```bash
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.clients import pg
from pathlib import Path
config = Config.load()
sql = Path('automation/db/migration-2026-05-05-roles-foundation.sql').read_text()
with pg.connection(config) as conn:
    with conn.cursor() as cur:
        cur.execute(sql)
print('migration applied')
"
```

- [ ] **Step 4: Verify both functions exist**

Run via psycopg:

```bash
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.clients import pg
config = Config.load()
with pg.connection(config) as conn:
    cur = pg.exec_sql(conn, \"\"\"
      SELECT routine_name, security_type
      FROM information_schema.routines
      WHERE routine_schema='public' AND routine_name IN ('is_admin','is_chef','list_app_users')
      ORDER BY routine_name
    \"\"\")
    for row in cur.fetchall():
        print(row)
"
```

Expected output (3 rows):
```
('is_admin', 'INVOKER')
('is_chef', 'INVOKER')
('list_app_users', 'DEFINER')
```

- [ ] **Step 5: Commit**

```bash
git add automation/db/migration-2026-05-05-roles-foundation.sql automation/db/schema.sql
git commit -m "feat(db): roles foundation — is_chef() + list_app_users()

Adds:
- public.is_chef() JWT helper (mirrors is_admin(); for sub-project #2)
- public.list_app_users() SECURITY DEFINER for the admin user-listing UI;
  body asserts is_admin(), returns auth.users with role normalised, supports
  role filter + email search + pagination."
```

---

## Task 2: CLI ops — `automation/mfc/ops/users.py`

**Files:**
- Create: `automation/mfc/ops/users.py`

- [ ] **Step 1: Write the ops module**

Create `automation/mfc/ops/users.py`:

```python
"""User-role operations.

The privileged mutation surface for roles. Reads via supabase-py service-role
client; force-signout via direct DELETE on auth.refresh_tokens + auth.sessions
(supabase-py's sign_out wants a JWT, not a user id, so it doesn't fit).

IMPORTANT: app_metadata only. user_metadata is user-writable; storing role
there would be a privilege-escalation vulnerability.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional
from uuid import UUID

from ..clients import pg, sb as sb_client
from ..core import log
from ..core.config import Config


VALID_ROLES: tuple[str, ...] = ("user", "chef", "admin")


@dataclass(frozen=True)
class AppUser:
    """Slimmed-down view of an auth.users row, role-normalised."""
    id: str
    email: str
    full_name: Optional[str]
    role: str  # always one of VALID_ROLES
    created_at: Optional[str]
    last_sign_in_at: Optional[str]
    provider: str


class RoleError(RuntimeError):
    """Domain error for role operations: invalid role, target not found,
    last-admin guard, etc. Caught at the command layer and rendered as a
    user-facing message + non-zero exit."""


# ─────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────

def _is_uuid(s: str) -> bool:
    try:
        UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


def _user_to_app_user(u) -> AppUser:
    """Normalise a supabase-py User into our AppUser dataclass."""
    app_meta = (u.app_metadata or {}) if hasattr(u, "app_metadata") else (u.get("app_metadata") or {})
    user_meta = (u.user_metadata or {}) if hasattr(u, "user_metadata") else (u.get("user_metadata") or {})
    role = app_meta.get("role") or "user"
    full_name = user_meta.get("full_name") or user_meta.get("name")
    provider = app_meta.get("provider") or "email"
    uid = u.id if hasattr(u, "id") else u.get("id")
    email = (u.email if hasattr(u, "email") else u.get("email")) or ""
    created_at = u.created_at if hasattr(u, "created_at") else u.get("created_at")
    last_sign_in_at = (
        u.last_sign_in_at if hasattr(u, "last_sign_in_at") else u.get("last_sign_in_at")
    )
    return AppUser(
        id=str(uid),
        email=email,
        full_name=full_name,
        role=role,
        created_at=str(created_at) if created_at else None,
        last_sign_in_at=str(last_sign_in_at) if last_sign_in_at else None,
        provider=provider,
    )


def _iter_all_users(client) -> Iterable:
    """Yield every auth.users row by paginating list_users()."""
    page = 1
    while True:
        users = client.auth.admin.list_users(page=page, per_page=200)
        if not users:
            return
        for u in users:
            yield u
        if len(users) < 200:
            return
        page += 1


def _resolve_target(client, target: str):
    """Return the supabase-py User object for `target` (email or UUID).
    Raises RoleError if not found."""
    if _is_uuid(target):
        try:
            resp = client.auth.admin.get_user_by_id(target)
            return resp.user if hasattr(resp, "user") else resp
        except Exception as exc:
            raise RoleError(f"user not found: {target}") from exc
    # Otherwise treat as email — paginate listUsers and match.
    target_lower = target.strip().lower()
    for u in _iter_all_users(client):
        email = (u.email if hasattr(u, "email") else u.get("email")) or ""
        if email.lower() == target_lower:
            return u
    raise RoleError(f"user not found: {target}")


def _count_admins(client) -> int:
    n = 0
    for u in _iter_all_users(client):
        app_meta = (u.app_metadata or {}) if hasattr(u, "app_metadata") else (u.get("app_metadata") or {})
        if (app_meta.get("role") or "user") == "admin":
            n += 1
    return n


def _is_demotion(current_role: str, new_role: str) -> bool:
    """admin → anything-not-admin, or chef → user. Promotions never trigger."""
    if current_role == "admin" and new_role != "admin":
        return True
    if current_role == "chef" and new_role == "user":
        return True
    return False


def _force_signout(config: Config, user_id: str) -> None:
    """Invalidate every session and refresh-token for the target user.
    Implemented via direct SQL because supabase-py's sign_out takes a JWT,
    not a user id."""
    with pg.connection(config) as conn:
        pg.exec_sql(conn, "DELETE FROM auth.refresh_tokens WHERE user_id = %s", (user_id,))
        pg.exec_sql(conn, "DELETE FROM auth.sessions       WHERE user_id = %s", (user_id,))


# ─────────────────────────────────────────────────────────────────────────
# Public ops
# ─────────────────────────────────────────────────────────────────────────

def list_users(
    config: Config,
    *,
    role: str = "all",
    q: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
) -> list[AppUser]:
    """Page auth.admin.list_users(), filter in-process, return AppUser list."""
    client = sb_client.service_client(config)
    role_l = role.lower()
    q_l = (q or "").strip().lower() or None

    matched: list = []
    for u in _iter_all_users(client):
        app_meta = (u.app_metadata or {}) if hasattr(u, "app_metadata") else (u.get("app_metadata") or {})
        u_role = (app_meta.get("role") or "user").lower()
        if role_l != "all" and u_role != role_l:
            continue
        u_email = (u.email if hasattr(u, "email") else u.get("email")) or ""
        if q_l and q_l not in u_email.lower():
            continue
        matched.append(u)

    # Stable order: newest first by created_at.
    def _ts(u):
        v = u.created_at if hasattr(u, "created_at") else u.get("created_at")
        return str(v or "")
    matched.sort(key=_ts, reverse=True)

    start = max(page - 1, 0) * max(min(per_page, 200), 1)
    end = start + max(min(per_page, 200), 1)
    return [_user_to_app_user(u) for u in matched[start:end]]


def set_role(
    config: Config,
    *,
    target: str,
    new_role: str,
    force_signout: bool = True,
) -> tuple[AppUser, AppUser, bool]:
    """Apply the role change. Returns (before, after, signed_out).

    Guards:
      - new_role must be in VALID_ROLES
      - target must exist
      - last-admin: refuse demotion of the only remaining admin
    """
    if new_role not in VALID_ROLES:
        raise RoleError(f"invalid role: {new_role!r} (must be one of {VALID_ROLES})")

    client = sb_client.service_client(config)
    user = _resolve_target(client, target)
    before = _user_to_app_user(user)

    # No-op if unchanged.
    if before.role == new_role:
        return before, before, False

    # Last-admin guard.
    if before.role == "admin" and new_role != "admin":
        if _count_admins(client) <= 1:
            raise RoleError(
                f"refusing to demote {before.email} — last remaining admin. "
                f"Promote another user to admin first."
            )

    # Build the merged app_metadata patch.
    app_meta = (user.app_metadata or {}) if hasattr(user, "app_metadata") else (user.get("app_metadata") or {})
    new_meta = dict(app_meta)
    if new_role == "user":
        new_meta.pop("role", None)
    else:
        new_meta["role"] = new_role

    client.auth.admin.update_user_by_id(before.id, {"app_metadata": new_meta})

    signed_out = False
    if force_signout and _is_demotion(before.role, new_role):
        _force_signout(config, before.id)
        signed_out = True

    # Re-fetch for the post-state.
    resp = client.auth.admin.get_user_by_id(before.id)
    after_user = resp.user if hasattr(resp, "user") else resp
    after = _user_to_app_user(after_user)
    return before, after, signed_out
```

- [ ] **Step 2: Smoke-import the module**

```bash
uv --project automation run python -c "
from mfc.ops import users
print('VALID_ROLES =', users.VALID_ROLES)
print('AppUser =', users.AppUser)
print('RoleError =', users.RoleError)
"
```

Expected:
```
VALID_ROLES = ('user', 'chef', 'admin')
AppUser = <class 'mfc.ops.users.AppUser'>
RoleError = <class 'mfc.ops.users.RoleError'>
```

- [ ] **Step 3: Smoke-test list_users() against live DB (read-only, safe)**

```bash
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.ops import users
rows = users.list_users(Config.load(), role='all', per_page=5)
for r in rows:
    print(f'{r.role:6s}  {r.email}  {r.id}')
"
```

Expected: prints up to 5 rows with role/email/id columns. (At least your operator user should appear.)

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/ops/users.py
git commit -m "feat(cli): mfc.ops.users — list_users + set_role with last-admin guard

set_role enforces: valid role values, target lookup, last-admin guard,
implicit-user (writes None for 'user' role). Force-signout on demotion via
direct DELETE on auth.refresh_tokens + auth.sessions (supabase-py's sign_out
takes a JWT, not a user id)."
```

---

## Task 3: CLI command — `mfc list-users`

**Files:**
- Create: `automation/mfc/commands/list_users.py`
- Modify: `automation/mfc/cli.py`

- [ ] **Step 1: Write the command module**

Create `automation/mfc/commands/list_users.py`:

```python
"""`mfc list-users` — list users with role + identity columns."""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..ops import users as users_ops


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "list-users",
        help="List users (paginated) with role + identity columns",
    )
    p.add_argument("--role", default="all", choices=("all", *users_ops.VALID_ROLES),
                   help="Filter by role (default: all)")
    p.add_argument("--q", default=None, help="Email substring (ILIKE)")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--per-page", type=int, default=50)
    p.set_defaults(handler=run)


def _truncate(s: str | None, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[: n - 1] + "…"


def run(args: argparse.Namespace, config: Config) -> int:
    rows = users_ops.list_users(
        config,
        role=args.role,
        q=args.q,
        page=args.page,
        per_page=args.per_page,
    )
    if not rows:
        log.warn("no users match")
        return 0

    # Compute column widths from rows we have.
    w_role  = max(5, max(len(r.role)  for r in rows))
    w_email = max(5, max(len(r.email) for r in rows))
    w_name  = max(4, max(len(r.full_name or "") for r in rows))
    w_prov  = max(8, max(len(r.provider) for r in rows))

    log.step(f"page {args.page} · {len(rows)} row(s)")
    header = f"  {'role':<{w_role}}  {'email':<{w_email}}  {'name':<{w_name}}  {'provider':<{w_prov}}  created"
    print(header)
    print("  " + "─" * (len(header) - 2))
    for r in rows:
        print(
            f"  {r.role:<{w_role}}  "
            f"{_truncate(r.email, w_email):<{w_email}}  "
            f"{_truncate(r.full_name or '—', w_name):<{w_name}}  "
            f"{r.provider:<{w_prov}}  "
            f"{(r.created_at or '')[:19]}"
        )
    return 0
```

- [ ] **Step 2: Register the command in `cli.py`**

Edit `automation/mfc/cli.py`. Find the imports block:

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    reset,
    seed_metrics,
    status,
)
```

Replace with (alphabetical, `list_users` added):

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    reset,
    seed_metrics,
    status,
)
```

Find `COMMAND_MODULES`:

```python
COMMAND_MODULES = [
    status,
    apply_schema,
    seed_metrics,
    import_recipes,
    drop_schema,
    reset,
]
```

Replace with (read-only first):

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    drop_schema,
    reset,
]
```

- [ ] **Step 3: Verify `mfc list-users --help` works**

```bash
uv --project automation run mfc --help
uv --project automation run mfc list-users --help
```

Expected: top-level help lists `list-users`; the subcommand help shows `--role`, `--q`, `--page`, `--per-page`.

- [ ] **Step 4: Smoke-test against live DB**

```bash
uv --project automation run mfc list-users --per-page 5
```

Expected: tabular output with at least the operator's row.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/cli.py automation/mfc/commands/list_users.py
git commit -m "feat(cli): mfc list-users — paginated users table

--role / --q filters, paginated. Calls ops.users.list_users() under the
hood (which pages auth.admin.list_users via supabase-py service-role)."
```

---

## Task 4: CLI command — `mfc set-role`

**Files:**
- Create: `automation/mfc/commands/set_role.py`

- [ ] **Step 1: Write the command module**

Create `automation/mfc/commands/set_role.py`:

```python
"""`mfc set-role` — change a user's role.

Privileged mutation. Validates input, applies the last-admin guard, writes
app_metadata.role, and on demotion invalidates all of the target's sessions.

Honours the global --yes flag; otherwise prompts for demotion confirmations.
"""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..core.prompts import confirm
from ..ops import users as users_ops


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "set-role",
        help="Change a user's role (user|chef|admin)",
    )
    p.add_argument("--user", required=True, help="Target email or UUID")
    p.add_argument("--role", required=True, choices=users_ops.VALID_ROLES,
                   help="New role")
    p.add_argument("--no-signout", action="store_true",
                   help="Skip force-signout on demotion (rare; use with care)")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    try:
        # Pre-resolve to know if it's a demotion before prompting.
        from ..clients import sb as sb_client
        client = sb_client.service_client(config)
        user = users_ops._resolve_target(client, args.user)
        before = users_ops._user_to_app_user(user)

        if before.role == args.role:
            log.warn(f"{before.email} is already {before.role} — no-op")
            return 0

        is_demote = users_ops._is_demotion(before.role, args.role)
        if is_demote and not args.no_signout:
            ok = confirm(
                f"  ! Demote {before.email} from {before.role} to {args.role}? "
                f"All active sessions will be ended.",
                assume_yes=getattr(args, "yes", False),
            )
            if not ok:
                log.warn("aborted")
                return 1

        before, after, signed_out = users_ops.set_role(
            config,
            target=args.user,
            new_role=args.role,
            force_signout=not args.no_signout,
        )
        sig = "yes" if signed_out else "no"
        log.ok(f"{before.email}  {before.role} → {after.role}  (signed out: {sig})")
        return 0
    except users_ops.RoleError as exc:
        log.error(str(exc))
        return 2
```

- [ ] **Step 2: Register `set_role` in `cli.py`**

Edit `automation/mfc/cli.py`. Find the imports block (after Task 3):

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    reset,
    seed_metrics,
    status,
)
```

Replace with (alphabetical, `set_role` added):

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    reset,
    seed_metrics,
    set_role,
    status,
)
```

Find `COMMAND_MODULES` (after Task 3):

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    drop_schema,
    reset,
]
```

Replace with (read-only first, then `set_role` after `import_recipes`, destructive last):

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    set_role,
    drop_schema,
    reset,
]
```

- [ ] **Step 3: Verify `mfc set-role --help` works**

```bash
uv --project automation run mfc --help
uv --project automation run mfc set-role --help
```

Expected: top-level help now lists `set-role`; the subcommand help shows `--user`, `--role`, `--no-signout`.

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/cli.py automation/mfc/commands/set_role.py
git commit -m "feat(cli): mfc set-role — change a user's role

Validates role, runs last-admin guard, writes app_metadata.role,
force-signs-out on demotion (skippable via --no-signout). Honours global
--yes; otherwise prompts for demotion confirmations."
```

---

## Task 5: Makefile targets

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add the two new targets**

Edit `Makefile`. Find:

```make
.PHONY: help sync status apply-schema seed-metrics import-recipes \
        drop-schema reset serve
```

Replace with:

```make
.PHONY: help sync status apply-schema seed-metrics import-recipes \
        list-users set-role drop-schema reset serve
```

Find:

```make
import-recipes: ## upsert ingredients, utensils, and recipes from web/assets/recipes/
	@$(UV) run mfc import-recipes
```

Insert immediately AFTER it (before `drop-schema`):

```make
list-users: ## list users; optional ROLE=user|chef|admin Q=alice
	@$(UV) run mfc list-users $(if $(ROLE),--role $(ROLE)) $(if $(Q),--q $(Q))

set-role: ## change role; required USER=<email-or-uuid> ROLE=<user|chef|admin>
	@$(UV) run mfc set-role --user "$(USER)" --role "$(ROLE)"
```

(The `USER=` make variable shadows `$USER` shell env for the recipe's duration only — Make's command-line override wins. Documented in spec.)

- [ ] **Step 2: Verify both targets show up in help**

```bash
make help
```

Expected: `list-users` and `set-role` appear with their descriptions.

- [ ] **Step 3: Verify `make list-users` works**

```bash
make list-users
make list-users ROLE=admin
```

Expected: tabular output. No errors.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(make): list-users + set-role targets

Both wrap the corresponding mfc CLI subcommands. set-role takes USER= and
ROLE= as required make-style variables."
```

---

## Task 6: Bootstrap operator as admin (idempotent verification)

**Files:**
- (No files modified — this is a runtime verification step.)

- [ ] **Step 1: Run set-role for the operator's email**

Identify the operator email (the human running this plan). It's the address you used to sign in to the public site at least once. If unknown, run `make list-users` and pick the row.

```bash
make set-role USER=<your-email> ROLE=admin
```

Expected outcomes:
- If already admin: `! <email> is already admin — no-op` (exit 0).
- If newly promoted: `✓ <email>  user → admin  (signed out: no)` (exit 0).

- [ ] **Step 2: Verify the assignment via direct SQL**

```bash
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.clients import pg
config = Config.load()
with pg.connection(config) as conn:
    cur = pg.exec_sql(conn, \"SELECT email, raw_app_meta_data->>'role' FROM auth.users WHERE raw_app_meta_data->>'role' = 'admin' ORDER BY email\")
    for r in cur.fetchall():
        print(r)
"
```

Expected: at least one row, including the operator's email with role `admin`.

- [ ] **Step 3: No commit needed — runtime verification only**

(If a JWT was issued for this user before the promotion, sign out and back in on the public site so the new role lands in the JWT. Required for Task 7 smoke-tests.)

---

## Task 7: Browser admin UI — sidebar entry + users list page

**Files:**
- Modify: `web/assets/js/lib/admin-shared.jsx`
- Create: `web/admin/users.html`
- Create: `web/assets/js/app/admin-users-app.jsx`

- [ ] **Step 1: Inspect existing admin sidebar pattern**

Read `web/assets/js/lib/admin-shared.jsx` to find the `AdminSidebar` component and the existing nav items (Recipes, Ingredients, Utensils). Note the exact JSX shape (active-link detection, href, label) so the Users entry matches.

```bash
grep -n "AdminSidebar\|nav-item\|Recipes\|Ingredients\|Utensils" web/assets/js/lib/admin-shared.jsx
```

- [ ] **Step 2: Add `Users` entry to AdminSidebar**

Modify the `AdminSidebar` component in `web/assets/js/lib/admin-shared.jsx`. Add a new nav item AFTER `Utensils` (or wherever the existing items are listed). Use the same shape as the existing items — `href="../admin/users.html"`, label `Users`, active-detection on the same path basename. Do not invent a new icon set; if existing items use plain text or a single icon, match it.

If the existing implementation uses an array of `{ label, href }` items, append `{ label: "Users", href: "users.html" }`. If it's hardcoded JSX, add a parallel `<a>` element styled the same way.

- [ ] **Step 3: Create the users list HTML shell**

Create `web/admin/users.html`. Mirror `web/admin/recipes.html` exactly for everything except the page-specific app jsx. Open `web/admin/recipes.html` first, copy its full content, then change:

- `<title>` → `Users — MyFoodCraving Admin`
- The single page-specific `<script type="text/babel" src="../assets/js/app/admin-recipes-app.jsx">` → `../assets/js/app/admin-users-app.jsx`

Keep all other includes (supabase.js, auth.js, db.js, admin-db.js, admin-gate.js, admin-shared.jsx, etc.) identical to `recipes.html`. Do NOT remove `admin-db.js` even though this page doesn't use the catalog tables — keeping the script set uniform avoids surprises.

- [ ] **Step 4: Create the users list app**

Create `web/assets/js/app/admin-users-app.jsx`:

```jsx
// Admin users list — read-only. Calls public.list_app_users() RPC.
// Role mutations happen in the terminal (see /admin/user.html).

const { useState, useEffect, useMemo } = React;

const ROLE_LABELS = { user: "User", chef: "Chef", admin: "Admin" };

function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60)        return `${s}s ago`;
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

function initials(email, fullName) {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
  }
  return (email?.[0] || "?").toUpperCase();
}

function RoleBadge({ role }) {
  const cls = `role-badge role-${role}`;
  return <span className={cls}>{ROLE_LABELS[role] || role}</span>;
}

function Pagination({ page, perPage, total, onPage }) {
  const last = Math.max(1, Math.ceil(total / perPage));
  return (
    <div className="user-pager">
      <button disabled={page <= 1}    onClick={() => onPage(page - 1)}>‹ Prev</button>
      <span>page {page} of {last}  ·  {total} total</span>
      <button disabled={page >= last} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  );
}

function UsersApp() {
  const [role, setRole]       = useState("all");
  const [qInput, setQInput]   = useState("");
  const [q, setQ]             = useState("");
  const [page, setPage]       = useState(1);
  const perPage = 50;
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  // Debounce q.
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    window.MFC.supabase.rpc("list_app_users", {
      p_role: role,
      p_q: q || null,
      p_page: page,
      p_per_page: perPage,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setErr(error.message || String(error)); setRows([]); setTotal(0); }
      else {
        setRows(data || []);
        setTotal(data && data.length ? Number(data[0].total_count) : 0);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [role, q, page]);

  return (
    <div className="admin-page">
      <div className="admin-topbar"><h1>Users</h1></div>

      <div className="admin-filters">
        <input
          className="admin-search"
          type="search"
          placeholder="Search by email…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <div className="role-pills">
          {["all", "user", "chef", "admin"].map((r) => (
            <button
              key={r}
              className={"role-pill" + (role === r ? " active" : "")}
              onClick={() => { setRole(r); setPage(1); }}
            >
              {r === "all" ? "All" : ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="user-banner">
        Role changes are made from the terminal. Open a user to see the exact command.
      </div>

      {loading && <div className="admin-loading">Loading…</div>}
      {err && <div className="admin-error">Error: {err}</div>}

      {!loading && !err && rows.length === 0 && (
        <div className="admin-empty">No users match.</div>
      )}

      {!loading && !err && rows.length > 0 && (
        <>
          <table className="users-table">
            <thead>
              <tr>
                <th></th>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Signed up</th>
                <th>Last sign-in</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => { window.location = `user.html?id=${r.id}`; }} className="user-row">
                  <td><span className="user-avatar">{initials(r.email, r.full_name)}</span></td>
                  <td className="mono">{r.email}</td>
                  <td>{r.full_name || "—"}</td>
                  <td><RoleBadge role={r.role} /></td>
                  <td title={r.created_at}>{relativeTime(r.created_at)}</td>
                  <td title={r.last_sign_in_at}>{relativeTime(r.last_sign_in_at)}</td>
                  <td>{r.provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} perPage={perPage} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// Gate then render.
window.MFC.adminGate.guard().then((ok) => {
  if (!ok) return; // gate renders its own panel
  ReactDOM.createRoot(document.getElementById("root")).render(<UsersApp />);
});
```

Inline-add minimal styles for new classes used here. Open `web/assets/css/admin-styles.css`, append:

```css
/* ── users list ───────────────────────────────────────────── */
.admin-filters { display: flex; gap: 16px; align-items: center; margin: 16px 0; }
.admin-search { flex: 1; padding: 8px 12px; border: 1px solid var(--rule); border-radius: 8px; font: inherit; }
.role-pills { display: flex; gap: 6px; }
.role-pill { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); cursor: pointer; font: inherit; }
.role-pill.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

.user-banner { padding: 10px 14px; background: var(--cream-deep); border-radius: 8px; font-style: italic; color: var(--ink-soft); margin-bottom: 16px; }

.users-table { width: 100%; border-collapse: collapse; }
.users-table th, .users-table td { padding: 10px 8px; border-bottom: 1px solid var(--rule); text-align: left; }
.users-table th { font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-muted); }
.user-row { cursor: pointer; }
.user-row:hover { background: var(--cream-soft); }
.user-avatar { display: inline-grid; place-items: center; width: 28px; height: 28px; background: var(--orange); color: var(--paper); border-radius: 50%; font-size: 11px; font-weight: 700; font-family: var(--mono); }

.role-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-family: var(--mono); letter-spacing: 0.04em; text-transform: uppercase; }
.role-badge.role-user  { background: var(--cream-deep); color: var(--ink-muted); }
.role-badge.role-chef  { background: var(--matcha); color: var(--paper); }
.role-badge.role-admin { background: var(--orange); color: var(--paper); }

.user-pager { display: flex; gap: 16px; align-items: center; justify-content: center; padding: 16px 0; }
.user-pager button { padding: 6px 12px; border: 1px solid var(--rule); border-radius: 6px; background: var(--paper); font: inherit; cursor: pointer; }
.user-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.mono { font-family: var(--mono); font-size: 13px; }

.admin-loading, .admin-empty, .admin-error { padding: 40px; text-align: center; color: var(--ink-muted); font-family: var(--serif); font-style: italic; }
.admin-error { color: var(--berry); }
```

(If any of `--berry` / `--cream-soft` doesn't exist in `recipe-base.css`, replace inline with a literal hex; check first via `grep --berry web/assets/css/recipe-base.css`.)

- [ ] **Step 5: Smoke-test the page**

```bash
make serve
```

Open `http://localhost:8080/admin/users.html` (signed in as the operator admin from Task 6). Expected:
- Sidebar shows `Users` entry, marked active.
- Table shows at least your own row with the `Admin` badge.
- "Role changes are made from the terminal" banner visible above the table.
- Search by email-substring works (debounced).
- Role filter pills work; switching to `Chef` (or another role with no rows) shows the empty state.
- Pagination shows `page 1 of 1 · N total` with disabled Prev/Next when only one page.

- [ ] **Step 6: Smoke-test the gate**

Sign out of the public site. Re-open `http://localhost:8080/admin/users.html`. Expected: `admin-gate.js` renders the sign-in / not-authorised panel; the users list does not render.

- [ ] **Step 7: Commit**

```bash
git add web/admin/users.html web/assets/js/app/admin-users-app.jsx web/assets/js/lib/admin-shared.jsx web/assets/css/admin-styles.css
git commit -m "feat(admin): users list page

Read-only listing of auth.users via public.list_app_users() RPC. Role pills,
debounced email search, pagination via total_count. Banner directs admins to
the terminal for role changes."
```

---

## Task 8: Browser admin UI — user detail page (read-only + suggest commands)

**Files:**
- Create: `web/admin/user.html`
- Create: `web/assets/js/app/admin-user-app.jsx`

- [ ] **Step 1: Create the detail HTML shell**

Create `web/admin/user.html`. Same pattern as Task 7 step 3: copy from `web/admin/recipe.html` (singular — the detail page), then change:

- `<title>` → `User — MyFoodCraving Admin`
- The single page-specific `<script>` to `../assets/js/app/admin-user-app.jsx`

Keep the rest of the include order identical.

- [ ] **Step 2: Create the detail app**

Create `web/assets/js/app/admin-user-app.jsx`:

```jsx
// Admin user detail — read-only.
// Shows identity + current role; suggests `make set-role` commands.

const { useState, useEffect } = React;

const ROLE_LABELS = { user: "User", chef: "Chef", admin: "Admin" };
const ROLE_DESCRIPTIONS = {
  user:  "No write access. Default role.",
  chef:  "Can create and edit recipes they own (granted in sub-project #2).",
  admin: "Full access: catalog, users, settings.",
};

function RoleBadge({ role }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABELS[role] || role}</span>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handler = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button className="copy-btn" onClick={handler}>
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function consequenceFor(currentRole, newRole) {
  const isDemote =
    (currentRole === "admin" && newRole !== "admin") ||
    (currentRole === "chef" && newRole === "user");
  if (isDemote) {
    return "Will sign the user out of all sessions immediately.";
  }
  if (newRole === "admin") return "Grants full admin access.";
  if (newRole === "chef")  return "Grants chef-level recipe ownership (when sub-project #2 lands).";
  return "Removes elevated access.";
}

function UserDetail({ user }) {
  const otherRoles = ["user", "chef", "admin"].filter((r) => r !== user.role);
  return (
    <div className="user-detail">
      <div className="user-id-block">
        <h2>{user.email}</h2>
        <dl>
          <dt>Name</dt>           <dd>{user.full_name || "—"}</dd>
          <dt>Provider</dt>       <dd>{user.provider}</dd>
          <dt>Signed up</dt>      <dd>{user.created_at || "—"}</dd>
          <dt>Last sign-in</dt>   <dd>{user.last_sign_in_at || "—"}</dd>
          <dt>User ID</dt>        <dd className="mono">{user.id}</dd>
        </dl>
      </div>

      <div className="user-role-block">
        <h3>Role</h3>
        <p>Current: <RoleBadge role={user.role} /></p>

        <div className="role-suggestions">
          <p className="hint">To change this role, run one of these commands in your terminal:</p>
          {otherRoles.map((r) => {
            const cmd = `make set-role USER=${user.email} ROLE=${r}`;
            return (
              <div key={r} className="role-suggestion">
                <div className="suggestion-head">
                  <span className="suggestion-label">→ Set to <RoleBadge role={r} /></span>
                  <CopyButton text={cmd} />
                </div>
                <pre className="suggestion-cmd">{cmd}</pre>
                <p className="suggestion-caption">{consequenceFor(user.role, r)} <em>{ROLE_DESCRIPTIONS[r]}</em></p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UserApp() {
  const id = new URLSearchParams(window.location.search).get("id");
  const [user, setUser]     = useState(null);
  const [err, setErr]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setErr("No user id in URL."); setLoading(false); return; }
    let cancelled = false;
    // Single-row lookup via the same RPC. We pass the id through p_q
    // because the RPC's filter accepts any substring; the id is unique.
    window.MFC.supabase.rpc("list_app_users", {
      p_role: "all",
      p_q: id,
      p_page: 1,
      p_per_page: 1,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setErr(error.message || String(error)); setLoading(false); return; }
      // p_q is email-only; if id-by-email returned nothing, fall back to scanning by id.
      if (data && data.length === 1 && data[0].id === id) {
        setUser(data[0]); setLoading(false); return;
      }
      // Fallback: pull a wider page and find by id.
      window.MFC.supabase.rpc("list_app_users", {
        p_role: "all", p_q: null, p_page: 1, p_per_page: 200,
      }).then(({ data: data2, error: e2 }) => {
        if (cancelled) return;
        if (e2) { setErr(e2.message || String(e2)); setLoading(false); return; }
        const match = (data2 || []).find((r) => r.id === id);
        if (!match) setErr("User not found.");
        else setUser(match);
        setLoading(false);
      });
    });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="admin-page">
      <div className="admin-topbar">
        <a href="users.html" className="back-link">← Users</a>
        <h1>{user ? user.email : "User"}</h1>
      </div>
      {loading && <div className="admin-loading">Loading…</div>}
      {err && <div className="admin-error">Error: {err}</div>}
      {user && <UserDetail user={user} />}
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (!ok) return;
  ReactDOM.createRoot(document.getElementById("root")).render(<UserApp />);
});
```

Append the page-specific styles to `web/assets/css/admin-styles.css`:

```css
/* ── user detail ──────────────────────────────────────────── */
.back-link { display: inline-block; margin-right: 16px; color: var(--ink-soft); font-size: 14px; }
.back-link:hover { color: var(--orange); }

.user-detail { display: grid; gap: 24px; max-width: 760px; }
.user-id-block dl { display: grid; grid-template-columns: 140px 1fr; gap: 6px 16px; margin-top: 12px; }
.user-id-block dt { font-family: var(--mono); font-size: 11px; color: var(--ink-muted); letter-spacing: 0.04em; text-transform: uppercase; }
.user-id-block dd { font-size: 14px; }

.user-role-block { padding: 20px; border: 1px solid var(--rule); border-radius: 12px; background: var(--paper); }
.user-role-block h3 { margin-bottom: 8px; }
.role-suggestions { margin-top: 24px; display: grid; gap: 16px; }
.role-suggestions .hint { font-style: italic; color: var(--ink-soft); margin-bottom: 8px; }
.role-suggestion { padding: 12px 14px; border: 1px dashed var(--rule); border-radius: 8px; background: var(--cream-soft); }
.suggestion-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.suggestion-label { font-size: 14px; }
.copy-btn { padding: 4px 10px; border: 1px solid var(--rule); border-radius: 6px; background: var(--paper); font: inherit; font-size: 12px; cursor: pointer; }
.copy-btn:hover { background: var(--cream-deep); }
.suggestion-cmd { font-family: var(--mono); font-size: 13px; padding: 8px 12px; background: var(--ink); color: var(--paper); border-radius: 6px; overflow-x: auto; margin: 0; }
.suggestion-caption { margin-top: 6px; font-size: 12px; color: var(--ink-muted); }
.suggestion-caption em { font-style: italic; color: var(--ink-soft); }
```

- [ ] **Step 3: Smoke-test**

With the dev server running:

1. From `/admin/users.html`, click your own row. Expected: redirects to `/admin/user.html?id=<your-id>`.
2. Detail page shows: identity block (email, name, provider, signed up, last sign-in, user id), current role badge `Admin`, and TWO suggestion rows (one for `User`, one for `Chef`).
3. Each suggestion row shows the exact `make set-role USER=<email> ROLE=<role>` command in a code block with a Copy button.
4. Click Copy on one — button changes to `✓ Copied` for ~1.5s. Paste somewhere to confirm clipboard payload.
5. The "Will sign the user out…" caption appears for demotions (e.g. admin → user/chef).

- [ ] **Step 4: Commit**

```bash
git add web/admin/user.html web/assets/js/app/admin-user-app.jsx web/assets/css/admin-styles.css
git commit -m "feat(admin): user detail page

Read-only identity + current role badge. Two suggestion rows showing the
exact \`make set-role\` command for each non-current role, each with a
Copy-to-clipboard button and a one-line consequence caption."
```

---

## Task 9: Documentation updates

**Files:**
- Modify: `docs/USER-TODO.md` (§4)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `docs/USER-TODO.md` §4**

Open `docs/USER-TODO.md`. Find §4 (`## 4. Grant yourself the admin role`). Replace the recommended path with the `make set-role` pattern. The fallback SQL stays.

Find the section starting with `## 4.` and replace its content (preserving the prerequisite + foot-gun warning) with:

```markdown
## 4. Grant yourself the admin role

The admin pages are gated by `app_metadata.role = 'admin'` on your Supabase
user, enforced both in the UI ([web/assets/js/lib/admin-gate.js](../web/assets/js/lib/admin-gate.js))
and at the database level via the RLS predicate `public.is_admin()` (defined
in [automation/db/schema.sql](../automation/db/schema.sql) §8).

> **Why `app_metadata` and not `user_metadata`?** `user_metadata` can be
> written by the user themselves via the Supabase client — it is **not safe**
> for access control. `app_metadata` is mutable only via the service-role key
> (or SQL), which is why `public.is_admin()` reads from there.

### Prerequisite

**Sign in once on the public site first** (magic link or Google) so your row
exists in `auth.users`. The grant won't work until the row exists.

### Recommended — make target

```bash
make set-role USER=<your-email> ROLE=admin
```

Idempotent. Other roles: `ROLE=chef` (stages for sub-project #2) or
`ROLE=user` (demotes; will sign the target out of every active session).

To list users at any time:

```bash
make list-users                    # all
make list-users ROLE=admin         # filter
make list-users Q=alice            # email-substring search
```

### Fallback — Studio SQL (if you haven't run `make sync` yet)

Run any of these in **Studio → SQL Editor**, replacing the email. They use
`raw_app_meta_data || '...'::jsonb` so existing keys (e.g. `provider`) are
preserved.

**Grant admin to a single user:**
```sql
UPDATE auth.users
SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
WHERE email = 'you@example.com';
```
```

(Keep any subsequent §5+ content untouched.)

- [ ] **Step 2: Update `CLAUDE.md`**

Open `CLAUDE.md`. Find the "Schema layers — Admin gate" bullet (last bullet under Schema layers):

```
- **Admin gate** — `public.is_admin()` returns true when
  `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`. Used by RLS policies on
  the catalog and library tables.
```

Replace with:

```
- **Admin gate** — `public.is_admin()` / `public.is_chef()` return true when
  `auth.jwt() -> 'app_metadata' ->> 'role'` matches `'admin'` / `'chef'`. Used
  by RLS policies on the catalog and library tables. `public.list_app_users()`
  is a SECURITY DEFINER function that returns `auth.users` rows to admin
  callers; powers `/admin/users.html`.
- **Roles** — `app_metadata.role ∈ {chef, admin}` (or absent for default
  `user`). Mutated only by `mfc set-role` (= `make set-role USER=<…>
  ROLE=<…>`). Never writable from the browser. (`user_metadata` is
  intentionally avoided — user-writable, would be a privilege-escalation
  vulnerability.)
```

In the "Dev" section, find the Make-target list:

```
make             # list every Make target
make serve       # http.server on :8080
make sync        # sync the python venv (after editing automation/pyproject.toml)
make status      # supabase: list public tables + row counts
make reset       # supabase: drop + apply schema + seed metrics + import recipes
```

Insert two lines (alphabetical):

```
make             # list every Make target
make serve       # http.server on :8080
make sync        # sync the python venv (after editing automation/pyproject.toml)
make status      # supabase: list public tables + row counts
make list-users  # supabase: list users; optional ROLE=chef Q=alice
make set-role    # supabase: change role; USER=<email> ROLE=<user|chef|admin>
make reset       # supabase: drop + apply schema + seed metrics + import recipes
```

- [ ] **Step 3: Commit**

```bash
git add docs/USER-TODO.md CLAUDE.md
git commit -m "docs: roles foundation — make targets + is_chef/list_app_users notes"
```

---

## Task 10: End-to-end smoke verification

**Files:**
- (No files modified.)

- [ ] **Step 1: CLI list — operator visible as admin**

```bash
make list-users
```

Expected: at least one row with the operator's email and role `admin`.

- [ ] **Step 2: CLI promote — pick a non-admin user, set chef**

Identify a non-admin user from `make list-users ROLE=user` output. Promote:

```bash
make set-role USER=<their-email> ROLE=chef
```

Expected: `✓ <email>  user → chef  (signed out: no)`.

Verify:

```bash
make list-users ROLE=chef
```

Expected: that user appears.

- [ ] **Step 3: Browser list reflects the change**

Reload `http://localhost:8080/admin/users.html`. Expected: the just-promoted user shows the `Chef` badge. Filter by `Chef` — the list narrows. Open the user row.

- [ ] **Step 4: Browser detail page suggestions are correct**

On the detail page for the chef user, expected:
- Current role badge: `Chef`.
- Two suggestion rows: `User` (with "will sign the user out" caption — chef→user is a demotion) and `Admin` (promotion caption).
- Copy on each works.

- [ ] **Step 5: Last-admin guard fires**

If the operator is currently the only admin, attempt:

```bash
make set-role USER=<operator-email> ROLE=user
```

Confirmation prompt appears (it's a demotion). Type `y`. Expected:
```
  ✗ refusing to demote <email> — last remaining admin. Promote another user to admin first.
```
Exit code non-zero (`echo $?` → `2`).

- [ ] **Step 6: Demotion + force-signout flow (requires a second admin)**

Promote the chef user from Step 2 to admin temporarily:

```bash
make set-role USER=<chef-email> ROLE=admin
```

Now demote them:

```bash
make set-role USER=<chef-email> ROLE=user
```

Confirm the demotion prompt with `y`. Expected: `✓ <email>  admin → user  (signed out: yes)`.

Verify refresh tokens cleared:

```bash
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.clients import pg
config = Config.load()
with pg.connection(config) as conn:
    cur = pg.exec_sql(conn, \"SELECT count(*) FROM auth.refresh_tokens t JOIN auth.users u ON u.id::text = t.user_id WHERE u.email = %s\", ('<chef-email>',))
    print('refresh tokens for that user:', cur.fetchone()[0])
"
```

Expected: `0`.

- [ ] **Step 7: Tag the milestone**

```bash
git tag -a roles-foundation -m "Sub-project #1 of 4: roles foundation complete"
```

(No push — operator may want to review before publishing the tag.)

---

## Self-Review

**Spec coverage:**

| Spec section            | Plan task(s) |
|-------------------------|--------------|
| Schema (`is_chef`, `list_app_users`) | Task 1 |
| CLI ops (`users.py`)    | Task 2 |
| CLI commands (`list-users`, `set-role`) | Task 3, Task 4 |
| Makefile targets        | Task 5 |
| Operator bootstrap      | Task 6 |
| Browser UI — list page  | Task 7 |
| Browser UI — detail page | Task 8 |
| Documentation           | Task 9 |
| End-to-end smoke        | Task 10 |
| Out-of-scope items      | (intentionally not addressed) |

All spec sections covered.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / vague error-handling phrases remain. Each step shows the actual content the engineer needs.

**Type consistency:** `AppUser` dataclass shape, `RoleError` class name, `VALID_ROLES` tuple, `_is_demotion` helper signature, RPC parameter names (`p_role`, `p_q`, `p_page`, `p_per_page`), and the response columns (`id`, `email`, `full_name`, `role`, `created_at`, `last_sign_in_at`, `provider`, `total_count`) match across SQL function definition, ops module, command modules, and both browser apps.

**Known caveats** (documented in spec, restated here so the implementer doesn't paper over them):
- The `USER=` Make variable shadows the `$USER` shell env for the recipe's lifetime. Make's command-line override wins; the recipe sees the explicit value. Documented in Task 5.
- `supabase-py`'s `auth.admin.sign_out(jwt, scope)` takes a JWT, not a user id, so it doesn't fit our use case. The plan uses direct `DELETE` on `auth.refresh_tokens` + `auth.sessions` via psycopg.
- The detail page's single-row lookup uses `p_q = id` because the spec deliberately keeps the RPC surface to one function. A small fallback path scans up to 200 rows if the id-as-email-substring search misses (it shouldn't, since UUIDs aren't valid email substrings — but the fallback is a belt-and-braces).
