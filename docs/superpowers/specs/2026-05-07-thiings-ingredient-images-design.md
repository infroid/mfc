# Ingredient bundles, USDA nutrition, image fetcher — design

- **Date**: 2026-05-07
- **Status**: design (pre-implementation)
- **Owner**: Aman

> **Filename history**: this spec started as a narrow "thiings.co image fetcher".
> Scope expanded mid-brainstorm to mirror the recipe-bundle pattern for
> ingredients + adopt the full USDA nutrient profile + add an
> `ingredient-images` Storage bucket. The original filename is preserved for
> commit lineage.

## Summary

Mirror the recipe-bundle pattern for ingredients. Each ingredient gets a
self-contained directory committed to git
(`web/assets/ingredients/<id>/ingredient.json` + `image.png`), an entry in
the existing `public.ingredients` table, and a copy of its image in a new
`ingredient-images` Supabase Storage bucket. Nutrition data follows the full
USDA FoodData Central nutrient profile (~140 fields, all optional). Three
fetchers populate bundles automatically: thiings.co (illustrations), USDA
FDC (nutrition primary), Anthropic Claude (nutrition AI fallback for
non-FDC foods).

## Decisions

| # | Question | Choice |
|---|---|---|
| 1 | Storage shape | Bundle dir per ingredient, parallel to recipes. Git-tracked |
| 2 | Image storage | Repo bytes + new `ingredient-images` Storage bucket; URL on `ingredients.photo` |
| 3 | Nutrition schema | Full USDA FDC profile, all fields optional, snake_case + unit suffix |
| 4 | Nutrition source | FDC primary, Anthropic AI fallback (opt-in via `--ai-fallback`) |
| 5 | AI provider | Anthropic, default `claude-sonnet-4-6` |
| 6 | Existing data migration | Per-row reshape via `mfc migrate-ingredient-nutrition` (idempotent) |
| 7 | Sync model | `mfc sync-ingredients` + `mfc sync-ingredient-images`, last-modified wins |
| 8 | Image fetcher trigger | CLI only (`mfc fetch-ingredient-image[s]`); no admin button |
| 9 | thiings.co miss handling | Skip + log; stateless re-runs naturally retry |

## Non-goals

- Admin UI button to fetch from the browser. (Static site can't write to
  the laptop; running through Storage diverges from the bundle pattern.)
- Background/automated fetch on row INSERT.
- Image resizing, cropping, or format conversion. PNG bytes from thiings
  are saved verbatim.
- Manifest cache of slug → blob URL.
- Adding ownership/chef-write rules for ingredients (admin-managed only).
- Recommender/UI changes that consume the new nutrition fields. Rendering
  vitamins, amino acids, etc. in the ingredient/recipe pages is out of
  scope; this spec lands the data layer only.
- Schema changes to `recipes` or any recipe-side child table.

## Architecture

### Directory layout

```
web/assets/ingredients/
├── paneer/
│   ├── ingredient.json   ← all bundle data
│   └── image.png         ← bytes, also live in Supabase Storage
├── kasuri-methi/
│   ├── ingredient.json
│   └── image.png
└── ...
```

Both files committed to git. Image bytes also live at
`ingredient-images/<id>/image.png` in Supabase Storage (public read).

### New files

- `automation/mfc/ops/thiings.py` — pure scraper. `fetch_image(slug) -> bytes` + `ThiingsNotFound` / `ThiingsError`.
- `automation/mfc/ops/fdc.py` — USDA FDC client. `search_food(query) -> FdcMatch`, `fetch_nutrients(fdcId) -> dict[int, float]` + `FdcNotFound` / `FdcError`.
- `automation/mfc/ops/fdc_nutrient_map.py` — module-level dict of FDC nutrient ID → bundle key (e.g., `1003 → "protein_g"`).
- `automation/mfc/ops/aifill.py` — Anthropic-backed nutrition fallback. `suggest_nutrition(name, category) -> dict` + `AiFillError`.
- `automation/mfc/ops/ingredients.py` — bundle ↔ DB sync (push, pull, both, last-modified-wins). Mirrors `ops/recipes.py`.
- `automation/mfc/ops/ingredient_images.py` — bucket ↔ local image bytes. Mirrors `ops/images.py`.
- `automation/mfc/ops/nutrition_migration.py` — pure function `reshape_legacy(nutrition: dict | None) -> dict | None` covering the legacy → USDA key rename. Idempotent.
- `automation/mfc/commands/sync_ingredients.py` — `mfc sync-ingredients`.
- `automation/mfc/commands/sync_ingredient_images.py` — `mfc sync-ingredient-images`.
- `automation/mfc/commands/fetch_ingredient_images.py` — `mfc fetch-ingredient-image` + `mfc fetch-ingredient-images` (single + bulk).
- `automation/mfc/commands/fetch_ingredient_nutrition.py` — `mfc fetch-ingredient-nutrition` (single + bulk).
- `automation/mfc/commands/migrate_ingredient_nutrition.py` — `mfc migrate-ingredient-nutrition`.
- `automation/tests/__init__.py` — package marker.
- `automation/tests/test_thiings.py` — three cases (happy, page-404, no-image).
- `automation/tests/test_fdc.py` — four cases (happy, no-match, pinned-id, priority-pick).
- `automation/tests/test_aifill.py` — two cases (happy, schema-violation).
- `automation/tests/test_nutrition_migration.py` — three cases (legacy reshape, already-new, empty).

### Modified files

- `automation/mfc/cli.py` — register the five new subcommands.
- `automation/mfc/core/config.py` — add `fdc_api_key`, `anthropic_api_key`, `require_fdc()`, `require_anthropic()`.
- `automation/.env.sample` — `FDC_API_KEY`, `ANTHROPIC_API_KEY` blocks.
- `automation/db/schema.sql` — three new ingredient columns, two updated comments, ingredient-images bucket + RLS, `can_write_ingredient_image()` helper.
- `automation/pyproject.toml` — add `anthropic` runtime dep (FDC uses stdlib urllib).
- `Makefile` — five new targets (sync-ingredients, sync-ingredient-images, fetch-ingredient-images, fetch-ingredient-nutrition, migrate-ingredient-nutrition).
- `web/assets/js/app/admin-ingredient-app.jsx` — Photo `<Field>` placeholder + hint refresh.

### New directory

- `web/assets/ingredients/` — bundle root. Created by sync-pull or by the
  fetchers; contents committed to git.

## Bundle JSON shape (`ingredient.json`)

```json
{
  "id": "paneer",
  "name": "Paneer",
  "tagline": "fresh, milky, holds shape under heat",
  "category": "Dairy",
  "defaultUnit": "g",
  "image": "https://fqjzhntqppbcwvqtjscb.supabase.co/storage/v1/object/public/ingredient-images/paneer/image.png",
  "emoji": "🧀",
  "healthFact": "...",
  "storage": "...",
  "substitutes": ["tofu (firm)", "halloumi"],
  "show": { "nutrition": true, "healthFact": true, "storage": true, "substitutes": true },
  "nutrition": { /* see below */ },
  "createdBy": null
}
```

DB ↔ bundle key mapping:

| DB column | Bundle key |
|---|---|
| `id`, `name`, `tagline`, `category` | same |
| `default_unit` | `defaultUnit` |
| `photo` | `image` (full Storage URL) |
| `health_fact` | `healthFact` |
| `storage`, `substitutes`, `show` | same |
| `emoji` (new column) | `emoji` |
| `nutrition` (jsonb) | `nutrition` |
| `nutrition_source` (new column) | `nutrition.source` |
| `fdc_id` (new column) | `nutrition.fdcId` |
| `ai_filled_at` (existing) | `nutrition.aiFilledAt` |
| `created_by` | `createdBy` |

## Nutrition block (USDA FDC profile, per-100g)

Top of the block holds source metadata; the rest are nutrient values. All
nutrient fields are optional — missing means "not measured / not
applicable" and renders as "—" in UI (never as 0).

```json
{
  "source": "fdc",
  "fdcId": 173436,
  "filledAt": "2026-05-07T12:00:00Z",
  "aiFilledAt": null,
  "per": "100g",

  "energy_kcal": 321,
  "energy_kj": 1343,
  "water_g": 53.5,
  "protein_g": 18.3,
  "total_fat_g": 25.0,
  "carbohydrate_g": 3.5,
  "ash_g": 1.7,

  "saturated_fat_g": 16.2,
  "monounsaturated_fat_g": 6.7,
  "polyunsaturated_fat_g": 0.7,
  "trans_fat_g": 0.0,
  "cholesterol_mg": 89.0,

  "fiber_total_g": 0,
  "fiber_soluble_g": 0,
  "fiber_insoluble_g": 0,
  "sugars_total_g": 3.2,
  "sugars_added_g": 0,
  "starch_g": 0,

  "calcium_mg": 208,
  "iron_mg": 0.16,
  "magnesium_mg": 8.0,
  "phosphorus_mg": 138,
  "potassium_mg": 138,
  "sodium_mg": 22,
  "zinc_mg": 2.50,
  "copper_mg": 0.03,
  "manganese_mg": 0.02,
  "selenium_ug": 14.5,
  "fluoride_ug": 0,

  "vitamin_a_rae_ug": 198,
  "vitamin_c_mg": 0,
  "vitamin_d_ug": 0.6,
  "vitamin_e_mg": 0.6,
  "vitamin_k_ug": 1.5,
  "thiamin_mg": 0.04,
  "riboflavin_mg": 0.20,
  "niacin_mg": 0.10,
  "pantothenic_acid_mg": 0.50,
  "vitamin_b6_mg": 0.04,
  "biotin_ug": 1.5,
  "folate_total_ug": 9,
  "folate_dfe_ug": 9,
  "vitamin_b12_ug": 0.5,
  "choline_mg": 16.4,

  "fa_18_3_n3_alpha_linolenic_g": 0,
  "fa_20_5_n3_epa_g": 0,
  "fa_22_6_n3_dha_g": 0,
  "fa_18_2_n6_linoleic_g": 0,
  "fa_20_4_n6_arachidonic_g": 0,

  "tryptophan_g": 0.20,
  "threonine_g": 0.81,
  "isoleucine_g": 1.10,
  "leucine_g": 1.83,
  "lysine_g": 1.43,
  "methionine_g": 0.50,
  "cystine_g": 0.10,
  "phenylalanine_g": 0.99,
  "tyrosine_g": 0.93,
  "valine_g": 1.20,
  "histidine_g": 0.58,
  "arginine_g": 0.65,
  "alanine_g": 0.55,
  "aspartic_acid_g": 1.31,
  "glutamic_acid_g": 4.45,
  "glycine_g": 0.36,
  "proline_g": 1.83,
  "serine_g": 1.05,

  "caffeine_mg": 0,
  "theobromine_mg": 0
}
```

Schema rules:
- Snake_case + unit suffix: `_g`, `_mg`, `_ug`, `_kcal`, `_kj`.
- All nutrient fields optional; `per` is fixed at `"100g"`.
- `source` ∈ `{"fdc", "ai", "manual"}`.
- `fdcId` present when `source = "fdc"`. `aiFilledAt` present when
  `source = "ai"`.
- `filledAt` is ISO 8601 UTC, populated for any non-null source.

## Schema changes

All applied via `automation/db/schema.sql`. Idempotent.

### New columns on `public.ingredients`

```sql
ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS emoji            TEXT,
  ADD COLUMN IF NOT EXISTS nutrition_source TEXT,
  ADD COLUMN IF NOT EXISTS fdc_id           INTEGER;

CREATE INDEX IF NOT EXISTS ingredients_nutrition_source_idx
  ON public.ingredients (nutrition_source);

COMMENT ON COLUMN public.ingredients.emoji            IS 'Single grapheme used on ingredient cards (e.g. "🧀"). Nullable.';
COMMENT ON COLUMN public.ingredients.nutrition_source IS '"fdc" | "ai" | "manual" | NULL. Powers "what still needs review" filters.';
COMMENT ON COLUMN public.ingredients.fdc_id           IS 'USDA FoodData Central food id (when nutrition_source = ''fdc''). Lets re-pulls hit the same record without re-searching.';
```

### Updated comments

```sql
COMMENT ON COLUMN public.ingredients.photo IS
  'Full Supabase Storage URL of the ingredient image '
  '(https://<ref>.supabase.co/storage/v1/object/public/ingredient-images/<id>/image.png). '
  'Bytes also live at web/assets/ingredients/<id>/image.png in the repo. Nullable.';

COMMENT ON COLUMN public.ingredients.nutrition IS
  'Per-100g USDA FoodData Central nutrient profile. '
  'JSONB { source, fdcId, filledAt, aiFilledAt, per:"100g", energy_kcal, protein_g, total_fat_g, ... }. '
  'All nutrient fields optional; missing renders as "—". '
  'See docs/superpowers/specs/2026-05-07-thiings-ingredient-images-design.md for full key list.';
```

### Storage bucket

```sql
INSERT INTO storage.buckets (id, name, public)
  VALUES ('ingredient-images', 'ingredient-images', true)
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_write_ingredient_image(path TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE
  AS $$ SELECT public.is_admin() $$;

COMMENT ON FUNCTION public.can_write_ingredient_image(text) IS
  'Returns true when caller is admin. Used by storage.objects RLS for the ingredient-images bucket. '
  'No chef-write tier — ingredients are admin-managed.';

DROP POLICY IF EXISTS "ingredient_images_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "ingredient_images_admin_write"  ON storage.objects;
DROP POLICY IF EXISTS "ingredient_images_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "ingredient_images_admin_delete" ON storage.objects;

CREATE POLICY "ingredient_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ingredient-images');

CREATE POLICY "ingredient_images_admin_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name));

CREATE POLICY "ingredient_images_admin_update"
  ON storage.objects FOR UPDATE
  USING      (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name))
  WITH CHECK (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name));

CREATE POLICY "ingredient_images_admin_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name));
```

### Triggers / functions

None added beyond `can_write_ingredient_image`. No ownership join table
(no chef-write tier).

## Migration of existing data

`mfc migrate-ingredient-nutrition`. One-shot, idempotent.

For every row in `public.ingredients`:

1. Read `nutrition` jsonb.
2. If `nutrition` is null or already has a `source` key → skip.
3. Else: rename keys
   - `calories → energy_kcal`
   - `protein → protein_g`
   - `fat → total_fat_g`
   - `carbs → carbohydrate_g`
4. Add `source = "manual"`, `per = "100g"`, `filledAt = now()` (UTC ISO 8601).
5. `UPDATE ingredients SET nutrition = $reshaped, nutrition_source = 'manual' WHERE id = $id`.

The same logic lives as a pure function in
`automation/mfc/ops/nutrition_migration.py` (`reshape_legacy`); the command
imports it and unit-tests it without DB.

## CLI surface

```
mfc sync-ingredients              --direction {pull|push|both} [--ingredient ID]...
mfc sync-ingredient-images        --direction {pull|push|both} [--ingredient ID]...
mfc fetch-ingredient-image        <id>          [--force] [--no-write]
mfc fetch-ingredient-images                     [--force] [--no-write] [--limit N] [--ids a,b,c]
mfc fetch-ingredient-nutrition    <id>          [--force] [--no-write] [--ai-fallback] [--fdc-id N]
mfc fetch-ingredient-nutrition                  [--force] [--no-write] [--ai-fallback] [--limit N] [--ids a,b,c]
mfc migrate-ingredient-nutrition                (one-shot, no flags)
```

| Flag | Default | Effect |
|---|---|---|
| `--force` | off | (image) re-download even if local file exists; (nutrition) re-fetch even if `source` is set |
| `--no-write` | off | save the fetched output but skip the DB / `ingredient.json` write |
| `--limit N` | none | bulk only — cap to first N rows after `--ids` filter |
| `--ids a,b,c` | none | bulk only — comma-separated allowlist |
| `--ai-fallback` | off | (nutrition only) try Anthropic AI when FDC search returns no match |
| `--fdc-id N` | none | (nutrition single) skip FDC search; pull nutrients for the given fdcId directly |

End-of-run reports for the bulk fetchers print:

```
Fetched: N   Skipped: N   Misses: N   Failed: N

Misses:
  - <id>   (<reason>)
Failed:
  - <id>   (<reason>)
```

Exit codes:
- `0` — at least one row succeeded or was skipped (misses are not failures).
- `1` — every targeted row failed (likely network breakdown / outage).
- `2` — config error (missing required env var, single-id not found in DB).

Pacing: 0.5 s sleep between requests in any bulk fetcher.

## Sync mechanics

Both `sync-ingredients` and `sync-ingredient-images` mirror the recipe
counterparts exactly.

- **push**: walk every bundle dir; for `sync-ingredients` upsert
  `ingredients` row + child columns; for `sync-ingredient-images` upload
  `image.png` to bucket if local mtime > remote.
- **pull**: read all `ingredients` rows / list bucket objects; write
  `ingredient.json` / download `image.png` if remote newer.
- **both**: per-id last-modified wins (`ingredients.updated_at` vs file
  mtime, ±1 s tolerance). Bytes-side: file mtime vs Storage object
  `updated_at`.

`sync-ingredients` push handles a bundle that carries a relative
`assets/ingredients/<id>/image.png` path: it normalizes to the full Storage
URL using `SUPABASE_URL` + `ingredient-images/<id>/image.png`, mirroring
`recipes` push behavior.

## Fetcher mechanics

### thiings.co (`fetch-ingredient-image[s]`)

Same scraper logic as the original spec, with the output path moved into
the bundle dir.

- Fetch `https://www.thiings.co/things/<slug>` with a real-browser User-Agent.
- Two-tier extraction:
  1. Regex for the literal Vercel Blob URL pattern
     `https://lftz25oez4aqbxpq\.public\.blob\.vercel-storage\.com/image-[A-Za-z0-9]+\.png`.
  2. Fallback: `_next/image\?url=([^&"]+)`, URL-decoded.
- HTTP 404 → `ThiingsNotFound(slug, reason="page-404")`.
- HTML without an image URL → `ThiingsNotFound(slug, reason="no-image-in-html")`.
- Other non-2xx / network → `ThiingsError(...)`.
- Image GET capped at 5 MB; first 8 bytes must be PNG magic.
- Output: `web/assets/ingredients/<id>/image.png`.
- Idempotency: if local file exists and `--force` not set → skip.

### USDA FDC (`fetch-ingredient-nutrition[s]`)

- Search: `GET https://api.nal.usda.gov/fdc/v1/foods/search?query=<name>&api_key=<KEY>&dataType=Foundation,SR%20Legacy,Survey%20%28FNDDS%29&pageSize=5`.
- Pick: first food whose `dataType` matches the priority order
  `Foundation > SR Legacy > Survey (FNDDS)`. If none → `FdcNotFound`.
- Fetch nutrients: `GET https://api.nal.usda.gov/fdc/v1/food/<fdcId>?api_key=<KEY>` returns `foodNutrients[]`.
- Map: each `foodNutrients[i].nutrient.id` → bundle key via
  `fdc_nutrient_map`. Unmapped ids ignored. Values are stored verbatim
  (USDA already standardizes per-100g for Foundation / SR Legacy / FNDDS).
- Build the bundle nutrition block: meta (`source="fdc"`, `fdcId`,
  `filledAt=now`, `aiFilledAt=null`, `per="100g"`) + the mapped
  nutrient values.
- `--fdc-id N` skips the search step.
- `--no-write` writes nothing; just logs.
- Otherwise: write into `web/assets/ingredients/<id>/ingredient.json`'s
  `nutrition` block, set `nutrition_source = 'fdc'` + `fdc_id = N` on the
  DB row.

### Anthropic AI fallback (`--ai-fallback`)

- Triggered only when FDC search returns no match AND `--ai-fallback` set.
- `aifill.suggest_nutrition(name, category)` posts a Messages API call
  using the Anthropic Python SDK. System prompt instructs Claude to
  return per-100g best-estimate values for the same nutrition schema, as
  a tool call (`tool_use` with the schema as `input_schema`).
- Schema validation: keys must be a subset of the bundle nutrition
  vocabulary; values must be non-negative numbers. Failure →
  `AiFillError`.
- Output meta: `source="ai"`, `fdcId=null`, `filledAt=now`,
  `aiFilledAt=now`.
- DB row: `nutrition_source = 'ai'`, `ai_filled_at = now()`.

## Auth / config

- Existing service-role Supabase client used by every command.
- `Config.fdc_api_key`, `Config.require_fdc()` — raises `ConfigError`
  when `FDC_API_KEY` is absent.
- `Config.anthropic_api_key`, `Config.require_anthropic()` — raises only
  when `--ai-fallback` is set.

`automation/.env.sample` adds:

```
# ─── Optional: USDA FoodData Central ───────────────────────────────────────
# Required only for `mfc fetch-ingredient-nutrition`. Free key from
# https://fdc.nal.usda.gov/api-key-signup.html (1,000 req/hr default).
FDC_API_KEY=DEMO_KEY

# ─── Optional: Anthropic (for nutrition AI fallback) ───────────────────────
# Required only when `mfc fetch-ingredient-nutrition --ai-fallback` is used.
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
```

`automation/pyproject.toml` adds:

```toml
"anthropic>=0.40",
```

(FDC client uses stdlib `urllib.request` to keep dep surface small. Image
scraper continues to use stdlib too.)

## Makefile targets

```make
sync-ingredients: ## sync ingredient metadata DB↔local; chains sync-ingredient-images in same direction
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-ingredients        --direction $(DIRECTION) && \
	  $(UV) run mfc sync-ingredient-images  --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — DB+Storage → local. ingredient rows become ingredient.json files; bytes pulled into web/assets/ingredients/.\n"; \
	  printf "  push — local → DB+Storage. Bundle JSONs upserted into DB; local images pushed to Storage.\n"; \
	  printf "  both — pull then push. Last-modified wins per ingredient and per image.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-ingredients --direction $$d && $(UV) run mfc sync-ingredient-images --direction $$d; \
	fi

sync-ingredient-images: ## sync ingredient images bucket↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-ingredient-images --direction $(DIRECTION); \
	else \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-ingredient-images --direction $$d; \
	fi

fetch-ingredient-images: ## fetch ingredient PNGs from thiings.co into bundle dirs; FORCE=1 LIMIT=N IDS=a,b
	@$(UV) run mfc fetch-ingredient-images \
	  $(if $(FORCE),--force) \
	  $(if $(LIMIT),--limit $(LIMIT)) \
	  $(if $(IDS),--ids $(IDS))

fetch-ingredient-nutrition: ## fetch USDA FDC nutrition into bundle JSONs; FORCE=1 LIMIT=N IDS=a,b AI=1
	@$(UV) run mfc fetch-ingredient-nutrition \
	  $(if $(FORCE),--force) \
	  $(if $(AI),--ai-fallback) \
	  $(if $(LIMIT),--limit $(LIMIT)) \
	  $(if $(IDS),--ids $(IDS))

migrate-ingredient-nutrition: ## one-shot: reshape legacy nutrition jsonb to USDA schema (idempotent)
	@$(UV) run mfc migrate-ingredient-nutrition
```

`.PHONY` gains the same five names.

## Testing & verification

### Unit tests (stdlib `unittest`, no live network)

- `test_thiings.py` — three cases:
  - happy path → returns PNG bytes
  - page 404 → `ThiingsNotFound(reason="page-404")`
  - HTML without image → `ThiingsNotFound(reason="no-image-in-html")`

- `test_fdc.py` — four cases:
  - happy path: search returns Foundation match → `fetch_nutrients` →
    mapper produces a known bundle nutrition block with ~10 representative
    keys asserted (energy_kcal, protein_g, total_fat_g, calcium_mg,
    vitamin_a_rae_ug, leucine_g, etc.)
  - empty search results → `FdcNotFound`
  - pinned `--fdc-id` → search skipped, fetch + map verified
  - priority pick: search returns Branded + Foundation → Foundation wins

- `test_aifill.py` — two cases:
  - happy path: stub Anthropic SDK to return tool-use response with valid
    nutrition object → `suggest_nutrition` returns it with `source="ai"`
    and `aiFilledAt` populated
  - schema-violating output → `AiFillError`

- `test_nutrition_migration.py` — three cases:
  - legacy `{calories, protein, fat, carbs}` → renamed correctly,
    `source="manual"` added
  - new shape (already has `source`) → returned unchanged
  - `nutrition` is null / empty → returned unchanged, no error

Run:
```
cd automation && uv run python -m unittest discover tests -v
```
Expected: every test green.

### Live smoke tests (require populated `.env`)

1. **thiings**: `mfc fetch-ingredient-image spinach --no-write` →
   `web/assets/ingredients/spinach/image.png` exists, valid PNG magic.
2. **FDC**: `mfc fetch-ingredient-nutrition spinach --no-write` →
   `web/assets/ingredients/spinach/ingredient.json` has populated
   `nutrition` block with `source: "fdc"`, 4-digit `fdcId`, several
   non-null macro/micro/vitamin fields.
3. **AI fallback**: `mfc fetch-ingredient-nutrition kasuri-methi
   --ai-fallback --no-write` → bundle nutrition block has `source: "ai"`,
   `aiFilledAt` set, plausible (not all-zero) macro spread.
4. **Migration**: back up DB → `make apply-schema` → `mfc
   migrate-ingredient-nutrition` → spot-check three rows in Studio (legacy
   keys gone, new keys present, `nutrition_source = 'manual'`). Re-run →
   report shows zero rows touched.
5. **Round-trip**: `make sync-ingredients` (push direction) → Storage
   bucket has `ingredient-images/spinach/image.png`, DB row's `photo` is
   the public Storage URL. `make sync-ingredients` (pull direction)
   overwrites the local bundle byte-for-byte (modulo timestamp formatting).

### Visual verification

- `admin/ingredients.html` — list renders thumbnails for fetched rows.
- `admin/ingredient.html` for spinach — image, nutrition, health-fact
  fields render.
- A `recipe.html` page that uses spinach — health-fact rotator surfaces
  spinach data when `show.nutrition = true`.

## Risks & mitigations

- **HTML structure change at thiings.co** — caught by re-recording test
  fixtures; failure mode is loud (misses report).
- **FDC name match wrong food** — humans review the `nutrition_source =
  'fdc'` rows in admin; `--fdc-id N` re-pulls with a pinned id.
- **AI hallucination** — bounded by strict tool-use schema validation
  (rejects malformed/out-of-vocabulary keys, rejects negative values).
  Humans review `nutrition_source = 'ai'` rows.
- **Rate limits** — 0.5 s pacing on bulk fetchers; FDC 1 000 req/hr free
  tier covers the whole library.
- **Existing rows**: `migrate-ingredient-nutrition` renames keys without
  introducing zeros; missing fields stay missing rather than
  zero-filled.
- **Recipe pipeline regression**: zero touch to `recipes` /
  `recipe-images` / sync-recipes. New columns on `ingredients` are
  nullable; `ingredients` reads on the recipe page take only `name`.
