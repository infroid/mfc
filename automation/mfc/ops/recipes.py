"""Recipe metadata sync — bidirectional between local recipe.json bundles
and Supabase recipes + child tables.

Three public functions:
  - push_bundles : local → DB (was import_all). Bulk-batched: ~13 round-trips
                   regardless of recipe count.
  - pull_bundles : DB → local (new). Per-recipe; rebuilds recipe.json from rows.
  - sync         : per-recipe, last-modified wins (DB.updated_at vs file mtime).

import_all is preserved as a deprecated alias to keep mfc.commands.reset
from breaking until Task 8 deletes the old command.

Image-URL handling: bundle JSON may carry either legacy 'assets/...' paths
or full Storage URLs. push routes media.hero.src and step.media.src through
images_ops.normalize_image_value so a stale bundle doesn't reverse-migrate
a row that already has Storage URLs. Legacy bundles with media.image are
promoted to media.hero.src and the legacy key is dropped.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from ..clients import sb as sb_client
from ..core import files, log
from ..core.config import Config
from ..core.utils import parse_iso_to_ts
from . import images as images_ops


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
class SyncReport:
    pushed: int = 0
    pulled: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return f"↑ {self.pushed} pushed · ↓ {self.pulled} pulled · - {self.skipped} skipped · ! {len(self.failed)} failed"


# ─────────────────────────────────────────────────────────────────────────
# PUSH (local → DB)  — bulk-batched (≈13 round-trips regardless of N)
# ─────────────────────────────────────────────────────────────────────────


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


def _build_recipe_row(config: Config, detail: dict) -> dict:
    rid = detail["id"]
    media = dict(detail.get("media") or {})

    # Hero URL is canonical at media.hero.src. Older bundles may carry a
    # legacy media.image; promote it to media.hero.src on push, then drop it.
    legacy_image = media.pop("image", None)
    hero = media.get("hero")
    hero_dict = dict(hero) if isinstance(hero, dict) else {}
    if "src" not in hero_dict and legacy_image:
        hero_dict["src"] = legacy_image
    if "src" in hero_dict:
        hero_dict["src"] = images_ops.normalize_image_value(
            config, recipe_id=rid, value=hero_dict.get("src")
        )
    if hero_dict:
        media["hero"] = hero_dict

    row = {
        "id": rid,
        "name": detail["name"],
        "tagline": detail.get("tagline"),
        "short_tagline": detail.get("shortTagline"),
        "cuisine": detail["cuisine"],
        "difficulty": detail["difficulty"],
        "servings": detail["servings"],
        "total_minutes": detail["totalMinutes"],
        "media": media,
        "color": detail.get("color"),
        "color_soft": detail.get("colorSoft"),
        "meal_types": [],
    }
    if detail.get("createdBy"):
        row["created_by"] = detail["createdBy"]
    return row


def _build_child_rows(config: Config, bundles: list[dict]) -> dict[str, list[dict]]:
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
            sm = step.get("media") or {}
            steps.append({
                "recipe_id": rid,
                "sort_order": step["id"] if isinstance(step.get("id"), int) else (i + 1),
                "title": step["title"],
                "detail": step["detail"],
                "duration_seconds": step.get("duration"),
                "tip": step.get("tip"),
                "media_caption": sm.get("caption"),
                "media_src": images_ops.normalize_image_value(
                    config, recipe_id=rid, value=sm.get("src")
                ),
            })

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
            health_facts.append({
                "category": "recipe",
                "target_id": rid,
                "sort_order": i,
                "fact": fact,
            })

    return {
        "recipe_tags":         tags,
        "recipe_ingredients":  ingredients,
        "recipe_steps":        steps,
        "recipe_utensils":     utensils,
        "health_facts":        health_facts,
    }


def _bulk_replace_children(sb, table: str, rows: list[dict], recipe_ids: list[str]) -> None:
    """Replace all child rows for the given recipes in two round-trips."""
    sb.table(table).delete().in_("recipe_id", recipe_ids).execute()
    if rows:
        sb.table(table).insert(rows).execute()
    log.ok(f"{table}: {len(rows)} row(s)")


def push_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Upsert local recipe.json bundles into DB. `only` scopes to a subset."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    bundle_paths = list(files.iter_recipe_bundles(config.repo_root))
    bundles = [files.load_recipe_json(p) for p in bundle_paths]
    if only:
        wanted = set(only)
        bundles = [b for b in bundles if b.get("id") in wanted]

    valid: list[dict] = []
    for d in bundles:
        if not d.get("id") or not d.get("name") or not d.get("cuisine"):
            log.warn(f"skipping bundle missing id/name/cuisine: {d.get('id') or '<no-id>'}")
            continue
        valid.append(d)

    if not valid:
        log.warn("no recipe bundles to push")
        return report

    log.step(f"sync-recipes · push · {len(valid)} bundle(s)")

    log.step("library upsert")
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

    log.step(f"recipes upsert ({len(valid)} rows)")
    # Pre-fetch existing created_by so bundles without `createdBy` fall back to
    # the row's existing creator. Required because recipes.created_by is NOT
    # NULL — Postgres validates the INSERT side of the upsert even when the
    # row exists and only the UPDATE side is taken. Brand-new recipes must
    # have `createdBy` in the bundle (or be inserted via the chef portal,
    # which sets it directly).
    existing = (
        sb.table("recipes")
        .select("id, created_by")
        .in_("id", [d["id"] for d in valid])
        .execute()
        .data
        or []
    )
    existing_creators = {r["id"]: r["created_by"] for r in existing}
    recipe_rows: list[dict] = []
    for d in valid:
        row = _build_recipe_row(config, d)
        if "created_by" not in row and d["id"] in existing_creators:
            row["created_by"] = existing_creators[d["id"]]
        recipe_rows.append(row)

    sb.table("recipes").upsert(recipe_rows, on_conflict="id").execute()
    log.ok(f"recipes: {len(valid)}")

    log.step("child tables (delete-then-insert per table)")
    children = _build_child_rows(config, valid)
    recipe_ids = [d["id"] for d in valid]
    for table in ("recipe_tags", "recipe_ingredients", "recipe_steps", "recipe_utensils"):
        _bulk_replace_children(sb, table, children[table], recipe_ids)

    # health_facts is polymorphic — delete by composite key, then insert.
    sb.table("health_facts").delete().eq("category", "recipe").in_("target_id", recipe_ids).execute()
    if children["health_facts"]:
        sb.table("health_facts").insert(children["health_facts"]).execute()
    log.ok(f"health_facts(recipe): {len(children['health_facts'])} row(s)")

    # Reconcile recipe_owners. Trigger handles the INSERT path (new rows);
    # this upsert handles UPDATE-path bundles where the trigger doesn't fire.
    owners_rows = [
        {"recipe_id": d["id"], "user_id": d["createdBy"]}
        for d in valid if d.get("createdBy")
    ]
    if owners_rows:
        sb.table("recipe_owners").upsert(
            owners_rows, on_conflict="recipe_id,user_id"
        ).execute()
        log.ok(f"recipe_owners: {len(owners_rows)} row(s) reconciled")

    report.pushed = len(valid)
    log.ok(report.line())
    return report


# ─────────────────────────────────────────────────────────────────────────
# PULL (DB → local)  — per-recipe (writes recipe.json files)
# ─────────────────────────────────────────────────────────────────────────


def _bundle_path(config: Config, recipe_id: str) -> Path:
    return config.repo_root / "web" / "assets" / "recipes" / recipe_id / "recipe.json"


def _build_bundle(sb, recipe_row: dict) -> dict:
    rid = recipe_row["id"]

    ing_rows = (
        sb.table("recipe_ingredients")
        .select("recipe_id, sort_order, ingredient_id, group_name, amount, ingredients(name)")
        .eq("recipe_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    step_rows = (
        sb.table("recipe_steps")
        .select("recipe_id, sort_order, title, detail, duration_seconds, tip, media_caption, media_src")
        .eq("recipe_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    util_rows = (
        sb.table("recipe_utensils")
        .select("recipe_id, sort_order, utensil_id, essential, utensils(name)")
        .eq("recipe_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    tag_rows = (
        sb.table("recipe_tags")
        .select("tag")
        .eq("recipe_id", rid)
        .execute()
        .data
        or []
    )
    fact_rows = (
        sb.table("health_facts")
        .select("sort_order, fact")
        .eq("category", "recipe")
        .eq("target_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )

    bundle = {
        "id": rid,
        "name": recipe_row["name"],
        "tagline": recipe_row.get("tagline"),
        "shortTagline": recipe_row.get("short_tagline"),
        "cuisine": recipe_row["cuisine"],
        "difficulty": recipe_row["difficulty"],
        "servings": recipe_row["servings"],
        "totalMinutes": recipe_row["total_minutes"],
        "media": recipe_row.get("media") or {},
        "color": recipe_row.get("color"),
        "colorSoft": recipe_row.get("color_soft"),
        "createdBy": recipe_row.get("created_by"),
        "ingredients": [
            {
                "name": (i.get("ingredients") or {}).get("name") or i["ingredient_id"],
                "amt": i.get("amount"),
                "group": i.get("group_name"),
            }
            for i in ing_rows
        ],
        "steps": [
            {
                "id": s["sort_order"],
                "title": s["title"],
                "detail": s["detail"],
                "duration": s.get("duration_seconds"),
                "tip": s.get("tip"),
                "media": {
                    "src": s.get("media_src"),
                    "caption": s.get("media_caption"),
                },
            }
            for s in step_rows
        ],
        "utensils": [
            {
                "name": (u.get("utensils") or {}).get("name") or u["utensil_id"],
                "essential": bool(u.get("essential")),
            }
            for u in util_rows
        ],
        "tags": [t["tag"] for t in tag_rows],
        "healthFacts": [f["fact"] for f in fact_rows],
    }
    # Strip Nones that round-trip ugly
    for k in ("tagline", "shortTagline", "color", "colorSoft", "createdBy"):
        if bundle.get(k) is None:
            del bundle[k]
    return bundle


def pull_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Reconstruct recipe.json bundles from DB rows."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    rows = sb.table("recipes").select("*").order("id").execute().data or []
    if only:
        wanted = set(only)
        rows = [r for r in rows if r["id"] in wanted]

    if not rows:
        log.warn("no recipes in DB to pull")
        return report

    log.step(f"sync-recipes · pull · {len(rows)} recipe(s)")

    for row in rows:
        rid = row["id"]
        try:
            bundle = _build_bundle(sb, row)
            path = _bundle_path(config, rid)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
            report.pulled += 1
            log.ok(rid)
        except Exception as e:  # noqa: BLE001
            report.failed.append(f"{rid}: {e}")
            log.error(f"{rid}: {e}")

    log.ok(report.line())
    return report


# ─────────────────────────────────────────────────────────────────────────
# Orchestrator (per-recipe last-modified wins)
# ─────────────────────────────────────────────────────────────────────────


def sync(config: Config, *, direction: str, only: Optional[list[str]] = None) -> SyncReport:
    if direction == "push":
        return push_bundles(config, only=only)
    if direction == "pull":
        return pull_bundles(config, only=only)
    if direction != "both":
        raise ValueError(f"invalid direction: {direction!r}")

    sb = sb_client.service_client(config)
    db_rows = sb.table("recipes").select("id, updated_at").execute().data or []
    db_by_id = {r["id"]: r for r in db_rows}
    if only:
        wanted = set(only)
        db_by_id = {k: v for k, v in db_by_id.items() if k in wanted}

    bundle_paths = list(files.iter_recipe_bundles(config.repo_root))
    local_by_id: dict[str, Path] = {}
    for p in bundle_paths:
        try:
            d = files.load_recipe_json(p)
            rid = d.get("id")
            if rid and (not only or rid in only):
                local_by_id[rid] = p
        except Exception:
            continue

    push_ids: list[str] = []
    pull_ids: list[str] = []

    all_ids = sorted(set(db_by_id) | set(local_by_id))
    for rid in all_ids:
        db_row = db_by_id.get(rid)
        local_path = local_by_id.get(rid)
        if db_row and not local_path:
            pull_ids.append(rid)
            continue
        if local_path and not db_row:
            push_ids.append(rid)
            continue
        local_mtime = local_path.stat().st_mtime
        db_ts = parse_iso_to_ts(db_row.get("updated_at") or "")
        delta = local_mtime - db_ts
        if abs(delta) <= 1.0:
            continue
        if delta > 0:
            push_ids.append(rid)
        else:
            pull_ids.append(rid)

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


