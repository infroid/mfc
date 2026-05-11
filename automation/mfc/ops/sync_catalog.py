"""SQLite ↔ Supabase sync for the ingredient catalog tables.

push: SELECT all rows from SQLite, upsert into Supabase.
pull: SELECT all rows from Supabase, REPLACE INTO SQLite (single transaction).
both: push first (SQLite canonical), then pull to capture any prod-side edits.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from .catalog import Catalog


_INGREDIENTS_JSON_FIELDS = ("aliases", "show")
_DETAILS_JSON_FIELDS = ("substitutes",)
# Columns to write back to Postgres on push (must match the new ingredients shape).
_INGREDIENT_PG_COLS = (
    "id", "name", "tagline", "category", "default_unit", "photo", "emoji",
    "aliases", "show", "source", "fdc_id", "ai_filled_at", "created_by",
    "created_at", "updated_at",
)
_DETAILS_PG_COLS_DEFER = ()  # all known cols flow through


@dataclass
class SyncReport:
    pushed_ingredients: int = 0
    pulled_ingredients: int = 0
    pushed_details: int = 0
    pulled_details: int = 0
    pushed_facts: int = 0
    pulled_facts: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"ingredients ↑{self.pushed_ingredients} ↓{self.pulled_ingredients} · "
            f"details ↑{self.pushed_details} ↓{self.pulled_details} · "
            f"facts ↑{self.pushed_facts} ↓{self.pulled_facts} · "
            f"failed {len(self.failed)}"
        )


def _decode_json_fields(row: sqlite3.Row | dict, json_fields: tuple[str, ...]) -> dict:
    d = dict(row)
    for k in json_fields:
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except Exception:
                pass
    return d


def _filter_cols(row: dict, cols: tuple[str, ...]) -> dict:
    if not cols:
        return {k: v for k, v in row.items() if v is not None}
    return {k: row[k] for k in cols if k in row and row[k] is not None}


def push(config: Config) -> SyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = SyncReport()

    # ingredients
    ing_rows: list[dict] = []
    for r in cat.iter_ingredients():
        decoded = _decode_json_fields(r, _INGREDIENTS_JSON_FIELDS)
        ing_rows.append(_filter_cols(decoded, _INGREDIENT_PG_COLS))
    if ing_rows:
        # Batch in chunks of ~200 to keep request size sane.
        BATCH = 200
        for i in range(0, len(ing_rows), BATCH):
            sb.table("ingredients").upsert(ing_rows[i:i+BATCH], on_conflict="id").execute()
        rep.pushed_ingredients = len(ing_rows)

    # ingredient_details
    det_rows: list[dict] = []
    cur = cat.conn.execute("SELECT * FROM ingredient_details ORDER BY id")
    for r in cur:
        decoded = _decode_json_fields(r, _DETAILS_JSON_FIELDS)
        # Drop None values to keep the request payload small.
        det_rows.append({k: v for k, v in decoded.items() if v is not None})
    if det_rows:
        BATCH = 100
        for i in range(0, len(det_rows), BATCH):
            sb.table("ingredient_details").upsert(det_rows[i:i+BATCH], on_conflict="id").execute()
        rep.pushed_details = len(det_rows)

    # health_facts (only ingredient-category from SQLite for this scope; recipe-category is owned by recipes ops)
    fact_rows: list[dict] = []
    cur = cat.conn.execute(
        "SELECT * FROM health_facts WHERE category='ingredient' ORDER BY target_id, sort_order"
    )
    for r in cur:
        fact_rows.append(dict(r))
    # Delete-then-insert per ingredient to support row-count changes.
    targets = sorted({r["target_id"] for r in fact_rows})
    if targets:
        # Batch delete in chunks of 200 ids.
        BATCH = 200
        for i in range(0, len(targets), BATCH):
            sb.table("health_facts").delete().eq("category", "ingredient").in_("target_id", targets[i:i+BATCH]).execute()
    if fact_rows:
        BATCH = 500
        for i in range(0, len(fact_rows), BATCH):
            sb.table("health_facts").insert(fact_rows[i:i+BATCH]).execute()
        rep.pushed_facts = len(fact_rows)

    cat.close()
    log.ok(rep.line())
    return rep


def pull(config: Config) -> SyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = SyncReport()

    ing_rows = sb.table("ingredients").select("*").order("id").execute().data or []
    det_rows = sb.table("ingredient_details").select("*").order("id").execute().data or []
    fact_rows = (
        sb.table("health_facts")
          .select("*")
          .eq("category", "ingredient")
          .order("target_id")
          .order("sort_order")
          .execute()
          .data
        or []
    )

    with cat.conn:
        cat.conn.execute("DELETE FROM ingredient_details")
        cat.conn.execute("DELETE FROM health_facts WHERE category='ingredient'")
        cat.conn.execute("DELETE FROM ingredients")
        for r in ing_rows:
            cat.upsert_ingredient(r)
        for r in det_rows:
            cat.upsert_details(r)
        for r in fact_rows:
            cat.conn.execute(
                "INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES (?, ?, ?, ?)",
                ("ingredient", r["target_id"], r["sort_order"], r["fact"]),
            )
    rep.pulled_ingredients = len(ing_rows)
    rep.pulled_details = len(det_rows)
    rep.pulled_facts = len(fact_rows)
    cat.close()
    log.ok(rep.line())
    return rep


def sync(config: Config, *, direction: str) -> SyncReport:
    if direction == "push":
        return push(config)
    if direction == "pull":
        return pull(config)
    if direction == "both":
        rep = push(config)
        rep2 = pull(config)
        rep.pulled_ingredients = rep2.pulled_ingredients
        rep.pulled_details = rep2.pulled_details
        rep.pulled_facts = rep2.pulled_facts
        return rep
    raise ValueError(f"invalid direction: {direction!r}")
