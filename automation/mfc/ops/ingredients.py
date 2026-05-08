"""Ingredient sync — bidirectional between local ingredient.json bundles and the
public.ingredients table. Mirrors ops/utensils.py.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..core.utils import parse_iso_to_ts


BUCKET = "ingredient-images"
_LEGACY_PATH_PREFIX = "assets/ingredients/"

_BUNDLE_FIELDS = (
    "id", "name", "tagline", "category", "default_unit", "photo", "emoji",
    "health_fact", "storage", "substitutes", "show", "nutrition",
    "ai_filled_at", "nutrition_source", "fdc_id",
)


@dataclass
class SyncReport:
    pushed: int = 0
    pulled: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return f"↑ {self.pushed} pushed · ↓ {self.pulled} pulled · - {self.skipped} skipped · ! {len(self.failed)} failed"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _iter_bundle_paths(repo_root: Path):
    root = repo_root / "web" / "assets" / "ingredients"
    if not root.exists():
        return []
    return sorted(p / "ingredient.json" for p in root.iterdir() if p.is_dir() and (p / "ingredient.json").exists())


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _bundle_path(repo_root: Path, ingredient_id: str) -> Path:
    return repo_root / "web" / "assets" / "ingredients" / ingredient_id / "ingredient.json"


def _normalize_photo(config: Config, ingredient_id: str, value) -> Optional[str]:
    """Convert legacy 'assets/ingredients/<id>/image.png' -> full Storage URL.
    Pass through full URLs and empty values unchanged.
    """
    if not isinstance(value, str) or not value.strip():
        return value
    if value.startswith("http://") or value.startswith("https://"):
        return value
    base = (config.supabase_url or "").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL not set")
    if value.startswith(_LEGACY_PATH_PREFIX) or value.startswith("/" + _LEGACY_PATH_PREFIX):
        return f"{base}/storage/v1/object/public/{BUCKET}/{ingredient_id}/{Path(value).name}"
    return value


def _bundle_to_row(config: Config, bundle: dict) -> dict:
    """Translate ingredient.json -> public.ingredients row payload."""
    row = {k: bundle.get(k) for k in _BUNDLE_FIELDS}
    row["photo"] = _normalize_photo(config, ingredient_id=bundle["id"], value=row.get("photo"))
    return row


def _row_to_bundle(row: dict) -> dict:
    """Build ingredient.json bundle from a DB row (drop null optional keys)."""
    bundle = {k: row.get(k) for k in _BUNDLE_FIELDS}
    # Strip None-valued optional keys for clean diffs.
    for k in ("tagline", "category", "photo", "emoji", "health_fact", "storage",
               "substitutes", "nutrition", "ai_filled_at", "nutrition_source", "fdc_id"):
        if bundle.get(k) is None:
            bundle.pop(k, None)
    return bundle


# ---------------------------------------------------------------------------
# push
# ---------------------------------------------------------------------------

def push_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Upsert local ingredient.json bundles into DB. `only` scopes to a subset."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    paths = list(_iter_bundle_paths(config.repo_root))
    bundles = [_load_json(p) for p in paths]
    if only:
        wanted = set(only)
        bundles = [b for b in bundles if b.get("id") in wanted]

    valid: list[dict] = []
    for b in bundles:
        if not b.get("id") or not b.get("name"):
            log.warn(f"skipping bundle missing id/name: {b.get('id') or '<no-id>'}")
            report.skipped += 1
            continue
        valid.append(b)

    if not valid:
        log.warn("no ingredient bundles to push")
        return report

    log.step(f"sync-ingredients · push · {len(valid)} bundle(s)")

    rows = [_bundle_to_row(config, b) for b in valid]
    sb.table("ingredients").upsert(rows, on_conflict="id").execute()
    log.ok(f"ingredients: {len(valid)}")

    report.pushed = len(valid)
    log.ok(report.line())
    return report


# ---------------------------------------------------------------------------
# pull
# ---------------------------------------------------------------------------

def pull_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Reconstruct ingredient.json bundles from DB rows."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    rows = sb.table("ingredients").select("*").order("id").execute().data or []
    if only:
        wanted = set(only)
        rows = [r for r in rows if r["id"] in wanted]

    if not rows:
        log.warn("no ingredients in DB to pull")
        return report

    log.step(f"sync-ingredients · pull · {len(rows)} ingredient(s)")

    for row in rows:
        rid = row["id"]
        try:
            bundle = _row_to_bundle(row)
            path = _bundle_path(config.repo_root, rid)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
            report.pulled += 1
            log.ok(rid)
        except Exception as e:  # noqa: BLE001
            report.failed.append(f"{rid}: {e}")
            log.error(f"{rid}: {e}")

    log.ok(report.line())
    return report


# ---------------------------------------------------------------------------
# sync (both)
# ---------------------------------------------------------------------------

def sync(config: Config, *, direction: str, only: Optional[list[str]] = None) -> SyncReport:
    if direction == "push":
        return push_bundles(config, only=only)
    if direction == "pull":
        return pull_bundles(config, only=only)
    if direction != "both":
        raise ValueError(f"invalid direction: {direction!r}")

    sb = sb_client.service_client(config)
    db_rows = sb.table("ingredients").select("id, updated_at").execute().data or []
    db_by_id = {r["id"]: r for r in db_rows}
    if only:
        wanted = set(only)
        db_by_id = {k: v for k, v in db_by_id.items() if k in wanted}

    bundle_paths = list(_iter_bundle_paths(config.repo_root))
    local_by_id: dict[str, Path] = {}
    for p in bundle_paths:
        try:
            d = _load_json(p)
            iid = d.get("id")
            if iid and (not only or iid in only):
                local_by_id[iid] = p
        except Exception:
            continue

    push_ids: list[str] = []
    pull_ids: list[str] = []

    for iid in sorted(set(db_by_id) | set(local_by_id)):
        db_row = db_by_id.get(iid)
        local_path = local_by_id.get(iid)
        if db_row and not local_path:
            pull_ids.append(iid)
            continue
        if local_path and not db_row:
            push_ids.append(iid)
            continue
        local_mtime = local_path.stat().st_mtime
        db_ts = parse_iso_to_ts(db_row.get("updated_at") or "")
        delta = local_mtime - db_ts
        if abs(delta) <= 1.0:
            continue
        if delta > 0:
            push_ids.append(iid)
        else:
            pull_ids.append(iid)

    report = SyncReport()
    if pull_ids:
        sub = pull_bundles(config, only=pull_ids)
        report.pulled += sub.pulled
        report.failed.extend(sub.failed)
    if push_ids:
        sub = push_bundles(config, only=push_ids)
        report.pushed += sub.pushed
        report.failed.extend(sub.failed)
    log.ok(report.line())
    return report
