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
    fetch_ingredient_images,
    fetch_ingredient_nutrition,
    gen_nutrition_doc,
    import_ingredient,
    import_recipe,
    import_recipes,
    import_usda,
    import_utensil,
    init_catalog,
    list_users,
    reset,
    seed_metrics,
    set_role,
    status,
    suspend_user,
    sync_images,
    sync_ingredient_images,
    sync_ingredients,
    sync_recipes,
    sync_utensil_images,
    sync_utensils,
    update_utensil,
)
from .core import log
from .core.config import Config, ConfigError


# Order here defines the order in `--help`.
# Read-only first, builders next, destructive last.
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    init_catalog,
    import_ingredient,
    import_recipe,
    import_recipes,
    import_usda,
    import_utensil,
    seed_metrics,
    sync_recipes,
    sync_images,
    sync_ingredients,
    sync_ingredient_images,
    sync_utensils,
    sync_utensil_images,
    fetch_ingredient_images,
    fetch_ingredient_nutrition,
    gen_nutrition_doc,
    update_utensil,
    set_role,
    suspend_user,
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
        register_bulk = getattr(mod, "register_bulk", None)
        if register_bulk is not None:
            register_bulk(sub)
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
