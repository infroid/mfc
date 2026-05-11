"""`mfc sync-utensils` — SQLite ↔ Supabase utensil catalog sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import sync_catalog


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-utensils",
        help="Sync utensils + utensil_buy_links SQLite↔Supabase",
    )
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    report = sync_catalog.sync_utensils(config, direction=args.direction)
    return 1 if report.failed else 0
