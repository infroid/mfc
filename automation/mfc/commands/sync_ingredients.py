"""`mfc sync-ingredients` — SQLite ↔ Supabase catalog sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import sync_catalog


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-ingredients",
        help="Sync ingredients + ingredient_details + health_facts(category=ingredient) SQLite↔Supabase",
    )
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    report = sync_catalog.sync(config, direction=args.direction)
    return 1 if report.failed else 0
