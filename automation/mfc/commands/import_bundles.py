"""`mfc import-bundles` — one-shot: read all web/assets/ingredients/<id>/ingredient.json,
decompose, write to automation/db.sqlite."""

from __future__ import annotations

import argparse
import json

from ..core import log
from ..core.config import Config
from ..ops.bundle_decompose import decompose
from ..ops.catalog import Catalog


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-bundles",
        help="One-shot import of every web/assets/ingredients/*/ingredient.json into automation/db.sqlite",
    )
    p.add_argument("--force", action="store_true", help="overwrite existing rows; default is INSERT-or-skip")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    bundle_root = config.repo_root / "web" / "assets" / "ingredients"
    if not bundle_root.exists():
        log.warn(f"no bundle dir at {bundle_root}; nothing to import")
        return 0

    c = Catalog(config.repo_root / "automation" / "db.sqlite")
    inserted = 0
    skipped = 0
    failed: list[tuple[str, str]] = []

    for child in sorted(bundle_root.iterdir()):
        if not child.is_dir():
            continue
        bp = child / "ingredient.json"
        if not bp.exists():
            continue
        try:
            bundle = json.loads(bp.read_text())
        except Exception as e:  # noqa: BLE001
            failed.append((child.name, f"json parse: {e}"))
            continue
        try:
            ing, det, facts = decompose(bundle)
        except Exception as e:  # noqa: BLE001
            failed.append((child.name, f"decompose: {e}"))
            continue

        if not args.force:
            cur = c.conn.execute("SELECT 1 FROM ingredients WHERE id=?", (ing["id"],))
            if cur.fetchone():
                skipped += 1
                continue

        c.upsert_ingredient(ing)
        if det is not None:
            c.upsert_details(det)
        if facts:
            c.set_health_facts("ingredient", ing["id"], [f["fact"] for f in facts])
        inserted += 1

    c.close()
    log.ok(f"import-bundles: inserted {inserted}, skipped {skipped}, failed {len(failed)}")
    for slug, reason in failed:
        log.info(f"  - {slug}   ({reason})")
    return 0
