"""`mfc seed-metrics` — load the 54-row metric_definitions catalog."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import seed


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "seed-metrics",
        help="Run data/db/seed_metrics.sql (idempotent ON CONFLICT upsert)",
    )
    p.set_defaults(handler=run)


def run(_args: argparse.Namespace, config: Config) -> int:
    seed.seed_metrics(config)
    return 0
