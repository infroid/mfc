"""`mfc status` — list public tables with row counts."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import schema


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser("status", help="List public tables and row counts")
    p.set_defaults(handler=run)


def run(_args: argparse.Namespace, config: Config) -> int:
    schema.status(config)
    return 0
