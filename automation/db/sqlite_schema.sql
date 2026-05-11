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

-- --------------------------------------------------------------------
-- utensils — list-page-friendly utensil library
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS utensils (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    tagline             TEXT,
    category            TEXT,
    photo               TEXT,
    care_tip            TEXT,
    specs               TEXT NOT NULL DEFAULT '{}',
    show                TEXT NOT NULL DEFAULT '{"careTip":true,"specs":false}',
    ai_filled_at        TEXT,
    amazon_asin         TEXT,
    amazon_marketplace  TEXT,
    amazon_fetched_at   TEXT,
    created_by          TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS utensils_category_idx ON utensils (category);

-- --------------------------------------------------------------------
-- utensil_buy_links — 0..N retailer links per utensil (Amazon, etc.)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS utensil_buy_links (
    utensil_id     TEXT NOT NULL REFERENCES utensils(id) ON DELETE CASCADE,
    sort_order     INTEGER NOT NULL,
    store          TEXT,
    url            TEXT,
    price          TEXT,
    affiliate_tag  TEXT,
    PRIMARY KEY (utensil_id, sort_order)
);
