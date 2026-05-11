"""Tests for mfc.ops.bundle_decompose — bundle JSON → (ingredients, details, health_facts) rows."""

from __future__ import annotations

import pytest


def test_minimal_bundle_yields_just_ingredients_row():
    from mfc.ops.bundle_decompose import decompose

    bundle = {"id": "spinach", "name": "Spinach"}
    ing, det, facts = decompose(bundle)

    assert ing["id"] == "spinach"
    assert ing["name"] == "Spinach"
    assert det is None or det == {"id": "spinach"}
    assert facts == []


def test_full_bundle_with_legacy_nutrition_keys_reshapes_to_short_names():
    """Pre-USDA bundles used { calories, protein, fat, carbs } at top of nutrition."""
    from mfc.ops.bundle_decompose import decompose

    bundle = {
        "id": "paneer",
        "name": "Paneer",
        "category": "Dairy",
        "default_unit": "g",
        "aliases": ["panir"],
        "photo": "assets/ingredients/paneer/image.png",
        "show": {"healthFact": True, "nutrition": True, "storage": False, "substitutes": False},
        "nutrition": {
            "source": "manual",
            "calories": 321,
            "protein": 18.3,
            "fat": 25.0,
            "carbs": 3.5,
            "filledAt": "2026-05-01T00:00:00Z",
        },
        "health_fact": "Paneer is a non-melting cheese.",
        "storage": "Refrigerate; change water daily.",
        "substitutes": ["tofu firm"],
    }
    ing, det, facts = decompose(bundle)

    assert ing["source"] == "manual"
    assert ing["category"] == "Dairy"
    assert ing["aliases"] == ["panir"]
    assert det["calories"] == 321
    assert det["protein"] == 18.3
    assert det["total_fat"] == 25.0
    assert det["carbohydrate"] == 3.5
    assert det["storage"] == "Refrigerate; change water daily."
    assert det["substitutes"] == ["tofu firm"]
    assert det["nutrition_filled_at"] == "2026-05-01T00:00:00Z"
    assert facts == [{"sort_order": 0, "fact": "Paneer is a non-melting cheese."}]


def test_usda_shape_nutrition_keys_pass_through():
    """Post-USDA-rename bundles have { energy_kcal, protein_g, ... } too."""
    from mfc.ops.bundle_decompose import decompose

    bundle = {
        "id": "spinach-raw",
        "name": "Spinach, raw",
        "nutrition": {
            "source": "fdc",
            "fdcId": 11457,
            "energy_kcal": 23,
            "protein_g": 2.86,
            "total_fat_g": 0.39,
            "carbohydrate_g": 3.63,
            "calcium_mg": 99,
        },
    }
    ing, det, facts = decompose(bundle)

    assert ing["source"] == "fdc"
    assert ing["fdc_id"] == 11457
    assert det["calories"] == 23
    assert det["protein"] == 2.86
    assert det["total_fat"] == 0.39
    assert det["carbohydrate"] == 3.63
    assert det["calcium"] == 99


def test_unknown_nutrition_keys_are_dropped_not_errored():
    from mfc.ops.bundle_decompose import decompose

    bundle = {
        "id": "x", "name": "X",
        "nutrition": {"calories": 100, "unknown_random_field": 999},
    }
    _ing, det, _ = decompose(bundle)
    assert det["calories"] == 100
    assert "unknown_random_field" not in det
