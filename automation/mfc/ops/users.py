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

import httpx

from ..clients import pg, sb as sb_client
from ..core.config import Config


VALID_ROLES: tuple[str, ...] = ("user", "chef", "admin")

# httpx default (5s) is tight for Supabase Auth admin calls when the project
# is in a far region. 30s leaves headroom without masking real failures.
_AUTH_TIMEOUT_SECONDS = 30.0


def _service_client(config: Config):
    """Wrap sb_client.service_client and bump the auth.admin httpx timeout."""
    client = sb_client.service_client(config)
    client.auth.admin._http_client.timeout = httpx.Timeout(_AUTH_TIMEOUT_SECONDS)
    return client


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

def is_demotion(current_role: str, new_role: str) -> bool:
    """Public re-export of _is_demotion for command-layer prompt logic."""
    return _is_demotion(current_role, new_role)


def lookup(config: Config, target: str) -> AppUser:
    """Resolve a user by email or UUID. Raises RoleError if not found."""
    client = _service_client(config)
    user = _resolve_target(client, target)
    return _user_to_app_user(user)


def list_users(
    config: Config,
    *,
    role: str = "all",
    q: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
) -> list[AppUser]:
    """Page auth.admin.list_users(), filter in-process, return AppUser list."""
    client = _service_client(config)
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

    def _ts(u):
        v = u.created_at if hasattr(u, "created_at") else u.get("created_at")
        return str(v or "")
    matched.sort(key=_ts, reverse=True)

    per = max(min(per_page, 200), 1)
    start = max(page - 1, 0) * per
    end = start + per
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

    client = _service_client(config)
    user = _resolve_target(client, target)
    before = _user_to_app_user(user)

    if before.role == new_role:
        return before, before, False

    if before.role == "admin" and new_role != "admin":
        if _count_admins(client) <= 1:
            raise RoleError(
                f"refusing to demote {before.email} — last remaining admin. "
                f"Promote another user to admin first."
            )

    # GoTrue's update_user_by_id MERGES app_metadata key-by-key; null deletes
    # the key. Send a sparse patch: only the role key, never the full dict.
    role_patch = {"role": None if new_role == "user" else new_role}
    client.auth.admin.update_user_by_id(before.id, {"app_metadata": role_patch})

    signed_out = False
    if force_signout and _is_demotion(before.role, new_role):
        _force_signout(config, before.id)
        signed_out = True

    resp = client.auth.admin.get_user_by_id(before.id)
    after_user = resp.user if hasattr(resp, "user") else resp
    after = _user_to_app_user(after_user)
    return before, after, signed_out
