"""`mfc import-usda` — read data/usda/*.csv, dedupe to foundation foods,
upsert into automation/db.sqlite. Existing slug → update, new slug → insert."""

from __future__ import annotations

import argparse

import pandas as pd

from ..core import log
from ..core.config import Config
from ..ops.catalog import Catalog
from ..ops.usda import extract_foundation_foods
from ..ops.usda_nutrient_map import NUTRIENT_MAP


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-usda",
        help="Import data/usda/*.csv foundation foods into automation/db.sqlite",
    )
    p.add_argument("--limit", type=int, default=None, help="cap to first N rows (debug)")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    usda_dir = config.repo_root / "data" / "usda"
    if not usda_dir.exists():
        log.error(f"USDA data not found at {usda_dir}")
        return 2

    log.step(f"loading USDA dump from {usda_dir}")
    df = extract_foundation_foods(usda_dir)
    log.ok(f"extracted {len(df)} foundation foods")
    if args.limit:
        df = df.head(args.limit)
        log.warn(f"--limit applied; processing {len(df)} rows only")

    c = Catalog(config.repo_root / "automation" / "db.sqlite")

    nutrient_cols = set(NUTRIENT_MAP.values())
    inserted = 0
    updated = 0
    for _, row in df.iterrows():
        cur = c.conn.execute("SELECT 1 FROM ingredients WHERE id=?", (row["id"],))
        exists = cur.fetchone() is not None

        ing = {
            "id": row["id"],
            "name": row["name"],
            "category": row["category"] or None,
            "source": "fdc",
            "fdc_id": int(row["fdc_id"]),
        }
        c.upsert_ingredient(ing)

        det: dict = {"id": row["id"], "nutrition_per": "100g"}
        for col in nutrient_cols:
            if col in df.columns:
                v = row[col]
                if pd.notna(v):
                    det[col] = float(v)
        c.upsert_details(det)

        if exists:
            updated += 1
        else:
            inserted += 1

    c.close()
    log.ok(f"import-usda: inserted {inserted}, updated {updated}")
    return 0
