"""Image-byte sync between local web/assets/recipes/* and Supabase Storage.

IMPORTANT: this module never touches recipe metadata schemas other than
recipes.media (the JSONB) and recipe_steps.media_src. Bundle JSON is owned
by mfc.ops.recipes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Literal, Optional

import httpx

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config


BUCKET = "recipe-images"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
LEGACY_PATH_PREFIX = "assets/"

# httpx default (5s) is tight for the Auth/Storage admin API in distant regions.
_HTTP_TIMEOUT_SECONDS = 60.0


@dataclass
class SyncReport:
    uploaded:   int = 0
    downloaded: int = 0
    skipped:    int = 0
    conflicts:  int = 0
    errors:     list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"↓ {self.downloaded} downloaded · "
            f"↑ {self.uploaded} uploaded · "
            f"- {self.skipped} skipped · "
            f"! {self.conflicts} conflicts"
        )


# ─────────────────────────────────────────────────────────────────────────
# Service-client + URL helper
# ─────────────────────────────────────────────────────────────────────────

def _service_client(config: Config):
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


def storage_url(config: Config, *, recipe_id: str, filename: str) -> str:
    """Returns the canonical public URL for a path inside the bucket."""
    base = (config.supabase_url or "").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL not set")
    return f"{base}/storage/v1/object/public/{BUCKET}/{recipe_id}/{filename}"


def normalize_image_value(config: Config, *, recipe_id: str, value) -> Optional[str]:
    """Convert legacy 'assets/...' paths to full Storage URLs. Pass through
    full URLs and empty values unchanged. Used by push paths so a stale
    bundle JSON doesn't reverse-migrate a row that's already on Storage URLs.
    """
    if not isinstance(value, str) or not value.strip():
        return value
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith(LEGACY_PATH_PREFIX):
        return storage_url(config, recipe_id=recipe_id, filename=Path(value).name)
    return value


# ─────────────────────────────────────────────────────────────────────────
# Local enumeration
# ─────────────────────────────────────────────────────────────────────────

def _recipes_dir(config: Config) -> Path:
    return config.repo_root / "web" / "assets" / "recipes"


def _local_recipe_ids(config: Config) -> list[str]:
    root = _recipes_dir(config)
    if not root.exists():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def _local_files_for(config: Config, recipe_id: str) -> dict[str, dict]:
    """Returns filename -> {mtime: float} for image files in the recipe dir."""
    out: dict[str, dict] = {}
    d = _recipes_dir(config) / recipe_id
    if not d.exists():
        return out
    for p in d.iterdir():
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            out[p.name] = {"mtime": p.stat().st_mtime}
    return out


# ─────────────────────────────────────────────────────────────────────────
# Storage enumeration
# ─────────────────────────────────────────────────────────────────────────

def _storage_files_for(client, recipe_id: str) -> dict[str, dict]:
    """Returns filename -> {updated_at_ts: float} for objects under <recipe_id>/."""
    out: dict[str, dict] = {}
    try:
        objects = client.storage.from_(BUCKET).list(recipe_id) or []
    except Exception:
        return out
    for o in objects:
        name = o.get("name") if isinstance(o, dict) else getattr(o, "name", None)
        if not name:
            continue
        if Path(name).suffix.lower() not in IMAGE_EXTS:
            continue
        ts_iso = (
            o.get("updated_at") if isinstance(o, dict) else getattr(o, "updated_at", None)
        )
        ts = _parse_iso_to_ts(ts_iso) if ts_iso else 0.0
        out[name] = {"updated_at_ts": ts}
    return out


def _parse_iso_to_ts(iso: str) -> float:
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


# ─────────────────────────────────────────────────────────────────────────
# Per-file decision rule
# ─────────────────────────────────────────────────────────────────────────

CLOCK_SKEW_TOLERANCE_S = 1.0


def _decide(
    *,
    local: Optional[dict],
    remote: Optional[dict],
    direction: str,
) -> Literal["upload", "download", "skip"]:
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


# ─────────────────────────────────────────────────────────────────────────
# Public ops
# ─────────────────────────────────────────────────────────────────────────

def sync_files(
    config: Config,
    *,
    direction: Literal["pull", "push", "both"],
    only: Optional[list[str]] = None,
) -> SyncReport:
    """Reconcile bytes between the bucket and web/assets/recipes/*."""
    if direction not in ("pull", "push", "both"):
        raise ValueError(f"invalid direction: {direction!r}")

    client = _service_client(config)
    report = SyncReport()

    if only:
        ids = list(only)
    else:
        local_ids = set(_local_recipe_ids(config))
        try:
            db_rows = client.table("recipes").select("id").execute().data or []
            db_ids = {r["id"] for r in db_rows}
        except Exception as e:
            log.warn(f"could not list DB recipes (continuing with local only): {e}")
            db_ids = set()
        ids = sorted(local_ids | db_ids)

    log.step(f"sync-images · {direction} · {len(ids)} recipe(s)")

    for rid in ids:
        local_files = _local_files_for(config, rid)
        remote_files = _storage_files_for(client, rid)
        all_names = sorted(set(local_files) | set(remote_files))

        for name in all_names:
            l = local_files.get(name)
            r = remote_files.get(name)
            action = _decide(local=l, remote=r, direction=direction)

            if action == "skip":
                report.skipped += 1
                continue
            if action == "upload":
                try:
                    _upload_one(client, config, rid, name)
                    report.uploaded += 1
                except Exception as e:
                    report.errors.append(f"upload {rid}/{name}: {e}")
            elif action == "download":
                try:
                    _download_one(client, config, rid, name)
                    report.downloaded += 1
                except Exception as e:
                    report.errors.append(f"download {rid}/{name}: {e}")

    log.ok(report.line())
    if report.errors:
        for err in report.errors[:10]:
            log.error(err)
        if len(report.errors) > 10:
            log.warn(f"…and {len(report.errors) - 10} more")
    return report


def _upload_one(client, config: Config, recipe_id: str, filename: str) -> None:
    p = _recipes_dir(config) / recipe_id / filename
    data = p.read_bytes()
    path = f"{recipe_id}/{filename}"
    content_type = _content_type_for(filename)
    client.storage.from_(BUCKET).upload(
        path,
        data,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def _download_one(client, config: Config, recipe_id: str, filename: str) -> None:
    path = f"{recipe_id}/{filename}"
    data = client.storage.from_(BUCKET).download(path)
    p = _recipes_dir(config) / recipe_id / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def _content_type_for(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")
