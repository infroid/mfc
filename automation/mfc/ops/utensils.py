"""Utensil sync — bidirectional between local utensil.json bundles and the
public.utensils + public.utensil_buy_links tables. Mirrors ops/recipes.py.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from ..clients import sb as sb_client
from ..core import files, log
from ..core.config import Config


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


def _bundle_to_utensil_row(bundle: dict) -> dict:
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

    rows = [_bundle_to_utensil_row(b) for b in valid]
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
