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

_UTENSILS_JSON_FIELDS = ("specs", "show")
_UTENSIL_PG_COLS = (
    "id", "name", "tagline", "category", "photo", "care_tip",
    "specs", "show", "ai_filled_at",
    "amazon_asin", "amazon_marketplace", "amazon_fetched_at",
    "created_by", "created_at", "updated_at",
)

_RECIPES_JSON_FIELDS = ("media", "meal_types")
_RECIPE_PG_COLS = (
    "id", "name", "tagline", "short_tagline",
    "cuisine", "difficulty", "servings", "total_minutes",
    "media", "color", "color_soft", "meal_types",
    "created_by", "created_at", "updated_at",
)


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


@dataclass
class UtensilSyncReport:
    pushed_utensils: int = 0
    pulled_utensils: int = 0
    pushed_buy_links: int = 0
    pulled_buy_links: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"utensils ↑{self.pushed_utensils} ↓{self.pulled_utensils} · "
            f"buy_links ↑{self.pushed_buy_links} ↓{self.pulled_buy_links} · "
            f"failed {len(self.failed)}"
        )


def push_utensils(config: Config) -> UtensilSyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = UtensilSyncReport()

    # utensils
    ut_rows: list[dict] = []
    for r in cat.iter_utensils():
        decoded = _decode_json_fields(r, _UTENSILS_JSON_FIELDS)
        ut_rows.append(_filter_cols(decoded, _UTENSIL_PG_COLS))
    if ut_rows:
        BATCH = 200
        for i in range(0, len(ut_rows), BATCH):
            sb.table("utensils").upsert(ut_rows[i:i+BATCH], on_conflict="id").execute()
        rep.pushed_utensils = len(ut_rows)

    # utensil_buy_links — delete-then-insert per utensil
    cur = cat.conn.execute("SELECT * FROM utensil_buy_links ORDER BY utensil_id, sort_order")
    bl_rows = [dict(r) for r in cur]
    utensil_ids = sorted({r["utensil_id"] for r in bl_rows})
    if utensil_ids:
        BATCH = 200
        for i in range(0, len(utensil_ids), BATCH):
            sb.table("utensil_buy_links").delete().in_("utensil_id", utensil_ids[i:i+BATCH]).execute()
    if bl_rows:
        BATCH = 500
        for i in range(0, len(bl_rows), BATCH):
            sb.table("utensil_buy_links").insert(bl_rows[i:i+BATCH]).execute()
        rep.pushed_buy_links = len(bl_rows)

    cat.close()
    log.ok(rep.line())
    return rep


def pull_utensils(config: Config) -> UtensilSyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = UtensilSyncReport()

    ut_rows = sb.table("utensils").select("*").order("id").execute().data or []
    bl_rows = (
        sb.table("utensil_buy_links")
          .select("*")
          .order("utensil_id")
          .order("sort_order")
          .execute()
          .data
        or []
    )

    with cat.conn:
        cat.conn.execute("DELETE FROM utensil_buy_links")
        cat.conn.execute("DELETE FROM utensils")
        for r in ut_rows:
            cat.upsert_utensil(r)
        # group buy_links by utensil_id and replace-all
        by_utensil: dict[str, list[dict]] = {}
        for r in bl_rows:
            by_utensil.setdefault(r["utensil_id"], []).append({
                "sort_order":    r.get("sort_order"),
                "store":         r.get("store"),
                "url":           r.get("url"),
                "price":         r.get("price"),
                "affiliate_tag": r.get("affiliate_tag"),
            })
    for utensil_id, links in by_utensil.items():
        cat.set_utensil_buy_links(utensil_id, links)

    rep.pulled_utensils = len(ut_rows)
    rep.pulled_buy_links = len(bl_rows)
    cat.close()
    log.ok(rep.line())
    return rep


def sync_utensils(config: Config, *, direction: str) -> UtensilSyncReport:
    if direction == "push":
        return push_utensils(config)
    if direction == "pull":
        return pull_utensils(config)
    if direction == "both":
        rep = push_utensils(config)
        rep2 = pull_utensils(config)
        rep.pulled_utensils = rep2.pulled_utensils
        rep.pulled_buy_links = rep2.pulled_buy_links
        return rep
    raise ValueError(f"invalid direction: {direction!r}")


@dataclass
class RecipeSyncReport:
    pushed_recipes: int = 0
    pulled_recipes: int = 0
    pushed_children: int = 0
    pulled_children: int = 0
    pushed_facts: int = 0
    pulled_facts: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"recipes ↑{self.pushed_recipes} ↓{self.pulled_recipes} · "
            f"children ↑{self.pushed_children} ↓{self.pulled_children} · "
            f"facts ↑{self.pushed_facts} ↓{self.pulled_facts} · "
            f"failed {len(self.failed)}"
        )


def push_recipes(config: Config) -> RecipeSyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = RecipeSyncReport()

    # recipes
    r_rows: list[dict] = []
    cur = cat.conn.execute("SELECT * FROM recipes ORDER BY id")
    for r in cur:
        decoded = _decode_json_fields(r, _RECIPES_JSON_FIELDS)
        r_rows.append(_filter_cols(decoded, _RECIPE_PG_COLS))
    if r_rows:
        BATCH = 100
        for i in range(0, len(r_rows), BATCH):
            sb.table("recipes").upsert(r_rows[i:i+BATCH], on_conflict="id").execute()
        rep.pushed_recipes = len(r_rows)

    # Child tables — delete-then-insert per recipe (atomicity is per-batch).
    recipe_ids = [r["id"] for r in r_rows]
    child_total = 0

    if recipe_ids:
        # recipe_ingredients
        sb.table("recipe_ingredients").delete().in_("recipe_id", recipe_ids).execute()
        ing_rows: list[dict] = []
        cur = cat.conn.execute("SELECT * FROM recipe_ingredients ORDER BY recipe_id, sort_order")
        for r in cur:
            ing_rows.append({k: r[k] for k in r.keys() if r[k] is not None})
        if ing_rows:
            BATCH = 500
            for i in range(0, len(ing_rows), BATCH):
                sb.table("recipe_ingredients").insert(ing_rows[i:i+BATCH]).execute()
            child_total += len(ing_rows)

        # recipe_steps
        sb.table("recipe_steps").delete().in_("recipe_id", recipe_ids).execute()
        step_rows: list[dict] = []
        cur = cat.conn.execute("SELECT * FROM recipe_steps ORDER BY recipe_id, sort_order")
        for r in cur:
            step_rows.append({k: r[k] for k in r.keys() if r[k] is not None})
        if step_rows:
            BATCH = 500
            for i in range(0, len(step_rows), BATCH):
                sb.table("recipe_steps").insert(step_rows[i:i+BATCH]).execute()
            child_total += len(step_rows)

        # recipe_utensils — note `essential` is INTEGER 0/1 in SQLite, BOOLEAN in Postgres
        sb.table("recipe_utensils").delete().in_("recipe_id", recipe_ids).execute()
        util_rows: list[dict] = []
        cur = cat.conn.execute("SELECT * FROM recipe_utensils ORDER BY recipe_id, sort_order")
        for r in cur:
            d = {k: r[k] for k in r.keys() if r[k] is not None}
            if "essential" in d:
                d["essential"] = bool(d["essential"])
            util_rows.append(d)
        if util_rows:
            BATCH = 500
            for i in range(0, len(util_rows), BATCH):
                sb.table("recipe_utensils").insert(util_rows[i:i+BATCH]).execute()
            child_total += len(util_rows)

        # recipe_tags
        sb.table("recipe_tags").delete().in_("recipe_id", recipe_ids).execute()
        tag_rows: list[dict] = []
        cur = cat.conn.execute("SELECT recipe_id, tag FROM recipe_tags ORDER BY recipe_id, tag")
        for r in cur:
            tag_rows.append(dict(r))
        if tag_rows:
            BATCH = 500
            for i in range(0, len(tag_rows), BATCH):
                sb.table("recipe_tags").insert(tag_rows[i:i+BATCH]).execute()
            child_total += len(tag_rows)

    rep.pushed_children = child_total

    # health_facts(category='recipe') — delete-then-insert
    fact_rows: list[dict] = []
    cur = cat.conn.execute(
        "SELECT * FROM health_facts WHERE category='recipe' ORDER BY target_id, sort_order"
    )
    for r in cur:
        fact_rows.append(dict(r))
    targets = sorted({r["target_id"] for r in fact_rows})
    if targets:
        BATCH = 200
        for i in range(0, len(targets), BATCH):
            sb.table("health_facts").delete().eq("category", "recipe").in_("target_id", targets[i:i+BATCH]).execute()
    if fact_rows:
        BATCH = 500
        for i in range(0, len(fact_rows), BATCH):
            sb.table("health_facts").insert(fact_rows[i:i+BATCH]).execute()
        rep.pushed_facts = len(fact_rows)

    cat.close()
    log.ok(rep.line())
    return rep


def pull_recipes(config: Config) -> RecipeSyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = RecipeSyncReport()

    r_rows = sb.table("recipes").select("*").order("id").execute().data or []
    ing_rows = sb.table("recipe_ingredients").select("*").order("recipe_id").order("sort_order").execute().data or []
    step_rows = sb.table("recipe_steps").select("*").order("recipe_id").order("sort_order").execute().data or []
    util_rows = sb.table("recipe_utensils").select("*").order("recipe_id").order("sort_order").execute().data or []
    tag_rows = sb.table("recipe_tags").select("recipe_id, tag").order("recipe_id").order("tag").execute().data or []
    fact_rows = (
        sb.table("health_facts").select("*")
          .eq("category", "recipe").order("target_id").order("sort_order")
          .execute().data
        or []
    )

    with cat.conn:
        cat.conn.execute("DELETE FROM recipe_ingredients")
        cat.conn.execute("DELETE FROM recipe_steps")
        cat.conn.execute("DELETE FROM recipe_utensils")
        cat.conn.execute("DELETE FROM recipe_tags")
        cat.conn.execute("DELETE FROM health_facts WHERE category='recipe'")
        cat.conn.execute("DELETE FROM recipes")
        for r in r_rows:
            cat.upsert_recipe(r)
        # group child rows by recipe and replace-all atomically
        by_recipe_ing: dict[str, list[dict]] = {}
        for r in ing_rows:
            by_recipe_ing.setdefault(r["recipe_id"], []).append({
                "sort_order": r.get("sort_order"),
                "ingredient_id": r.get("ingredient_id"),
                "group_name": r.get("group_name"),
                "amount": r.get("amount"),
                "unit": r.get("unit"),
            })
        by_recipe_step: dict[str, list[dict]] = {}
        for r in step_rows:
            by_recipe_step.setdefault(r["recipe_id"], []).append({
                "sort_order": r.get("sort_order"),
                "title": r.get("title"),
                "detail": r.get("detail"),
                "duration_seconds": r.get("duration_seconds"),
                "tip": r.get("tip"),
                "media_caption": r.get("media_caption"),
                "media_src": r.get("media_src"),
            })
        by_recipe_util: dict[str, list[dict]] = {}
        for r in util_rows:
            by_recipe_util.setdefault(r["recipe_id"], []).append({
                "sort_order": r.get("sort_order"),
                "utensil_id": r.get("utensil_id"),
                "essential":  bool(r.get("essential")),
            })
        by_recipe_tag: dict[str, list[str]] = {}
        for r in tag_rows:
            by_recipe_tag.setdefault(r["recipe_id"], []).append(r["tag"])
        by_recipe_facts: dict[str, list[str]] = {}
        for r in fact_rows:
            by_recipe_facts.setdefault(r["target_id"], []).append(r["fact"])

    for rid, rows in by_recipe_ing.items():
        cat.set_recipe_ingredients(rid, rows)
    for rid, rows in by_recipe_step.items():
        cat.set_recipe_steps(rid, rows)
    for rid, rows in by_recipe_util.items():
        cat.set_recipe_utensils(rid, rows)
    for rid, tags in by_recipe_tag.items():
        cat.set_recipe_tags(rid, tags)
    for rid, facts in by_recipe_facts.items():
        cat.set_health_facts("recipe", rid, facts)

    rep.pulled_recipes = len(r_rows)
    rep.pulled_children = len(ing_rows) + len(step_rows) + len(util_rows) + len(tag_rows)
    rep.pulled_facts = len(fact_rows)
    cat.close()
    log.ok(rep.line())
    return rep


def sync_recipes(config: Config, *, direction: str) -> RecipeSyncReport:
    if direction == "push":
        return push_recipes(config)
    if direction == "pull":
        return pull_recipes(config)
    if direction == "both":
        rep = push_recipes(config)
        rep2 = pull_recipes(config)
        rep.pulled_recipes = rep2.pulled_recipes
        rep.pulled_children = rep2.pulled_children
        rep.pulled_facts = rep2.pulled_facts
        return rep
    raise ValueError(f"invalid direction: {direction!r}")
