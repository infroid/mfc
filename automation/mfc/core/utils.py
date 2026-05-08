"""Shared utility helpers — kept tiny and stdlib-only."""

from __future__ import annotations

from datetime import datetime


def parse_iso_to_ts(iso: str | None) -> float:
    """Parse an ISO-8601 timestamp to a Unix float; returns 0.0 on empty/invalid.

    Tolerates the trailing-`Z` form some Supabase / Postgres serialisations emit.
    """
    if not iso:
        return 0.0
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0
