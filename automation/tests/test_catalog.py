"""Tests for mfc.ops.catalog — SQLite catalog client."""

from __future__ import annotations

import json
import pytest


@pytest.fixture
def catalog(tmp_path):
    from mfc.ops.catalog import Catalog
    db_path = tmp_path / "test.sqlite"
    c = Catalog(db_path)
    c.init()
    yield c
    c.close()


def test_init_creates_expected_tables(catalog):
    cur = catalog.conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    names = {r[0] for r in cur.fetchall()}
    assert {"ingredients", "ingredient_details", "health_facts", "metric_definitions"} <= names


def test_upsert_ingredient_inserts_then_updates(catalog):
    catalog.upsert_ingredient({"id": "spinach", "name": "Spinach"})
    cur = catalog.conn.execute("SELECT name FROM ingredients WHERE id='spinach'")
    assert cur.fetchone()[0] == "Spinach"

    catalog.upsert_ingredient({"id": "spinach", "name": "Spinach Updated"})
    cur = catalog.conn.execute("SELECT name FROM ingredients WHERE id='spinach'")
    assert cur.fetchone()[0] == "Spinach Updated"


def test_upsert_ingredient_serializes_json_fields(catalog):
    catalog.upsert_ingredient({
        "id": "paneer", "name": "Paneer",
        "aliases": ["panir", "indian cottage cheese"],
        "show": {"healthFact": True, "nutrition": True, "storage": False, "substitutes": False},
    })
    cur = catalog.conn.execute("SELECT aliases, show FROM ingredients WHERE id='paneer'")
    aliases_json, show_json = cur.fetchone()
    assert json.loads(aliases_json) == ["panir", "indian cottage cheese"]
    assert json.loads(show_json)["nutrition"] is True


def test_upsert_ingredient_details(catalog):
    catalog.upsert_ingredient({"id": "spinach", "name": "Spinach"})
    catalog.upsert_details({"id": "spinach", "calories": 23, "protein": 2.86})
    cur = catalog.conn.execute("SELECT calories, protein FROM ingredient_details WHERE id='spinach'")
    cal, prot = cur.fetchone()
    assert cal == 23
    assert prot == 2.86


def test_upsert_details_cascade_delete_with_ingredient(catalog):
    catalog.upsert_ingredient({"id": "x", "name": "X"})
    catalog.upsert_details({"id": "x", "calories": 100})
    catalog.conn.execute("DELETE FROM ingredients WHERE id='x'")
    catalog.conn.commit()
    cur = catalog.conn.execute("SELECT COUNT(*) FROM ingredient_details WHERE id='x'")
    assert cur.fetchone()[0] == 0


def test_set_health_facts_replaces_all_for_target(catalog):
    catalog.upsert_ingredient({"id": "spinach", "name": "Spinach"})
    catalog.set_health_facts("ingredient", "spinach", ["high in iron", "high in vitamin K"])
    cur = catalog.conn.execute(
        "SELECT fact FROM health_facts WHERE category='ingredient' AND target_id='spinach' ORDER BY sort_order"
    )
    facts = [r[0] for r in cur.fetchall()]
    assert facts == ["high in iron", "high in vitamin K"]

    catalog.set_health_facts("ingredient", "spinach", ["fresh leafy green"])
    cur = catalog.conn.execute(
        "SELECT COUNT(*) FROM health_facts WHERE category='ingredient' AND target_id='spinach'"
    )
    assert cur.fetchone()[0] == 1


def test_iter_ingredients_yields_all_rows(catalog):
    for i in range(3):
        catalog.upsert_ingredient({"id": f"x{i}", "name": f"X{i}"})
    ids = sorted(r["id"] for r in catalog.iter_ingredients())
    assert ids == ["x0", "x1", "x2"]


def test_upsert_utensil_inserts_and_serializes_specs(catalog):
    catalog.upsert_utensil({
        "id": "kadhai", "name": "Kadhai",
        "specs": {"material": "cast iron", "size": "10in"},
        "show": {"careTip": True, "specs": True},
    })
    cur = catalog.conn.execute("SELECT name, specs, show FROM utensils WHERE id='kadhai'")
    name, specs_json, show_json = cur.fetchone()
    assert name == "Kadhai"
    assert json.loads(specs_json)["material"] == "cast iron"
    assert json.loads(show_json)["careTip"] is True


def test_upsert_utensil_updates_existing(catalog):
    catalog.upsert_utensil({"id": "knife", "name": "Knife"})
    catalog.upsert_utensil({"id": "knife", "name": "Chef's Knife"})
    cur = catalog.conn.execute("SELECT name FROM utensils WHERE id='knife'")
    assert cur.fetchone()[0] == "Chef's Knife"


def test_set_utensil_buy_links_replaces_all(catalog):
    catalog.upsert_utensil({"id": "kadhai", "name": "Kadhai"})
    catalog.set_utensil_buy_links("kadhai", [
        {"sort_order": 0, "store": "Amazon", "url": "https://a.com", "price": "$49", "affiliate_tag": "mfc-20"},
        {"sort_order": 1, "store": "iHerb", "url": "https://i.com", "price": "$55", "affiliate_tag": None},
    ])
    cur = catalog.conn.execute("SELECT store FROM utensil_buy_links WHERE utensil_id='kadhai' ORDER BY sort_order")
    stores = [r[0] for r in cur.fetchall()]
    assert stores == ["Amazon", "iHerb"]

    # Re-set replaces (count stays at 1, not appends to 3)
    catalog.set_utensil_buy_links("kadhai", [
        {"sort_order": 0, "store": "Target", "url": "https://t.com", "price": "$40", "affiliate_tag": None},
    ])
    cur = catalog.conn.execute("SELECT COUNT(*) FROM utensil_buy_links WHERE utensil_id='kadhai'")
    assert cur.fetchone()[0] == 1


def test_utensil_buy_links_cascade_delete(catalog):
    catalog.upsert_utensil({"id": "fork", "name": "Fork"})
    catalog.set_utensil_buy_links("fork", [
        {"sort_order": 0, "store": "Amazon", "url": "https://a.com", "price": "$10", "affiliate_tag": None},
    ])
    catalog.conn.execute("DELETE FROM utensils WHERE id='fork'")
    catalog.conn.commit()
    cur = catalog.conn.execute("SELECT COUNT(*) FROM utensil_buy_links WHERE utensil_id='fork'")
    assert cur.fetchone()[0] == 0


def test_upsert_recipe_serializes_media_and_meal_types(catalog):
    catalog.upsert_recipe({
        "id": "x", "name": "X",
        "cuisine": "Indian", "difficulty": "Easy",
        "servings": 4, "total_minutes": 30,
        "media": {"hero": {"src": "https://example.com/x.jpg"}},
        "meal_types": ["lunch", "dinner"],
    })
    cur = catalog.conn.execute("SELECT media, meal_types FROM recipes WHERE id='x'")
    media_json, meal_json = cur.fetchone()
    assert json.loads(media_json)["hero"]["src"] == "https://example.com/x.jpg"
    assert json.loads(meal_json) == ["lunch", "dinner"]


def test_set_recipe_ingredients_replaces_all(catalog):
    catalog.upsert_ingredient({"id": "spinach", "name": "Spinach"})
    catalog.upsert_ingredient({"id": "salt", "name": "Salt"})
    catalog.upsert_recipe({
        "id": "r1", "name": "R", "cuisine": "X", "difficulty": "Easy",
        "servings": 1, "total_minutes": 10,
    })
    catalog.set_recipe_ingredients("r1", [
        {"sort_order": 0, "ingredient_id": "spinach", "amount": "100g", "unit": "g"},
        {"sort_order": 1, "ingredient_id": "salt", "amount": "pinch", "unit": None},
    ])
    cur = catalog.conn.execute("SELECT ingredient_id FROM recipe_ingredients WHERE recipe_id='r1' ORDER BY sort_order")
    assert [r[0] for r in cur.fetchall()] == ["spinach", "salt"]
    # Re-set replaces (count stays at 1, not 3)
    catalog.set_recipe_ingredients("r1", [{"sort_order": 0, "ingredient_id": "spinach", "amount": "200g", "unit": "g"}])
    cur = catalog.conn.execute("SELECT COUNT(*) FROM recipe_ingredients WHERE recipe_id='r1'")
    assert cur.fetchone()[0] == 1


def test_set_recipe_steps_and_utensils_and_tags(catalog):
    catalog.upsert_utensil({"id": "kadhai", "name": "Kadhai"})
    catalog.upsert_recipe({
        "id": "r2", "name": "R2", "cuisine": "X", "difficulty": "Easy",
        "servings": 1, "total_minutes": 10,
    })
    catalog.set_recipe_steps("r2", [
        {"sort_order": 1, "title": "Boil", "detail": "Boil water", "duration_seconds": 300},
    ])
    catalog.set_recipe_utensils("r2", [
        {"sort_order": 0, "utensil_id": "kadhai", "essential": True},
    ])
    catalog.set_recipe_tags("r2", ["vegan", "quick"])
    cur = catalog.conn.execute("SELECT title FROM recipe_steps WHERE recipe_id='r2'")
    assert cur.fetchone()[0] == "Boil"
    cur = catalog.conn.execute("SELECT essential FROM recipe_utensils WHERE recipe_id='r2'")
    assert cur.fetchone()[0] == 1
    cur = catalog.conn.execute("SELECT tag FROM recipe_tags WHERE recipe_id='r2' ORDER BY tag")
    assert [r[0] for r in cur.fetchall()] == ["quick", "vegan"]


def test_recipe_child_tables_cascade_delete(catalog):
    catalog.upsert_ingredient({"id": "x", "name": "X"})
    catalog.upsert_recipe({
        "id": "r3", "name": "R3", "cuisine": "X", "difficulty": "Easy",
        "servings": 1, "total_minutes": 10,
    })
    catalog.set_recipe_ingredients("r3", [{"sort_order": 0, "ingredient_id": "x", "amount": "1", "unit": "g"}])
    catalog.set_recipe_tags("r3", ["a", "b"])
    catalog.conn.execute("DELETE FROM recipes WHERE id='r3'")
    catalog.conn.commit()
    cur = catalog.conn.execute("SELECT COUNT(*) FROM recipe_ingredients WHERE recipe_id='r3'")
    assert cur.fetchone()[0] == 0
    cur = catalog.conn.execute("SELECT COUNT(*) FROM recipe_tags WHERE recipe_id='r3'")
    assert cur.fetchone()[0] == 0
