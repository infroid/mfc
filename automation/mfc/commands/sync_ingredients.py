"""`mfc sync-ingredients` — bundle↔DB metadata sync. Mirror of sync-utensils."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import ingredients as ingredients_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-ingredients",
        help="Sync ingredient library DB↔local bundles (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = DB→local; push = local→DB; both = last-modified wins per ingredient",
    )
    p.add_argument(
        "--ingredient",
        action="append",
        default=None,
        help="Limit to one or more ingredient ids (repeatable)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.ingredient or None
    report = ingredients_ops.sync(config, direction=args.direction, only=only)
    if report.failed:
        return 1
    return 0
