"""Smoke test: SQLite schema file applies cleanly to a fresh in-memory db."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "db" / "sqlite_schema.sql"


@pytest.fixture
def memdb():
    conn = sqlite3.connect(":memory:")
    yield conn
    conn.close()


def test_schema_applies_cleanly(memdb):
    sql = SCHEMA_PATH.read_text()
    memdb.executescript(sql)


def test_schema_is_idempotent(memdb):
    """Applying the schema twice must not raise — every CREATE uses IF NOT EXISTS."""
    sql = SCHEMA_PATH.read_text()
    memdb.executescript(sql)
    memdb.executescript(sql)


def test_expected_tables_present(memdb):
    sql = SCHEMA_PATH.read_text()
    memdb.executescript(sql)
    cur = memdb.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    names = {row[0] for row in cur.fetchall()}
    assert {"ingredients", "ingredient_details", "health_facts", "metric_definitions"} <= names


def test_ingredient_details_has_expected_columns(memdb):
    sql = SCHEMA_PATH.read_text()
    memdb.executescript(sql)
    cur = memdb.execute("PRAGMA table_info(ingredient_details)")
    cols = {row[1] for row in cur.fetchall()}
    must_have = {
        "id", "storage", "substitutes", "nutrition_per", "nutrition_filled_at",
        "calories", "protein", "total_fat", "carbohydrate", "fiber",
        "calcium", "iron", "potassium", "vitamin_c", "vitamin_a",
        "tryptophan", "leucine", "lysine",
        "pufa_22_6_n3_dha", "sfa_16_0",
    }
    missing = must_have - cols
    assert not missing, f"missing columns: {missing}"
    assert len(cols) >= 100, f"only {len(cols)} columns on ingredient_details; expected ≥100"


def test_health_facts_polymorphic_check(memdb):
    sql = SCHEMA_PATH.read_text()
    memdb.executescript(sql)
    memdb.execute("INSERT INTO ingredients (id, name) VALUES ('test', 'Test')")
    memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('ingredient', 'test', 0, 'fact 1')")
    memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('recipe', 'r1', 0, 'fact 2')")
    memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('utensil', 'u1', 0, 'fact 3')")
    with pytest.raises(sqlite3.IntegrityError):
        memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('bogus', 'x', 0, 'no')")
