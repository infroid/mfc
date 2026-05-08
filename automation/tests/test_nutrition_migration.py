"""Tests for mfc.ops.nutrition_migration.reshape_legacy."""

from __future__ import annotations

import pytest


def test_legacy_keys_renamed_and_source_set():
    from mfc.ops.nutrition_migration import reshape_legacy

    out = reshape_legacy({"calories": 321, "protein": 18.3, "fat": 25.0, "carbs": 3.5})

    assert out["energy_kcal"] == 321
    assert out["protein_g"] == 18.3
    assert out["total_fat_g"] == 25.0
    assert out["carbohydrate_g"] == 3.5
    assert out["source"] == "manual"
    assert out["per"] == "100g"
    assert "filledAt" in out
    # Legacy keys must be gone
    for k in ("calories", "protein", "fat", "carbs"):
        assert k not in out


def test_already_new_shape_returned_unchanged():
    from mfc.ops.nutrition_migration import reshape_legacy

    already = {
        "source": "fdc",
        "fdcId": 173436,
        "per": "100g",
        "energy_kcal": 321,
    }
    assert reshape_legacy(already) == already


@pytest.mark.parametrize("inp,expected", [
    (None, None),
    ({}, {}),
])
def test_empty_or_null_returned_unchanged(inp, expected):
    from mfc.ops.nutrition_migration import reshape_legacy

    assert reshape_legacy(inp) == expected


def test_idempotent_double_reshape():
    """reshape_legacy(reshape_legacy(x)) == reshape_legacy(x) — guards
    against a future refactor that breaks the 'source' sentinel guard."""
    from mfc.ops.nutrition_migration import reshape_legacy

    legacy = {"calories": 321, "protein": 18.3, "fat": 25.0, "carbs": 3.5}
    once = reshape_legacy(legacy)
    twice = reshape_legacy(once)
    assert twice == once
