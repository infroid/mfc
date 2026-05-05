"""`mfc drop-schema` — DROP all known public tables CASCADE.

Destructive. Prompts for the literal string "wipe" unless --yes is set.
Refuses to run non-interactively without --yes.
"""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..core.prompts import confirm_destructive
from ..ops import schema


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "drop-schema",
        help="DESTRUCTIVE: drop all known public tables CASCADE",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    db_url = config.require_db_url()
    # Show enough of the host to recognize the project, never the password.
    safe = db_url.split("@", 1)[-1] if "@" in db_url else db_url
    if not confirm_destructive(
        f"  ! About to DROP every public table on {safe} CASCADE.\n"
        f"  ! Auth users survive. Catalog, library, marker definitions, and\n"
        f"  ! all per-user rows will be lost.",
        expected="wipe",
        assume_yes=getattr(args, "yes", False),
    ):
        log.warn("aborted")
        return 1
    schema.drop(config)
    return 0
