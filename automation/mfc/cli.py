"""Argparse entry point and command registry.

Each command lives in `mfc.commands.<name>` exposing two callables:
  register(subparsers) -> None
  run(args, config)    -> int

To add a new command: implement the module, append it to COMMAND_MODULES.
"""

from __future__ import annotations

import argparse
from typing import Sequence

from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    reset,
    seed_metrics,
    status,
)
from .core import log
from .core.config import Config, ConfigError


# Order here defines the order in `--help`.
# Read-only first, builders next, destructive last.
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    drop_schema,
    reset,
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mfc",
        description="MyFoodCraving Supabase management CLI.",
    )
    parser.add_argument(
        "--env-file",
        default=None,
        help="Path to a .env file (default: automation/.env).",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip interactive confirmations (destructive commands).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    for mod in COMMAND_MODULES:
        mod.register(sub)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        config = Config.load(args.env_file)
    except ConfigError as exc:
        log.error(str(exc))
        return 2
    try:
        return args.handler(args, config)
    except ConfigError as exc:
        log.error(str(exc))
        return 2
    except KeyboardInterrupt:
        log.warn("interrupted")
        return 130
    except Exception as exc:  # surface unexpected failures cleanly
        log.error(f"{type(exc).__name__}: {exc}")
        return 1
