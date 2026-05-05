"""Recipe catalog import — bulk-batched upsert.

Strategy:
  1. Walk recipe.json bundles, collect unique ingredients + utensils.
  2. Upsert library tables (one round-trip per table).
  3. Upsert recipes table (one round-trip).
  4. For each child join table (recipe_tags, recipe_ingredients,
     recipe_steps, recipe_utensils, recipe_health_facts):
        - DELETE WHERE recipe_id IN (all bundle ids)   — one round-trip
        - INSERT all collected rows                    — one round-trip

Total round-trips: ~13, regardless of recipe count. Per-recipe
isolation is gone (a malformed row aborts that table's batch); for
this dataset that's a worthwhile trade. The previous per-recipe
approach was ~11 round-trips per bundle which scaled badly.

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
    ingredients: dict[str, dict]
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


def _build_child_rows(bundles: list[dict]) -> dict[str, list[dict]]:
    """Flatten all child rows (across every bundle) into one list per table."""
    tags: list[dict] = []
    ingredients: list[dict] = []
    steps: list[dict] = []
    utensils: list[dict] = []
    health_facts: list[dict] = []

    for detail in bundles:
        rid = detail["id"]

        for t in detail.get("tags") or []:
            tags.append({"recipe_id": rid, "tag": t})

        for i, ing in enumerate(detail.get("ingredients") or []):
            if not ing.get("name"):
                continue
            ingredients.append({
                "recipe_id": rid,
                "sort_order": i,
                "ingredient_id": _slugify(ing["name"]),
                "group_name": ing.get("group"),
                "amount": ing.get("amt"),
                "unit": None,
            })

        for i, step in enumerate(detail.get("steps") or []):
            steps.append({
                "recipe_id": rid,
                "sort_order": step["id"] if isinstance(step.get("id"), int) else (i + 1),
                "title": step["title"],
                "detail": step["detail"],
                "duration_seconds": step.get("duration"),
                "tip": step.get("tip"),
                "media_caption": (step.get("media") or {}).get("caption"),
            })

        # Utensils — dedupe slugs per recipe; recipes occasionally list the
        # same tool twice (e.g. "knife" used in multiple steps).
        seen_u: set[str] = set()
        ord_u = 0
        for u in detail.get("utensils") or []:
            if not u.get("name"):
                continue
            slug = _slugify(u["name"])
            if slug in seen_u:
                continue
            seen_u.add(slug)
            utensils.append({
                "recipe_id": rid,
                "sort_order": ord_u,
                "utensil_id": slug,
                "essential": bool(u.get("essential")),
            })
            ord_u += 1

        for i, fact in enumerate(detail.get("healthFacts") or []):
            health_facts.append({"recipe_id": rid, "sort_order": i, "fact": fact})

    return {
        "recipe_tags":         tags,
        "recipe_ingredients":  ingredients,
        "recipe_steps":        steps,
        "recipe_utensils":     utensils,
        "recipe_health_facts": health_facts,
    }


def _bulk_replace_children(sb, table: str, rows: list[dict], recipe_ids: list[str]) -> None:
    """Replace all child rows for the given recipes in two round-trips."""
    sb.table(table).delete().in_("recipe_id", recipe_ids).execute()
    if rows:
        sb.table(table).insert(rows).execute()
    log.ok(f"{table}: {len(rows)} row(s)")


def import_all(config: Config) -> None:
    sb = sb_client.service_client(config)

    bundles = [files.load_recipe_json(p) for p in files.iter_recipe_bundles(config.repo_root)]
    if not bundles:
        log.warn("no recipe bundles found under web/assets/recipes/")
        return

    # Drop any bundle missing required fields rather than aborting the whole run.
    valid: list[dict] = []
    for d in bundles:
        if not d.get("id") or not d.get("name") or not d.get("cuisine"):
            log.warn(f"skipping bundle missing id/name/cuisine: {d.get('id') or '<no-id>'}")
            continue
        valid.append(d)

    log.step(f"pass 1/4 · collected {len(valid)} bundle(s) (skipped {len(bundles) - len(valid)})")

    log.step("pass 2/4 · library upsert")
    lib = _collect_library(valid)
    if lib.ingredients:
        sb.table("ingredients").upsert(
            list(lib.ingredients.values()), on_conflict="id"
        ).execute()
        log.ok(f"ingredients: {len(lib.ingredients)}")
    if lib.utensils:
        sb.table("utensils").upsert(
            list(lib.utensils.values()), on_conflict="id"
        ).execute()
        log.ok(f"utensils: {len(lib.utensils)}")

    log.step(f"pass 3/4 · recipes upsert ({len(valid)} rows)")
    sb.table("recipes").upsert(
        [_build_recipe_row(d) for d in valid], on_conflict="id"
    ).execute()
    log.ok(f"recipes: {len(valid)}")

    log.step("pass 4/4 · child tables (delete-then-insert per table)")
    children = _build_child_rows(valid)
    recipe_ids = [d["id"] for d in valid]
    for table in ("recipe_tags", "recipe_ingredients", "recipe_steps",
                  "recipe_utensils", "recipe_health_facts"):
        _bulk_replace_children(sb, table, children[table], recipe_ids)
