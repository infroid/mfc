"""supabase-py service-role client.

Uses the secret key — bypasses RLS. Only construct this from CLI commands
that genuinely need it (recipe import, future admin/storage commands).
"""

from __future__ import annotations

from supabase import create_client, Client  # type: ignore[import-untyped]

from ..core.config import Config


def service_client(config: Config) -> Client:
    url, key = config.require_supabase()
    return create_client(url, key)
