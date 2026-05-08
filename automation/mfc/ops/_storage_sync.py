"""Shared internals for Supabase Storage ↔ local-disk byte sync.

Used by both ops/images.py (recipe-images) and ops/utensil_images.py
(utensil-images). Pure logic and Storage-client plumbing — no domain
knowledge of recipes or utensils.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

import httpx

from ..clients import sb as sb_client
from ..core.config import Config


IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
CLOCK_SKEW_TOLERANCE_S = 1.0

# httpx default (5s) is tight for the Auth/Storage admin API in distant regions.
_HTTP_TIMEOUT_SECONDS = 60.0


def service_client(config: Config):
    """Wrap sb_client.service_client and bump the storage httpx timeout."""
    client = sb_client.service_client(config)
    try:
        client.auth.admin._http_client.timeout = httpx.Timeout(_HTTP_TIMEOUT_SECONDS)
    except Exception:
        pass
    try:
        client.storage._client.timeout = httpx.Timeout(_HTTP_TIMEOUT_SECONDS)
    except Exception:
        pass
    return client


def content_type_for(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")


def decide(
    *,
    local: Optional[dict],
    remote: Optional[dict],
    direction: str,
) -> Literal["upload", "download", "skip"]:
    """Per-file action choice given local mtime and remote updated_at_ts.
    Within ±CLOCK_SKEW_TOLERANCE_S, treat as identical (skip)."""
    if not local and not remote:
        return "skip"
    if local and not remote:
        return "upload" if direction in ("push", "both") else "skip"
    if remote and not local:
        return "download" if direction in ("pull", "both") else "skip"
    delta = local["mtime"] - remote["updated_at_ts"]
    if abs(delta) <= CLOCK_SKEW_TOLERANCE_S:
        return "skip"
    if delta > 0:
        return "upload" if direction in ("push", "both") else "skip"
    return "download" if direction in ("pull", "both") else "skip"
