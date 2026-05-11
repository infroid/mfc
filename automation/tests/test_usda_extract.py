"""Tests for mfc.ops.usda.extract_foundation_foods."""

from __future__ import annotations

from pathlib import Path

import pytest


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "usda_mini"


def test_extract_returns_dataframe_with_one_row_per_unique_slug():
    from mfc.ops.usda import extract_foundation_foods

    df = extract_foundation_foods(FIXTURE_DIR)

    assert len(df) == 3
    assert set(df["id"]) == {"spinach-raw", "cheese-cheddar", "almonds"}

    spinach = df[df["id"] == "spinach-raw"].iloc[0]
    assert spinach["fdc_id"] == 101
    assert spinach["protein"] == 2.86
    assert spinach["calories"] == 23


def test_category_is_shortened():
    from mfc.ops.usda import extract_foundation_foods

    df = extract_foundation_foods(FIXTURE_DIR)
    spinach = df[df["id"] == "spinach-raw"].iloc[0]
    assert spinach["category"] == "Vegetable"
    cheese = df[df["id"] == "cheese-cheddar"].iloc[0]
    assert cheese["category"] == "Dairy"


def test_unmapped_nutrient_ids_are_dropped():
    from mfc.ops.usda import extract_foundation_foods

    df = extract_foundation_foods(FIXTURE_DIR)
    assert "nutrient_9999999" not in df.columns
    assert "calcium" in df.columns
