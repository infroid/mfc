"""`mfc apply-schema` — runs data/db/schema.sql top-to-bottom (idempotent)."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import schema


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "apply-schema",
        help="Run data/db/schema.sql against the configured database",
    )
    p.set_defaults(handler=run)


def run(_args: argparse.Namespace, config: Config) -> int:
    schema.apply(config)
    return 0
