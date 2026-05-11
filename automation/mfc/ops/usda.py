"""USDA Foundation Foods extractor.

Reads data/usda/*.csv, filters to data_type='foundation_food', joins
food + food_nutrient + nutrient + food_category, pivots wide, applies
our nutrient + category name maps, slugifies the description, and
deduplicates on slug (max fdc_id wins).

Returns a pandas DataFrame with one row per slug, ready to upsert into
the SQLite ingredients + ingredient_details tables.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from .usda_categories import shorten
from .usda_nutrient_map import NUTRIENT_MAP


_SLUG_RX = re.compile(r"[^a-z0-9]+")


def _slug(s: str) -> str:
    return _SLUG_RX.sub("-", (s or "").lower()).strip("-")


def extract_foundation_foods(usda_dir: str | Path) -> pd.DataFrame:
    """Return one row per unique slug with our column names + USDA nutrient values."""
    usda = Path(usda_dir)

    foods = pd.read_csv(usda / "food.csv", dtype={"fdc_id": int})
    foods = foods[foods["data_type"] == "foundation_food"].copy()
    foods["slug"] = foods["description"].apply(_slug)

    cats = pd.read_csv(usda / "food_category.csv", dtype={"id": int})
    cats = cats.rename(columns={"id": "food_category_id", "description": "category_raw"})[
        ["food_category_id", "category_raw"]
    ]
    foods["food_category_id"] = pd.to_numeric(foods["food_category_id"], errors="coerce").astype("Int64")
    foods = foods.merge(cats, on="food_category_id", how="left")
    foods["category"] = foods["category_raw"].fillna("").apply(shorten)

    nut = pd.read_csv(usda / "food_nutrient.csv", dtype={"fdc_id": int, "nutrient_id": int})
    nut = nut[nut["fdc_id"].isin(foods["fdc_id"])]
    nut = nut[nut["amount"].notna()]
    nut["col"] = nut["nutrient_id"].map(NUTRIENT_MAP)
    nut = nut[nut["col"].notna()]

    # Wide pivot. For ids that map to the same column (e.g. 1008/2047/2048 → calories),
    # the priority is "later id wins" since NUTRIENT_MAP preserves the order we want
    # (2047/2048 listed after 1008). Implement with a deterministic groupby-last.
    nut = nut.sort_values(["fdc_id", "nutrient_id"])
    wide = nut.groupby(["fdc_id", "col"], as_index=False)["amount"].last()
    wide = wide.pivot(index="fdc_id", columns="col", values="amount").reset_index()
    wide.columns.name = None

    merged = foods.merge(wide, on="fdc_id", how="left")
    merged["id"] = merged["slug"]
    merged["name"] = merged["description"]
    merged["source"] = "fdc"

    merged = merged.sort_values(["id", "fdc_id"]).drop_duplicates("id", keep="last")

    base_cols = ["id", "name", "category", "fdc_id", "source"]
    nutrient_cols = [c for c in merged.columns if c in set(NUTRIENT_MAP.values())]
    return merged[base_cols + nutrient_cols].reset_index(drop=True)
