"""`mfc init-catalog` — create automation/db.sqlite from the schema file. Idempotent."""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..ops.catalog import Catalog


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "init-catalog",
        help="Create automation/db.sqlite from the schema (idempotent; --force drops first)",
    )
    p.add_argument("--force", action="store_true", help="drop the file before re-creating")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    db_path = config.repo_root / "automation" / "db.sqlite"
    if args.force and db_path.exists():
        db_path.unlink()
        log.warn(f"removed {db_path}")
    c = Catalog(db_path)
    c.init()
    c.close()
    log.ok(f"catalog ready at {db_path}")
    return 0
