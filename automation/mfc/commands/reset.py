"""`mfc reset` — drop → apply-schema → seed-metrics → import-recipes.

The full clean-slate refresh. One destructive prompt up front, then runs
all four steps in sequence. Stops at the first failure and reports.
"""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..core.prompts import confirm_destructive
from ..ops import recipes, schema, seed


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "reset",
        help="DESTRUCTIVE: drop + apply schema + seed metrics + import recipes",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    db_url = config.require_db_url()
    safe = db_url.split("@", 1)[-1] if "@" in db_url else db_url
    if not confirm_destructive(
        f"  ! About to FULL-RESET the public schema on {safe}.\n"
        f"  ! Drops every public table, re-applies schema.sql, re-seeds\n"
        f"  ! metric_definitions, and re-imports all recipe bundles.",
        expected="reset",
        assume_yes=getattr(args, "yes", False),
    ):
        log.warn("aborted")
        return 1

    log.header("step 1 of 4 · drop")
    schema.drop(config)

    log.header("step 2 of 4 · apply schema")
    schema.apply(config)

    log.header("step 3 of 4 · seed metric_definitions")
    seed.seed_metrics(config)

    log.header("step 4 of 4 · import recipes")
    recipes.import_all(config)

    log.header("done")
    log.ok("reset complete — run `mfc status` to verify row counts")
    return 0
