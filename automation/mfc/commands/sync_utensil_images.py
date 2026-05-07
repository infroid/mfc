"""`mfc sync-utensil-images` — reconcile bytes between the utensil-images
bucket and web/assets/utensils/*."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import utensil_images as utensil_images_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-utensil-images",
        help="Sync utensil image bytes bucket↔local (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = Storage→local; push = local→Storage; both = last-modified wins per file",
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
    report = utensil_images_ops.sync_files(config, direction=args.direction, only=only)
    if report.errors:
        return 1
    return 0
