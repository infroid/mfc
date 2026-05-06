"""Image-byte sync between local web/assets/recipes/* and Supabase Storage,
plus a one-shot DB rewriter that swaps legacy 'assets/...' paths for full
Storage URLs.

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


@dataclass
class MigrationReport:
    recipes_rewritten: int = 0
    steps_rewritten:   int = 0
    skipped_recipes:   int = 0
    skipped_steps:     int = 0


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


# ─────────────────────────────────────────────────────────────────────────
# DB URL rewriter
# ─────────────────────────────────────────────────────────────────────────

def migrate_urls(config: Config) -> MigrationReport:
    """Rewrite legacy 'assets/...' paths in recipes.media + populate
    recipe_steps.media_src from local file presence. Idempotent."""
    client = _service_client(config)
    report = MigrationReport()

    rows = client.table("recipes").select("id, media").execute().data or []
    log.step(f"migrate-image-urls · {len(rows)} recipe(s)")

    for r in rows:
        rid = r["id"]
        media = r.get("media") or {}
        new_media, changed = _rewrite_media(config, rid, media)
        if changed:
            client.table("recipes").update({"media": new_media}).eq("id", rid).execute()
            report.recipes_rewritten += 1
        else:
            report.skipped_recipes += 1

        steps = (
            client.table("recipe_steps")
            .select("recipe_id, sort_order, media_src")
            .eq("recipe_id", rid)
            .order("sort_order")
            .execute()
            .data
            or []
        )
        for s in steps:
            if s.get("media_src"):
                report.skipped_steps += 1
                continue
            sort_order = s["sort_order"]
            local_filename = _find_local_step_file(config, rid, sort_order)
            if not local_filename:
                report.skipped_steps += 1
                continue
            url = storage_url(config, recipe_id=rid, filename=local_filename)
            client.table("recipe_steps").update({"media_src": url}).eq(
                "recipe_id", rid
            ).eq("sort_order", sort_order).execute()
            report.steps_rewritten += 1

    log.ok(
        f"recipes: {report.recipes_rewritten} rewritten, {report.skipped_recipes} skipped · "
        f"steps: {report.steps_rewritten} populated, {report.skipped_steps} skipped"
    )
    return report


def _rewrite_media(config: Config, recipe_id: str, media: dict) -> tuple[dict, bool]:
    """Returns (new_media, changed). Rewrites media.image and media.hero.src
    when they start with 'assets/'."""
    new_media = dict(media)
    changed = False

    img = new_media.get("image")
    if isinstance(img, str) and img.startswith(LEGACY_PATH_PREFIX):
        filename = Path(img).name
        new_media["image"] = storage_url(config, recipe_id=recipe_id, filename=filename)
        changed = True

    hero = new_media.get("hero")
    if isinstance(hero, dict):
        new_hero = dict(hero)
        src = new_hero.get("src")
        if isinstance(src, str) and src.startswith(LEGACY_PATH_PREFIX):
            filename = Path(src).name
            new_hero["src"] = storage_url(
                config, recipe_id=recipe_id, filename=filename
            )
            changed = True
        new_media["hero"] = new_hero

    return new_media, changed


def _find_local_step_file(config: Config, recipe_id: str, sort_order: int) -> Optional[str]:
    d = _recipes_dir(config) / recipe_id
    if not d.exists():
        return None
    for ext in IMAGE_EXTS:
        candidate = d / f"step-{sort_order}{ext}"
        if candidate.exists():
            return candidate.name
    return None
