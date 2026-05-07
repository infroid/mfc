"""`mfc sync-utensils` — reconcile utensil metadata between DB and local
utensil.json bundles. Mirrors ops/recipes.py's three-mode sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import utensils as utensils_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-utensils",
        help="Sync utensil library DB↔local bundles (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = DB→local; push = local→DB; both = last-modified wins per utensil",
    )
    p.add_argument(
        "--utensil",
        action="append",
        default=None,
        help="Limit to one or more utensil ids (repeatable)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.utensil or None
    report = utensils_ops.sync(config, direction=args.direction, only=only)
    if report.failed:
        return 1
    return 0
