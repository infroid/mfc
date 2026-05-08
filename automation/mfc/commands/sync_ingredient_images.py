"""`mfc sync-ingredient-images` — bucket↔local image-bytes sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import ingredient_images as ingredient_images_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-ingredient-images",
        help="Sync ingredient images bucket↔local (pull|push|both)",
    )
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.add_argument(
        "--ingredient",
        action="append",
        default=None,
        help="Limit to one or more ingredient ids (repeatable)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.ingredient or None
    report = ingredient_images_ops.sync_files(config, direction=args.direction, only=only)
    if report.errors:
        return 1
    return 0
