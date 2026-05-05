"""Recipe catalog import — port of scripts/import_recipes.mjs.

Three passes:
  1. Walk recipe.json bundles, collect unique ingredients + utensils
  2. Upsert library tables (ingredients, utensils)
  3. Upsert each recipe row, then replace its child rows
     (recipe_tags, recipe_ingredients, recipe_steps, recipe_utensils,
     recipe_health_facts)

Idempotent — a re-run reconciles to the same end state.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from ..clients import sb as sb_client
from ..core import files, log
from ..core.config import Config


_SLUG_RX = re.compile(r"[^a-z0-9]+")


def _slugify(s: str) -> str:
    return _SLUG_RX.sub("-", s.lower()).strip("-")


def _guess_unit(amount: str | None) -> str:
    if not amount:
        return "g"
    a = amount.lower()
    if re.search(r"\btbsp\b", a):    return "tbsp"
    if re.search(r"\btsp\b", a):     return "tsp"
    if re.search(r"\bcups?\b", a):   return "cup"
    if re.search(r"\bml\b", a):      return "ml"
    if re.search(r"\bmedium\b", a):  return "medium"
    if re.search(r"\blarge\b", a):   return "large"
    if re.search(r"\bwhole\b", a):   return "whole"
    if re.search(r"\bpinch\b", a):   return "pinch"
    return "g"


@dataclass
class _LibraryRows:
    ingredients: dict[str, dict]   # slug -> row
    utensils: dict[str, dict]


def _collect_library(bundles: Iterable[dict]) -> _LibraryRows:
    ingredients: dict[str, dict] = {}
    utensils: dict[str, dict] = {}
    for detail in bundles:
        for ing in detail.get("ingredients") or []:
            name = ing.get("name")
            if not name:
                continue
            slug = _slugify(name)
            ingredients.setdefault(slug, {
                "id": slug,
                "name": name,
                "default_unit": _guess_unit(ing.get("amt")),
            })
        for u in detail.get("utensils") or []:
            name = u.get("name")
            if not name:
                continue
            slug = _slugify(name)
            utensils.setdefault(slug, {"id": slug, "name": name})
    return _LibraryRows(ingredients=ingredients, utensils=utensils)


def _build_recipe_row(detail: dict) -> dict:
    rid = detail["id"]
    media = detail.get("media") or {}
    return {
        "id": rid,
        "name": detail["name"],
        "tagline": detail.get("tagline"),
        "short_tagline": detail.get("shortTagline"),
        "cuisine": detail["cuisine"],
        "difficulty": detail["difficulty"],
        "servings": detail["servings"],
        "total_minutes": detail["totalMinutes"],
        "media": {
            "emoji": media.get("emoji"),
            "hero": media.get("hero"),
            "image": f"assets/recipes/{rid}/hero.jpg",
        },
        "color": detail.get("color"),
        "color_soft": detail.get("colorSoft"),
        "featured": bool(detail.get("featured")),
        "highlight": detail.get("highlight"),
        "meal_types": [],
    }


def _replace_children(sb, table: str, recipe_id: str, rows: list[dict]) -> None:
    """Delete-then-insert pattern: cleanest way to reconcile join tables."""
    sb.table(table).delete().eq("recipe_id", recipe_id).execute()
    if rows:
        sb.table(table).insert(rows).execute()


def _upsert_recipe(sb, detail: dict) -> None:
    rid = detail["id"]
    sb.table("recipes").upsert(_build_recipe_row(detail), on_conflict="id").execute()

    # Tags
    tags = detail.get("tags") or []
    _replace_children(sb, "recipe_tags", rid,
        [{"recipe_id": rid, "tag": t} for t in tags])

    # Ingredients (FK join via slugified ingredient_id)
    ings = detail.get("ingredients") or []
    _replace_children(sb, "recipe_ingredients", rid, [
        {
            "recipe_id": rid,
            "sort_order": i,
            "ingredient_id": _slugify(ing["name"]),
            "group_name": ing.get("group"),
            "amount": ing.get("amt"),
            "unit": None,
        }
        for i, ing in enumerate(ings) if ing.get("name")
    ])

    # Steps — preserve numeric step.id when present, else 1-based fallback
    steps = detail.get("steps") or []
    _replace_children(sb, "recipe_steps", rid, [
        {
            "recipe_id": rid,
            "sort_order": step["id"] if isinstance(step.get("id"), int) else (i + 1),
            "title": step["title"],
            "detail": step["detail"],
            "duration_seconds": step.get("duration"),
            "tip": step.get("tip"),
            "media_caption": (step.get("media") or {}).get("caption"),
        }
        for i, step in enumerate(steps)
    ])

    # Utensils (FK join, dedup by slug — same recipe sometimes lists the same tool twice)
    utensils = detail.get("utensils") or []
    seen_u: set[str] = set()
    util_rows: list[dict] = []
    for u in utensils:
        if not u.get("name"):
            continue
        slug = _slugify(u["name"])
        if slug in seen_u:
            continue
        seen_u.add(slug)
        util_rows.append({
            "recipe_id": rid,
            "sort_order": len(util_rows),
            "utensil_id": slug,
            "essential": bool(u.get("essential")),
        })
    _replace_children(sb, "recipe_utensils", rid, util_rows)

    # Health facts
    facts = detail.get("healthFacts") or []
    _replace_children(sb, "recipe_health_facts", rid,
        [{"recipe_id": rid, "sort_order": i, "fact": f} for i, f in enumerate(facts)])


def import_all(config: Config) -> None:
    """Run all three passes. Errors per-recipe surface as warnings; the
    overall command continues so one bad bundle doesn't block the others."""
    sb = sb_client.service_client(config)

    bundles = [files.load_recipe_json(p) for p in files.iter_recipe_bundles(config.repo_root)]
    if not bundles:
        log.warn("no recipe bundles found under web/assets/recipes/")
        return

    log.step(f"pass 1/3 · collecting library rows from {len(bundles)} bundle(s)")
    lib = _collect_library(bundles)
    log.info(f"unique ingredients: {len(lib.ingredients)} · utensils: {len(lib.utensils)}")

    log.step("pass 2/3 · upserting library tables")
    if lib.ingredients:
        sb.table("ingredients").upsert(
            list(lib.ingredients.values()), on_conflict="id"
        ).execute()
        log.ok(f"ingredients populated ({len(lib.ingredients)})")
    if lib.utensils:
        sb.table("utensils").upsert(
            list(lib.utensils.values()), on_conflict="id"
        ).execute()
        log.ok(f"utensils populated ({len(lib.utensils)})")

    log.step(f"pass 3/3 · upserting {len(bundles)} recipe(s)")
    failed: list[str] = []
    for detail in bundles:
        rid = detail.get("id", "<unknown>")
        try:
            _upsert_recipe(sb, detail)
            log.ok(rid)
        except Exception as e:  # noqa: BLE001 — per-recipe isolation is intentional
            log.error(f"{rid}: {e}")
            failed.append(rid)

    if failed:
        raise RuntimeError(f"{len(failed)} recipe(s) failed: {', '.join(failed)}")
