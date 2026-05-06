"""`mfc sync-recipes` — reconcile recipe metadata between DB and local
recipe.json bundles. Replaces mfc import-recipes."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import recipes as recipes_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-recipes",
        help="Sync recipe metadata DB↔local bundles (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = DB→local; push = local→DB; both = last-modified wins per recipe",
    )
    p.add_argument(
        "--recipe",
        action="append",
        default=None,
        help="Limit to one or more recipe ids (repeatable)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.recipe or None
    report = recipes_ops.sync(config, direction=args.direction, only=only)
    if report.failed:
        return 1
    return 0
