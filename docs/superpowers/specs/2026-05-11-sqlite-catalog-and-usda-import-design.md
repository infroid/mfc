# SQLite catalog + USDA Foundation Foods import — design

- **Date**: 2026-05-11
- **Status**: design (pre-implementation)
- **Owner**: Aman
- **Project**: A (of A/B/C; B = utensils, C = recipes — both deferred)

## Summary

Replace the bundle-JSON-per-ingredient storage model with a single local SQLite catalog (`automation/db.sqlite`) committed to git. Bulk-import the USDA FoodData Central Foundation Foods CSV dump (~469 high-quality, fully-nutritioned foods) into that catalog using pandas. Split the wide `ingredients` row into a list-friendly main table + a 1:1 details table + a unified `health_facts` table that serves all of ingredients, utensils, and recipes. Retire the per-row FDC API fetcher's bundle layer; rewrite `mfc sync-ingredients` to move data SQLite ↔ Supabase. Keep a sample JSON template + importer for ad-hoc human authoring. Image bytes stay file-based.

After Project A: utensil and recipe bundle JSONs still exist; their conversion to the SQLite model is Projects B and C respectively. The `health_facts` consolidation IS done now (one table, three categories), because the table rename can't be split cleanly.

## Decisions

| # | Question | Choice |
|---|---|---|
| 1 | Storage location | `automation/db.sqlite`, git-committed binary |
| 2 | Schema authoring | Mirror Supabase manually; SQLite schema lives at `automation/db/sqlite_schema.sql` |
| 3 | Existing-row preservation | One-shot bundle migration loads all 559 first, then USDA overlays. Slug match → update; no match → insert |
| 4 | USDA slug rule | `slug(usda.description)` verbatim — no trimming |
| 5 | Naming convention | Drop unit suffixes (`calories` / `protein` / `iron`); units documented in column comment + `docs/NUTRITION_FIELDS.md` |
| 6 | Nutrition columns | Flat ~180 REAL columns on `ingredient_details`, NOT JSONB |
| 7 | Ingredient row split | 3 tables: `ingredients` (list page, narrow), `ingredient_details` (1:1, wide), `ingredient_health_facts` rows in shared `health_facts` table |
| 8 | health_facts shape | Single table, polymorphic via `(category, target_id, sort_order, fact)` PK. No DB-level FK on `target_id` |
| 9 | `food_category` shortening | Yes — verbose USDA names → short app-friendly labels |
| 10 | `food_portion` import | Deferred (25% USDA coverage; app standardizes to g/ml anyway) |
| 11 | `metric_definitions` mirror | Include in SQLite now (small reference table; needed for fresh-deploy) |
| 12 | Existing fetchers | Keep `fetch-ingredient-nutrition` and `fetch-ingredient-image`; port both to SQLite |
| 13 | Frontend changes | None — frontend continues to read from Supabase |

## Non-goals

- Utensils → SQLite (Project B).
- Recipes (catalog + child tables) → SQLite (Project C).
- USDA `food_portion` / `measure_unit` import.
- USDA non-foundation rows (Survey, Branded, sub-samples).
- Admin UI editor for the new wide nutrition schema (existing form keeps working with the flat shape; richer per-nutrient editing comes when needed).
- A general migration framework. We hand-translate the schema once; future changes are hand-applied to both `schema.sql` (Postgres) and `sqlite_schema.sql`.

## Architecture

### Data flow

```
   USDA CSVs                       SQLite catalog              Supabase (Postgres)
   data/usda/*.csv     ─pandas─►   automation/db.sqlite   ──►   public.ingredients
                                                                public.ingredient_details
                                                                public.health_facts
                                                                public.metric_definitions

   Existing bundle JSONs ──┐
   web/assets/ingredients/ │       SQLite ◄── source of truth for catalog data
   <id>/ingredient.json    │       Supabase ◄── runtime production database
                           │       Frontend reads from Supabase (no change)
                           ▼
                      one-shot
                      migration

   Sample JSON template
   docs/templates/ingredient.example.json
                           │
                           ▼
                   mfc import-ingredient <file>
```

Two pipelines feed SQLite during rollout: a one-shot bundle migration (run once), and the USDA importer (re-runnable, idempotent). After rollout, `mfc import-ingredient` is the way new ingredients get added; `mfc fetch-ingredient-*` updates existing rows.

### SQLite as canonical source

The SQLite file is the single point-in-time view of what catalog data should be deployed to Supabase. Workflow:

- **Develop**: edit SQLite via CLI (`mfc import-ingredient`, `mfc fetch-ingredient-*`) or by hand (`sqlite3 automation/db.sqlite`).
- **Push to prod**: `mfc sync-ingredients --direction push` → upserts changed rows in Supabase.
- **Capture prod-side edits**: `mfc sync-ingredients --direction pull` → overwrites SQLite from Supabase. Used after admin-UI edits.
- **Fresh deploy**: a brand-new Supabase project gets seeded by `mfc sync-ingredients --direction push` from a clean SQLite. (Auth tables, user data, RLS policies provisioned separately via `schema.sql`.)

The SQLite is a binary committed file. Diffs in PRs are not human-readable but the file is small (estimated <2 MB after USDA import). Future tooling could emit a `db.sqlite.summary.txt` alongside it for review-friendly diffs.

## SQLite schema

`automation/db/sqlite_schema.sql`:

### `ingredients` — list-page-friendly, kept narrow

```sql
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
```

Column semantics:
- `id` — slug, primary key. From `slug(usda.description)` for USDA imports; from `slug(bundle.name)` for legacy imports; from `slug(<user-supplied id>)` for JSON-template imports.
- `aliases` — JSON array of search-fallback names (Postgres: `TEXT[]`; SQLite: stored as JSON text, parsed at read).
- `source` — `'fdc' | 'ai' | 'manual' | 'fdc-miss' | 'ai-miss' | NULL`. Mirrors `ingredient_details.nutrition.source` from the previous design; canonical state lives here so the list query never joins.
- `show` — JSON object with per-section visibility toggles (back-compat with the existing bundle/frontend shape).
- `created_by` — UUID-as-text (Supabase `auth.users.id` is `uuid`; SQLite stores as text, conversion handled in sync).
- Timestamps — ISO 8601. SQLite default `datetime('now')` returns `YYYY-MM-DD HH:MM:SS` (no T separator, no Z); the sync layer normalizes to the Postgres `timestamptz` representation.

### `ingredient_details` — 1:1 details, ~180 flat nutrient columns

```sql
CREATE TABLE IF NOT EXISTS ingredient_details (
  id                   TEXT PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
  storage              TEXT,
  substitutes          TEXT NOT NULL DEFAULT '[]',
  nutrition_per        TEXT NOT NULL DEFAULT '100g',
  nutrition_filled_at  TEXT,

  -- ENERGY + WATER
  calories             REAL,  energy_kj  REAL,  water  REAL,

  -- MACROS (g)
  protein  REAL,  total_fat  REAL,  carbohydrate  REAL,  ash  REAL,  alcohol  REAL,

  -- CARBOHYDRATE BREAKDOWN (g)
  fiber  REAL,  fiber_soluble  REAL,  fiber_insoluble  REAL,
  sugars  REAL,  sugars_added  REAL,  starch  REAL,
  glucose  REAL,  fructose  REAL,  sucrose  REAL,
  lactose  REAL,  maltose  REAL,  galactose  REAL,

  -- FAT BREAKDOWN (g unless noted)
  saturated_fat  REAL,  mono_fat  REAL,  poly_fat  REAL,  trans_fat  REAL,
  cholesterol    REAL,  -- mg
  -- individual saturated fatty acids (SFA, g)
  sfa_4_0  REAL,  sfa_6_0  REAL,  sfa_8_0  REAL,  sfa_10_0  REAL,
  sfa_12_0 REAL,  sfa_14_0 REAL,  sfa_15_0 REAL,  sfa_16_0  REAL,
  sfa_17_0 REAL,  sfa_18_0 REAL,  sfa_20_0 REAL,  sfa_22_0  REAL,  sfa_24_0  REAL,
  -- individual monounsaturated (MUFA, g)
  mufa_14_1  REAL,  mufa_15_1  REAL,  mufa_16_1  REAL,  mufa_17_1  REAL,
  mufa_18_1  REAL,  mufa_20_1  REAL,  mufa_22_1  REAL,  mufa_24_1  REAL,
  -- individual polyunsaturated (PUFA, g)
  pufa_18_2_n6_la       REAL,  pufa_18_3_n3_ala  REAL,  pufa_18_3_n6_gla  REAL,
  pufa_18_4             REAL,  pufa_20_2_n6      REAL,  pufa_20_3_n6      REAL,
  pufa_20_3_n3          REAL,  pufa_20_4_n6_aa   REAL,  pufa_20_5_n3_epa  REAL,
  pufa_21_5             REAL,  pufa_22_2         REAL,  pufa_22_5_n3_dpa  REAL,
  pufa_22_6_n3_dha      REAL,

  -- MINERALS (mg unless noted; selenium / fluoride / iodine in µg)
  calcium  REAL,  iron  REAL,  magnesium  REAL,  phosphorus  REAL,
  potassium  REAL,  sodium  REAL,  zinc  REAL,  copper  REAL,
  manganese  REAL,  selenium  REAL,  fluoride  REAL,  iodine  REAL,

  -- FAT-SOLUBLE VITAMINS
  vitamin_a       REAL,  -- µg RAE
  vitamin_a_iu    REAL,  -- IU (legacy unit; some FDC rows report IU not RAE)
  retinol         REAL,  -- µg
  carotene_alpha  REAL,  carotene_beta  REAL,  cryptoxanthin_beta  REAL,
  lycopene        REAL,  lutein_zeaxanthin  REAL,
  vitamin_d       REAL,  -- µg
  vitamin_d2      REAL,  vitamin_d3       REAL,
  vitamin_e       REAL,  -- mg α-tocopherol
  tocopherol_beta REAL,  tocopherol_gamma  REAL,  tocopherol_delta  REAL,
  vitamin_k       REAL,  -- µg

  -- WATER-SOLUBLE VITAMINS
  thiamin       REAL,  riboflavin  REAL,  niacin  REAL,
  pantothenic_acid  REAL,  vitamin_b6  REAL,  biotin  REAL,
  folate        REAL,  -- µg total
  folate_dfe    REAL,  -- µg dietary folate equivalents
  vitamin_b12   REAL,  -- µg
  choline       REAL,  -- mg
  vitamin_c     REAL,  -- mg

  -- AMINO ACIDS (g)
  tryptophan  REAL,  threonine     REAL,  isoleucine    REAL,  leucine     REAL,
  lysine      REAL,  methionine    REAL,  cystine       REAL,  phenylalanine REAL,
  tyrosine    REAL,  valine        REAL,  arginine      REAL,  histidine   REAL,
  alanine     REAL,  aspartic_acid REAL,  glutamic_acid REAL,  glycine     REAL,
  proline     REAL,  serine        REAL,  hydroxyproline REAL,

  -- STIMULANTS + MISC
  caffeine  REAL,  -- mg
  theobromine  REAL,  -- mg
  nitrogen  REAL  -- g, source-of-truth for protein calculation
);
```

Total: ~140 nutrient columns. Tier 4 (research-only, <5 % coverage) is intentionally excluded — exotic isomers, lab artifacts, deprecated decomposition products. The spec ships with this exact list; future additions are one-line schema edits + a Postgres `ALTER TABLE ADD COLUMN`.

Every column has a `COMMENT ON COLUMN` on the Postgres side spelling out units + USDA `nutrient_id` source. A generated `docs/NUTRITION_FIELDS.md` mirrors that for human reference.

### `health_facts` — consolidated, polymorphic

```sql
CREATE TABLE IF NOT EXISTS health_facts (
  category    TEXT    NOT NULL CHECK (category IN ('ingredient', 'utensil', 'recipe')),
  target_id   TEXT    NOT NULL,  -- references ingredients.id | utensils.id | recipes.id by category
  sort_order  INTEGER NOT NULL,
  fact        TEXT    NOT NULL,
  PRIMARY KEY (category, target_id, sort_order)
);
CREATE INDEX IF NOT EXISTS health_facts_target_idx ON health_facts (category, target_id);
```

No DB-level FK on `target_id` (polymorphic). Application owns the consistency invariant: facts get deleted when their target gets deleted. CASCADE delete is implemented via a per-category trigger on the Postgres side (or, simpler: the sync push code deletes orphans before insert).

A query for "all facts to show on the recipe-detail page" becomes one indexed lookup per target plus a small join through `recipe_ingredients` for the ingredient-derived facts.

### `metric_definitions` — reference data, fresh-deploy seed

Mirror the existing Postgres shape verbatim into SQLite. 54 rows. Read-only outside seed-time edits.

## Supabase schema changes

The full migration on Postgres lives in `automation/db/schema.sql` (idempotent, re-applied per existing pattern):

1. **Split `ingredients`**:
   - Move `nutrition` (jsonb), `health_fact` (text), `storage` (text), `substitutes` (text[]) OUT of `ingredients`.
   - `ingredients.nutrition` retired entirely — its contents reshape into the ~140 flat columns on the new `ingredient_details` table.
   - `ingredients.health_fact` retired — single-string value migrated as one row into `health_facts (category='ingredient')`.
   - `ingredients.storage`, `ingredients.substitutes` move to `ingredient_details`.
2. **Create `ingredient_details`** with the full 140-column nutrient schema + foreign key to `ingredients` + RLS (public read, admin write — mirroring `ingredients`).
3. **Create `health_facts`** consolidated table with the polymorphic shape. Public read; admin write for ingredient + utensil facts; admin or chef-owner write for recipe facts (mirroring `recipe_health_facts` policies).
4. **Migrate `recipe_health_facts` → `health_facts`**: insert all existing rows as `(category='recipe', target_id=recipe_id, sort_order, fact)`. Then drop `recipe_health_facts`.
5. **Rename `ingredients.nutrition_source` → `ingredients.source`**. Same values (`'fdc' | 'ai' | 'manual' | 'fdc-miss' | 'ai-miss' | NULL`); shorter name fits the no-suffix convention adopted for the nutrient columns. The rename happens as a single `ALTER TABLE ingredients RENAME COLUMN nutrition_source TO source` in the same idempotent migration that drops `recipe_health_facts`.
6. **Drop** the `migrate-ingredient-nutrition` no-op leftovers (helper function + command).

Idempotency: all DDL guarded by `IF EXISTS` / `IF NOT EXISTS`; data migration is wrapped in `INSERT ... ON CONFLICT DO NOTHING` and a `DROP TABLE IF EXISTS recipe_health_facts CASCADE` at the end.

## USDA data extraction

`automation/mfc/ops/usda.py` exposes a single pure function:

```
extract_foundation_foods(usda_dir: Path) -> pd.DataFrame
```

Steps:

1. Load `food.csv` filtered to `data_type == 'foundation_food'`. Keep `fdc_id, description, food_category_id, publication_date`.
2. Load `food_category.csv`; join on `food_category_id` and apply the category-shortening map (see below).
3. Load `food_nutrient.csv` filtered to the foundation `fdc_id` set. Pivot to wide: rows = foods, columns = `nutrient_id`, values = `amount`.
4. Apply the nutrient-id → bundle-key map (also new module `automation/mfc/ops/usda_nutrient_map.py`, ~140 entries) to rename columns into our naming scheme. Drop columns not in the map (Tier 4).
5. Compute `slug` column from `description` using the project's existing `slug(s)` helper. No trimming.
6. Deduplicate on slug, keeping the row with the largest `fdc_id` (newest sample). Logs dropped duplicates.
7. Return a DataFrame ready to be merged into the `ingredients` + `ingredient_details` tables.

Pandas + pivot is appropriate scale: ~10 M `food_nutrient` rows total but the foundation subset is only ~170 K rows. End-to-end runs in <5 seconds on a laptop.

### Category shortening map

```
'Vegetables and Vegetable Products'   → 'Vegetable'
'Fruits and Fruit Juices'             → 'Fruit'
'Dairy and Egg Products'              → 'Dairy'
'Cereal Grains and Pasta'             → 'Grain'
'Legumes and Legume Products'         → 'Legume'
'Nut and Seed Products'               → 'Nut & Seed'
'Finfish and Shellfish Products'      → 'Seafood'
'Beef Products'                       → 'Meat'
'Pork Products'                       → 'Meat'
'Poultry Products'                    → 'Meat'
'Lamb, Veal, and Game Products'       → 'Meat'
'Sausages and Luncheon Meats'         → 'Charcuterie'
'Fats and Oils'                       → 'Oil & Fat'
'Spices and Herbs'                    → 'Spice & Herb'
'Sweets'                              → 'Sweet'
'Soups, Sauces, and Gravies'          → 'Sauce'
'Baked Products'                      → 'Bakery'
'Beverages'                           → 'Beverage'
'Restaurant Foods'                    → 'Other'
```

## Bundle migration

`mfc import-bundles` (new one-shot command):

1. Walk `web/assets/ingredients/<id>/ingredient.json`.
2. For each bundle:
   - Map top-level keys (`id, name, tagline, category, default_unit, photo, emoji, aliases, show, source, fdc_id, ai_filled_at, created_by`) → `ingredients` row.
   - Map `storage, substitutes` → `ingredient_details` row.
   - Reshape `nutrition` JSONB (with current keys `energy_kcal, protein_g, total_fat_g, carbohydrate_g, …`) into the new flat columns via the same nutrient-name mapping as USDA. The legacy `calories/protein/fat/carbs` keys (pre-USDA-rename) are also handled by the same shim.
   - Map `health_fact` (single string, today) → one row in `health_facts` with `sort_order=0`.
3. `INSERT ... ON CONFLICT (id) DO NOTHING` semantics so re-running is safe.

After bundle migration completes successfully, the JSON files are deleted (only the JSONs — `image.png` byte files stay). Deletion is a separate explicit step (`make import-bundles CONFIRM_DELETE=1` or interactive prompt).

## New CLI commands

| Command | Purpose | Idempotent? |
|---|---|---|
| `mfc init-catalog` | Create `automation/db.sqlite` from `automation/db/sqlite_schema.sql`. Drops + recreates if `--force`. | Yes |
| `mfc import-bundles` | One-shot: walk all `web/assets/ingredients/*/ingredient.json`, insert into SQLite. Skips slugs already in DB unless `--force`. | Yes |
| `mfc import-usda` | Read `data/usda/*.csv`, dedupe, upsert into SQLite. `--limit N` for test runs. | Yes |
| `mfc import-ingredient <path>` | Read one JSON template, insert/upsert SQLite rows across the three tables. | Yes |
| `mfc sync-ingredients --direction {pull,push,both}` | SQLite ↔ Supabase. Last-modified-wins on `both`. | Yes |
| `mfc fetch-ingredient-nutrition` | Re-implemented: reads from SQLite, writes nutrition rows in SQLite + sets `source`. AI fallback unchanged. | Yes |
| `mfc fetch-ingredient-image` | Re-implemented: writes PNG bytes to disk + sets SQLite `photo` to the local path. (Storage URL set on next push.) | Yes |

Retired:
- `mfc migrate-ingredient-nutrition` (the legacy `{calories, protein, fat, carbs}` → USDA-keys reshape; bundle-imported data will already be in the new shape).
- All bundle-JSON read/write code in `mfc.ops.ingredients`, `mfc.ops.ingredient_images`.
- The `nutrition_migration.py` helper module.

## JSON template

`docs/templates/ingredient.example.json`:

```jsonc
{
  // ingredients table
  "id": "paneer",
  "name": "Paneer",
  "aliases": ["panir", "indian cottage cheese"],
  "category": "Dairy",
  "tagline": "fresh, milky, holds shape under heat",
  "photo": "https://example.com/storage/v1/object/public/ingredient-images/paneer/image.png",
  "emoji": "🧀",
  "default_unit": "g",
  "source": "manual",
  "fdc_id": null,
  "show": { "healthFact": true, "nutrition": true, "storage": true, "substitutes": true },

  // ingredient_details table
  "details": {
    "storage": "Submerge in cold water; refrigerate; change water daily.",
    "substitutes": ["tofu (firm)", "halloumi"],
    "nutrition_per": "100g",
    "nutrition_filled_at": "2026-05-11T00:00:00Z",
    "calories": 321, "protein": 18.3, "total_fat": 25.0, "carbohydrate": 3.5,
    "calcium": 208, "iron": 0.16, "sodium": 22
    // any subset of the ~140 nutrient fields
  },

  // health_facts rows (category='ingredient' applied at import time)
  "health_facts": [
    "Paneer is a non-melting cheese — high protein, ~25% fat, slow digestion.",
    "Lacto-fermented variants improve calcium bioavailability."
  ]
}
```

`mfc import-ingredient <path>` reads this, validates required fields (`id`, `name`), and writes 1 row to `ingredients`, 1 row to `ingredient_details` (if `details` present), and N rows to `health_facts` (if `health_facts` present).

## Sync command (SQLite ↔ Supabase)

`mfc sync-ingredients --direction {pull,push,both}`. Replaces the current bundle-JSON-aware implementation.

- **Push**: SELECT all rows from each SQLite catalog table, upsert into the Supabase counterpart with `on_conflict="id"` for `ingredients`/`ingredient_details`/`metric_definitions` and `on_conflict="category,target_id,sort_order"` for `health_facts`. Storage URL normalization on `ingredients.photo` (mirrors current behavior).
- **Pull**: SELECT all from Supabase, REPLACE INTO SQLite. The SQLite file is overwritten in-place (single transaction for atomicity).
- **Both**: per-row last-modified-wins (`updated_at` comparison ±1 s tolerance). Same shape as today's recipe sync.

The chained `make sync-ingredients DIRECTION=push` continues to also chain `make sync-ingredient-images` (PNG bytes ↔ Storage bucket). That image command is unchanged.

## Field-by-field naming convention

- No unit suffix in column names (`calories` not `calories_kcal`, `protein` not `protein_g`).
- Implied units: g for macros and amino acids and fatty acids, mg for minerals and most water-soluble vitamins, µg for fat-soluble vitamins (A, D, K, B12) and selenium/fluoride/iodine, mg for stimulants, kcal for `calories`, kJ for `energy_kj`.
- A few exceptions where USDA uses dual units: `vitamin_a` is µg RAE (current best practice); `vitamin_a_iu` is the legacy IU value (USDA still reports for back-compat, kept for old food rows that pre-date the RAE switch).
- The generated `docs/NUTRITION_FIELDS.md` lists every column with: (a) unit, (b) USDA nutrient id, (c) one-line description, (d) typical-range / sample-coverage note.

## Retired code paths

After the migration runs and `mfc sync-ingredients push` lands the new schema on Supabase, the following can be deleted in one cleanup pass (separate commit at the end of implementation):

- `mfc.commands.fetch_ingredient_nutrition` — replaced with the SQLite-aware version.
- `mfc.commands.fetch_ingredient_images` — replaced.
- `mfc.commands.migrate_ingredient_nutrition` — no longer needed.
- `mfc.commands.sync_ingredients` — replaced.
- `mfc.commands.sync_ingredient_images` — kept but updated to write Storage URLs into SQLite, not bundle JSON.
- `mfc.ops.ingredients` — replaced with SQLite-aware operations.
- `mfc.ops.nutrition_migration` — deleted.
- All bundle JSON files under `web/assets/ingredients/<id>/ingredient.json` — deleted after migration succeeds.
- The macro-key shim (`readMacro` + `MACRO_NEW_KEY`) in `admin-ingredient-app.jsx` — replaced with direct reads of the new short-name columns.

## Testing & verification

- **Pure-function unit tests** (pytest, no live network or DB):
  - `tests/test_usda_extract.py` — given a tiny fixture CSV bundle, `extract_foundation_foods` returns the expected DataFrame shape; dedupe-on-slug keeps the largest fdc_id; category shortening applied correctly.
  - `tests/test_usda_nutrient_map.py` — every entry in the map points at a valid SQLite column; no two entries collide on the same column.
  - `tests/test_bundle_to_sqlite.py` — bundle JSON → 3-table row decomposition; legacy `{calories,...}` keys reshape into the new flat columns.
  - `tests/test_sqlite_schema.py` — the schema file applies cleanly to a fresh in-memory SQLite; expected column count + names on each table.
- **Integration smoke** (with `automation/.env` set):
  - `make init-catalog` then `make import-bundles` then `make import-usda` then `make sync-ingredients DIRECTION=push`. Visual spot-check via `mfc status` showing the new tables + row counts.
  - Open `/admin/ingredients.html` — the list page renders thumbnails + categories. Pick one ingredient, open detail page — calories/protein etc. surface correctly.
  - Pick one recipe that uses an ingredient with `health_facts` — the recipe-detail health-fact rotator pulls both recipe-level and ingredient-derived facts.
- **Schema parity check**: a CLI helper `mfc check-schema-parity` reads the SQLite schema and the Supabase information_schema, asserts column-by-column matching for the catalog tables, fails CI if drift is detected.

## Risks & mitigations

- **Binary SQLite in PRs**: diffs are not human-readable. **Mitigation**: a `db.sqlite.summary.txt` emitted alongside the file on every `mfc sync-ingredients pull` — lists row counts per table + any rows whose `updated_at` changed since the previous sync. PR reviewers read the text file.
- **Polymorphic `health_facts.target_id` has no FK**: orphan rows possible if delete logic misses. **Mitigation**: a Postgres trigger on `DELETE FROM ingredients / utensils / recipes` removes matching `health_facts` rows. Trigger lives in `schema.sql`.
- **140 columns is wide**: pgsync / Supabase REST has no problem, but admin form code that explicitly lists fields will be verbose. **Mitigation**: admin form continues to surface only the legacy 4 macros + a few key fields; nutrition richness happens at the data layer, UI evolves later.
- **Slug "spinach-raw" doesn't collide with existing "spinach"**: USDA imports + your existing rows coexist as duplicates until you reconcile. **Mitigation**: documented + reconciliation is your follow-up `fdc_id`-keyed migration. The duplicates are visible in the admin list and not hidden.
- **Sample dates differ across USDA's duplicate foundation entries**: we keep `max(fdc_id)`. **Mitigation**: a debug log line `usda-dedupe: <slug> kept fdc_id=N dropped [{m, ...}]` so deduplication decisions are auditable.
- **Existing `nutrition` jsonb on production Supabase has data we'd lose**: the migration script reads the existing rows, decomposes them into the new flat columns BEFORE dropping the column. Zero data loss.
- **Frontend reads `recipe_health_facts` somewhere**: must inventory and update before the table is dropped. Implementation plan includes that audit as a discrete task.

## Open questions (resolve in implementation plan, not blocking spec)

- Exact migration ordering during rollout: schema-first vs data-first vs interleaved. The DDL is idempotent so order matters less than usual; the plan picks one.
- Whether the polymorphic `health_facts` trigger lives in `schema.sql` (re-applied on every schema apply) or is a one-shot migration.
- Whether `mfc check-schema-parity` is a v1 or post-rollout deliverable.
