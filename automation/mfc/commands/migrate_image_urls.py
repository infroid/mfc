"""`mfc migrate-image-urls` — one-shot DB rewriter.

Rewrites legacy 'assets/...' paths in recipes.media to full Storage URLs
and populates recipe_steps.media_src from local file presence. Idempotent.
"""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import images as images_ops


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "migrate-image-urls",
        help="One-shot — rewrite legacy paths to full Storage URLs (idempotent)",
    )
    p.set_defaults(handler=run)


def run(_args: argparse.Namespace, config: Config) -> int:
    images_ops.migrate_urls(config)
    return 0
