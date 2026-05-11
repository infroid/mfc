"""`mfc import-ingredient <path>` — read one JSON file, upsert across the three tables."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..core import log
from ..core.config import Config
from ..ops.catalog import Catalog


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-ingredient",
        help="Read one ingredient JSON (see docs/templates/ingredient.example.json) into automation/db.sqlite",
    )
    p.add_argument("path", help="path to the JSON file")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    path = Path(args.path)
    if not path.exists():
        log.error(f"file not found: {path}")
        return 2
    bundle = json.loads(path.read_text())
    if "id" not in bundle or "name" not in bundle:
        log.error("JSON must have at least 'id' and 'name'")
        return 2

    c = Catalog(config.repo_root / "automation" / "db.sqlite")
    iid = bundle["id"]

    ing_keys = (
        "id", "name", "aliases", "category", "tagline", "photo", "emoji",
        "default_unit", "source", "fdc_id", "show", "ai_filled_at", "created_by",
    )
    c.upsert_ingredient({k: bundle[k] for k in ing_keys if k in bundle})

    details = bundle.get("details") or {}
    if details:
        details["id"] = iid
        c.upsert_details(details)

    facts = bundle.get("health_facts") or []
    if facts:
        c.set_health_facts("ingredient", iid, facts)

    c.close()
    log.ok(f"imported {iid}")
    return 0
