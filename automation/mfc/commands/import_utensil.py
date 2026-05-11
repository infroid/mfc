"""`mfc import-utensil <path>` — read one utensil JSON, upsert into automation/db.sqlite."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..core import log
from ..core.config import Config
from ..ops.bundle_decompose_utensil import decompose
from ..ops.catalog import Catalog


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-utensil",
        help="Read one utensil JSON (see docs/templates/utensil.example.json) into automation/db.sqlite",
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

    utensil, buy_links = decompose(bundle)
    c = Catalog(config.repo_root / "automation" / "db.sqlite")
    c.upsert_utensil(utensil)
    if buy_links:
        c.set_utensil_buy_links(utensil["id"], buy_links)
    c.close()
    log.ok(f"imported {utensil['id']}")
    return 0
