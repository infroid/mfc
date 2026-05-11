"""`mfc import-recipe <path>` — read one recipe JSON, upsert into automation/db.sqlite.

Auto-stubs any missing ingredient / utensil library rows referenced
by the recipe (matches `import-recipes` behavior).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..core import log
from ..core.config import Config
from ..ops.bundle_decompose_recipe import decompose
from ..ops.catalog import Catalog


def _humanize(slug: str) -> str:
    return slug.replace("-", " ").strip().capitalize() or slug


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-recipe",
        help="Read one recipe JSON (see docs/templates/recipe.example.json) into automation/db.sqlite",
    )
    p.add_argument("path", help="path to the JSON file")
    p.set_defaults(handler=run)


def _ensure_stubs(c: Catalog, table: str, ids: list[str]) -> int:
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    cur = c.conn.execute(f"SELECT id FROM {table} WHERE id IN ({placeholders})", ids)
    existing = {r[0] for r in cur.fetchall()}
    missing = [i for i in ids if i not in existing]
    for sid in missing:
        if table == "ingredients":
            c.upsert_ingredient({"id": sid, "name": _humanize(sid)})
        else:
            c.upsert_utensil({"id": sid, "name": _humanize(sid)})
    return len(missing)


def run(args: argparse.Namespace, config: Config) -> int:
    path = Path(args.path)
    if not path.exists():
        log.error(f"file not found: {path}")
        return 2
    bundle = json.loads(path.read_text())
    if "id" not in bundle or "name" not in bundle:
        log.error("JSON must have at least 'id' and 'name'")
        return 2

    out = decompose(bundle)
    rid = out["recipe"]["id"]

    c = Catalog(config.repo_root / "automation" / "db.sqlite")
    stub_i = _ensure_stubs(c, "ingredients", [r["ingredient_id"] for r in out["ingredients"]])
    stub_u = _ensure_stubs(c, "utensils",    [u["utensil_id"]    for u in out["utensils"]])
    c.upsert_recipe(out["recipe"])
    c.set_recipe_ingredients(rid, out["ingredients"])
    c.set_recipe_steps(rid, out["steps"])
    c.set_recipe_utensils(rid, out["utensils"])
    c.set_recipe_tags(rid, out["tags"])
    c.set_health_facts("recipe", rid, out["health_facts"])
    c.close()

    msg = f"imported {rid}"
    if stub_i or stub_u:
        msg += f" (stub_ingredients +{stub_i}, stub_utensils +{stub_u})"
    log.ok(msg)
    return 0
