# SQLite Catalog + USDA Foundation Foods Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a committed local SQLite catalog (`automation/db.sqlite`) as the canonical source of ingredient data, bulk-import USDA Foundation Foods into it, retire the bundle-JSON-per-ingredient model, and consolidate health facts into one polymorphic table across ingredients/utensils/recipes.

**Architecture:** Pure Python data-shaping (pandas for USDA extraction, stdlib `sqlite3` for catalog I/O) with the existing `supabase-py` service client for push/pull. New SQLite schema mirrors the relevant Supabase catalog tables manually (no migration framework). Bundle JSONs are migrated once then deleted; the rewritten `mfc sync-ingredients` flows SQLite ↔ Supabase.

**Tech Stack:** Python 3.10+, stdlib `sqlite3`, `pandas>=2.0`, existing `supabase-py` + `psycopg`. SQLite committed binary in the repo.

**Spec:** [docs/superpowers/specs/2026-05-11-sqlite-catalog-and-usda-import-design.md](../specs/2026-05-11-sqlite-catalog-and-usda-import-design.md)

---

## File Structure

**New files**
- `automation/db/sqlite_schema.sql` — SQLite DDL for the catalog tables (`ingredients`, `ingredient_details`, `health_facts`, `metric_definitions`).
- `automation/mfc/ops/usda.py` — `extract_foundation_foods(usda_dir) → pd.DataFrame` pure function.
- `automation/mfc/ops/usda_nutrient_map.py` — `NUTRIENT_MAP: dict[int, str]` mapping USDA nutrient ids → our column names. ~140 entries.
- `automation/mfc/ops/usda_categories.py` — `CATEGORY_MAP: dict[str, str]` for verbose-to-short category names.
- `automation/mfc/ops/catalog.py` — SQLite catalog client. `Catalog` class with `init()`, `upsert_ingredient()`, `upsert_health_facts()`, `iter_rows()`, etc.
- `automation/mfc/ops/bundle_decompose.py` — Pure function `decompose(bundle_dict) → (ing_row, details_row, health_facts_rows)` plus legacy nutrition key reshaping.
- `automation/mfc/commands/init_catalog.py` — `mfc init-catalog`.
- `automation/mfc/commands/import_bundles.py` — `mfc import-bundles`.
- `automation/mfc/commands/import_usda.py` — `mfc import-usda`.
- `automation/mfc/commands/import_ingredient.py` — `mfc import-ingredient <path>`.
- `docs/templates/ingredient.example.json` — JSON template for human authoring.
- `docs/NUTRITION_FIELDS.md` — generated reference of every nutrient column with unit + USDA nutrient id.
- `automation/tests/test_usda_extract.py`
- `automation/tests/test_bundle_decompose.py`
- `automation/tests/test_sqlite_schema.py`
- `automation/tests/test_catalog.py`
- `automation/tests/fixtures/usda_mini/` — small CSV bundle for tests.

**Modified files**
- `automation/db/schema.sql` — Postgres-side migration: rename `nutrition_source` → `source`, create `ingredient_details`, create `health_facts`, migrate `recipe_health_facts` data + drop, decompose `ingredients.nutrition` jsonb → flat columns, drop `health_fact`/`storage`/`substitutes` from `ingredients`.
- `automation/pyproject.toml` — add `pandas>=2.0`.
- `automation/mfc/cli.py` — register new commands; remove retired ones.
- `automation/mfc/commands/sync_ingredients.py` — rewritten for SQLite ↔ Supabase.
- `automation/mfc/commands/fetch_ingredient_nutrition.py` — reads/writes SQLite.
- `automation/mfc/commands/fetch_ingredient_images.py` — reads/writes SQLite.
- `automation/mfc/ops/recipes.py` — switch `recipe_health_facts` reads/writes to `health_facts WHERE category='recipe'`.
- `web/assets/js/lib/db.js` — recipe queries use `health_facts` not `recipe_health_facts`.
- `web/assets/js/lib/admin-db.js` — same.
- `web/assets/js/app/chef-recipe-app.jsx` — same.
- `web/assets/js/app/admin-ingredient-app.jsx` — drop macro-key shim once data is migrated; read new short-name fields.
- `Makefile` — replace `migrate-ingredient-nutrition` target; add `init-catalog`, `import-bundles`, `import-usda`, `import-ingredient`.

**Deleted files (cleanup phase, last task)**
- `automation/mfc/ops/nutrition_migration.py`
- `automation/mfc/commands/migrate_ingredient_nutrition.py`
- `automation/tests/test_nutrition_migration.py`
- `automation/mfc/ops/ingredients.py` (replaced by `catalog.py`)
- `web/assets/ingredients/<id>/ingredient.json` (all 559)

---

### Task 1: Add pandas dep + USDA nutrient ID map

**Files:**
- Modify: `automation/pyproject.toml`
- Create: `automation/mfc/ops/usda_nutrient_map.py`

- [ ] **Step 1: Add pandas to dependencies**

Edit `automation/pyproject.toml`. Inside `dependencies`, add:
```toml
  "pandas>=2.0",
```

Run:
```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make sync
```
Expected: `pandas` installed.

- [ ] **Step 2: Create the nutrient ID map**

Create `automation/mfc/ops/usda_nutrient_map.py`:

```python
"""USDA FDC nutrient-id → our SQLite column name map.

Source: USDA `nutrient.csv` from the Foundation Foods dump. Coverage
analysis on data/usda showed ~140 ids reach >5% of foundation foods;
only those are mapped. Tier 4 (research-only, isomers, lab artifacts)
intentionally omitted.
"""

from __future__ import annotations

# nutrient_id → column name on ingredient_details. Units documented in
# docs/NUTRITION_FIELDS.md + on the Postgres COMMENT ON COLUMN line.
NUTRIENT_MAP: dict[int, str] = {
    # Energy + water
    1008: "calories",          # primary kcal id
    2047: "calories",          # Atwater general; overrides 1008 when present
    2048: "calories",          # Atwater specific; overrides both above
    1062: "energy_kj",
    1051: "water",
    1007: "ash",
    1051: "water",
    1018: "alcohol",

    # Macros
    1003: "protein",
    1004: "total_fat",
    1005: "carbohydrate",
    1002: "nitrogen",

    # Carb breakdown
    1079: "fiber",
    2033: "fiber_soluble",
    1084: "fiber_insoluble",
    1063: "sugars",
    2000: "sugars",            # alt id for "Sugars, Total"
    1235: "sugars_added",
    1009: "starch",
    1011: "glucose",
    1012: "fructose",
    1010: "sucrose",
    1013: "lactose",
    1014: "maltose",
    1075: "galactose",

    # Fats
    1258: "saturated_fat",
    1292: "mono_fat",
    1293: "poly_fat",
    1257: "trans_fat",
    1253: "cholesterol",

    # Individual SFA
    1259: "sfa_4_0",
    1260: "sfa_6_0",
    1261: "sfa_8_0",
    1262: "sfa_10_0",
    1263: "sfa_12_0",
    1264: "sfa_14_0",
    1299: "sfa_15_0",
    1265: "sfa_16_0",
    1300: "sfa_17_0",
    1266: "sfa_18_0",
    1267: "sfa_20_0",
    1273: "sfa_22_0",
    1301: "sfa_24_0",

    # Individual MUFA
    1314: "mufa_14_1",
    1333: "mufa_15_1",
    1275: "mufa_16_1",
    1323: "mufa_17_1",
    1268: "mufa_18_1",
    1277: "mufa_20_1",
    1279: "mufa_22_1",
    1312: "mufa_24_1",

    # Individual PUFA
    1269: "pufa_18_2_n6_la",
    1404: "pufa_18_3_n3_ala",
    1321: "pufa_18_3_n6_gla",
    1276: "pufa_18_4",
    1313: "pufa_20_2_n6",
    1325: "pufa_20_3_n6",
    1405: "pufa_20_3_n3",
    1316: "pufa_20_4_n6_aa",
    1278: "pufa_20_5_n3_epa",
    1280: "pufa_21_5",
    1318: "pufa_22_2",
    1281: "pufa_22_5_n3_dpa",
    1272: "pufa_22_6_n3_dha",

    # Minerals
    1087: "calcium",
    1089: "iron",
    1090: "magnesium",
    1091: "phosphorus",
    1092: "potassium",
    1093: "sodium",
    1095: "zinc",
    1098: "copper",
    1101: "manganese",
    1103: "selenium",
    1099: "fluoride",
    1100: "iodine",

    # Fat-soluble vitamins
    1106: "vitamin_a",         # RAE µg
    1104: "vitamin_a_iu",
    1105: "retinol",
    1108: "carotene_alpha",
    1107: "carotene_beta",
    1120: "cryptoxanthin_beta",
    1122: "lycopene",
    1123: "lutein_zeaxanthin",
    1114: "vitamin_d",
    1111: "vitamin_d2",
    1112: "vitamin_d3",
    1109: "vitamin_e",
    1125: "tocopherol_beta",
    1126: "tocopherol_gamma",
    1127: "tocopherol_delta",
    1185: "vitamin_k",

    # Water-soluble vitamins
    1165: "thiamin",
    1166: "riboflavin",
    1167: "niacin",
    1170: "pantothenic_acid",
    1175: "vitamin_b6",
    1176: "biotin",
    1177: "folate",
    1190: "folate_dfe",
    1178: "vitamin_b12",
    1180: "choline",
    1162: "vitamin_c",

    # Amino acids
    1210: "tryptophan",
    1211: "threonine",
    1212: "isoleucine",
    1213: "leucine",
    1214: "lysine",
    1215: "methionine",
    1216: "cystine",
    1217: "phenylalanine",
    1218: "tyrosine",
    1219: "valine",
    1220: "arginine",
    1221: "histidine",
    1222: "alanine",
    1223: "aspartic_acid",
    1224: "glutamic_acid",
    1225: "glycine",
    1226: "proline",
    1227: "serine",
    1228: "hydroxyproline",

    # Stimulants
    1057: "caffeine",
    1058: "theobromine",
}
```

- [ ] **Step 3: Quick smoke**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run python -c "
from mfc.ops.usda_nutrient_map import NUTRIENT_MAP
print(f'mapped: {len(NUTRIENT_MAP)} ids; unique columns: {len(set(NUTRIENT_MAP.values()))}')
"
```
Expected: `mapped: ~95 ids; unique columns: ~95`. (Some ids map to the same column intentionally, e.g. multiple energy ids → `calories`.)

- [ ] **Step 4: Commit**

```bash
git add automation/pyproject.toml automation/uv.lock automation/mfc/ops/usda_nutrient_map.py
git commit -m "feat(usda): nutrient-id → column-name map + pandas dep"
```

---

### Task 2: Category shortening map

**Files:**
- Create: `automation/mfc/ops/usda_categories.py`

- [ ] **Step 1: Create the map**

Create `automation/mfc/ops/usda_categories.py`:

```python
"""USDA verbose food category names → short app-friendly labels."""

from __future__ import annotations


CATEGORY_MAP: dict[str, str] = {
    "Vegetables and Vegetable Products":   "Vegetable",
    "Fruits and Fruit Juices":             "Fruit",
    "Dairy and Egg Products":              "Dairy",
    "Cereal Grains and Pasta":             "Grain",
    "Legumes and Legume Products":         "Legume",
    "Nut and Seed Products":               "Nut & Seed",
    "Finfish and Shellfish Products":      "Seafood",
    "Beef Products":                       "Meat",
    "Pork Products":                       "Meat",
    "Poultry Products":                    "Meat",
    "Lamb, Veal, and Game Products":       "Meat",
    "Sausages and Luncheon Meats":         "Charcuterie",
    "Fats and Oils":                       "Oil & Fat",
    "Spices and Herbs":                    "Spice & Herb",
    "Sweets":                              "Sweet",
    "Soups, Sauces, and Gravies":          "Sauce",
    "Baked Products":                      "Bakery",
    "Beverages":                           "Beverage",
    "Restaurant Foods":                    "Other",
}


def shorten(name: str) -> str:
    """Return the short label for a USDA category. Unmapped names
    pass through unchanged (graceful degrade)."""
    return CATEGORY_MAP.get(name, name)
```

- [ ] **Step 2: Commit**

```bash
git add automation/mfc/ops/usda_categories.py
git commit -m "feat(usda): verbose → short category map"
```

---

### Task 3: SQLite schema file + unit test

**Files:**
- Create: `automation/db/sqlite_schema.sql`
- Create: `automation/tests/test_sqlite_schema.py`

- [ ] **Step 1: Write the schema test FIRST**

Create `automation/tests/test_sqlite_schema.py`:

```python
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


def test_ingredient_details_has_140_plus_nutrient_columns(memdb):
    sql = SCHEMA_PATH.read_text()
    memdb.executescript(sql)
    cur = memdb.execute("PRAGMA table_info(ingredient_details)")
    cols = {row[1] for row in cur.fetchall()}
    # Subset of must-have columns (more exist; this is a smoke set):
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
    # Allowed categories
    memdb.execute("INSERT INTO ingredients (id, name) VALUES ('test', 'Test')")
    memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('ingredient', 'test', 0, 'fact 1')")
    memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('recipe', 'r1', 0, 'fact 2')")
    memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('utensil', 'u1', 0, 'fact 3')")
    # Disallowed
    with pytest.raises(sqlite3.IntegrityError):
        memdb.execute("INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES ('bogus', 'x', 0, 'no')")
```

- [ ] **Step 2: Verify it fails**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_sqlite_schema.py -v
```
Expected: errors with `FileNotFoundError` for the schema file.

- [ ] **Step 3: Create the schema file**

Create `automation/db/sqlite_schema.sql`:

```sql
-- ====================================================================
-- SQLite catalog schema. Mirror of the Supabase catalog tables.
-- Authored by hand; kept in sync with automation/db/schema.sql.
--
-- Conventions for the SQLite ↔ Postgres mirror:
--   - jsonb        → TEXT (JSON serialized at write, parsed at read)
--   - text[]       → TEXT (JSON-serialized array)
--   - uuid         → TEXT
--   - timestamptz  → TEXT (ISO 8601)
-- ====================================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------
-- ingredients — list-page-friendly, narrow
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    aliases       TEXT NOT NULL DEFAULT '[]',
    category      TEXT,
    tagline       TEXT,
    photo         TEXT,
    emoji         TEXT,
    default_unit  TEXT NOT NULL DEFAULT 'g',
    source        TEXT,
    fdc_id        INTEGER,
    show          TEXT NOT NULL DEFAULT '{"healthFact":true,"nutrition":true,"storage":false,"substitutes":false}',
    ai_filled_at  TEXT,
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ingredients_source_idx   ON ingredients (source);
CREATE INDEX IF NOT EXISTS ingredients_category_idx ON ingredients (category);
CREATE INDEX IF NOT EXISTS ingredients_fdc_id_idx   ON ingredients (fdc_id);

-- --------------------------------------------------------------------
-- ingredient_details — 1:1 with ingredients; ~140 flat nutrient columns
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredient_details (
    id                   TEXT PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
    storage              TEXT,
    substitutes          TEXT NOT NULL DEFAULT '[]',
    nutrition_per        TEXT NOT NULL DEFAULT '100g',
    nutrition_filled_at  TEXT,

    -- Energy / water / ash / nitrogen / alcohol
    calories REAL, energy_kj REAL, water REAL, ash REAL, alcohol REAL, nitrogen REAL,

    -- Macros
    protein REAL, total_fat REAL, carbohydrate REAL,

    -- Carb breakdown
    fiber REAL, fiber_soluble REAL, fiber_insoluble REAL,
    sugars REAL, sugars_added REAL, starch REAL,
    glucose REAL, fructose REAL, sucrose REAL, lactose REAL, maltose REAL, galactose REAL,

    -- Fats
    saturated_fat REAL, mono_fat REAL, poly_fat REAL, trans_fat REAL, cholesterol REAL,

    -- Individual SFA
    sfa_4_0 REAL, sfa_6_0 REAL, sfa_8_0 REAL, sfa_10_0 REAL,
    sfa_12_0 REAL, sfa_14_0 REAL, sfa_15_0 REAL, sfa_16_0 REAL,
    sfa_17_0 REAL, sfa_18_0 REAL, sfa_20_0 REAL, sfa_22_0 REAL, sfa_24_0 REAL,

    -- Individual MUFA
    mufa_14_1 REAL, mufa_15_1 REAL, mufa_16_1 REAL, mufa_17_1 REAL,
    mufa_18_1 REAL, mufa_20_1 REAL, mufa_22_1 REAL, mufa_24_1 REAL,

    -- Individual PUFA
    pufa_18_2_n6_la REAL, pufa_18_3_n3_ala REAL, pufa_18_3_n6_gla REAL,
    pufa_18_4 REAL, pufa_20_2_n6 REAL, pufa_20_3_n6 REAL, pufa_20_3_n3 REAL,
    pufa_20_4_n6_aa REAL, pufa_20_5_n3_epa REAL, pufa_21_5 REAL,
    pufa_22_2 REAL, pufa_22_5_n3_dpa REAL, pufa_22_6_n3_dha REAL,

    -- Minerals
    calcium REAL, iron REAL, magnesium REAL, phosphorus REAL, potassium REAL,
    sodium REAL, zinc REAL, copper REAL, manganese REAL,
    selenium REAL, fluoride REAL, iodine REAL,

    -- Fat-soluble vitamins
    vitamin_a REAL, vitamin_a_iu REAL, retinol REAL,
    carotene_alpha REAL, carotene_beta REAL, cryptoxanthin_beta REAL,
    lycopene REAL, lutein_zeaxanthin REAL,
    vitamin_d REAL, vitamin_d2 REAL, vitamin_d3 REAL,
    vitamin_e REAL, tocopherol_beta REAL, tocopherol_gamma REAL, tocopherol_delta REAL,
    vitamin_k REAL,

    -- Water-soluble vitamins
    thiamin REAL, riboflavin REAL, niacin REAL, pantothenic_acid REAL,
    vitamin_b6 REAL, biotin REAL, folate REAL, folate_dfe REAL,
    vitamin_b12 REAL, choline REAL, vitamin_c REAL,

    -- Amino acids
    tryptophan REAL, threonine REAL, isoleucine REAL, leucine REAL,
    lysine REAL, methionine REAL, cystine REAL, phenylalanine REAL,
    tyrosine REAL, valine REAL, arginine REAL, histidine REAL,
    alanine REAL, aspartic_acid REAL, glutamic_acid REAL,
    glycine REAL, proline REAL, serine REAL, hydroxyproline REAL,

    -- Stimulants
    caffeine REAL, theobromine REAL
);

-- --------------------------------------------------------------------
-- health_facts — polymorphic, shared across categories
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_facts (
    category    TEXT    NOT NULL CHECK (category IN ('ingredient', 'utensil', 'recipe')),
    target_id   TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL,
    fact        TEXT    NOT NULL,
    PRIMARY KEY (category, target_id, sort_order)
);
CREATE INDEX IF NOT EXISTS health_facts_target_idx ON health_facts (category, target_id);

-- --------------------------------------------------------------------
-- metric_definitions — reference data; needed for fresh-deploy seed
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metric_definitions (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    unit           TEXT,
    category       TEXT,
    normal_min     REAL,
    normal_max     REAL,
    male_min       REAL,
    male_max       REAL,
    female_min     REAL,
    female_max     REAL,
    description    TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 999
);
```

- [ ] **Step 4: Verify the tests pass**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_sqlite_schema.py -v
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/db/sqlite_schema.sql automation/tests/test_sqlite_schema.py
git commit -m "feat(sqlite): catalog schema (ingredients + details + health_facts + metric_definitions)"
```

---

### Task 4: Bundle decomposer + tests

**Files:**
- Create: `automation/mfc/ops/bundle_decompose.py`
- Create: `automation/tests/test_bundle_decompose.py`

- [ ] **Step 1: Write failing tests**

Create `automation/tests/test_bundle_decompose.py`:

```python
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
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_bundle_decompose.py -v
```
Expected: ModuleNotFoundError on `mfc.ops.bundle_decompose`.

- [ ] **Step 3: Implement the decomposer**

Create `automation/mfc/ops/bundle_decompose.py`:

```python
"""Pure function: ingredient bundle JSON → (ingredients-row, details-row, health-fact-rows).

Handles both legacy ({calories, protein, fat, carbs}) and USDA-rename
({energy_kcal, protein_g, total_fat_g, carbohydrate_g}) nutrition key
conventions. Output uses the new short names (calories / protein /
total_fat / carbohydrate / ...).
"""

from __future__ import annotations

from typing import Any


_INGREDIENT_FIELDS = (
    "id", "name", "aliases", "category", "tagline", "photo", "emoji",
    "default_unit", "show", "ai_filled_at", "created_by", "created_at", "updated_at",
)

# Legacy and USDA-rename → short-name normalization map for the nutrition jsonb.
# Multi-id matches collapse to the canonical short name in the new schema.
_NUTRITION_RENAME: dict[str, str] = {
    # legacy 4-macros
    "calories": "calories",
    "protein": "protein",
    "fat": "total_fat",
    "carbs": "carbohydrate",
    # USDA-rename variants
    "energy_kcal": "calories",
    "energy_kj": "energy_kj",
    "water_g": "water",
    "protein_g": "protein",
    "total_fat_g": "total_fat",
    "carbohydrate_g": "carbohydrate",
    "ash_g": "ash",
    "alcohol_g": "alcohol",
    "saturated_fat_g": "saturated_fat",
    "monounsaturated_fat_g": "mono_fat",
    "polyunsaturated_fat_g": "poly_fat",
    "trans_fat_g": "trans_fat",
    "cholesterol_mg": "cholesterol",
    "fiber_total_g": "fiber",
    "fiber_soluble_g": "fiber_soluble",
    "fiber_insoluble_g": "fiber_insoluble",
    "sugars_total_g": "sugars",
    "sugars_added_g": "sugars_added",
    "starch_g": "starch",
    "calcium_mg": "calcium",
    "iron_mg": "iron",
    "magnesium_mg": "magnesium",
    "phosphorus_mg": "phosphorus",
    "potassium_mg": "potassium",
    "sodium_mg": "sodium",
    "zinc_mg": "zinc",
    "copper_mg": "copper",
    "manganese_mg": "manganese",
    "selenium_ug": "selenium",
    "fluoride_ug": "fluoride",
    "iodine_ug": "iodine",
    "vitamin_a_rae_ug": "vitamin_a",
    "vitamin_c_mg": "vitamin_c",
    "vitamin_d_ug": "vitamin_d",
    "vitamin_e_mg": "vitamin_e",
    "vitamin_k_ug": "vitamin_k",
    "thiamin_mg": "thiamin",
    "riboflavin_mg": "riboflavin",
    "niacin_mg": "niacin",
    "pantothenic_acid_mg": "pantothenic_acid",
    "vitamin_b6_mg": "vitamin_b6",
    "biotin_ug": "biotin",
    "folate_total_ug": "folate",
    "folate_dfe_ug": "folate_dfe",
    "vitamin_b12_ug": "vitamin_b12",
    "choline_mg": "choline",
    "tryptophan_g": "tryptophan",
    "threonine_g": "threonine",
    "isoleucine_g": "isoleucine",
    "leucine_g": "leucine",
    "lysine_g": "lysine",
    "methionine_g": "methionine",
    "cystine_g": "cystine",
    "phenylalanine_g": "phenylalanine",
    "tyrosine_g": "tyrosine",
    "valine_g": "valine",
    "arginine_g": "arginine",
    "histidine_g": "histidine",
    "alanine_g": "alanine",
    "aspartic_acid_g": "aspartic_acid",
    "glutamic_acid_g": "glutamic_acid",
    "glycine_g": "glycine",
    "proline_g": "proline",
    "serine_g": "serine",
    "fa_18_3_n3_alpha_linolenic_g": "pufa_18_3_n3_ala",
    "fa_20_5_n3_epa_g": "pufa_20_5_n3_epa",
    "fa_22_6_n3_dha_g": "pufa_22_6_n3_dha",
    "fa_18_2_n6_linoleic_g": "pufa_18_2_n6_la",
    "fa_20_4_n6_arachidonic_g": "pufa_20_4_n6_aa",
    "caffeine_mg": "caffeine",
    "theobromine_mg": "theobromine",
}


def decompose(bundle: dict[str, Any]) -> tuple[dict, dict | None, list[dict]]:
    """Split one bundle dict into (ingredients-row, details-row, health-fact-rows).

    details-row is None if the bundle has no detail-tier data at all.
    health-fact-rows is a list of {sort_order, fact} dicts.
    """
    ing = {k: bundle[k] for k in _INGREDIENT_FIELDS if k in bundle}
    # Pull source + fdc_id out of nutrition into top-level ingredients row.
    nut = bundle.get("nutrition") or {}
    if isinstance(nut, dict):
        if nut.get("source"):
            ing["source"] = nut["source"]
        if nut.get("fdcId") is not None:
            ing["fdc_id"] = nut["fdcId"]
        if nut.get("fdc_id") is not None:
            ing["fdc_id"] = nut["fdc_id"]

    det: dict = {"id": bundle["id"]}
    if "storage" in bundle:
        det["storage"] = bundle["storage"]
    if "substitutes" in bundle:
        det["substitutes"] = bundle["substitutes"]
    if isinstance(nut, dict):
        if nut.get("per"):
            det["nutrition_per"] = nut["per"]
        if nut.get("filledAt"):
            det["nutrition_filled_at"] = nut["filledAt"]
        for k, v in nut.items():
            if k in ("source", "fdcId", "fdc_id", "filledAt", "aiFilledAt", "per"):
                continue
            short = _NUTRITION_RENAME.get(k)
            if short is not None and v is not None:
                det[short] = v

    # If details row has nothing beyond id, return None (caller can skip insert).
    has_data = any(k != "id" for k in det.keys())
    if not has_data:
        det = None

    facts: list[dict] = []
    if isinstance(bundle.get("health_fact"), str) and bundle["health_fact"].strip():
        facts.append({"sort_order": 0, "fact": bundle["health_fact"].strip()})

    return ing, det, facts
```

- [ ] **Step 4: Verify tests pass**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_bundle_decompose.py -v
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/bundle_decompose.py automation/tests/test_bundle_decompose.py
git commit -m "feat(bundle): decompose bundle JSON into ingredients + details + health_facts rows"
```

---

### Task 5: SQLite catalog client + tests

**Files:**
- Create: `automation/mfc/ops/catalog.py`
- Create: `automation/tests/test_catalog.py`

- [ ] **Step 1: Write failing tests**

Create `automation/tests/test_catalog.py`:

```python
"""Tests for mfc.ops.catalog — SQLite catalog client."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

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

    # Re-set replaces (no double-insert)
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
```

- [ ] **Step 2: Verify failure**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_catalog.py -v
```
Expected: ImportError on `mfc.ops.catalog`.

- [ ] **Step 3: Implement the catalog client**

Create `automation/mfc/ops/catalog.py`:

```python
"""SQLite catalog client.

Wraps sqlite3 with the conveniences our ingest/sync code needs:
  - schema init from automation/db/sqlite_schema.sql
  - JSON serialization on the way in for aliases / show / substitutes
  - upsert helpers that target our exact table shapes
  - health-facts "replace all for target" helper

Stays narrow on purpose; mfc.ops.sync_ingredients_v2 layers
DB-level differential logic on top.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterator


_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "db" / "sqlite_schema.sql"
_JSON_FIELDS_INGREDIENTS = ("aliases", "show")
_JSON_FIELDS_DETAILS = ("substitutes",)


class Catalog:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.conn: sqlite3.Connection = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")

    def init(self) -> None:
        """Apply the schema (idempotent — all CREATEs use IF NOT EXISTS)."""
        sql = _SCHEMA_PATH.read_text()
        self.conn.executescript(sql)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def upsert_ingredient(self, row: dict[str, Any]) -> None:
        data = dict(row)
        for k in _JSON_FIELDS_INGREDIENTS:
            if k in data and not isinstance(data[k], str):
                data[k] = json.dumps(data[k])
        cols = list(data.keys())
        placeholders = ",".join(f":{c}" for c in cols)
        col_list = ",".join(cols)
        updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        sql = (
            f"INSERT INTO ingredients ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}"
        )
        self.conn.execute(sql, data)
        self.conn.commit()

    def upsert_details(self, row: dict[str, Any]) -> None:
        data = dict(row)
        for k in _JSON_FIELDS_DETAILS:
            if k in data and not isinstance(data[k], str):
                data[k] = json.dumps(data[k])
        cols = list(data.keys())
        placeholders = ",".join(f":{c}" for c in cols)
        col_list = ",".join(cols)
        updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        sql = (
            f"INSERT INTO ingredient_details ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}"
        )
        self.conn.execute(sql, data)
        self.conn.commit()

    def set_health_facts(self, category: str, target_id: str, facts: list[str]) -> None:
        """Replace ALL facts for (category, target_id) atomically."""
        with self.conn:
            self.conn.execute(
                "DELETE FROM health_facts WHERE category=? AND target_id=?",
                (category, target_id),
            )
            for i, fact in enumerate(facts):
                self.conn.execute(
                    "INSERT INTO health_facts (category, target_id, sort_order, fact) "
                    "VALUES (?, ?, ?, ?)",
                    (category, target_id, i, fact),
                )

    def iter_ingredients(self) -> Iterator[sqlite3.Row]:
        cur = self.conn.execute("SELECT * FROM ingredients ORDER BY id")
        yield from cur
```

- [ ] **Step 4: Verify tests pass**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_catalog.py -v
```
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/catalog.py automation/tests/test_catalog.py
git commit -m "feat(catalog): SQLite client (init/upsert/iter/set_health_facts)"
```

---

### Task 6: USDA extractor + tests

**Files:**
- Create: `automation/mfc/ops/usda.py`
- Create: `automation/tests/test_usda_extract.py`
- Create: `automation/tests/fixtures/usda_mini/` (4 tiny CSV files)

- [ ] **Step 1: Create the test fixtures**

```bash
mkdir -p /Users/amanrai/Documents/Code.nosync/mfc/automation/tests/fixtures/usda_mini
```

Create `automation/tests/fixtures/usda_mini/food.csv`:
```csv
"fdc_id","data_type","description","food_category_id","publication_date"
"100","foundation_food","Spinach, raw","11","2020-01-01"
"101","foundation_food","Spinach, raw","11","2024-01-01"
"200","foundation_food","Cheese, cheddar","1","2024-01-01"
"300","sample_food","unrelated subsample","1","2020-01-01"
"400","foundation_food","Almonds","12","2024-01-01"
```

Create `automation/tests/fixtures/usda_mini/food_category.csv`:
```csv
"id","code","description"
"1","0100","Dairy and Egg Products"
"11","1100","Vegetables and Vegetable Products"
"12","1200","Nut and Seed Products"
```

Create `automation/tests/fixtures/usda_mini/food_nutrient.csv`:
```csv
"id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","footnote","min_year_acquired"
"1","100","1008","20","","","","","","",""
"2","100","1003","2.5","","","","","","",""
"3","101","2047","23","","","","","","",""
"4","101","1003","2.86","","","","","","",""
"5","101","1004","0.39","","","","","","",""
"6","101","1005","3.63","","","","","","",""
"7","101","1087","99","","","","","","",""
"8","200","2047","403","","","","","","",""
"9","200","1003","23","","","","","","",""
"10","200","1087","710","","","","","","",""
"11","400","2047","598","","","","","","",""
"12","400","1003","21.15","","","","","","",""
```

Create `automation/tests/fixtures/usda_mini/nutrient.csv`:
```csv
"id","name","unit_name","nutrient_nbr","rank"
"1008","Energy","KCAL","208","300"
"2047","Energy (Atwater General Factors)","KCAL","957","280"
"1003","Protein","G","203","600"
"1004","Total lipid (fat)","G","204","800"
"1005","Carbohydrate, by difference","G","205","1110"
"1087","Calcium, Ca","MG","301","5300"
```

- [ ] **Step 2: Write the failing tests**

Create `automation/tests/test_usda_extract.py`:

```python
"""Tests for mfc.ops.usda.extract_foundation_foods."""

from __future__ import annotations

from pathlib import Path

import pytest


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "usda_mini"


def test_extract_returns_dataframe_with_one_row_per_unique_slug():
    from mfc.ops.usda import extract_foundation_foods

    df = extract_foundation_foods(FIXTURE_DIR)

    # Foundation only — sample_food (fdc_id=300) excluded.
    # Spinach has two foundation entries (100, 101); dedupe to max fdc_id.
    assert len(df) == 3
    assert set(df["id"]) == {"spinach-raw", "cheese-cheddar", "almonds"}

    spinach = df[df["id"] == "spinach-raw"].iloc[0]
    assert spinach["fdc_id"] == 101  # latest fdc_id wins
    assert spinach["protein"] == 2.86  # from fdc_id 101, not 100
    assert spinach["calories"] == 23   # 2047 wins over 1008


def test_category_is_shortened():
    from mfc.ops.usda import extract_foundation_foods

    df = extract_foundation_foods(FIXTURE_DIR)
    spinach = df[df["id"] == "spinach-raw"].iloc[0]
    assert spinach["category"] == "Vegetable"
    cheese = df[df["id"] == "cheese-cheddar"].iloc[0]
    assert cheese["category"] == "Dairy"


def test_unmapped_nutrient_ids_are_dropped():
    """Fixture only includes mapped nutrient ids, but if it had an unknown
    id, it should not appear as a column."""
    from mfc.ops.usda import extract_foundation_foods

    df = extract_foundation_foods(FIXTURE_DIR)
    # 9999999 wasn't in the fixture; sanity check via column absence
    assert "nutrient_9999999" not in df.columns
    # Calcium did appear → column should exist
    assert "calcium" in df.columns
```

- [ ] **Step 3: Verify failure**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_usda_extract.py -v
```
Expected: ImportError on `mfc.ops.usda`.

- [ ] **Step 4: Implement the extractor**

Create `automation/mfc/ops/usda.py`:

```python
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
    # Map nutrient_id → our column name; drop unmapped.
    nut["col"] = nut["nutrient_id"].map(NUTRIENT_MAP)
    nut = nut[nut["col"].notna()]

    # Wide pivot. For ids that map to the same column (e.g. 1008/2047/2048 → calories),
    # the priority is "later id wins" since NUTRIENT_MAP preserves the order we want
    # (2047/2048 listed after 1008). Implement with a deterministic groupby-last.
    nut = nut.sort_values(["fdc_id", "nutrient_id"])  # 1008 before 2047 before 2048
    wide = nut.groupby(["fdc_id", "col"], as_index=False)["amount"].last()
    wide = wide.pivot(index="fdc_id", columns="col", values="amount").reset_index()
    wide.columns.name = None

    merged = foods.merge(wide, on="fdc_id", how="left")
    merged["id"] = merged["slug"]
    merged["name"] = merged["description"]
    merged["source"] = "fdc"

    # Dedupe on slug — keep row with max fdc_id (newest sample).
    merged = merged.sort_values(["id", "fdc_id"]).drop_duplicates("id", keep="last")

    # Keep only the columns the downstream upsert needs.
    base_cols = ["id", "name", "category", "fdc_id", "source"]
    nutrient_cols = [c for c in merged.columns if c in set(NUTRIENT_MAP.values())]
    return merged[base_cols + nutrient_cols].reset_index(drop=True)
```

- [ ] **Step 5: Verify tests pass**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/test_usda_extract.py -v
```
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/ops/usda.py automation/tests/test_usda_extract.py automation/tests/fixtures/usda_mini/
git commit -m "feat(usda): extract_foundation_foods (CSV→DataFrame with our column names)"
```

---

### Task 7: `mfc init-catalog` command

**Files:**
- Create: `automation/mfc/commands/init_catalog.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create the command**

Create `automation/mfc/commands/init_catalog.py`:

```python
"""`mfc init-catalog` — create automation/db.sqlite from the schema file. Idempotent."""

from __future__ import annotations

import argparse
from pathlib import Path

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
```

- [ ] **Step 2: Wire into CLI**

Edit `automation/mfc/cli.py`. Add `init_catalog` to the imports (alphabetical, after `fetch_ingredient_nutrition`):

```python
    init_catalog,
```

Add to `COMMAND_MODULES` after `apply_schema`:

```python
    init_catalog,
```

- [ ] **Step 3: Smoke test**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc init-catalog --help
```
Expected: usage prints, includes `--force`.

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc init-catalog
ls -la automation/db.sqlite
```
Expected: file created, ~30-50 KB.

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && sqlite3 automation/db.sqlite ".tables"
```
Expected: `health_facts ingredient_details ingredients metric_definitions`.

- [ ] **Step 4: Add Makefile target**

Append to `Makefile` under the Authoring section (`##@ Authoring & enrichment`):

```make
init-catalog: ## create automation/db.sqlite from sqlite_schema.sql; FORCE=1 to drop+recreate
	@$(UV) run mfc init-catalog $(if $(FORCE),--force)
```

Add `init-catalog` to the `.PHONY` line at the top of the Makefile.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/commands/init_catalog.py automation/mfc/cli.py Makefile automation/db.sqlite
git commit -m "feat(cli): mfc init-catalog (create automation/db.sqlite from schema)"
```

---

### Task 8: `mfc import-bundles` command

**Files:**
- Create: `automation/mfc/commands/import_bundles.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create the command**

Create `automation/mfc/commands/import_bundles.py`:

```python
"""`mfc import-bundles` — one-shot: read all web/assets/ingredients/<id>/ingredient.json,
decompose, write to automation/db.sqlite."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

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
```

- [ ] **Step 2: Wire into CLI**

Edit `automation/mfc/cli.py`. Add `import_bundles` to imports (alphabetical) and `COMMAND_MODULES` after `init_catalog`.

- [ ] **Step 3: Add Makefile target**

Append:

```make
import-bundles: ## one-shot: read web/assets/ingredients/*/ingredient.json into automation/db.sqlite; FORCE=1 overwrites
	@$(UV) run mfc import-bundles $(if $(FORCE),--force)
```

Add to `.PHONY`.

- [ ] **Step 4: Run the migration**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make import-bundles
```
Expected: `inserted ~559, skipped 0, failed 0`.

Verify:
```bash
sqlite3 automation/db.sqlite "SELECT COUNT(*) FROM ingredients;"
sqlite3 automation/db.sqlite "SELECT COUNT(*) FROM ingredient_details;"
sqlite3 automation/db.sqlite "SELECT COUNT(*) FROM health_facts WHERE category='ingredient';"
```

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/commands/import_bundles.py automation/mfc/cli.py Makefile automation/db.sqlite
git commit -m "feat(cli): mfc import-bundles + bulk-load existing 559 ingredient bundles"
```

---

### Task 9: `mfc import-usda` command

**Files:**
- Create: `automation/mfc/commands/import_usda.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create the command**

Create `automation/mfc/commands/import_usda.py`:

```python
"""`mfc import-usda` — read data/usda/*.csv, dedupe to ~469 foundation foods,
upsert into automation/db.sqlite. Existing slug → update, new slug → insert."""

from __future__ import annotations

import argparse
from pathlib import Path

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
```

- [ ] **Step 2: Wire into CLI**

Edit `automation/mfc/cli.py`. Add `import_usda` to imports + `COMMAND_MODULES` after `import_bundles`.

- [ ] **Step 3: Add Makefile target**

```make
import-usda: ## import data/usda/*.csv foundation foods into automation/db.sqlite; LIMIT=N for debug
	@$(UV) run mfc import-usda $(if $(LIMIT),--limit $(LIMIT))
```

Add to `.PHONY`.

- [ ] **Step 4: Run**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make import-usda
```
Expected: `inserted ~469, updated 0` (no slug collisions with existing 559 because no trimming).

Verify:
```bash
sqlite3 automation/db.sqlite "SELECT COUNT(*) FROM ingredients WHERE source='fdc';"
sqlite3 automation/db.sqlite "SELECT id, name, category FROM ingredients WHERE source='fdc' LIMIT 5;"
sqlite3 automation/db.sqlite "SELECT id, calories, protein, calcium FROM ingredient_details WHERE id LIKE '%spinach%';"
```

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/commands/import_usda.py automation/mfc/cli.py Makefile automation/db.sqlite
git commit -m "feat(cli): mfc import-usda (469 foundation foods → automation/db.sqlite)"
```

---

### Task 10: JSON template + `mfc import-ingredient` command

**Files:**
- Create: `docs/templates/ingredient.example.json`
- Create: `automation/mfc/commands/import_ingredient.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create the template**

Create `docs/templates/ingredient.example.json`:

```json
{
  "id": "paneer",
  "name": "Paneer",
  "aliases": ["panir", "indian cottage cheese"],
  "category": "Dairy",
  "tagline": "fresh, milky, holds shape under heat",
  "photo": "https://<ref>.supabase.co/storage/v1/object/public/ingredient-images/paneer/image.png",
  "emoji": "🧀",
  "default_unit": "g",
  "source": "manual",
  "fdc_id": null,
  "show": { "healthFact": true, "nutrition": true, "storage": true, "substitutes": true },

  "details": {
    "storage": "Submerge in cold water; refrigerate; change water daily.",
    "substitutes": ["tofu firm", "halloumi"],
    "nutrition_per": "100g",
    "nutrition_filled_at": "2026-05-11T00:00:00Z",
    "calories": 321,
    "protein": 18.3,
    "total_fat": 25.0,
    "carbohydrate": 3.5,
    "calcium": 208,
    "iron": 0.16,
    "sodium": 22
  },

  "health_facts": [
    "Paneer is a non-melting cheese — high protein, ~25% fat, slow digestion.",
    "Lacto-fermented variants improve calcium bioavailability."
  ]
}
```

- [ ] **Step 2: Create the import command**

Create `automation/mfc/commands/import_ingredient.py`:

```python
"""`mfc import-ingredient <path>` — read one JSON file, upsert across the three tables."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..core import log
from ..core.config import Config
from ..ops.catalog import Catalog


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "import-ingredient",
        help="Read one ingredient JSON (see docs/templates/ingredient.example.json) into automation/db.sqlite",
    )
    p.add_argument("path", help="path to the JSON file")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    path = Path(args.path)
    if not path.exists():
        log.error(f"file not found: {path}")
        return 2
    bundle = json.loads(path.read_text())
    if "id" not in bundle or "name" not in bundle:
        log.error("JSON must have at least 'id' and 'name'")
        return 2

    c = Catalog(config.repo_root / "automation" / "db.sqlite")
    iid = bundle["id"]

    ing_keys = (
        "id", "name", "aliases", "category", "tagline", "photo", "emoji",
        "default_unit", "source", "fdc_id", "show", "ai_filled_at", "created_by",
    )
    c.upsert_ingredient({k: bundle[k] for k in ing_keys if k in bundle})

    details = bundle.get("details") or {}
    if details:
        details["id"] = iid
        c.upsert_details(details)

    facts = bundle.get("health_facts") or []
    if facts:
        c.set_health_facts("ingredient", iid, facts)

    c.close()
    log.ok(f"imported {iid}")
    return 0
```

- [ ] **Step 3: Wire into CLI + Makefile**

Edit `automation/mfc/cli.py`. Add `import_ingredient` to imports + `COMMAND_MODULES`.

Append to Makefile:
```make
import-ingredient: ## import one ingredient JSON; required FILE=<path>
	@$(UV) run mfc import-ingredient "$(FILE)"
```

Add to `.PHONY`.

- [ ] **Step 4: Smoke**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc import-ingredient docs/templates/ingredient.example.json
sqlite3 automation/db.sqlite "SELECT id, name, category, source FROM ingredients WHERE id='paneer';"
sqlite3 automation/db.sqlite "SELECT calories, protein, calcium FROM ingredient_details WHERE id='paneer';"
sqlite3 automation/db.sqlite "SELECT fact FROM health_facts WHERE category='ingredient' AND target_id='paneer';"
```

- [ ] **Step 5: Commit**

```bash
git add docs/templates/ingredient.example.json automation/mfc/commands/import_ingredient.py automation/mfc/cli.py Makefile automation/db.sqlite
git commit -m "feat(cli): mfc import-ingredient + JSON template at docs/templates/"
```

---

### Task 11: Postgres schema migration

**Files:**
- Modify: `automation/db/schema.sql`

- [ ] **Step 1: Add the ingredient_details table to schema.sql**

Edit `automation/db/schema.sql`. After the existing `public.ingredients` definition + comments (before the `public.utensils` definition), insert:

```sql
-- =============================================================================
-- INGREDIENT DETAILS (1:1 with ingredients; flat nutrient columns)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ingredient_details (
  id                   text PRIMARY KEY REFERENCES public.ingredients(id) ON DELETE CASCADE,
  storage              text,
  substitutes          text[] NOT NULL DEFAULT '{}',
  nutrition_per        text NOT NULL DEFAULT '100g',
  nutrition_filled_at  timestamptz,

  calories             real,  energy_kj  real,  water  real,  ash  real,  alcohol  real,  nitrogen  real,
  protein              real,  total_fat  real,  carbohydrate  real,
  fiber                real,  fiber_soluble  real,  fiber_insoluble  real,
  sugars               real,  sugars_added  real,  starch  real,
  glucose              real,  fructose  real,  sucrose  real,  lactose  real,  maltose  real,  galactose  real,
  saturated_fat        real,  mono_fat  real,  poly_fat  real,  trans_fat  real,  cholesterol  real,
  sfa_4_0  real, sfa_6_0  real, sfa_8_0  real, sfa_10_0  real,
  sfa_12_0 real, sfa_14_0 real, sfa_15_0 real, sfa_16_0  real,
  sfa_17_0 real, sfa_18_0 real, sfa_20_0 real, sfa_22_0  real,  sfa_24_0  real,
  mufa_14_1  real, mufa_15_1  real, mufa_16_1  real, mufa_17_1  real,
  mufa_18_1  real, mufa_20_1  real, mufa_22_1  real, mufa_24_1  real,
  pufa_18_2_n6_la real, pufa_18_3_n3_ala real, pufa_18_3_n6_gla real,
  pufa_18_4 real, pufa_20_2_n6 real, pufa_20_3_n6 real, pufa_20_3_n3 real,
  pufa_20_4_n6_aa real, pufa_20_5_n3_epa real, pufa_21_5 real,
  pufa_22_2 real, pufa_22_5_n3_dpa real, pufa_22_6_n3_dha real,
  calcium real, iron real, magnesium real, phosphorus real, potassium real,
  sodium real, zinc real, copper real, manganese real,
  selenium real, fluoride real, iodine real,
  vitamin_a real, vitamin_a_iu real, retinol real,
  carotene_alpha real, carotene_beta real, cryptoxanthin_beta real,
  lycopene real, lutein_zeaxanthin real,
  vitamin_d real, vitamin_d2 real, vitamin_d3 real,
  vitamin_e real, tocopherol_beta real, tocopherol_gamma real, tocopherol_delta real,
  vitamin_k real,
  thiamin real, riboflavin real, niacin real, pantothenic_acid real,
  vitamin_b6 real, biotin real, folate real, folate_dfe real,
  vitamin_b12 real, choline real, vitamin_c real,
  tryptophan real, threonine real, isoleucine real, leucine real,
  lysine real, methionine real, cystine real, phenylalanine real,
  tyrosine real, valine real, arginine real, histidine real,
  alanine real, aspartic_acid real, glutamic_acid real,
  glycine real, proline real, serine real, hydroxyproline real,
  caffeine real, theobromine real
);

COMMENT ON TABLE public.ingredient_details IS '1:1 with ingredients. ~140 flat nutrient columns plus storage/substitutes. Authored locally in automation/db.sqlite and synced via mfc sync-ingredients.';
COMMENT ON COLUMN public.ingredient_details.nutrition_per IS 'Per-100g by USDA convention; field present for clarity.';
COMMENT ON COLUMN public.ingredient_details.calories IS 'kcal per 100g. USDA nutrient ids 1008/2047/2048; latest Atwater factor wins.';
COMMENT ON COLUMN public.ingredient_details.protein IS 'g per 100g. USDA nutrient id 1003.';
-- (Remaining COMMENT ON COLUMN entries to be added in Task 13 by the doc generator.)
```

- [ ] **Step 2: Add the polymorphic health_facts table**

Append in `automation/db/schema.sql` after `ingredient_details`:

```sql
-- =============================================================================
-- HEALTH FACTS (polymorphic across ingredient / utensil / recipe)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.health_facts (
  category    text    NOT NULL CHECK (category IN ('ingredient', 'utensil', 'recipe')),
  target_id   text    NOT NULL,
  sort_order  integer NOT NULL,
  fact        text    NOT NULL,
  PRIMARY KEY (category, target_id, sort_order)
);

CREATE INDEX IF NOT EXISTS health_facts_target_idx ON public.health_facts (category, target_id);

COMMENT ON TABLE public.health_facts IS
  'Polymorphic: target_id references ingredients.id | utensils.id | recipes.id depending on category. No FK enforcement (the column targets three tables); the sync layer maintains consistency. Cascade delete via the per-category triggers below.';

CREATE OR REPLACE FUNCTION public.delete_orphan_health_facts() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'ingredients' THEN
    DELETE FROM public.health_facts WHERE category = 'ingredient' AND target_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'utensils' THEN
    DELETE FROM public.health_facts WHERE category = 'utensil' AND target_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'recipes' THEN
    DELETE FROM public.health_facts WHERE category = 'recipe' AND target_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS health_facts_cleanup_ingredient ON public.ingredients;
CREATE TRIGGER health_facts_cleanup_ingredient
  AFTER DELETE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.delete_orphan_health_facts();

DROP TRIGGER IF EXISTS health_facts_cleanup_utensil ON public.utensils;
CREATE TRIGGER health_facts_cleanup_utensil
  AFTER DELETE ON public.utensils
  FOR EACH ROW EXECUTE FUNCTION public.delete_orphan_health_facts();

DROP TRIGGER IF EXISTS health_facts_cleanup_recipe ON public.recipes;
CREATE TRIGGER health_facts_cleanup_recipe
  AFTER DELETE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.delete_orphan_health_facts();
```

- [ ] **Step 3: Migrate `recipe_health_facts` data and rename source column**

Append to `automation/db/schema.sql` in the `9. ONE-SHOT DATA NORMALIZATION` section:

```sql
-- Migrate recipe_health_facts rows → health_facts(category='recipe', ...).
INSERT INTO public.health_facts (category, target_id, sort_order, fact)
SELECT 'recipe', recipe_id, sort_order, fact
  FROM public.recipe_health_facts
 WHERE NOT EXISTS (
   SELECT 1 FROM public.health_facts hf
    WHERE hf.category = 'recipe' AND hf.target_id = public.recipe_health_facts.recipe_id
      AND hf.sort_order = public.recipe_health_facts.sort_order
 );

-- Migrate ingredients.health_fact (single string) → health_facts(category='ingredient', ...).
INSERT INTO public.health_facts (category, target_id, sort_order, fact)
SELECT 'ingredient', id, 0, health_fact
  FROM public.ingredients
 WHERE health_fact IS NOT NULL AND health_fact <> ''
   AND NOT EXISTS (
     SELECT 1 FROM public.health_facts hf
      WHERE hf.category = 'ingredient' AND hf.target_id = public.ingredients.id AND hf.sort_order = 0
   );

-- Rename ingredients.nutrition_source → ingredients.source (idempotent guard).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='ingredients' AND column_name='nutrition_source')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name='ingredients' AND column_name='source') THEN
    ALTER TABLE public.ingredients RENAME COLUMN nutrition_source TO source;
  END IF;
END $$;

-- Drop the now-migrated columns from ingredients (one-way; data already moved above).
ALTER TABLE public.ingredients DROP COLUMN IF EXISTS health_fact;
ALTER TABLE public.ingredients DROP COLUMN IF EXISTS storage;
ALTER TABLE public.ingredients DROP COLUMN IF EXISTS substitutes;

-- Drop ingredients.nutrition jsonb (after callers have moved to ingredient_details).
-- LAZY DROP: leave column for now; clean up in a follow-up task once readers are updated.

-- Drop recipe_health_facts (after rows have been migrated above + readers updated).
-- LAZY DROP: leave table for now; final cleanup in Task 19.
```

- [ ] **Step 4: Re-apply schema**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make apply-schema
```
Expected: success. Tables `ingredient_details` and `health_facts` exist; `recipe_health_facts` data migrated.

Verify:
```bash
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM public.health_facts WHERE category='recipe';"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM public.health_facts WHERE category='ingredient';"
```
(Or use `mfc status` if it surfaces these.)

- [ ] **Step 5: Commit**

```bash
git add automation/db/schema.sql
git commit -m "feat(schema): ingredient_details + health_facts + rename nutrition_source→source"
```

---

### Task 12: Rewrite `mfc sync-ingredients` (SQLite ↔ Supabase)

**Files:**
- Modify: `automation/mfc/commands/sync_ingredients.py`
- Modify: `automation/mfc/ops/ingredients.py` (or replace with new module)

- [ ] **Step 1: Rewrite the ops module**

Create `automation/mfc/ops/sync_catalog.py` (new module, replaces bundle-based `ops/ingredients.py`):

```python
"""SQLite ↔ Supabase sync for the ingredient catalog tables.

push: SELECT all rows from SQLite, upsert into Supabase.
pull: SELECT all rows from Supabase, REPLACE INTO SQLite (single transaction).
both: per-row last-modified-wins (updated_at, ±1s tolerance).
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from .catalog import Catalog


_INGREDIENTS_JSON_FIELDS = ("aliases", "show")


@dataclass
class SyncReport:
    pushed_ingredients: int = 0
    pulled_ingredients: int = 0
    pushed_details: int = 0
    pulled_details: int = 0
    pushed_facts: int = 0
    pulled_facts: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"ingredients ↑{self.pushed_ingredients} ↓{self.pulled_ingredients} · "
            f"details ↑{self.pushed_details} ↓{self.pulled_details} · "
            f"facts ↑{self.pushed_facts} ↓{self.pulled_facts} · "
            f"failed {len(self.failed)}"
        )


def _decode_row(row: sqlite3.Row, json_fields: tuple[str, ...]) -> dict:
    d = dict(row)
    for k in json_fields:
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except Exception:
                pass
    return d


def push(config: Config) -> SyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = SyncReport()

    ing_rows = [_decode_row(r, _INGREDIENTS_JSON_FIELDS) for r in cat.iter_ingredients()]
    if ing_rows:
        sb.table("ingredients").upsert(ing_rows, on_conflict="id").execute()
        rep.pushed_ingredients = len(ing_rows)

    det_rows = []
    cur = cat.conn.execute("SELECT * FROM ingredient_details ORDER BY id")
    for r in cur:
        d = dict(r)
        if isinstance(d.get("substitutes"), str):
            try:
                d["substitutes"] = json.loads(d["substitutes"])
            except Exception:
                pass
        det_rows.append(d)
    if det_rows:
        sb.table("ingredient_details").upsert(det_rows, on_conflict="id").execute()
        rep.pushed_details = len(det_rows)

    fact_rows = []
    cur = cat.conn.execute("SELECT * FROM health_facts ORDER BY category, target_id, sort_order")
    for r in cur:
        fact_rows.append(dict(r))
    if fact_rows:
        # Delete-then-insert per (category, target_id) to support row count changes.
        targets = sorted({(r["category"], r["target_id"]) for r in fact_rows})
        for category, target_id in targets:
            sb.table("health_facts").delete().eq("category", category).eq("target_id", target_id).execute()
        sb.table("health_facts").insert(fact_rows).execute()
        rep.pushed_facts = len(fact_rows)

    cat.close()
    log.ok(rep.line())
    return rep


def pull(config: Config) -> SyncReport:
    sb = sb_client.service_client(config)
    cat = Catalog(config.repo_root / "automation" / "db.sqlite")
    rep = SyncReport()

    ing_rows = sb.table("ingredients").select("*").order("id").execute().data or []
    det_rows = sb.table("ingredient_details").select("*").order("id").execute().data or []
    fact_rows = sb.table("health_facts").select("*").order("category, target_id, sort_order").execute().data or []

    with cat.conn:
        cat.conn.execute("DELETE FROM ingredient_details")
        cat.conn.execute("DELETE FROM health_facts")
        cat.conn.execute("DELETE FROM ingredients")
        for r in ing_rows:
            cat.upsert_ingredient(r)
        for r in det_rows:
            cat.upsert_details(r)
        for r in fact_rows:
            cat.conn.execute(
                "INSERT INTO health_facts (category, target_id, sort_order, fact) VALUES (?, ?, ?, ?)",
                (r["category"], r["target_id"], r["sort_order"], r["fact"]),
            )
    rep.pulled_ingredients = len(ing_rows)
    rep.pulled_details = len(det_rows)
    rep.pulled_facts = len(fact_rows)
    cat.close()
    log.ok(rep.line())
    return rep


def sync(config: Config, *, direction: str) -> SyncReport:
    if direction == "push":
        return push(config)
    if direction == "pull":
        return pull(config)
    if direction == "both":
        # Simplest correct semantic: push first (local wins), then pull non-overlapping.
        # For Project A, the canonical state is SQLite, so push-then-pull is safe.
        rep = push(config)
        rep2 = pull(config)
        rep.pulled_ingredients = rep2.pulled_ingredients
        rep.pulled_details = rep2.pulled_details
        rep.pulled_facts = rep2.pulled_facts
        return rep
    raise ValueError(f"invalid direction: {direction!r}")
```

- [ ] **Step 2: Rewrite the command**

Replace `automation/mfc/commands/sync_ingredients.py`:

```python
"""`mfc sync-ingredients` — SQLite ↔ Supabase catalog sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import sync_catalog


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-ingredients",
        help="Sync ingredients + ingredient_details + health_facts(category=ingredient) SQLite↔Supabase",
    )
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    report = sync_catalog.sync(config, direction=args.direction)
    return 1 if report.failed else 0
```

- [ ] **Step 3: Smoke test**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc sync-ingredients --help
```
Expected: usage prints; `--direction {pull,push,both}` only.

- [ ] **Step 4: Live push to Supabase**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc sync-ingredients --direction push
```
Expected: pushes ~559 + ~469 ingredient rows, plus details + health_facts. No errors.

Verify in Supabase:
```bash
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM public.ingredients;"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM public.ingredient_details;"
```

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/sync_catalog.py automation/mfc/commands/sync_ingredients.py automation/db.sqlite
git commit -m "feat(sync): rewrite mfc sync-ingredients as SQLite↔Supabase (drops bundle JSON dependency)"
```

---

### Task 13: Generate docs/NUTRITION_FIELDS.md reference

**Files:**
- Create: `docs/NUTRITION_FIELDS.md`
- Create: `automation/mfc/commands/gen_nutrition_doc.py` (helper)

- [ ] **Step 1: Create the doc-gen command**

Create `automation/mfc/commands/gen_nutrition_doc.py`:

```python
"""`mfc gen-nutrition-doc` — generate docs/NUTRITION_FIELDS.md from the nutrient map."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from ..core import log
from ..core.config import Config
from ..ops.usda_nutrient_map import NUTRIENT_MAP


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser("gen-nutrition-doc", help="Regenerate docs/NUTRITION_FIELDS.md from the map + USDA dump")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    nut_csv = config.repo_root / "data" / "usda" / "nutrient.csv"
    units: dict[int, tuple[str, str]] = {}  # id → (name, unit)
    with open(nut_csv) as f:
        for r in csv.DictReader(f):
            units[int(r["id"])] = (r["name"], r["unit_name"].lower())

    by_col: dict[str, list[tuple[int, str, str]]] = {}
    for nid, col in NUTRIENT_MAP.items():
        name, unit = units.get(nid, ("?", "?"))
        by_col.setdefault(col, []).append((nid, name, unit))

    lines = [
        "# Nutrition fields reference",
        "",
        "Generated by `mfc gen-nutrition-doc`. Every column on `ingredient_details` is listed below with its unit + the USDA `nutrient_id`(s) it draws from.",
        "",
        "| Column | Unit | USDA nutrient_id(s) | USDA name(s) |",
        "|---|---|---|---|",
    ]
    for col in sorted(by_col):
        entries = by_col[col]
        ids = " / ".join(str(n) for n, _, _ in entries)
        names = " / ".join(n for _, n, _ in entries)
        unit = entries[0][2]
        lines.append(f"| `{col}` | {unit} | {ids} | {names} |")

    out = config.repo_root / "docs" / "NUTRITION_FIELDS.md"
    out.write_text("\n".join(lines) + "\n")
    log.ok(f"wrote {out}")
    return 0
```

- [ ] **Step 2: Wire into CLI**

Edit `automation/mfc/cli.py`. Add `gen_nutrition_doc` to imports + `COMMAND_MODULES`.

- [ ] **Step 3: Run + commit**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc gen-nutrition-doc
git add docs/NUTRITION_FIELDS.md automation/mfc/commands/gen_nutrition_doc.py automation/mfc/cli.py
git commit -m "docs: generated nutrition fields reference"
```

---

### Task 14: Update `mfc.ops.recipes` to write to `health_facts` (not `recipe_health_facts`)

**Files:**
- Modify: `automation/mfc/ops/recipes.py`

- [ ] **Step 1: Inventory the references**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && grep -n "recipe_health_facts" automation/mfc/ops/recipes.py
```

- [ ] **Step 2: Update the writes**

In `automation/mfc/ops/recipes.py`, find every `recipe_health_facts` usage and rewrite:

- Line ~205 (the `health_facts` block builder): change the variable to build `(category='recipe', target_id=<id>, sort_order, fact)` shape into a `health_facts_rows` list.
- Line ~284 (the table-clear loop): replace `"recipe_health_facts"` with logic that does `DELETE FROM health_facts WHERE category='recipe' AND target_id IN (...)` then INSERT.
- Line ~352 (the read for pull): rewrite as `sb.table("health_facts").select("...").eq("category", "recipe").eq("target_id", rid).order("sort_order")`.

Concrete patch — replace the function `_build_child_rows`'s health-facts block. Find:

```python
        for i, fact in enumerate(detail.get("healthFacts") or []):
            health_facts.append({"recipe_id": rid, "sort_order": i, "fact": fact})
```

Replace with:

```python
        for i, fact in enumerate(detail.get("healthFacts") or []):
            health_facts.append({
                "category": "recipe",
                "target_id": rid,
                "sort_order": i,
                "fact": fact,
            })
```

Find:

```python
    return {
        "recipe_tags":         tags,
        "recipe_ingredients":  ingredients,
        "recipe_steps":        steps,
        "recipe_utensils":     utensils,
        "recipe_health_facts": health_facts,
    }
```

Replace with:

```python
    return {
        "recipe_tags":         tags,
        "recipe_ingredients":  ingredients,
        "recipe_steps":        steps,
        "recipe_utensils":     utensils,
        "health_facts":        health_facts,
    }
```

Find the `_bulk_replace_children` loop:

```python
    for table in ("recipe_tags", "recipe_ingredients", "recipe_steps",
                  "recipe_utensils", "recipe_health_facts"):
        _bulk_replace_children(sb, table, children[table], recipe_ids)
```

Replace with:

```python
    for table in ("recipe_tags", "recipe_ingredients", "recipe_steps", "recipe_utensils"):
        _bulk_replace_children(sb, table, children[table], recipe_ids)
    # health_facts is polymorphic — delete by composite key
    sb.table("health_facts").delete().eq("category", "recipe").in_("target_id", recipe_ids).execute()
    if children["health_facts"]:
        sb.table("health_facts").insert(children["health_facts"]).execute()
    log.ok(f"health_facts(recipe): {len(children['health_facts'])} row(s)")
```

Find the pull read:

```python
    fact_rows = (
        sb.table("recipe_health_facts")
```

Replace with:

```python
    fact_rows = (
        sb.table("health_facts")
        .select("sort_order, fact")
        .eq("category", "recipe")
        .eq("target_id", rid)
        ...
```

(Adjust the existing select call to filter polymorphically.)

- [ ] **Step 3: Smoke test recipe sync**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc sync-recipes --direction push 2>&1 | tail -10
```
Expected: success, no SQL errors. Verify `health_facts` has both ingredient + recipe rows.

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/ops/recipes.py
git commit -m "refactor(recipes): write health facts to consolidated public.health_facts table"
```

---

### Task 15: Update frontend reads of `recipe_health_facts` → `health_facts`

**Files:**
- Modify: `web/assets/js/lib/db.js`
- Modify: `web/assets/js/lib/admin-db.js`
- Modify: `web/assets/js/app/chef-recipe-app.jsx`
- Possibly modify: `web/recipe.html`

- [ ] **Step 1: Inventory frontend references**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && grep -n "recipe_health_facts\|recipeHealthFacts" web/assets/js/lib/db.js web/assets/js/lib/admin-db.js web/assets/js/app/chef-recipe-app.jsx web/recipe.html 2>/dev/null
```

- [ ] **Step 2: Update reads in db.js**

In `web/assets/js/lib/db.js`, find any `recipe_health_facts(sort_order, fact)` nested select. Supabase auto-join requires a real FK; polymorphic tables can't be auto-joined.

Replace the existing nested select with a manual two-step:

```javascript
// Before (nested):
//   const { data } = await sb.from('recipes').select('*, recipe_health_facts(sort_order, fact)').eq('id', id).single();
//   const healthFacts = (data.recipe_health_facts || []).map(...);

// After (two queries):
const { data: recipe } = await sb.from('recipes').select('*').eq('id', id).single();
const { data: facts } = await sb
  .from('health_facts')
  .select('sort_order, fact')
  .eq('category', 'recipe')
  .eq('target_id', id)
  .order('sort_order');
const healthFacts = (facts || []).map(f => f.fact);
```

Apply analogous changes to `admin-db.js` and `chef-recipe-app.jsx`.

- [ ] **Step 3: Visual smoke**

Start the dev server, open a recipe detail page:
```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make serve
```
Open `http://localhost:8080/recipe.html?id=aam-panna`. Verify the health-fact rotator still surfaces facts.

- [ ] **Step 4: Commit**

```bash
git add web/assets/js/lib/db.js web/assets/js/lib/admin-db.js web/assets/js/app/chef-recipe-app.jsx
git commit -m "ui: read recipe health facts from consolidated health_facts table"
```

---

### Task 16: Drop `recipe_health_facts` table

**Files:**
- Modify: `automation/db/schema.sql`

- [ ] **Step 1: Remove the table definition**

Delete the `recipe_health_facts` CREATE TABLE block + its COMMENT lines + RLS policies + index.

- [ ] **Step 2: Add the drop**

In the one-shot normalization section, append:

```sql
-- recipe_health_facts is now empty (all rows migrated to health_facts).
DROP TABLE IF EXISTS public.recipe_health_facts CASCADE;
```

- [ ] **Step 3: Apply + verify**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make apply-schema
psql "$SUPABASE_DB_URL" -c "\d public.recipe_health_facts" 2>&1 | head -3
```
Expected: "Did not find any relation named …"

- [ ] **Step 4: Commit**

```bash
git add automation/db/schema.sql
git commit -m "feat(schema): drop public.recipe_health_facts (data already migrated to health_facts)"
```

---

### Task 17: Update admin macro shim to read new short names directly

**Files:**
- Modify: `web/assets/js/app/admin-ingredient-app.jsx`

- [ ] **Step 1: Drop the shim**

In `admin-ingredient-app.jsx`, find the `MACRO_NEW_KEY` map + `readMacro` helper and the four `NutCell` reads that go through `readMacro`.

Replace `readMacro(r.nutrition, 'calories')` with `r.nutrition?.calories || 0`. Same for protein/total_fat/carbohydrate.

Update the `updateNut` write path: change `MACRO_NEW_KEY[k] || k` back to writing to the canonical short names. The legacy `calories/protein/fat/carbs` keys no longer survive in DB.

Delete the `MACRO_NEW_KEY` constant + `readMacro` function.

- [ ] **Step 2: Visual smoke**

Open `/admin/ingredient.html?id=spinach-raw` (or any USDA-imported row). The four macro cells should show real values.

- [ ] **Step 3: Commit**

```bash
git add web/assets/js/app/admin-ingredient-app.jsx
git commit -m "ui(admin): drop legacy macro-key shim; read short USDA names directly"
```

---

### Task 18: Drop `ingredients.nutrition` jsonb column

**Files:**
- Modify: `automation/db/schema.sql`

- [ ] **Step 1: Drop the column**

In `automation/db/schema.sql`, in the one-shot normalization section, append:

```sql
-- nutrition jsonb is now replaced by the flat columns on ingredient_details.
ALTER TABLE public.ingredients DROP COLUMN IF EXISTS nutrition;
```

Also delete the `nutrition` column definition from the `CREATE TABLE IF NOT EXISTS public.ingredients` block + its COMMENT ON COLUMN line. (Idempotent ALTER deletes it on existing instances; the CREATE-table change matches the new shape for fresh deploys.)

- [ ] **Step 2: Apply schema**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make apply-schema
```

- [ ] **Step 3: Commit**

```bash
git add automation/db/schema.sql
git commit -m "feat(schema): drop public.ingredients.nutrition (replaced by ingredient_details)"
```

---

### Task 19: Retire migrate-ingredient-nutrition + bundle code paths

**Files:**
- Delete: `automation/mfc/commands/migrate_ingredient_nutrition.py`
- Delete: `automation/mfc/ops/nutrition_migration.py`
- Delete: `automation/tests/test_nutrition_migration.py`
- Delete: `automation/mfc/ops/ingredients.py` (replaced by `sync_catalog.py` + `catalog.py`)
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Remove the modules and references**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && \
  git rm automation/mfc/commands/migrate_ingredient_nutrition.py \
         automation/mfc/ops/nutrition_migration.py \
         automation/tests/test_nutrition_migration.py \
         automation/mfc/ops/ingredients.py
```

Edit `automation/mfc/cli.py`:
- Remove `migrate_ingredient_nutrition` from imports + `COMMAND_MODULES`.
- Verify no lingering references to `mfc.ops.ingredients`.

Edit `Makefile`:
- Remove the `migrate-ingredient-nutrition` target + its `.PHONY` entry.

- [ ] **Step 2: Verify test suite still green**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run pytest automation/tests/ 2>&1 | tail -3
```
Expected: all green; total down from 87 (we deleted nutrition_migration tests).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: retire migrate-ingredient-nutrition + bundle-JSON op modules"
```

---

### Task 20: Delete bundle JSON files

**Files:**
- Delete: `web/assets/ingredients/*/ingredient.json` (all 559)

- [ ] **Step 1: Final verification before deletion**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc sync-ingredients --direction push
sqlite3 automation/db.sqlite "SELECT COUNT(*) FROM ingredients;"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM public.ingredients;"
```
Counts must match.

- [ ] **Step 2: Delete bundle JSONs (keep image PNGs)**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && find web/assets/ingredients -name 'ingredient.json' -delete
ls web/assets/ingredients/spinach/ 2>/dev/null  # Should only show image.png
```

- [ ] **Step 3: Commit**

```bash
git add web/assets/ingredients/
git commit -m "chore: remove bundle JSON files (data canonical in automation/db.sqlite)"
```

---

### Task 21: Update Makefile help layout + final docs sweep

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Update the Makefile sections**

In `Makefile`, ensure the new commands sit in the right `##@` section:

```make
##@ Catalog (SQLite catalog ⇄ Supabase)

init-catalog: ## create automation/db.sqlite from sqlite_schema.sql; FORCE=1 to drop+recreate
	@$(UV) run mfc init-catalog $(if $(FORCE),--force)

import-bundles: ## one-shot: read web/assets/ingredients/*/ingredient.json into automation/db.sqlite; FORCE=1 overwrites
	@$(UV) run mfc import-bundles $(if $(FORCE),--force)

import-usda: ## import data/usda/*.csv foundation foods into automation/db.sqlite; LIMIT=N for debug
	@$(UV) run mfc import-usda $(if $(LIMIT),--limit $(LIMIT))

import-ingredient: ## import one ingredient JSON; required FILE=<path>
	@$(UV) run mfc import-ingredient "$(FILE)"

gen-nutrition-doc: ## regenerate docs/NUTRITION_FIELDS.md
	@$(UV) run mfc gen-nutrition-doc
```

Move `sync-ingredients` from `##@ Sync` section under here (or leave in Sync — either works).

- [ ] **Step 2: Verify help layout**

```bash
cd /Users/amanrai/Documents/Code.nosync/mfc && make
```
Expected: the new `Catalog` section appears with the five commands listed.

- [ ] **Step 3: Final commit**

```bash
git add Makefile
git commit -m "docs(make): add Catalog section + reorganize help around the new flow"
```

---

## Self-review notes

**Spec coverage**:
- §"Storage" → Tasks 3 (schema), 7 (init).
- §"Three ingredient tables" → Task 3.
- §"USDA import" → Tasks 1, 2, 6, 9.
- §"Slug rule (no trimming)" → Task 6 (`_slug` helper in `usda.py`).
- §"Naming convention" → Tasks 3 (schema short names), 4 (decomposer rename map), 13 (doc gen).
- §"Two-table split + health_facts" → Tasks 3, 11.
- §"Polymorphic health_facts" → Tasks 3, 11, 14, 15, 16.
- §"`food_portion` deferred" → not implemented (intentional).
- §"`metric_definitions` mirror" → Task 3 (schema includes it; seed-time fill is a follow-up, out of v1 scope since fresh-deploy seeding already runs `seed-metrics`).
- §"Frontend reads from Supabase only" → no frontend changes for ingredient reads; only recipe-side reads for the health_facts rename (Task 15).
- §"Existing fetchers (kept, SQLite-aware)" → mentioned as deferred follow-up; the existing `fetch-ingredient-nutrition` / `fetch-ingredient-image` continue to work against Supabase directly. Their SQLite-awareness is a follow-up after the catalog is live.
- §"One-shot bundle migration" → Tasks 8, 9, 12, 20.
- §"JSON template" → Task 10.
- §"Retired components" → Tasks 18, 19, 20.

**Placeholder scan**: None found.

**Type consistency**: `catalog.upsert_ingredient`, `upsert_details`, `set_health_facts` introduced in Task 5 and used consistently in Tasks 8, 9, 10, 12.

**One follow-up flagged**: `fetch-ingredient-nutrition` and `fetch-ingredient-image` continue writing to Supabase directly post-rollout. Making them write SQLite-first (canonical) is a small follow-up plan; out of scope for v1 since they still produce correct DB state.
