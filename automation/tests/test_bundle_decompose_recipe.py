"""Tests for mfc.ops.bundle_decompose_recipe — recipe bundle JSON → SQLite rows."""

from __future__ import annotations


def test_minimal_bundle_yields_just_recipe_row():
    from mfc.ops.bundle_decompose_recipe import decompose

    bundle = {
        "id": "x", "name": "X", "cuisine": "Indian", "difficulty": "Easy",
        "servings": 1, "totalMinutes": 10,
    }
    out = decompose(bundle)

    assert out["recipe"]["id"] == "x"
    assert out["recipe"]["name"] == "X"
    assert out["recipe"]["total_minutes"] == 10
    assert out["ingredients"] == []
    assert out["steps"] == []
    assert out["utensils"] == []
    assert out["tags"] == []
    assert out["health_facts"] == []


def test_full_bundle_renames_camel_keys_and_derives_fks():
    from mfc.ops.bundle_decompose_recipe import decompose

    bundle = {
        "id": "aam-panna",
        "name": "Aam Panna",
        "tagline": "Raw mango cooler",
        "shortTagline": "raw mango · 30 min",
        "cuisine": "North Indian",
        "difficulty": "Easy",
        "servings": 4,
        "totalMinutes": 30,
        "media": {"hero": {"src": "https://example.com/h.jpg"}, "emoji": "🥭"},
        "color": "#A4C268",
        "colorSoft": "rgba(164,194,104,0.18)",
        "createdBy": "abc-uuid",
        "ingredients": [
            {"name": "Raw green mango", "amt": "2", "group": "main"},
            {"name": "Cumin powder", "amt": "1 tsp"},
        ],
        "steps": [
            {"id": 1, "title": "Boil", "detail": "Boil it", "duration": 1200, "tip": "watch the heat",
             "media": {"src": "https://example.com/s1.jpg", "caption": "Boiling"}},
            {"id": 2, "title": "Cool", "detail": "Cool it"},
        ],
        "utensils": [
            {"name": "Pressure cooker", "essential": True},
            {"name": "Chef's Knife", "essential": False},
        ],
        "tags": ["drink", "vegan"],
        "healthFacts": [
            "High in vitamin C",
            "Electrolyte balance",
        ],
    }
    out = decompose(bundle)

    # Recipe row
    r = out["recipe"]
    assert r["short_tagline"] == "raw mango · 30 min"
    assert r["total_minutes"] == 30
    assert r["color_soft"] == "rgba(164,194,104,0.18)"
    assert r["created_by"] == "abc-uuid"
    assert r["media"]["hero"]["src"] == "https://example.com/h.jpg"
    assert r["meal_types"] == []  # bundle has none; default to empty list

    # Ingredients (sort_order is the array index; ingredient_id is slugify(name))
    assert out["ingredients"] == [
        {"sort_order": 0, "ingredient_id": "raw-green-mango", "group_name": "main", "amount": "2", "unit": None},
        {"sort_order": 1, "ingredient_id": "cumin-powder", "group_name": None, "amount": "1 tsp", "unit": None},
    ]

    # Steps
    assert out["steps"] == [
        {"sort_order": 1, "title": "Boil", "detail": "Boil it", "duration_seconds": 1200,
         "tip": "watch the heat", "media_caption": "Boiling", "media_src": "https://example.com/s1.jpg"},
        {"sort_order": 2, "title": "Cool", "detail": "Cool it", "duration_seconds": None,
         "tip": None, "media_caption": None, "media_src": None},
    ]

    # Utensils (sort_order is array index, utensil_id is slugify(name))
    assert out["utensils"] == [
        {"sort_order": 0, "utensil_id": "pressure-cooker", "essential": True},
        {"sort_order": 1, "utensil_id": "chef-s-knife", "essential": False},
    ]

    # Tags
    assert out["tags"] == ["drink", "vegan"]

    # Health facts (list of strings; caller converts to rows with sort_order at write time)
    assert out["health_facts"] == ["High in vitamin C", "Electrolyte balance"]


def test_step_without_id_uses_array_index_plus_one():
    """Older bundles may omit the per-step `id` field."""
    from mfc.ops.bundle_decompose_recipe import decompose

    bundle = {
        "id": "x", "name": "X", "cuisine": "Indian", "difficulty": "Easy",
        "servings": 1, "totalMinutes": 10,
        "steps": [
            {"title": "S1", "detail": "d1"},
            {"title": "S2", "detail": "d2"},
        ],
    }
    out = decompose(bundle)
    assert out["steps"][0]["sort_order"] == 1
    assert out["steps"][1]["sort_order"] == 2


def test_ingredients_with_no_name_dropped():
    """Defensively drop bundle ingredients missing a name."""
    from mfc.ops.bundle_decompose_recipe import decompose

    bundle = {
        "id": "x", "name": "X", "cuisine": "Indian", "difficulty": "Easy",
        "servings": 1, "totalMinutes": 10,
        "ingredients": [
            {"name": "Salt"},
            {"amt": "??"},  # no name; drop
        ],
    }
    out = decompose(bundle)
    assert len(out["ingredients"]) == 1
    assert out["ingredients"][0]["ingredient_id"] == "salt"


def test_dedupe_utensils_by_slug_keeping_first():
    """Bundle may accidentally repeat a utensil; keep first occurrence."""
    from mfc.ops.bundle_decompose_recipe import decompose

    bundle = {
        "id": "x", "name": "X", "cuisine": "Indian", "difficulty": "Easy",
        "servings": 1, "totalMinutes": 10,
        "utensils": [
            {"name": "Kadhai", "essential": True},
            {"name": "Kadhai", "essential": False},  # dup
            {"name": "Knife"},
        ],
    }
    out = decompose(bundle)
    ids = [u["utensil_id"] for u in out["utensils"]]
    assert ids == ["kadhai", "knife"]
    assert out["utensils"][0]["essential"] is True
