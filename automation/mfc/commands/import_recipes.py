"""`mfc import-recipes` — bulk import web/assets/recipes/* into Supabase."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import recipes


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-recipes",
        help="Upsert ingredients, utensils, and recipes from web/assets/recipes/",
    )
    p.set_defaults(handler=run)


def run(_args: argparse.Namespace, config: Config) -> int:
    recipes.import_all(config)
    return 0
