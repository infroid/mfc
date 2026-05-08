"""Utensil sync — bidirectional between local utensil.json bundles and the
public.utensils + public.utensil_buy_links tables. Mirrors ops/recipes.py.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..clients import sb as sb_client
from ..core import files, log
from ..core.config import Config
from ..core.utils import parse_iso_to_ts


_BUNDLE_FIELDS = (
    "id", "name", "tagline", "category", "photo", "care_tip",
    "specs", "show", "ai_filled_at",
)
_BUY_LINK_FIELDS = ("sort_order", "store", "url", "price", "affiliate_tag")


@dataclass
class SyncReport:
    pushed: int = 0
    pulled: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return f"↑ {self.pushed} pushed · ↓ {self.pulled} pulled · - {self.skipped} skipped · ! {len(self.failed)} failed"


def _bundle_to_utensil_row(config: "Config", bundle: dict) -> dict:
    """Translate utensil.json -> public.utensils row payload (excluding child tables)."""
    row = {k: bundle.get(k) for k in _BUNDLE_FIELDS}
    # specs / show default to {} per schema.
    if row["specs"] is None:
        row["specs"] = {}
    if row["show"] is None:
        row["show"] = {}
    az = bundle.get("amazon") or {}
    row["amazon_asin"] = az.get("asin")
    row["amazon_marketplace"] = az.get("marketplace")
    row["amazon_fetched_at"] = az.get("fetched_at")
    # Normalize legacy 'assets/utensils/.../foo.jpg' to a full Storage URL.
    from . import utensil_images as utensil_images_ops  # local import to avoid cycle
    row["photo"] = utensil_images_ops.normalize_image_value(
        config, utensil_id=bundle["id"], value=row.get("photo")
    )
    return row


def _bundle_to_buy_link_rows(bundle: dict) -> list[dict]:
    out: list[dict] = []
    for entry in (bundle.get("buy_links") or []):
        row = {"utensil_id": bundle["id"]}
        for k in _BUY_LINK_FIELDS:
            row[k] = entry.get(k)
        out.append(row)
    return out


def push_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Upsert local utensil.json bundles into DB. `only` scopes to a subset."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    paths = list(files.iter_utensil_bundles(config.repo_root))
    bundles = [files.load_utensil_json(p) for p in paths]
    if only:
        wanted = set(only)
        bundles = [b for b in bundles if b.get("id") in wanted]

    valid: list[dict] = []
    for b in bundles:
        if not b.get("id") or not b.get("name"):
            log.warn(f"skipping bundle missing id/name: {b.get('id') or '<no-id>'}")
            continue
        valid.append(b)

    if not valid:
        log.warn("no utensil bundles to push")
        return report

    log.step(f"sync-utensils · push · {len(valid)} bundle(s)")

    rows = [_bundle_to_utensil_row(config, b) for b in valid]
    sb.table("utensils").upsert(rows, on_conflict="id").execute()
    log.ok(f"utensils: {len(valid)}")

    ids = [b["id"] for b in valid]
    sb.table("utensil_buy_links").delete().in_("utensil_id", ids).execute()
    buy_rows = [r for b in valid for r in _bundle_to_buy_link_rows(b)]
    if buy_rows:
        sb.table("utensil_buy_links").insert(buy_rows).execute()
    log.ok(f"utensil_buy_links: {len(buy_rows)} row(s)")

    report.pushed = len(valid)
    log.ok(report.line())
    return report


def _db_to_bundle(row: dict, buy_links: list[dict]) -> dict:
    bundle = {k: row.get(k) for k in _BUNDLE_FIELDS}
    if row.get("amazon_asin"):
        bundle["amazon"] = {
            "asin": row["amazon_asin"],
            "marketplace": row.get("amazon_marketplace"),
            "fetched_at": row.get("amazon_fetched_at"),
        }
    bundle["buy_links"] = [
        {k: bl.get(k) for k in _BUY_LINK_FIELDS}
        for bl in sorted(buy_links, key=lambda b: b.get("sort_order") or 0)
    ]
    # Strip None-valued optional keys for clean diffs.
    for k in ("tagline", "category", "photo", "care_tip", "ai_filled_at"):
        if bundle.get(k) is None:
            bundle.pop(k, None)
    return bundle


def pull_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Reconstruct utensil.json bundles from DB rows."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    rows = sb.table("utensils").select("*").order("id").execute().data or []
    if only:
        wanted = set(only)
        rows = [r for r in rows if r["id"] in wanted]

    if not rows:
        log.warn("no utensils in DB to pull")
        return report

    log.step(f"sync-utensils · pull · {len(rows)} utensil(s)")

    ids = [r["id"] for r in rows]
    bl_rows = (
        sb.table("utensil_buy_links")
        .select("utensil_id, sort_order, store, url, price, affiliate_tag")
        .in_("utensil_id", ids)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    bl_by_uid: dict[str, list[dict]] = {}
    for bl in bl_rows:
        bl_by_uid.setdefault(bl["utensil_id"], []).append(bl)

    for row in rows:
        rid = row["id"]
        try:
            bundle = _db_to_bundle(row, bl_by_uid.get(rid, []))
            path = files.utensil_bundle_path(config.repo_root, rid)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
            report.pulled += 1
            log.ok(rid)
        except Exception as e:  # noqa: BLE001
            report.failed.append(f"{rid}: {e}")
            log.error(f"{rid}: {e}")

    log.ok(report.line())
    return report


def sync(config: Config, *, direction: str, only: Optional[list[str]] = None) -> SyncReport:
    if direction == "push":
        return push_bundles(config, only=only)
    if direction == "pull":
        return pull_bundles(config, only=only)
    if direction != "both":
        raise ValueError(f"invalid direction: {direction!r}")

    sb = sb_client.service_client(config)
    db_rows = sb.table("utensils").select("id, updated_at").execute().data or []
    db_by_id = {r["id"]: r for r in db_rows}
    if only:
        wanted = set(only)
        db_by_id = {k: v for k, v in db_by_id.items() if k in wanted}

    bundle_paths = list(files.iter_utensil_bundles(config.repo_root))
    local_by_id: dict[str, Path] = {}
    for p in bundle_paths:
        try:
            d = files.load_utensil_json(p)
            uid = d.get("id")
            if uid and (not only or uid in only):
                local_by_id[uid] = p
        except Exception:
            continue

    push_ids: list[str] = []
    pull_ids: list[str] = []

    for uid in sorted(set(db_by_id) | set(local_by_id)):
        db_row = db_by_id.get(uid)
        local_path = local_by_id.get(uid)
        if db_row and not local_path:
            pull_ids.append(uid)
            continue
        if local_path and not db_row:
            push_ids.append(uid)
            continue
        local_mtime = local_path.stat().st_mtime
        db_ts = parse_iso_to_ts(db_row.get("updated_at") or "")
        delta = local_mtime - db_ts
        if abs(delta) <= 1.0:
            continue
        if delta > 0:
            push_ids.append(uid)
        else:
            pull_ids.append(uid)

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


