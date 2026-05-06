"""`mfc sync-images` — reconcile bytes between the recipe-images bucket
and web/assets/recipes/*."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import images as images_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-images",
        help="Sync recipe images bucket↔local (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = Storage→local; push = local→Storage; both = last-modified wins per file",
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
    report = images_ops.sync_files(config, direction=args.direction, only=only)
    if report.errors:
        return 1
    return 0
