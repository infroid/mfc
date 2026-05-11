"""`mfc import-recipes` — one-shot: read all
web/assets/recipes/<id>/recipe.json, decompose, write to
automation/db.sqlite.

Library auto-stub: if a recipe references an ingredient/utensil id
that doesn't exist in the catalog, insert a placeholder row (id, name)
so the FK constraint is satisfied. Subsequent sync-ingredients /
sync-utensils pulls will fill in the rest from Supabase if those
slugs exist there, or human edits can flesh them out.
"""

from __future__ import annotations

import argparse
import json
import re

from ..core import log
from ..core.config import Config
from ..ops.bundle_decompose_recipe import decompose
from ..ops.catalog import Catalog


_SLUG_RX = re.compile(r"[^a-z0-9]+")


def _humanize(slug: str) -> str:
    """Cheap reverse-slug for placeholder display names: 'raw-green-mango' → 'Raw green mango'."""
    return slug.replace("-", " ").strip().capitalize() or slug


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-recipes",
        help="One-shot: import every web/assets/recipes/*/recipe.json into automation/db.sqlite",
    )
    p.add_argument("--force", action="store_true",
                   help="overwrite existing recipe rows; default is INSERT-or-skip")
    p.set_defaults(handler=run)


def _ensure_ingredient_stubs(c: Catalog, ids: list[str]) -> int:
    """Insert placeholder ingredient rows for any id not yet in SQLite."""
    if not ids:
        return 0
    cur = c.conn.execute(
        f"SELECT id FROM ingredients WHERE id IN ({','.join('?' * len(ids))})",
        ids,
    )
    existing = {r[0] for r in cur.fetchall()}
    missing = [i for i in ids if i not in existing]
    for iid in missing:
        c.upsert_ingredient({"id": iid, "name": _humanize(iid)})
    return len(missing)


def _ensure_utensil_stubs(c: Catalog, ids: list[str]) -> int:
    if not ids:
        return 0
    cur = c.conn.execute(
        f"SELECT id FROM utensils WHERE id IN ({','.join('?' * len(ids))})",
        ids,
    )
    existing = {r[0] for r in cur.fetchall()}
    missing = [i for i in ids if i not in existing]
    for uid in missing:
        c.upsert_utensil({"id": uid, "name": _humanize(uid)})
    return len(missing)


def run(args: argparse.Namespace, config: Config) -> int:
    bundle_root = config.repo_root / "web" / "assets" / "recipes"
    if not bundle_root.exists():
        log.warn(f"no bundle dir at {bundle_root}; nothing to import")
        return 0

    c = Catalog(config.repo_root / "automation" / "db.sqlite")
    inserted = 0
    skipped = 0
    stub_ingredients = 0
    stub_utensils = 0
    failed: list[tuple[str, str]] = []

    for child in sorted(bundle_root.iterdir()):
        if not child.is_dir():
            continue
        bp = child / "recipe.json"
        if not bp.exists():
            continue
        try:
            bundle = json.loads(bp.read_text())
        except Exception as e:  # noqa: BLE001
            failed.append((child.name, f"json parse: {e}"))
            continue
        try:
            out = decompose(bundle)
        except Exception as e:  # noqa: BLE001
            failed.append((child.name, f"decompose: {e}"))
            continue

        rid = out["recipe"].get("id") or child.name
        if not args.force:
            cur = c.conn.execute("SELECT 1 FROM recipes WHERE id=?", (rid,))
            if cur.fetchone():
                skipped += 1
                continue

        try:
            # 1. Stub any missing library rows so FKs are satisfied
            stub_ingredients += _ensure_ingredient_stubs(
                c, [r["ingredient_id"] for r in out["ingredients"]]
            )
            stub_utensils += _ensure_utensil_stubs(
                c, [u["utensil_id"] for u in out["utensils"]]
            )
            # 2. Recipe row
            c.upsert_recipe(out["recipe"])
            # 3. Child tables — atomic replace-all
            c.set_recipe_ingredients(rid, out["ingredients"])
            c.set_recipe_steps(rid, out["steps"])
            c.set_recipe_utensils(rid, out["utensils"])
            c.set_recipe_tags(rid, out["tags"])
            # 4. Health facts via the shared polymorphic table
            c.set_health_facts("recipe", rid, out["health_facts"])
            inserted += 1
        except Exception as e:  # noqa: BLE001
            failed.append((child.name, f"insert: {e}"))

    c.close()
    log.ok(
        f"import-recipes: inserted {inserted}, skipped {skipped}, "
        f"failed {len(failed)}, stub_ingredients +{stub_ingredients}, stub_utensils +{stub_utensils}"
    )
    for slug, reason in failed:
        log.info(f"  - {slug}   ({reason})")
    return 0
