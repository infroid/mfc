"""Pure function: recipe bundle JSON → dict of SQLite rows across 6 tables.

Output:
    {
        "recipe":       <recipes row>,
        "ingredients":  list[<recipe_ingredients row>],
        "steps":        list[<recipe_steps row>],
        "utensils":     list[<recipe_utensils row>],
        "tags":         list[str],
        "health_facts": list[str],
    }
"""

from __future__ import annotations

import re
from typing import Any


_SLUG_RX = re.compile(r"[^a-z0-9]+")


def _slugify(s: str) -> str:
    return _SLUG_RX.sub("-", (s or "").lower()).strip("-")


def decompose(bundle: dict[str, Any]) -> dict[str, Any]:
    rid = bundle["id"]

    recipe: dict[str, Any] = {
        "id": rid,
        "name": bundle["name"],
        "tagline": bundle.get("tagline"),
        "short_tagline": bundle.get("shortTagline"),
        "cuisine": bundle["cuisine"],
        "difficulty": bundle["difficulty"],
        "servings": bundle["servings"],
        "total_minutes": bundle["totalMinutes"],
        "media": bundle.get("media") or {},
        "color": bundle.get("color"),
        "color_soft": bundle.get("colorSoft"),
        "meal_types": bundle.get("mealTypes") or [],
        "created_by": bundle.get("createdBy"),
    }

    ingredients: list[dict] = []
    for i, ing in enumerate(bundle.get("ingredients") or []):
        name = (ing or {}).get("name")
        if not name:
            continue
        ingredients.append({
            "sort_order":    i,
            "ingredient_id": _slugify(name),
            "group_name":    ing.get("group"),
            "amount":        ing.get("amt"),
            "unit":          ing.get("unit"),
        })

    steps: list[dict] = []
    for i, step in enumerate(bundle.get("steps") or []):
        if not isinstance(step, dict):
            continue
        sm = step.get("media") or {}
        sort = step.get("id") if isinstance(step.get("id"), int) else (i + 1)
        steps.append({
            "sort_order":       sort,
            "title":            step.get("title", ""),
            "detail":           step.get("detail", ""),
            "duration_seconds": step.get("duration"),
            "tip":              step.get("tip"),
            "media_caption":    sm.get("caption"),
            "media_src":        sm.get("src"),
        })

    utensils: list[dict] = []
    seen_util: set[str] = set()
    util_idx = 0
    for util in bundle.get("utensils") or []:
        name = (util or {}).get("name")
        if not name:
            continue
        slug = _slugify(name)
        if slug in seen_util:
            continue
        seen_util.add(slug)
        utensils.append({
            "sort_order": util_idx,
            "utensil_id": slug,
            "essential":  bool(util.get("essential", True)),
        })
        util_idx += 1

    tags = [t for t in (bundle.get("tags") or []) if t]
    health_facts = [f for f in (bundle.get("healthFacts") or []) if isinstance(f, str) and f.strip()]

    return {
        "recipe":       recipe,
        "ingredients":  ingredients,
        "steps":        steps,
        "utensils":     utensils,
        "tags":         tags,
        "health_facts": health_facts,
    }
