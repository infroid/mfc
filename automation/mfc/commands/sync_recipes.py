"""`mfc sync-recipes` — SQLite ↔ Supabase recipe catalog sync.

Replaces the bundle-JSON-aware implementation. Recipe image bytes
still sync via `mfc sync-images` (Storage bucket ↔ local files).
"""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import sync_catalog


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-recipes",
        help="Sync recipes + 4 child tables + health_facts(category=recipe) SQLite↔Supabase",
    )
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    report = sync_catalog.sync_recipes(config, direction=args.direction)
    return 1 if report.failed else 0
