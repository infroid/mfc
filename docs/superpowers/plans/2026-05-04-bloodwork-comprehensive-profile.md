# Comprehensive bloodwork + user profile + soft recipe prefs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the bloodwork page to 54 diet-controllable markers with sex-aware ranges, introduce a `user_profiles` table + `my/profile.html`, and use the profile to drive a soft recipe-preference layer on search/index/dashboard.

**Architecture:** Static HTML + in-browser React/Babel + Supabase Postgres. New profile data in a typed `user_profiles` table; sex-aware ranges via additional nullable columns on `metric_definitions`; recipe ranking computed client-side via a single shared `recipe-prefs.js` module that every surface consumes.

**Tech Stack:** Supabase JS client v2 (CDN), React 18 (CDN), Babel Standalone (CDN). No build, no test runner. Verification via Supabase Studio SQL queries, browser smoke-tests, and inline self-tests for pure JS modules.

**Spec:** `docs/superpowers/specs/2026-05-04-bloodwork-comprehensive-profile-design.md`

**Frontend constraint:** All UI changes use the existing design system from `css/recipe-base.css` and component vocabulary already established on `my/markers.html` and `recipe-search.html`. Implementer should invoke `frontend-design:frontend-design` skill when building new UI tasks.

---

## File map

**New:**
- `data/db/migrations/2026-05-04-profiles-and-marker-ranges.sql` — incremental delta to apply over an existing schema
- `shared/recipe-prefs.js` — `MFC.recipePrefs.classify(recipe, profile) → { score, violations[] }` + a small inline self-test that runs in `<script>` and logs to console
- `my/profile.html` — auth-gated shell page
- `js/profile-app.jsx` — single-file React app (matches `markers-app.jsx` shape) with `TAG_TAXONOMY` + `MFC.tagTaxonomy` re-export

**Modified:**
- `data/db/schema.sql` — add `user_profiles` table, RLS, trigger; add new `metric_definitions` columns + comments
- `data/db/seed_metrics.sql` — full rewrite: 54 markers, sex-specific columns, descriptions
- `shared/db.js` — `getUserProfile`, `upsertUserProfile` exported on `window.MFC.db`
- `shared/user-menu.jsx` — accepts `profileHref` prop; renders Profile item above Account when set
- `js/markers-app.jsx` — sex-aware range resolution, expanded `CATEGORY_TABS`, `profileHref` passed to `MfcUserMenu`
- `js/dashboard-app.jsx` — `profileHref` to user-menu, defensive avoid-state badge on recommendation cards
- `recipe-search.html` — soft-pref strip + master toggle; sort + visual states; consumes `recipe-prefs.js`; `profileHref`
- `index.html` — featured strip uses same sort/visual rules; consumes `recipe-prefs.js`; `profileHref`
- `recipe.html` — `profileHref`
- `admin/recipes.html`, `admin/recipe.html`, `admin/ingredients.html`, `admin/ingredient.html`, `admin/utensils.html`, `admin/utensil.html` — `profileHref` (`../my/profile.html`)
- `data/recipe-bundles/{aloo-gobi,butter-chicken,chicken-biryani,chole-bhature,dal-makhani,masala-dosa,palak-paneer,paneer-butter-masala,rajma-chawal,tandoori-chicken}/recipe.json` — re-tagged
- `CLAUDE.md` — add `user_profiles`, `mfc:profile-change` event, profile-app.jsx, recipe-prefs.js mentions

**Note:** `shared/auth.js` does **not** need editing — its existing `path.includes('/my/')` check already treats `my/profile.html` as a STAY_ON page.

---

## Phase 1 — Schema & data foundation

### Task 1: Write the migration SQL file

**Files:**
- Create: `data/db/migrations/2026-05-04-profiles-and-marker-ranges.sql`

- [ ] **Step 1: Create the migrations directory and file**

```bash
mkdir -p data/db/migrations
```

Write `data/db/migrations/2026-05-04-profiles-and-marker-ranges.sql`:

```sql
-- Migration: 2026-05-04 — sex-aware metric ranges + user_profiles
-- Idempotent. Apply on top of an existing schema in Supabase Studio.

-- 1. metric_definitions: sex-specific ranges + description
ALTER TABLE public.metric_definitions
  ADD COLUMN IF NOT EXISTS normal_min_female numeric,
  ADD COLUMN IF NOT EXISTS normal_max_female numeric,
  ADD COLUMN IF NOT EXISTS normal_min_male   numeric,
  ADD COLUMN IF NOT EXISTS normal_max_male   numeric,
  ADD COLUMN IF NOT EXISTS description       text;

COMMENT ON COLUMN public.metric_definitions.normal_min_female IS 'Female-specific lower bound. Falls back to normal_min when null.';
COMMENT ON COLUMN public.metric_definitions.normal_max_female IS 'Female-specific upper bound. Falls back to normal_max when null.';
COMMENT ON COLUMN public.metric_definitions.normal_min_male   IS 'Male-specific lower bound. Falls back to normal_min when null.';
COMMENT ON COLUMN public.metric_definitions.normal_max_male   IS 'Male-specific upper bound. Falls back to normal_max when null.';
COMMENT ON COLUMN public.metric_definitions.description       IS 'One-liner: what the marker measures and how diet affects it.';

-- 2. user_profiles
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  sex           text CHECK (sex IN ('female','male','prefer_not_to_say')),
  date_of_birth date,
  diet_tags     text[] NOT NULL DEFAULT '{}',
  allergies     text[] NOT NULL DEFAULT '{}',
  goals         text[] NOT NULL DEFAULT '{}',
  units         text   NOT NULL DEFAULT 'metric'
                CHECK (units IN ('metric','imperial')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.user_profiles               IS 'One row per user. Holds identity (sex, age) and dietary preference tags. Read by both the bloodwork page (sex-aware ranges) and the recipe-search page (soft preferences).';
COMMENT ON COLUMN public.user_profiles.user_id       IS 'FK → auth.users.id. PK.';
COMMENT ON COLUMN public.user_profiles.display_name  IS 'User-editable display name. Falls back to user_metadata.full_name.';
COMMENT ON COLUMN public.user_profiles.sex           IS 'female | male | prefer_not_to_say. Drives sex-aware reference ranges on metric_definitions.';
COMMENT ON COLUMN public.user_profiles.date_of_birth IS 'Optional; used for future age-aware ranges and recommendations.';
COMMENT ON COLUMN public.user_profiles.diet_tags     IS 'Soft + identity diet tags (vegetarian, high-protein, mediterranean, indian, …). Match against recipe_tags.tag and recipes.cuisine.';
COMMENT ON COLUMN public.user_profiles.allergies     IS 'Hard exclusions (nut-free, egg-free, soy-free, shellfish-free). Always enforced regardless of master toggle.';
COMMENT ON COLUMN public.user_profiles.goals         IS 'weight-loss, muscle-gain, energy, heart-health, gut-health.';
COMMENT ON COLUMN public.user_profiles.units         IS 'metric | imperial. Currently informational; future use for unit conversion.';
COMMENT ON COLUMN public.user_profiles.updated_at    IS 'Auto-updated via touch_updated_at trigger on UPDATE.';

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_owner_all" ON public.user_profiles;
CREATE POLICY "user_profiles_owner_all" ON public.user_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 2: Commit**

```bash
git add data/db/migrations/2026-05-04-profiles-and-marker-ranges.sql
git commit -m "feat(db): add migration for sex-aware ranges + user_profiles"
```

### Task 2: Apply the migration to Supabase

**Files:** none (manual op)

- [ ] **Step 1: Open the file in Supabase Studio**

Open `data/db/migrations/2026-05-04-profiles-and-marker-ranges.sql`, copy contents.

- [ ] **Step 2: Run in Supabase Studio SQL Editor**

Studio → SQL Editor → paste → Run.

Expected: "Success. No rows returned."

- [ ] **Step 3: Verify the new columns and table**

In SQL Editor, run:

```sql
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'metric_definitions'
    AND column_name IN ('normal_min_female','normal_max_female','normal_min_male','normal_max_male','description');

SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_profiles';
```

Expected: 5 rows from the first query; 9 rows from the second (matching the column list in the migration).

### Task 3: Update `data/db/schema.sql` to keep fresh-applies in sync

**Files:**
- Modify: `data/db/schema.sql` (insert new columns into the metric_definitions block; add user_profiles section before triggers; add RLS + policy in the RLS section)

- [ ] **Step 1: Add the new columns to the `metric_definitions` CREATE TABLE block**

Find the existing block (around line 252) and replace with:

```sql
CREATE TABLE IF NOT EXISTS public.metric_definitions (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  unit               text NOT NULL,
  normal_min         numeric,
  normal_max         numeric,
  normal_min_female  numeric,
  normal_max_female  numeric,
  normal_min_male    numeric,
  normal_max_male    numeric,
  category           text,
  sort_order         int NOT NULL DEFAULT 0,
  description        text
);
```

Then add the matching `COMMENT ON COLUMN` lines for the 5 new columns (use the same text as in the migration file).

- [ ] **Step 2: Insert the `user_profiles` table block after the `user_health_markers` block (around line 293)**

Add (full block, identical to the migration except wrapped in `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  sex           text CHECK (sex IN ('female','male','prefer_not_to_say')),
  date_of_birth date,
  diet_tags     text[] NOT NULL DEFAULT '{}',
  allergies     text[] NOT NULL DEFAULT '{}',
  goals         text[] NOT NULL DEFAULT '{}',
  units         text   NOT NULL DEFAULT 'metric'
                CHECK (units IN ('metric','imperial')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

Plus the same COMMENT ON lines from the migration.

- [ ] **Step 3: Add the trigger and RLS to the appropriate sections**

In the Triggers section (around line 414), add:

```sql
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

In the RLS section (around line 485, with the other user-owned tables), add:

```sql
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_profiles_owner_all" ON public.user_profiles;
CREATE POLICY "user_profiles_owner_all" ON public.user_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 4: Update the destructive DROP at the top of the file**

Find the commented-out DROP TABLE at the top (around line 22-28) and add `public.user_profiles` to the list, before `public.recommendations`.

- [ ] **Step 5: Commit**

```bash
git add data/db/schema.sql
git commit -m "feat(db): mirror migration changes into schema.sql for fresh applies"
```

### Task 4: Rewrite `data/db/seed_metrics.sql` with the 54-marker catalog

**Files:**
- Modify: `data/db/seed_metrics.sql` (full rewrite)

- [ ] **Step 1: Replace the entire file with the new catalog**

```sql
-- Seed: catalog of diet-controllable health markers. Idempotent via ON CONFLICT.
-- Reference ranges follow conservative adult global norms; sex-specific ranges
-- on hemoglobin / ferritin / iron / transferrin saturation / uric acid.
-- Admin can add more via Supabase Studio.

INSERT INTO public.metric_definitions
  (id, name, unit, normal_min, normal_max,
   normal_min_female, normal_max_female, normal_min_male, normal_max_male,
   category, sort_order, description)
VALUES
  -- Lipid panel
  ('cholesterol',   'Total Cholesterol', 'mg/dL', NULL, 200,  NULL, NULL, NULL, NULL, 'lipid', 100, 'Sum of LDL + HDL + 20% TG. Saturated-fat sensitive.'),
  ('ldl',           'LDL Cholesterol',   'mg/dL', NULL, 100,  NULL, NULL, NULL, NULL, 'lipid', 101, 'The "bad" cholesterol. Lowered by reducing saturated fat and refined carbs.'),
  ('hdl',           'HDL Cholesterol',   'mg/dL', 40,   NULL, 50,   NULL, 40,   NULL, 'lipid', 102, 'The "good" cholesterol. Boosted by olive oil, fatty fish, exercise.'),
  ('non_hdl',       'Non-HDL Cholesterol','mg/dL',NULL, 130,  NULL, NULL, NULL, NULL, 'lipid', 103, 'Total minus HDL. Better atherosclerosis predictor than LDL alone.'),
  ('triglycerides', 'Triglycerides',     'mg/dL', NULL, 150,  NULL, NULL, NULL, NULL, 'lipid', 104, 'Strongly responsive to refined carbs, alcohol, and fructose.'),
  ('vldl',          'VLDL Cholesterol',  'mg/dL', NULL, 30,   NULL, NULL, NULL, NULL, 'lipid', 105, 'Calculated as triglycerides ÷ 5. Tracks insulin resistance.'),
  ('apob',          'Apolipoprotein B',  'mg/dL', NULL, 90,   NULL, NULL, NULL, NULL, 'lipid', 106, 'Particle-count proxy. Lower with reduced saturated fat and Mediterranean pattern.'),
  ('lpa',           'Lipoprotein(a)',    'mg/dL', NULL, 30,   NULL, NULL, NULL, NULL, 'lipid', 107, 'Largely genetic; modest reduction with niacin and saturated-fat moderation.'),

  -- Glycemic / insulin
  ('glucose',  'Fasting Glucose',  'mg/dL', 70, 99,   NULL, NULL, NULL, NULL, 'metabolic', 200, 'Single-point blood sugar. Influenced by carbs, fiber, sleep, stress.'),
  ('hba1c',    'HbA1c',            '%',     NULL, 5.7, NULL, NULL, NULL, NULL, 'metabolic', 201, '~3-month glucose average. Lowered by reducing refined carbs and added sugar.'),
  ('insulin',  'Fasting Insulin',  'µIU/mL', 2,  10,  NULL, NULL, NULL, NULL, 'metabolic', 202, 'Best single marker of insulin resistance. Falls with low-carb / fasting.'),
  ('cpeptide', 'C-Peptide',        'ng/mL', 0.8, 3.1, NULL, NULL, NULL, NULL, 'metabolic', 203, 'Pancreatic insulin output. Tracks fasting insulin.'),

  -- Iron panel (sex-specific)
  ('iron',                    'Iron (Serum)',          'µg/dL', 60, 170, 50,  170, 65,  175, 'iron-panel', 300, 'Diet sources: red meat (heme), legumes, dark leafy greens.'),
  ('ferritin',                'Ferritin',              'ng/mL', 30, 400, 12,  150, 30,  400, 'iron-panel', 301, 'Iron storage. Low = depleted iron; very high = inflammation.'),
  ('tibc',                    'Total Iron-Binding Capacity', 'µg/dL', 250, 450, NULL, NULL, NULL, NULL, 'iron-panel', 302, 'Inverse to ferritin in iron deficiency.'),
  ('transferrin_saturation',  'Transferrin Saturation', '%',    20, 50,  15,  45,  20,  50,  'iron-panel', 303, 'Iron / TIBC × 100. Low <15% suggests deficiency.'),
  ('hemoglobin',              'Hemoglobin',            'g/dL',  12, 17,  12,  15.5, 13.5, 17.5, 'iron-panel', 304, 'Oxygen-carrying capacity. Diet drivers: iron, B12, folate.'),

  -- Inflammation
  ('hs_crp',      'hs-CRP',       'mg/L',  NULL, 1,   NULL, NULL, NULL, NULL, 'inflammation', 400, 'Sensitive systemic-inflammation marker. Reduced by Mediterranean diet, omega-3.'),
  ('homocysteine','Homocysteine', 'µmol/L', NULL, 10,  NULL, NULL, NULL, NULL, 'inflammation', 401, 'Elevated by low B12/B9/B6 status. Methylation marker.'),
  ('uric_acid',   'Uric Acid',    'mg/dL', 3.5, 7.2, 2.6, 6.0, 3.5, 7.2, 'inflammation', 402, 'Diet drivers: purines (organ meat, anchovies), fructose, alcohol.'),

  -- Liver enzymes
  ('alt', 'ALT', 'U/L', NULL, 35, NULL, NULL, NULL, NULL, 'liver', 500, 'Liver-cell enzyme. Elevated by alcohol, fructose, NAFLD.'),
  ('ast', 'AST', 'U/L', NULL, 35, NULL, NULL, NULL, NULL, 'liver', 501, 'Less liver-specific than ALT. AST > ALT may suggest alcohol.'),
  ('ggt', 'GGT', 'U/L', NULL, 50, NULL, NULL, NULL, NULL, 'liver', 502, 'Most alcohol-sensitive liver enzyme.'),
  ('alp', 'ALP', 'U/L', 40, 130, NULL, NULL, NULL, NULL, 'liver', 503, 'Liver + bone enzyme. Diet impact via zinc/magnesium status.'),

  -- Kidney
  ('albumin',       'Albumin',       'g/dL',  3.5, 5.0, NULL, NULL, NULL, NULL, 'kidney', 600, 'Main blood protein. Low = inadequate protein intake or liver/kidney issue.'),
  ('total_protein', 'Total Protein', 'g/dL',  6.0, 8.3, NULL, NULL, NULL, NULL, 'kidney', 601, 'Albumin + globulins. Tracks protein-energy status.'),
  ('bun',           'BUN',           'mg/dL', 7,   20,  NULL, NULL, NULL, NULL, 'kidney', 602, 'Urea nitrogen. Elevated by high protein intake or dehydration.'),
  ('creatinine',    'Creatinine',    'mg/dL', 0.6, 1.3, 0.6, 1.1, 0.7, 1.3, 'kidney', 603, 'Muscle-derived; meat intake nudges it upward.'),

  -- Vitamins, fat-soluble
  ('vit_a', 'Vitamin A (Retinol)', 'µg/dL', 30, 80, NULL, NULL, NULL, NULL, 'vitamin', 700, 'Sources: liver, eggs, dairy, beta-carotene from orange veg.'),
  ('d3',    'Vitamin D (25-OH)',   'ng/mL', 30, 60, NULL, NULL, NULL, NULL, 'vitamin', 701, 'Sun + fortified dairy + fatty fish + supplementation.'),
  ('vit_e', 'Vitamin E (α-Tocopherol)', 'mg/L', 5.5, 17, NULL, NULL, NULL, NULL, 'vitamin', 702, 'Nuts, seeds, vegetable oils.'),
  ('vit_k', 'Vitamin K (Phylloquinone)', 'ng/mL', 0.2, 3.2, NULL, NULL, NULL, NULL, 'vitamin', 703, 'Leafy greens, fermented foods (K2).'),

  -- Vitamins, water-soluble
  ('b1',        'Vitamin B1 (Thiamine)',     'nmol/L', 70, 180, NULL, NULL, NULL, NULL, 'vitamin', 710, 'Whole grains, pork, legumes.'),
  ('b2',        'Vitamin B2 (Riboflavin)',   'µg/dL',  4,  24,  NULL, NULL, NULL, NULL, 'vitamin', 711, 'Dairy, eggs, leafy greens.'),
  ('b3',        'Vitamin B3 (Niacin)',       'µg/mL',  0.5, 8.45, NULL, NULL, NULL, NULL, 'vitamin', 712, 'Meat, fish, peanuts, mushrooms.'),
  ('b5',        'Vitamin B5 (Pantothenic)',  'ng/mL',  37, 147, NULL, NULL, NULL, NULL, 'vitamin', 713, 'Widespread in foods; deficiency rare.'),
  ('b6',        'Vitamin B6',                'ng/mL',  5,  50,  NULL, NULL, NULL, NULL, 'vitamin', 714, 'Poultry, fish, potatoes, chickpeas.'),
  ('b7',        'Vitamin B7 (Biotin)',       'ng/L',   200, 1200, NULL, NULL, NULL, NULL, 'vitamin', 715, 'Eggs, nuts, seeds, sweet potatoes.'),
  ('folate',    'Folate (B9)',               'ng/mL',  3,  17,  NULL, NULL, NULL, NULL, 'vitamin', 716, 'Leafy greens, legumes, fortified grains.'),
  ('b12',       'Vitamin B12',               'pg/mL',  200, 900, NULL, NULL, NULL, NULL, 'vitamin', 717, 'Animal foods only; vegans need supplementation.'),
  ('vitamin_c', 'Vitamin C',                 'mg/dL',  0.4, 2.0, NULL, NULL, NULL, NULL, 'vitamin', 718, 'Citrus, peppers, kiwi, leafy greens.'),

  -- Minerals, major
  ('calcium',    'Calcium',    'mg/dL', 8.5, 10.5, NULL, NULL, NULL, NULL, 'mineral', 800, 'Dairy, leafy greens, sardines, fortified plant milks.'),
  ('magnesium',  'Magnesium',  'mg/dL', 1.7, 2.2,  NULL, NULL, NULL, NULL, 'mineral', 801, 'Nuts, seeds, leafy greens, whole grains.'),
  ('phosphorus', 'Phosphorus', 'mg/dL', 2.5, 4.5,  NULL, NULL, NULL, NULL, 'mineral', 802, 'Dairy, meat, fish, legumes.'),
  ('potassium',  'Potassium',  'mEq/L', 3.5, 5.0,  NULL, NULL, NULL, NULL, 'mineral', 803, 'Bananas, potatoes, beans, leafy greens.'),
  ('sodium',     'Sodium',     'mEq/L', 135, 145,  NULL, NULL, NULL, NULL, 'mineral', 804, 'Mostly processed foods. Hypertension lever.'),

  -- Minerals, trace
  ('zinc',      'Zinc',      'µg/dL', 70, 120, NULL, NULL, NULL, NULL, 'mineral', 810, 'Oysters, beef, pumpkin seeds, legumes.'),
  ('copper',    'Copper',    'µg/dL', 70, 140, NULL, NULL, NULL, NULL, 'mineral', 811, 'Liver, cocoa, nuts, seeds.'),
  ('selenium',  'Selenium',  'µg/L',  70, 150, NULL, NULL, NULL, NULL, 'mineral', 812, 'Brazil nuts (very high), fish, eggs.'),
  ('iodine',    'Iodine (Urinary)', 'µg/L', 100, 300, NULL, NULL, NULL, NULL, 'mineral', 813, 'Iodized salt, dairy, seafood, seaweed.'),
  ('manganese', 'Manganese', 'µg/L', 4, 15, NULL, NULL, NULL, NULL, 'mineral', 814, 'Whole grains, nuts, leafy greens, tea.'),
  ('chromium',  'Chromium',  'µg/L', 0.1, 2.1, NULL, NULL, NULL, NULL, 'mineral', 815, 'Broccoli, whole grains, brewer''s yeast.'),

  -- Other diet-related
  ('omega3_index', 'Omega-3 Index', '%',     8,    NULL, NULL, NULL, NULL, NULL, 'other',  900, '% RBC EPA + DHA. Boosted by fatty fish, algae oil.'),
  ('tsh',          'TSH',           'mIU/L', 0.4, 4.0, NULL, NULL, NULL, NULL, 'thyroid', 901, 'Diet drivers: iodine, selenium, goitrogens (cooked usually fine).')
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  unit              = EXCLUDED.unit,
  normal_min        = EXCLUDED.normal_min,
  normal_max        = EXCLUDED.normal_max,
  normal_min_female = EXCLUDED.normal_min_female,
  normal_max_female = EXCLUDED.normal_max_female,
  normal_min_male   = EXCLUDED.normal_min_male,
  normal_max_male   = EXCLUDED.normal_max_male,
  category          = EXCLUDED.category,
  sort_order        = EXCLUDED.sort_order,
  description       = EXCLUDED.description;
```

- [ ] **Step 2: Commit**

```bash
git add data/db/seed_metrics.sql
git commit -m "feat(db): expand metric catalog to 54 diet-controllable markers with sex-aware ranges"
```

### Task 5: Apply the new seed and verify the marker catalog

**Files:** none (manual op + verify)

- [ ] **Step 1: Apply via Supabase Studio**

Open `data/db/seed_metrics.sql`, paste full contents into Studio SQL Editor, run.

Expected: "Success. No rows returned." Or message indicating UPSERT count.

- [ ] **Step 2: Verify row count and category distribution**

```sql
SELECT category, count(*) FROM public.metric_definitions GROUP BY category ORDER BY category;
SELECT count(*) AS total FROM public.metric_definitions;
```

Expected total: 54. Categories: lipid (8), metabolic (4), iron-panel (5), inflammation (3), liver (4), kidney (4), vitamin (13), mineral (11), thyroid (1), other (1).

- [ ] **Step 3: Verify sex-specific rows**

```sql
SELECT id, normal_min_female, normal_max_female, normal_min_male, normal_max_male
  FROM public.metric_definitions
  WHERE normal_min_female IS NOT NULL OR normal_min_male IS NOT NULL;
```

Expected: 5 rows — `hemoglobin`, `ferritin`, `iron`, `transferrin_saturation`, `uric_acid`. (Note: `hdl`, `creatinine` also have sex-specific values per the seed; if they appear, that's fine — we set sex-specific ranges where they meaningfully differ.)

---

## Phase 2 — Shared infrastructure

### Task 6: Add `getUserProfile` and `upsertUserProfile` to `shared/db.js`

**Files:**
- Modify: `shared/db.js` (after the `// ---------- Prefs ----------` block, around line 193)

- [ ] **Step 1: Add the functions**

Insert this block after the `setPref` function (just before the `// ---------- Health markers ----------` line):

```js
  // ---------- User profile ----------

  async function getUserProfile() {
    if (!sb) return null;
    const uid = userId(); if (!uid) return null;
    const { data, error } = await sb.from('user_profiles')
      .select('*').eq('user_id', uid).maybeSingle();
    if (error) { console.warn('[db.getUserProfile]', error); return null; }
    return data;
  }

  async function upsertUserProfile(payload) {
    if (!sb) return false;
    const uid = userId(); if (!uid) return false;
    const row = {
      user_id: uid,
      display_name:  payload.display_name  ?? null,
      sex:           payload.sex           ?? null,
      date_of_birth: payload.date_of_birth ?? null,
      diet_tags:     payload.diet_tags     ?? [],
      allergies:     payload.allergies     ?? [],
      goals:         payload.goals         ?? [],
      units:         payload.units         ?? 'metric',
    };
    const { data, error } = await sb.from('user_profiles')
      .upsert(row).select().maybeSingle();
    if (error) { console.warn('[db.upsertUserProfile]', error); return false; }
    window.dispatchEvent(new CustomEvent('mfc:profile-change', { detail: { profile: data } }));
    return true;
  }
```

- [ ] **Step 2: Add the new functions to the public surface**

Find the `return { ... }` block at the bottom (around line 328) and add `getUserProfile, upsertUserProfile,` to the list. After the change the block should include them inline:

```js
    getPref, setPref,
    getUserProfile, upsertUserProfile,
    getMetricDefinitions, getHealthMarkers, upsertHealthMarker,
```

- [ ] **Step 3: Smoke-test in browser console**

Start the dev server:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/my/markers.html`, sign in, then in console:

```js
await window.MFC.db.getUserProfile()         // expect: null  (no profile yet)
await window.MFC.db.upsertUserProfile({ display_name: 'Test', sex: 'male' })
                                             // expect: true
await window.MFC.db.getUserProfile()         // expect: { user_id, display_name: 'Test', sex: 'male', ... }
```

- [ ] **Step 4: Commit**

```bash
git add shared/db.js
git commit -m "feat(db): add getUserProfile/upsertUserProfile + emit mfc:profile-change"
```

### Task 7: Update `shared/user-menu.jsx` with Profile menu item

**Files:**
- Modify: `shared/user-menu.jsx`

- [ ] **Step 1: Update the comment header to document the new prop**

Replace the file's first 4 lines:

```js
// Shared user menu — pill button + dropdown (Profile, Account, Sign out).
// Reuses .nav-user / .nav-avatar / .nav-user-btn already defined per-page.
// Injects its own dropdown styles once.
// Usage: <MfcUserMenu user={user} onSignIn={openAuth} profileHref="my/profile.html" accountHref="my/account.html" />
```

- [ ] **Step 2: Update the component to accept and render `profileHref`**

Find `function MfcUserMenu({ user, onSignIn, accountHref })` and update:

```js
function MfcUserMenu({ user, onSignIn, profileHref, accountHref }) {
```

Inside the dropdown JSX, find the `<a className="user-menu-item" ... href={accountHref ...}>Account</a>` element and insert a Profile item directly above it:

```jsx
{profileHref && (
  <a
    className="user-menu-item"
    role="menuitem"
    href={profileHref}
    onClick={() => setOpen(false)}
  >
    Profile
  </a>
)}
<a
  className="user-menu-item"
  role="menuitem"
  href={accountHref || '#'}
  onClick={() => setOpen(false)}
>
  Account
</a>
```

- [ ] **Step 3: Smoke-test**

Reload `http://localhost:8080/my/markers.html` (signed in). Open user-menu dropdown.

Expected: dropdown order is Profile / Account / —rule— / Sign out.

(The Profile link will 404 until Task 12 — that's fine for this task.)

- [ ] **Step 4: Commit**

```bash
git add shared/user-menu.jsx
git commit -m "feat(user-menu): add Profile item above Account when profileHref is provided"
```

### Task 8: Plumb `profileHref` through every page that mounts `MfcUserMenu`

**Files:**
- Modify (each adds one prop): `js/markers-app.jsx`, `js/dashboard-app.jsx`, `index.html`, `recipe-search.html`, `recipe.html`, `admin/recipes.html`, `admin/recipe.html`, `admin/ingredients.html`, `admin/ingredient.html`, `admin/utensils.html`, `admin/utensil.html`

- [ ] **Step 1: Update root pages (path: `my/profile.html`)**

Search-and-replace in `index.html`, `recipe-search.html`, `recipe.html`:

Find: `<MfcUserMenu` (or `<UserMenu` if aliased)
After the existing `accountHref="..."` (or in absence of it, after `user={user}`), add:

```jsx
profileHref="my/profile.html"
```

Example final attribute string: `<UserMenu user={user} profileHref="my/profile.html" accountHref="my/account.html" />`

If a page does not currently pass `accountHref`, just add `profileHref="my/profile.html"`.

- [ ] **Step 2: Update `my/*` pages (path: `profile.html`)**

In `js/markers-app.jsx` line 483, change:

```jsx
<UserMenu user={user} accountHref="account.html" />
```

to:

```jsx
<UserMenu user={user} profileHref="profile.html" accountHref="account.html" />
```

In `js/dashboard-app.jsx`, find the equivalent `<UserMenu` line and apply the same change (`profileHref="profile.html"`).

- [ ] **Step 3: Update admin pages (path: `../my/profile.html`)**

For each admin HTML file (`admin/recipes.html`, `admin/recipe.html`, `admin/ingredients.html`, `admin/ingredient.html`, `admin/utensils.html`, `admin/utensil.html`), find the `<MfcUserMenu` or `<UserMenu` mount and add `profileHref="../my/profile.html"`.

- [ ] **Step 4: Smoke-test on each surface**

Open each of: `index.html`, `recipe-search.html`, `recipe.html?id=palak-paneer`, `my/markers.html`, `my/dashboard.html`, and one admin page (e.g. `admin/recipes.html`). Open the user-menu dropdown on each.

Expected: Profile link visible above Account on every page, with the correct relative path.

- [ ] **Step 5: Commit**

```bash
git add js/markers-app.jsx js/dashboard-app.jsx index.html recipe-search.html recipe.html admin/
git commit -m "feat: plumb profileHref through every MfcUserMenu mount point"
```

### Task 9: Create `shared/recipe-prefs.js` with `classify()` and inline self-test

**Files:**
- Create: `shared/recipe-prefs.js`

- [ ] **Step 1: Write the module**

```js
// MFC recipe preference classifier.
// classify(recipe, profile) → { score, violations: [{ type, label }] }
//
//   recipe  : { tags: string[], cuisine: string }
//   profile : { diet_tags: string[], allergies: string[], goals: string[] }
//
// Three classes of profile signal:
//   1. Allergy        → always-enforced violation
//   2. Diet identity  → violation when recipe contradicts; subject to caller's master toggle
//   3. Soft pref      → adds to score; never violates
window.MFC = window.MFC || {};
window.MFC.recipePrefs = (function () {

  // ---- tag class membership ----
  const ALLERGY_TAGS = new Set(['nut-free', 'egg-free', 'soy-free', 'shellfish-free']);
  const IDENTITY_TAGS = new Set([
    'vegetarian', 'vegan', 'pescatarian',
    'gluten-free', 'dairy-free', 'low-fodmap',
    'halal', 'kosher', 'jain',
  ]);
  // Soft-pref = anything in profile.diet_tags that is not an identity tag.

  // ---- profile-tag → recipe-tag violation rules ----
  // A violation is keyed by what the profile demands; the value is a function
  // that takes the recipe's tag set and cuisine and returns a label string when
  // the recipe contradicts the profile, or null when compatible.
  const IDENTITY_RULES = {
    'vegetarian': (rt) =>
      rt.has('non-veg') ? 'Not vegetarian' : null,

    'vegan': (rt) => {
      if (rt.has('non-veg')) return 'Not vegan';
      if (rt.has('dairy') || rt.has('egg')) return 'Not vegan';
      return null;
    },

    'pescatarian': (rt) =>
      (rt.has('non-veg') && !rt.has('seafood') && !rt.has('fish'))
        ? 'Not pescatarian' : null,

    'gluten-free': (rt) =>
      rt.has('gluten') ? 'Contains gluten'
        : (rt.has('gluten-free') ? null : 'Gluten unconfirmed'),

    'dairy-free': (rt) =>
      rt.has('dairy') ? 'Contains dairy' : null,

    'low-fodmap': (rt) =>
      rt.has('low-fodmap') ? null : 'Not low-FODMAP',

    'halal': (rt) => {
      if (rt.has('pork') || rt.has('alcohol')) return 'Not halal';
      if (rt.has('non-veg') && !rt.has('halal')) return 'Not halal';
      return null;
    },

    'kosher': (rt) => {
      if (rt.has('pork') || rt.has('shellfish')) return 'Not kosher';
      if (rt.has('non-veg') && !rt.has('kosher')) return 'Not kosher';
      return null;
    },

    'jain': (rt) => {
      if (rt.has('non-veg')) return 'Not jain';
      if (rt.has('onion') || rt.has('garlic') || rt.has('root-veg')) return 'Not jain';
      return null;
    },
  };

  const ALLERGY_RULES = {
    'nut-free':       (rt) => rt.has('nuts')      ? 'Contains nuts'      : null,
    'egg-free':       (rt) => rt.has('egg')       ? 'Contains egg'       : null,
    'soy-free':       (rt) => rt.has('soy')       ? 'Contains soy'       : null,
    'shellfish-free': (rt) => rt.has('shellfish') ? 'Contains shellfish' : null,
  };

  function classify(recipe, profile) {
    const rt = new Set(recipe?.tags || []);
    const cuisine = (recipe?.cuisine || '').toLowerCase();
    const dietTags  = profile?.diet_tags || [];
    const allergies = profile?.allergies || [];

    const violations = [];
    let score = 0;

    // Allergy class
    for (const tag of allergies) {
      const rule = ALLERGY_RULES[tag];
      if (rule) {
        const label = rule(rt);
        if (label) violations.push({ type: 'allergy', label });
      }
    }

    // Identity class
    for (const tag of dietTags) {
      if (!IDENTITY_TAGS.has(tag)) continue;
      const rule = IDENTITY_RULES[tag];
      if (rule) {
        const label = rule(rt);
        if (label) violations.push({ type: 'identity', label });
      }
    }

    // Soft-pref class — score
    const seen = new Set();
    for (const tag of dietTags) {
      if (IDENTITY_TAGS.has(tag) || ALLERGY_TAGS.has(tag)) continue;
      if (seen.has(tag)) continue;
      seen.add(tag);
      if (rt.has(tag) || (cuisine && cuisine.includes(tag))) score += 1;
    }

    return { score, violations };
  }

  return { classify };
})();

// ---- inline self-tests ----
// Run automatically when the script loads. Failures log [recipe-prefs:FAIL] to console.
(function () {
  const c = window.MFC.recipePrefs.classify;
  const tests = [
    {
      name: 'vegetarian + non-veg recipe → identity violation',
      recipe: { tags: ['non-veg'], cuisine: '' },
      profile: { diet_tags: ['vegetarian'] },
      expect: (r) => r.violations.some((v) => v.type === 'identity' && v.label === 'Not vegetarian'),
    },
    {
      name: 'nut-free + nuts in recipe → allergy violation',
      recipe: { tags: ['nuts'], cuisine: '' },
      profile: { allergies: ['nut-free'] },
      expect: (r) => r.violations.some((v) => v.type === 'allergy' && v.label === 'Contains nuts'),
    },
    {
      name: 'high-protein soft pref → score 1',
      recipe: { tags: ['high-protein', 'vegetarian'], cuisine: '' },
      profile: { diet_tags: ['high-protein', 'vegetarian'] },
      expect: (r) => r.score === 1 && r.violations.length === 0,
    },
    {
      name: 'cuisine substring match → score 1',
      recipe: { tags: [], cuisine: 'North Indian' },
      profile: { diet_tags: ['indian'] },
      expect: (r) => r.score === 1,
    },
    {
      name: 'vegan + dairy in recipe → identity violation',
      recipe: { tags: ['vegetarian', 'dairy'], cuisine: '' },
      profile: { diet_tags: ['vegan'] },
      expect: (r) => r.violations.some((v) => v.label === 'Not vegan'),
    },
    {
      name: 'no profile tags → score 0, no violations',
      recipe: { tags: ['non-veg', 'gluten'], cuisine: 'Italian' },
      profile: {},
      expect: (r) => r.score === 0 && r.violations.length === 0,
    },
  ];
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      const result = c(t.recipe, t.profile);
      if (t.expect(result)) pass += 1;
      else { fail += 1; console.warn('[recipe-prefs:FAIL]', t.name, result); }
    } catch (e) { fail += 1; console.warn('[recipe-prefs:ERROR]', t.name, e); }
  }
  if (fail === 0) console.info(`[recipe-prefs] ${pass}/${tests.length} self-tests passed`);
})();
```

- [ ] **Step 2: Verify by loading on a page that includes it**

Add `<script src="shared/recipe-prefs.js"></script>` temporarily in `index.html`'s `<head>` (you'll add it for real in Task 15). Reload, check console.

Expected: `[recipe-prefs] 6/6 self-tests passed`. If any FAIL/ERROR appear, fix the rule for that case before moving on.

After verifying, leave the include in `index.html` (it's needed permanently).

- [ ] **Step 3: Commit**

```bash
git add shared/recipe-prefs.js index.html
git commit -m "feat: shared recipe-prefs classifier with allergy/identity/soft-pref rules + self-tests"
```

---

## Phase 3 — Profile page

### Task 10: Create `my/profile.html` shell

**Files:**
- Create: `my/profile.html`

- [ ] **Step 1: Write the file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your profile — MyFoodCraving</title>
<meta name="description" content="Tell us how you eat. We'll tune your bloodwork ranges and recipe suggestions to fit." />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&family=Caveat:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='15' fill='%23FF6D2E'/><text x='50%25' y='62%25' text-anchor='middle' fill='%23FFFCF3' font-family='Georgia,serif' font-style='italic' font-weight='400' font-size='22'>m</text></svg>" />

<link rel="stylesheet" href="../css/recipe-base.css" />

<meta name="mfc-supabase-url" content="https://fqjzhntqppbcwvqtjscb.supabase.co" />
<meta name="mfc-supabase-publishable-key" content="sb_publishable_zuFopkEX_3zj-Gr7dJErtg_FBwMHiZL" />
</head>
<body>
<div id="root"></div>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../shared/supabase.js"></script>
<script src="../shared/auth.js"></script>
<script src="../shared/db.js"></script>

<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>

<script type="text/babel" src="../shared/user-menu.jsx" data-presets="react"></script>
<script type="text/babel" src="../js/profile-app.jsx" data-presets="react"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the page loads (will be blank until profile-app.jsx exists)**

Open `http://localhost:8080/my/profile.html`.

Expected: page loads without console errors. Body shows nothing (no `profile-app.jsx` yet — next task fills it in). The 404 for `js/profile-app.jsx` is expected at this point.

- [ ] **Step 3: Commit**

```bash
git add my/profile.html
git commit -m "feat: add my/profile.html shell"
```

### Task 11: Create `js/profile-app.jsx` with `TAG_TAXONOMY` and a minimal renderable shell

**Files:**
- Create: `js/profile-app.jsx`

- [ ] **Step 1: Write the file (skeleton: nav + hero + empty body, save bar wiring stubbed)**

This task creates the file structure and the `TAG_TAXONOMY` constant. Section UIs come in Task 12.

```jsx
const { useState, useEffect, useMemo, useRef } = React;

// ===========================================================================
// Tag taxonomy — single source of truth, re-exported on window.MFC.tagTaxonomy
// ===========================================================================
const TAG_TAXONOMY = {
  diet_style: {
    label: 'Diet style',
    groups: [
      { sub: 'How do you eat?', tags: ['vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'dairy-free', 'low-fodmap'] },
      { sub: 'Macro orientation', tags: ['high-protein', 'low-carb', 'low-fat', 'low-sodium', 'low-sugar'] },
      { sub: 'Patterns', tags: ['keto', 'paleo', 'mediterranean', 'whole30'] },
      { sub: 'Cuisine preference', tags: ['indian', 'asian', 'mediterranean', 'mexican', 'italian'] },
      { sub: 'Time / effort', tags: ['quick', 'one-pot', 'batch-cook'] },
    ],
  },
  allergies: {
    label: 'Allergies & exclusions',
    helper: 'Things to never recommend',
    tags: ['nut-free', 'egg-free', 'soy-free', 'shellfish-free'],
  },
  goals: {
    label: 'Goals',
    helper: 'What are you optimizing for?',
    tags: ['weight-loss', 'muscle-gain', 'energy', 'heart-health', 'gut-health'],
  },
  lifestyle: {
    label: 'Lifestyle',
    tags: ['halal', 'kosher', 'jain', 'warming', 'cooling', 'raw'],
  },
};

window.MFC = window.MFC || {};
window.MFC.tagTaxonomy = TAG_TAXONOMY;

// ===========================================================================
// Inline styles
// ===========================================================================
const PROFILE_STYLE = `
.wrap { max-width: 880px; margin: 0 auto; padding: 0 28px; position: relative; z-index: 2; }

/* loading */
.pf-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; gap:14px; }
.pf-loading .pulse { width:10px; height:10px; border-radius:50%; background:var(--orange);
  animation: pf-pulse 1.1s cubic-bezier(.4,0,.6,1) infinite; }
.pf-loading p { font-family: var(--serif); font-style: italic; font-size: 18px; color: var(--ink-muted); }
@keyframes pf-pulse { 0%,100% { opacity:1; transform:scale(1);} 50% { opacity:.4; transform:scale(.6);} }

/* nav (copied vocabulary from markers.html) */
.nav { position: sticky; top:0; z-index:50; height:64px; display:flex; align-items:center;
  background: rgba(247,241,227,.86); backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  border-bottom: 1px solid var(--rule); }
.nav-inner { width:100%; max-width: var(--container); margin:0 auto; padding:0 28px; display:flex; align-items:center; justify-content:space-between; gap:24px; }
.brand { display:inline-flex; align-items:center; gap:10px; font-weight:600; letter-spacing:-.02em; }
.brand-mark { display:inline-grid; place-items:center; width:32px; height:32px; background: var(--orange); color: var(--paper);
  font-family: var(--serif); font-style:italic; font-size:22px; border-radius:50%; transform: rotate(-6deg); flex-shrink:0; }
.brand-name { font-size:17px; }
.brand-name em { font-family: var(--serif); font-weight: 400; font-style: italic; }
.nav-links { display:flex; align-items:center; gap:28px; }
.nav-links a { font-family: var(--mono); font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color: var(--ink-soft); transition: color 200ms; position: relative; }
.nav-links a:hover, .nav-links a.active { color: var(--orange); }
.nav-links a.active::after { content:""; position:absolute; left:50%; bottom:-22px; width:6px; height:6px; border-radius:50%; background: var(--orange); transform: translateX(-50%); }
.nav-user { display:flex; align-items:center; gap:8px; padding:6px 14px 6px 6px; background: var(--paper); color: var(--ink);
  border:1.5px solid var(--ink); border-radius: var(--r-pill); font-size:13px; font-weight:500; cursor:pointer; box-shadow: var(--pop-sm);
  transition: transform 180ms, box-shadow 180ms; }
.nav-user:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--ink); }
.nav-avatar { display:grid; place-items:center; width:26px; height:26px; background: var(--orange); color: var(--paper);
  border-radius:50%; font-size:12px; font-weight:700; font-family: var(--mono); flex-shrink:0; text-transform: uppercase; }

/* hero */
.pf-hero { padding: 56px 0 24px; }
.pf-hero h1 { font-family: var(--sans); font-weight:500; font-size: clamp(36px, 4.6vw, 56px); line-height: 0.98; letter-spacing: -0.035em; }
.pf-hero h1 em { font-family: var(--serif); font-style: italic; font-weight: 400; color: var(--orange); }
.pf-hero-sub { font-family: var(--serif); font-style: italic; font-size:18px; color: var(--ink-soft); margin-top: 14px; max-width: 540px; line-height: 1.4; }
.pf-empty-hint { font-family: var(--mono); font-size: 11.5px; letter-spacing: .04em; color: var(--ink-muted); margin-top: 8px; }
.pf-empty-hint::before { content: "// "; color: var(--orange); }

/* section card */
.pf-section { padding: 22px 26px; margin-top: 22px; background: var(--paper); border: 1.5px solid var(--ink); border-radius: var(--r-lg); box-shadow: var(--pop-md); }
.pf-section h2 { font-family: var(--sans); font-weight:500; font-size: 22px; letter-spacing: -.02em; margin-bottom: 4px; }
.pf-section .helper { font-family: var(--serif); font-style: italic; font-size: 15px; color: var(--ink-muted); margin-bottom: 18px; }
.pf-subgroup { margin-top: 16px; }
.pf-subgroup-label { font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 10px; }
.pf-subgroup-label::before { content: "// "; color: var(--orange); }

/* chip group */
.pf-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.pf-chip {
  padding: 9px 16px; background: var(--paper); border: 1.5px solid var(--rule-strong);
  border-radius: var(--r-pill); font-family: var(--mono); font-size: 11px;
  letter-spacing: .08em; text-transform: uppercase; color: var(--ink-muted);
  transition: all 160ms cubic-bezier(.2,.8,.2,1); cursor: pointer;
}
.pf-chip:hover { border-color: var(--ink); color: var(--ink); }
.pf-chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); box-shadow: var(--pop-sm); transform: translate(-1px,-1px); }

/* identity row */
.pf-row { display: grid; grid-template-columns: 160px 1fr; gap: 16px; align-items: center; padding: 12px 0; border-bottom: 1px dashed var(--rule); }
.pf-row:last-child { border-bottom: 0; }
.pf-row label { font-family: var(--mono); font-size: 11.5px; letter-spacing: .04em; color: var(--ink-soft); text-transform: uppercase; }
.pf-row input[type="text"], .pf-row input[type="date"] { width: 100%; padding: 10px 14px; background: var(--paper); border: 1.5px solid var(--rule-strong); border-radius: var(--r-sm);
  font-family: var(--sans); font-size: 14px; color: var(--ink); outline: none; transition: border-color 150ms; }
.pf-row input:focus { border-color: var(--orange); }

/* save bar */
.pf-savebar { position: sticky; bottom: 16px; z-index: 40; margin: 32px 0 56px; padding: 14px 22px; background: var(--paper);
  border: 1.5px solid var(--ink); border-radius: var(--r-pill); box-shadow: var(--pop-lg); display: flex; align-items: center; justify-content: space-between; gap: 16px;
  animation: pf-rise 240ms cubic-bezier(.2,.8,.2,1); }
@keyframes pf-rise { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
.pf-savebar .pf-save-msg { font-family: var(--serif); font-style: italic; font-size: 15px; color: var(--ink-muted); }
.pf-savebar .btn { box-shadow: 4px 4px 0 var(--orange-deep); }

/* btn (re-uses markers.html vocabulary) */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 22px;
  border: 1.5px solid var(--ink); border-radius: var(--r-pill); background: var(--paper); color: var(--ink);
  font-size: 14px; font-weight: 500; box-shadow: var(--pop-md);
  transition: transform 180ms, box-shadow 180ms, background 180ms; white-space: nowrap; cursor: pointer; }
.btn:hover { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 var(--ink); }
.btn:active { transform: translate(0,0); box-shadow: var(--pop-sm); }
.btn.orange { background: var(--orange); color: var(--paper); }
.btn.orange:hover { box-shadow: 5px 5px 0 var(--orange-deep); }
.btn.ghost { box-shadow: none; }
.btn.ghost:hover { background: var(--cream-deep); box-shadow: none; transform: none; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn:disabled:hover { transform: none; box-shadow: var(--pop-sm); }

/* responsive */
@media (max-width: 720px) {
  .nav-links { display: none; }
  .nav-inner { padding: 0 20px; gap: 12px; }
  .wrap { padding: 0 20px; }
  .pf-row { grid-template-columns: 1fr; gap: 6px; }
  .pf-section { padding: 18px 18px; }
}
`;

// ===========================================================================
// Auth gate
// ===========================================================================
function useAuthGuard() {
  const [user, setUser] = useState(() => window.MFC?.auth?.getUser() || null);
  const [ready, setReady] = useState(() => !!window.MFC?.auth?.getUser());
  useEffect(() => {
    if (ready) return;
    const h = (e) => { setUser(e.detail.user); setReady(true); };
    window.addEventListener('mfc:auth-change', h);
    return () => window.removeEventListener('mfc:auth-change', h);
  }, [ready]);
  return { user, ready };
}

// ===========================================================================
// Nav
// ===========================================================================
function Nav({ user }) {
  const UserMenu = window.MfcUserMenu;
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="brand" href="../index.html">
          <span className="brand-mark">m</span>
          <span className="brand-name">MyFood<em>Craving</em></span>
        </a>
        <div className="nav-links">
          <a href="../index.html">Home</a>
          <a href="markers.html">Bloodwork</a>
          <a href="../recipe-search.html">Recipes</a>
          <a href="profile.html" className="active">Profile</a>
        </div>
        {UserMenu && <UserMenu user={user} profileHref="profile.html" accountHref="account.html" />}
      </div>
    </nav>
  );
}

// ===========================================================================
// App (skeleton — sections filled in Task 12)
// ===========================================================================
function ProfileApp() {
  const { user, ready } = useAuthGuard();
  const [profile, setProfile] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (ready && !user) window.location.href = '../index.html';
  }, [ready, user]);

  useEffect(() => {
    if (!user) return;
    window.MFC?.db?.getUserProfile().then((p) => {
      // Prefill display name from user_metadata if profile is empty.
      const seeded = p ?? {
        user_id: user.id,
        display_name: user.name || '',
        sex: null,
        date_of_birth: null,
        diet_tags: [],
        allergies: [],
        goals: [],
        units: 'metric',
      };
      setProfile(seeded);
      setLoaded(true);
    });
  }, [user]);

  if (!ready) return (
    <div className="pf-loading">
      <style>{PROFILE_STYLE}</style>
      <span className="pulse" />
      <p>loading your profile…</p>
    </div>
  );
  if (!user) return null;

  const empty = profile && (
    !profile.sex && !profile.date_of_birth &&
    profile.diet_tags.length === 0 && profile.allergies.length === 0 &&
    profile.goals.length === 0
  );

  return (
    <>
      <style>{PROFILE_STYLE}</style>
      <Nav user={user} />

      <main>
        <section className="pf-hero">
          <div className="wrap">
            <h1>Tell us about <em>you</em></h1>
            <p className="pf-hero-sub">
              Your bloodwork ranges and recipe suggestions get sharper as you fill this in.
            </p>
            {empty && <p className="pf-empty-hint">all fields optional · stored only against your account</p>}
          </div>
        </section>

        <div className="wrap">
          {loaded
            ? <p style={{ marginTop: 18, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-muted)' }}>
                profile sections come online in Task 12
              </p>
            : null}
        </div>
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ProfileApp />);
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:8080/my/profile.html` (signed in).

Expected: nav shows with Profile active, hero "Tell us about you" renders, empty-hint comment shown, placeholder "profile sections come online in Task 12" visible. No console errors. `window.MFC.tagTaxonomy` available in console.

- [ ] **Step 3: Commit**

```bash
git add js/profile-app.jsx
git commit -m "feat(profile): scaffold profile-app.jsx with TAG_TAXONOMY + nav/hero shell"
```

### Task 12: Build profile sections + save bar

**Files:**
- Modify: `js/profile-app.jsx` (replace the placeholder line in the body with full sections + save bar)

- [ ] **Step 1: Add helper components above `ProfileApp` (just below `Nav`)**

```jsx
// ---- chip helpers ----
function ChipSet({ tags, selected, onToggle }) {
  return (
    <div className="pf-chips">
      {tags.map((t) => (
        <button
          key={t}
          type="button"
          className={'pf-chip' + (selected.includes(t) ? ' active' : '')}
          onClick={() => onToggle(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function RadioPills({ value, onChange, options }) {
  return (
    <div className="pf-chips">
      {options.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          className={'pf-chip' + (value === v ? ' active' : '')}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---- equality helper for dirty-tracking ----
function profileEqual(a, b) {
  if (!a || !b) return a === b;
  const arrEq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  return a.display_name === b.display_name
      && a.sex === b.sex
      && a.date_of_birth === b.date_of_birth
      && a.units === b.units
      && arrEq(a.diet_tags || [], b.diet_tags || [])
      && arrEq(a.allergies || [], b.allergies || [])
      && arrEq(a.goals || [], b.goals || []);
}
```

- [ ] **Step 2: Inside `ProfileApp`, add saved-baseline tracking, dirty state, save handler, and section render**

After the `useEffect` that loads the profile, add:

```jsx
  const [saved, setSaved] = useState(null);     // last saved snapshot (used for dirty tracking)
  const [busy, setBusy]   = useState(false);
  const [savedFlash, setSavedFlash] = useState(0);
  // capture baseline once profile is first loaded
  useEffect(() => { if (profile && saved === null) setSaved(profile); }, [profile]);

  const dirty = saved && profile && !profileEqual(profile, saved);

  function patch(part) { setProfile((p) => ({ ...p, ...part })); }
  function toggleArrayTag(field, t) {
    setProfile((p) => {
      const cur = p[field] || [];
      const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
      return { ...p, [field]: next };
    });
  }

  // The taxonomy splits diet style into multiple sub-groups but they all share one
  // backing array (profile.diet_tags). Allergies / goals each have their own field.
  const dietToggle  = (t) => toggleArrayTag('diet_tags', t);
  const allergyToggle = (t) => toggleArrayTag('allergies', t);
  const goalToggle  = (t) => toggleArrayTag('goals', t);

  async function save() {
    if (!profile || busy) return;
    setBusy(true);
    const ok = await window.MFC?.db?.upsertUserProfile(profile);
    setBusy(false);
    if (ok) { setSaved(profile); setSavedFlash(Date.now()); }
  }
```

- [ ] **Step 3: Replace the placeholder paragraph in the JSX with the actual sections**

In the body, replace:

```jsx
{loaded
  ? <p style={{ ... }}>profile sections come online in Task 12</p>
  : null}
```

with:

```jsx
{loaded && profile && <>
  {/* Identity */}
  <section className="pf-section">
    <h2>Identity</h2>
    <div className="pf-row">
      <label>Display name</label>
      <input
        type="text"
        value={profile.display_name || ''}
        onChange={(e) => patch({ display_name: e.target.value })}
        placeholder="What should we call you?"
      />
    </div>
    <div className="pf-row">
      <label>Sex</label>
      <RadioPills
        value={profile.sex}
        onChange={(v) => patch({ sex: v })}
        options={[
          { value: 'female', label: 'female' },
          { value: 'male',   label: 'male' },
          { value: 'prefer_not_to_say', label: 'prefer not to say' },
        ]}
      />
    </div>
    <div className="pf-row">
      <label>Date of birth</label>
      <input
        type="date"
        value={profile.date_of_birth || ''}
        max={new Date().toISOString().slice(0,10)}
        onChange={(e) => patch({ date_of_birth: e.target.value || null })}
      />
    </div>
    <div className="pf-row">
      <label>Units</label>
      <RadioPills
        value={profile.units}
        onChange={(v) => patch({ units: v })}
        options={[
          { value: 'metric',   label: 'metric' },
          { value: 'imperial', label: 'imperial' },
        ]}
      />
    </div>
  </section>

  {/* Diet style */}
  <section className="pf-section">
    <h2>{TAG_TAXONOMY.diet_style.label}</h2>
    {TAG_TAXONOMY.diet_style.groups.map((g) => (
      <div className="pf-subgroup" key={g.sub}>
        <div className="pf-subgroup-label">{g.sub}</div>
        <ChipSet
          tags={g.tags}
          selected={profile.diet_tags}
          onToggle={dietToggle}
        />
      </div>
    ))}
  </section>

  {/* Allergies */}
  <section className="pf-section">
    <h2>{TAG_TAXONOMY.allergies.label}</h2>
    <p className="helper">{TAG_TAXONOMY.allergies.helper}</p>
    <ChipSet
      tags={TAG_TAXONOMY.allergies.tags}
      selected={profile.allergies}
      onToggle={allergyToggle}
    />
  </section>

  {/* Goals */}
  <section className="pf-section">
    <h2>{TAG_TAXONOMY.goals.label}</h2>
    <p className="helper">{TAG_TAXONOMY.goals.helper}</p>
    <ChipSet
      tags={TAG_TAXONOMY.goals.tags}
      selected={profile.goals}
      onToggle={goalToggle}
    />
  </section>

  {/* Lifestyle (folds into diet_tags) */}
  <section className="pf-section">
    <h2>{TAG_TAXONOMY.lifestyle.label}</h2>
    <ChipSet
      tags={TAG_TAXONOMY.lifestyle.tags}
      selected={profile.diet_tags}
      onToggle={dietToggle}
    />
  </section>

  {/* Save bar (sticky, only when dirty) */}
  {dirty && (
    <div className="pf-savebar">
      <span className="pf-save-msg">
        {busy ? 'saving…' : 'unsaved changes'}
      </span>
      <button className="btn orange" onClick={save} disabled={busy}>
        {busy ? '…' : 'Save changes'}
      </button>
    </div>
  )}

  {/* Just-saved confirmation */}
  {!dirty && savedFlash && Date.now() - savedFlash < 2200 && (
    <p style={{ marginTop: 18, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--matcha-deep)', letterSpacing: '.04em' }}>
      ✓ saved
    </p>
  )}
</>}
```

- [ ] **Step 4: Smoke-test all sections in browser**

Reload `http://localhost:8080/my/profile.html`.

Expected:
- All 5 sections render with the right chip lists
- Clicking a chip toggles its active state (filled black bg)
- Selecting different chips makes the save bar slide up
- Clicking "Save changes" persists; reloading the page shows the same selections
- "Sex" set to "female" in the database can be confirmed via Studio:
  ```sql
  SELECT * FROM public.user_profiles WHERE user_id = auth.uid();
  ```
  (Or query without the auth.uid() filter via a service-role connection.)

- [ ] **Step 5: Commit**

```bash
git add js/profile-app.jsx
git commit -m "feat(profile): build out Identity / Diet / Allergies / Goals / Lifestyle sections + save bar"
```

---

## Phase 4 — Bloodwork sex-aware ranges

### Task 13: Sex-aware range resolution + new category tabs in `markers-app.jsx`

**Files:**
- Modify: `js/markers-app.jsx`

- [ ] **Step 1: Update `CATEGORY_TABS`**

Find (around line 428):

```js
const CATEGORY_TABS = ['all', 'mineral', 'vitamin', 'lipid', 'metabolic', 'blood', 'thyroid', 'kidney'];
```

Replace with:

```js
const CATEGORY_TABS = [
  'all', 'lipid', 'metabolic', 'iron-panel', 'inflammation',
  'liver', 'kidney', 'vitamin', 'mineral', 'thyroid', 'other',
];
```

- [ ] **Step 2: Add a profile-aware `effectiveRange()` helper above `markerStatus`**

Insert just above `function markerStatus(def, value)`:

```js
// Resolve sex-aware ranges. Falls back to unisex when no sex set or no override.
function effectiveRange(def, sex) {
  if (sex === 'female') {
    return {
      min: def.normal_min_female ?? def.normal_min,
      max: def.normal_max_female ?? def.normal_max,
    };
  }
  if (sex === 'male') {
    return {
      min: def.normal_min_male ?? def.normal_min,
      max: def.normal_max_male ?? def.normal_max,
    };
  }
  return { min: def.normal_min, max: def.normal_max };
}
```

- [ ] **Step 3: Update `markerStatus` and `fmtRange` to take resolved bounds**

Replace `markerStatus` and `fmtRange` with:

```js
function markerStatus(def, value, sex) {
  if (value == null || value === '') return 'missing';
  const v = Number(value);
  const { min, max } = effectiveRange(def, sex);
  if (min != null && v < Number(min)) return 'low';
  if (max != null && v > Number(max)) return 'high';
  return 'ok';
}

function fmtRange(def, sex) {
  const { min: lo, max: hi } = effectiveRange(def, sex);
  const u = def.unit || '';
  if (lo != null && hi != null) return `Normal: ${lo}–${hi} ${u}`;
  if (hi != null) return `Normal: < ${hi} ${u}`;
  if (lo != null) return `Normal: > ${lo} ${u}`;
  return `Unit: ${u}`;
}
```

- [ ] **Step 4: Wire `sex` into the component tree**

Inside `MarkersApp`, after the `const { user, ready } = useAuthGuard();` line, add:

```js
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!user) return;
    window.MFC?.db?.getUserProfile().then(setProfile);
    const onChange = (e) => setProfile(e.detail.profile);
    window.addEventListener('mfc:profile-change', onChange);
    return () => window.removeEventListener('mfc:profile-change', onChange);
  }, [user]);
  const sex = profile?.sex || null;
```

- [ ] **Step 5: Pass `sex` to every `markerStatus` and `fmtRange` call**

Find each `markerStatus(def, …)` call and `fmtRange(def)` call (search "markerStatus(" and "fmtRange("). Add `sex` as the trailing arg.

There are calls inside:
- `MarkerCard` (its own component — pass `sex` as a prop down from `MarkersApp`)
- `RangeBar` (uses `def.normal_min` directly — also update to take `sex`)
- The `flagged` / `ok` filters in `MarkersApp`

In `MarkerCard`, change the signature to:

```jsx
function MarkerCard({ def, reading, recipes, onSaved, index, sex }) {
```

and replace its `markerStatus(def, reading?.value)` and `fmtRange(def)` calls with `markerStatus(def, reading?.value, sex)` and `fmtRange(def, sex)`.

Update `RangeBar` similarly:

```jsx
function RangeBar({ def, value, status, sex }) {
  const { min: loRaw, max: hiRaw } = effectiveRange(def, sex);
  const lo = loRaw != null ? Number(loRaw) : null;
  const hi = hiRaw != null ? Number(hiRaw) : null;
  // ... rest unchanged
}
```

In `MarkersApp`, pass `sex` to every `<MarkerCard>` render and update the filter expressions:

```jsx
const flagged = items.filter(({ def, reading }) => reading && markerStatus(def, reading.value, sex) !== 'ok');
const ok      = items.filter(({ def, reading }) => reading && markerStatus(def, reading.value, sex) === 'ok');
```

- [ ] **Step 6: Smoke-test in browser**

Reload `http://localhost:8080/my/markers.html` (signed in).

1. Profile sex unset → markers show unisex ranges (e.g., hemoglobin Normal: 12–17 g/dL).
2. Set profile sex to "female" via the profile page → reload markers → hemoglobin shows Normal: 12–15.5 g/dL.
3. Set sex to "male" → reload → hemoglobin shows 13.5–17.5 g/dL.

Verify the new category tabs render: `lipid`, `metabolic`, `iron-panel`, `inflammation`, `liver`, `kidney`, `vitamin`, `mineral`, `thyroid`, `other`. (Tabs only show when at least one def is in that category — which is true after Task 5's seed.)

- [ ] **Step 7: Commit**

```bash
git add js/markers-app.jsx
git commit -m "feat(markers): sex-aware range resolution + expanded category tabs"
```

---

## Phase 5 — Recipe tagging + soft preferences

### Task 14: Re-tag the 10 recipe bundles + sync to DB

**Files:**
- Modify: `data/recipe-bundles/{aloo-gobi,butter-chicken,chicken-biryani,chole-bhature,dal-makhani,masala-dosa,palak-paneer,paneer-butter-masala,rajma-chawal,tandoori-chicken}/recipe.json` — `tags` array

- [ ] **Step 1: Apply this tag mapping (replace each recipe's `tags` array)**

Use these arrays exactly. Each recipe gets a dietary identity tag, ingredient-class tags, and any soft-pref tags that genuinely apply.

| Recipe | Tags |
|---|---|
| `aloo-gobi` | `["vegetarian","vegan","gluten-free","dairy-free","low-carb","mediterranean","one-pot","heart-health","jain"]` |
| `butter-chicken` | `["non-veg","halal","dairy","high-protein","gluten-free","indian"]` |
| `chicken-biryani` | `["non-veg","halal","high-protein","dairy","one-pot","indian"]` |
| `chole-bhature` | `["vegetarian","high-protein","dairy","gluten","onion","garlic","indian"]` |
| `dal-makhani` | `["vegetarian","high-protein","dairy","gluten-free","onion","garlic","indian"]` |
| `masala-dosa` | `["vegetarian","gluten-free","onion","garlic","indian"]` |
| `palak-paneer` | `["vegetarian","high-protein","dairy","gluten-free","onion","garlic","heart-health","indian"]` |
| `paneer-butter-masala` | `["vegetarian","high-protein","dairy","gluten-free","onion","garlic","indian"]` |
| `rajma-chawal` | `["vegetarian","high-protein","gluten-free","dairy-free","onion","garlic","gut-health","indian"]` |
| `tandoori-chicken` | `["non-veg","halal","high-protein","gluten-free","dairy","onion","garlic","indian"]` |

For each `recipe.json`, replace the existing `tags` array with the corresponding array above. Be careful to preserve the rest of the JSON structure.

- [ ] **Step 2: Sync the new tags to Supabase**

The `recipe_tags` table is the source of truth at runtime. Run in Supabase Studio (one query — ten DELETE+INSERT pairs):

```sql
-- For each recipe, replace its tag set.
DELETE FROM public.recipe_tags WHERE recipe_id = 'aloo-gobi';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('aloo-gobi','vegetarian'), ('aloo-gobi','vegan'), ('aloo-gobi','gluten-free'),
  ('aloo-gobi','dairy-free'), ('aloo-gobi','low-carb'), ('aloo-gobi','mediterranean'),
  ('aloo-gobi','one-pot'), ('aloo-gobi','heart-health'), ('aloo-gobi','jain');

DELETE FROM public.recipe_tags WHERE recipe_id = 'butter-chicken';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('butter-chicken','non-veg'), ('butter-chicken','halal'), ('butter-chicken','dairy'),
  ('butter-chicken','high-protein'), ('butter-chicken','gluten-free'), ('butter-chicken','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'chicken-biryani';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('chicken-biryani','non-veg'), ('chicken-biryani','halal'), ('chicken-biryani','high-protein'),
  ('chicken-biryani','dairy'), ('chicken-biryani','one-pot'), ('chicken-biryani','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'chole-bhature';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('chole-bhature','vegetarian'), ('chole-bhature','high-protein'), ('chole-bhature','dairy'),
  ('chole-bhature','gluten'), ('chole-bhature','onion'), ('chole-bhature','garlic'),
  ('chole-bhature','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'dal-makhani';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('dal-makhani','vegetarian'), ('dal-makhani','high-protein'), ('dal-makhani','dairy'),
  ('dal-makhani','gluten-free'), ('dal-makhani','onion'), ('dal-makhani','garlic'),
  ('dal-makhani','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'masala-dosa';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('masala-dosa','vegetarian'), ('masala-dosa','gluten-free'), ('masala-dosa','onion'),
  ('masala-dosa','garlic'), ('masala-dosa','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'palak-paneer';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('palak-paneer','vegetarian'), ('palak-paneer','high-protein'), ('palak-paneer','dairy'),
  ('palak-paneer','gluten-free'), ('palak-paneer','onion'), ('palak-paneer','garlic'),
  ('palak-paneer','heart-health'), ('palak-paneer','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'paneer-butter-masala';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('paneer-butter-masala','vegetarian'), ('paneer-butter-masala','high-protein'),
  ('paneer-butter-masala','dairy'), ('paneer-butter-masala','gluten-free'),
  ('paneer-butter-masala','onion'), ('paneer-butter-masala','garlic'),
  ('paneer-butter-masala','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'rajma-chawal';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('rajma-chawal','vegetarian'), ('rajma-chawal','high-protein'), ('rajma-chawal','gluten-free'),
  ('rajma-chawal','dairy-free'), ('rajma-chawal','onion'), ('rajma-chawal','garlic'),
  ('rajma-chawal','gut-health'), ('rajma-chawal','indian');

DELETE FROM public.recipe_tags WHERE recipe_id = 'tandoori-chicken';
INSERT INTO public.recipe_tags (recipe_id, tag) VALUES
  ('tandoori-chicken','non-veg'), ('tandoori-chicken','halal'), ('tandoori-chicken','high-protein'),
  ('tandoori-chicken','gluten-free'), ('tandoori-chicken','dairy'), ('tandoori-chicken','onion'),
  ('tandoori-chicken','garlic'), ('tandoori-chicken','indian');
```

The query needs admin (service-role) write access — run as project owner in Studio.

- [ ] **Step 3: Verify**

```sql
SELECT recipe_id, count(*) AS tag_count
  FROM public.recipe_tags
  GROUP BY recipe_id ORDER BY recipe_id;
```

Expected: 10 rows, with counts 9, 6, 6, 7, 7, 5, 8, 7, 7, 8 (matching the arrays above).

- [ ] **Step 4: Commit**

```bash
git add data/recipe-bundles/
git commit -m "feat(recipes): re-tag 10 recipes against the new soft-pref taxonomy"
```

### Task 15: Soft-pref strip + match/avoid visuals + sort on `recipe-search.html`

**Files:**
- Modify: `recipe-search.html`

- [ ] **Step 1: Add `<script src="shared/recipe-prefs.js"></script>` near the existing supabase/auth/db scripts**

Find the block with `<script src="shared/supabase.js"></script>` etc. Add directly after `<script src="shared/db.js"></script>`:

```html
<script src="shared/recipe-prefs.js"></script>
```

- [ ] **Step 2: Add CSS for the soft-pref strip and the match/avoid visuals**

Find the existing `<style>` block, scroll to near the bottom, and append:

```css
/* soft-pref strip */
.softpref-strip {
  margin: 16px auto 8px; max-width: var(--container);
  padding: 12px 18px;
  background: var(--paper); border: 1.5px dashed var(--rule-strong); border-radius: var(--r-md);
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.softpref-label { font-family: var(--mono); font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink-muted); }
.softpref-label::before { content: "// "; color: var(--orange); }
.softpref-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.softpref-chip { padding: 4px 10px; background: var(--cream-deep); color: var(--ink-soft);
  font-family: var(--mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  border-radius: var(--r-pill); }
.softpref-edit { font-family: var(--mono); font-size: 11px; letter-spacing: .04em;
  color: var(--orange); text-transform: uppercase; }
.softpref-edit:hover { color: var(--orange-deep); }
.softpref-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  font-family: var(--mono); font-size: 11px; color: var(--ink-soft); }
.softpref-toggle input { accent-color: var(--orange); }
.softpref-dismiss { margin-left: auto; font-family: var(--mono); font-size: 14px;
  color: var(--ink-muted); cursor: pointer; padding: 4px 8px; border-radius: var(--r-sm); }
.softpref-dismiss:hover { background: var(--cream-deep); color: var(--ink); }

/* card match badges */
.fc-match-badge {
  position: absolute; top: 12px; right: 12px;
  font-family: var(--mono); font-size: 9px; letter-spacing: .1em; text-transform: uppercase;
  background: var(--matcha-soft); color: var(--matcha-deep);
  padding: 4px 8px; border-radius: var(--r-pill); border: 1px solid var(--matcha-deep); z-index: 3;
}
.fc-avoid-badge {
  position: absolute; top: 12px; right: 12px;
  font-family: var(--mono); font-size: 9px; letter-spacing: .1em; text-transform: uppercase;
  background: rgba(200,75,90,.16); color: var(--berry);
  padding: 4px 8px; border-radius: var(--r-pill); border: 1px solid var(--berry); z-index: 3;
}
.featured-card.is-avoid, .recipe-card.is-avoid { opacity: .55; box-shadow: 4px 4px 0 var(--berry); }
.featured-card.is-avoid:hover, .recipe-card.is-avoid:hover { opacity: .75; }
```

- [ ] **Step 3: Inside the in-file React, add a `useProfile()` hook just above `function App()` (search "function App")**

Insert above `App`:

```jsx
function useProfile() {
  const [profile, setProfile] = React.useState(null);
  React.useEffect(() => {
    if (!window.MFC?.auth?.isLoggedIn?.()) return;
    window.MFC?.db?.getUserProfile?.().then(setProfile);
    const onAuth = () => window.MFC?.db?.getUserProfile?.().then(setProfile);
    const onProf = (e) => setProfile(e.detail.profile);
    window.addEventListener('mfc:auth-change', onAuth);
    window.addEventListener('mfc:profile-change', onProf);
    return () => {
      window.removeEventListener('mfc:auth-change', onAuth);
      window.removeEventListener('mfc:profile-change', onProf);
    };
  }, []);
  return profile;
}

function profileHasAnyTags(p) {
  return !!(p && (
    (p.diet_tags && p.diet_tags.length) ||
    (p.allergies && p.allergies.length) ||
    (p.goals && p.goals.length)
  ));
}
```

- [ ] **Step 4: Inside `App`, integrate the profile, master toggle, and dismissed flag**

Just below the existing `useState`s in `App`, add:

```jsx
const profile = useProfile();
const [respectPrefs, setRespectPrefs] = React.useState(true);
const [dismissed, setDismissed] = React.useState(() => sessionStorage.getItem('mfc_softpref_dismissed') === '1');
React.useEffect(() => {
  if (dismissed) sessionStorage.setItem('mfc_softpref_dismissed', '1');
  else sessionStorage.removeItem('mfc_softpref_dismissed');
}, [dismissed]);
```

- [ ] **Step 5: Update the `filtered` memo to compute classification + sort**

Find the existing `const filtered = useMemo(...)` block. Replace its body with:

```jsx
const filtered = React.useMemo(() => {
  let list = recipes;
  // Existing hard filters (preserve)
  if (filter === "vegetarian") list = list.filter(r => r.tags.includes("vegetarian") || r.tags.includes("vegan"));
  else if (filter === "non-veg") list = list.filter(r => r.tags.includes("non-veg"));
  else if (filter === "easy") list = list.filter(r => r.difficulty === "Easy");
  else if (filter === "quick") list = list.filter(r => r.totalMinutes <= 30);
  else if (filter === "south") list = list.filter(r => r.cuisine === "South Indian");

  if (query.trim()) {
    const q = query.toLowerCase();
    list = list.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.tagline.toLowerCase().includes(q) ||
      r.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  // Classify and sort
  const classify = window.MFC?.recipePrefs?.classify;
  const annotated = list.map((r) => {
    if (!classify || !profile) return { recipe: r, score: 0, violations: [] };
    const c = classify(r, profile);
    // Allergy violations always count; identity violations only when respecting prefs
    const filteredViolations = respectPrefs
      ? c.violations
      : c.violations.filter((v) => v.type === 'allergy');
    return { recipe: r, score: respectPrefs ? c.score : 0, violations: filteredViolations };
  });

  annotated.sort((a, b) => {
    const aAvoid = a.violations.length > 0 ? 1 : 0;
    const bAvoid = b.violations.length > 0 ? 1 : 0;
    if (aAvoid !== bAvoid) return aAvoid - bAvoid;
    if (a.score !== b.score) return b.score - a.score;
    return 0;
  });
  return annotated;
}, [query, filter, recipes, profile, respectPrefs]);
```

- [ ] **Step 6: Update the recipe-card render loop to use the annotated list**

Find the existing `filtered.map((recipe) => (...))` (or similar). Update to destructure annotated entries and render badges:

```jsx
{filtered.map(({ recipe, score, violations }) => {
  const isAvoid  = violations.length > 0;
  const isMatch  = !isAvoid && score > 0;
  return (
    <a
      key={recipe.id}
      href={`recipe.html?id=${recipe.id}`}
      className={"recipe-card" + (isAvoid ? " is-avoid" : "")}
    >
      {/* ... existing card body ... */}
      {isMatch && <span className="fc-match-badge">{score} of your prefs</span>}
      {isAvoid && <span className="fc-avoid-badge">{violations[0].label}</span>}
    </a>
  );
})}
```

If the existing markup uses positioned content, ensure the recipe-card has `position: relative;` so the absolute-positioned badges anchor correctly. Add it to `.recipe-card` and `.featured-card` in the CSS block if not already present.

- [ ] **Step 7: Render the soft-pref strip directly above the existing search bar**

Find where the search input is rendered. Above it, add:

```jsx
{profile && profileHasAnyTags(profile) && !dismissed && (
  <div className="softpref-strip">
    <span className="softpref-label">soft-filtering by</span>
    <div className="softpref-chips">
      {[...profile.diet_tags, ...profile.allergies].slice(0, 4).map((t) =>
        <span key={t} className="softpref-chip">{t}</span>
      )}
      {([...profile.diet_tags, ...profile.allergies].length > 4) &&
        <span className="softpref-chip">+{[...profile.diet_tags, ...profile.allergies].length - 4} more</span>
      }
    </div>
    <a href="my/profile.html" className="softpref-edit">edit ↗</a>
    <label className="softpref-toggle">
      <input type="checkbox" checked={respectPrefs} onChange={(e) => setRespectPrefs(e.target.checked)} />
      respect my prefs
    </label>
    <button className="softpref-dismiss" onClick={() => setDismissed(true)} title="Dismiss for this session">×</button>
  </div>
)}
```

- [ ] **Step 8: Smoke-test on every relevant scenario**

Reload `http://localhost:8080/recipe-search.html`.

Test scenarios:

1. **Anonymous (logged out)** — strip not shown; cards render with no badges; no errors in console.
2. **Logged in, empty profile** — strip hidden (no tags); cards render normally.
3. **Logged in, set `vegetarian` in profile** — strip appears with "vegetarian" chip; the 3 non-veg recipes (butter-chicken, chicken-biryani, tandoori-chicken) get .55 opacity + berry "Not vegetarian" badge and sort to the bottom; the 7 vegetarian recipes show a green match badge with their score.
4. **Logged in, set `nut-free` allergy + add a recipe with `nuts` tag in DB temporarily** — cards with nuts get "Contains nuts" badge in berry. (Optional skip if no test recipe.)
5. **Toggle "respect my prefs" off** — identity badges disappear, sort returns to default; allergy badges still rendered.
6. **Click ×** — strip dismissed for the session; reload → strip reappears.

- [ ] **Step 9: Commit**

```bash
git add recipe-search.html
git commit -m "feat(search): soft-pref strip, match/avoid visuals, profile-aware sort"
```

### Task 16: Apply the same treatment to `index.html`'s featured strip

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `<script src="shared/recipe-prefs.js"></script>` near the supabase/auth/db scripts**

(If Task 9, Step 2 already added it permanently for the self-test, this is already done — verify and skip if so.)

- [ ] **Step 2: Add CSS for badges (re-uses `recipe-search.html` vocabulary, but the featured cards may need `position: relative;`)**

Add to the existing `<style>` block:

```css
.featured-card { position: relative; }
.featured-card.is-avoid { opacity: .55; box-shadow: 4px 4px 0 var(--berry); }
.fc-match-badge {
  position: absolute; top: 12px; right: 12px;
  font-family: var(--mono); font-size: 9px; letter-spacing: .1em; text-transform: uppercase;
  background: var(--matcha-soft); color: var(--matcha-deep);
  padding: 4px 8px; border-radius: var(--r-pill); border: 1px solid var(--matcha-deep);
}
.fc-avoid-badge {
  position: absolute; top: 12px; right: 12px;
  font-family: var(--mono); font-size: 9px; letter-spacing: .1em; text-transform: uppercase;
  background: rgba(200,75,90,.16); color: var(--berry);
  padding: 4px 8px; border-radius: var(--r-pill); border: 1px solid var(--berry);
}
```

- [ ] **Step 3: Inside the in-file React, add `useProfile()` (same hook as Task 15, Step 3)**

Place above the main App component.

- [ ] **Step 4: Annotate + sort the featured recipes**

Find where the featured list is rendered (in the App component, the section that maps over a featured-recipes array). Wrap with the same classify/sort logic from Task 15 Step 5, applied to the featured slice:

```jsx
const profile = useProfile();
const annotatedFeatured = React.useMemo(() => {
  const classify = window.MFC?.recipePrefs?.classify;
  const list = featured.map((r) => {
    if (!classify || !profile) return { recipe: r, score: 0, violations: [] };
    return { recipe: r, ...classify(r, profile) };
  });
  list.sort((a, b) => {
    const aAvoid = a.violations.length > 0 ? 1 : 0;
    const bAvoid = b.violations.length > 0 ? 1 : 0;
    if (aAvoid !== bAvoid) return aAvoid - bAvoid;
    return b.score - a.score;
  });
  return list;
}, [featured, profile]);
```

(Replace `featured` with whatever variable holds the featured-recipe list in `index.html`.)

In the render, change `featured.map(...)` to `annotatedFeatured.map(...)` and apply the same badge logic as Task 15 Step 6.

- [ ] **Step 5: Smoke-test**

Reload `http://localhost:8080/index.html` while logged in with vegetarian profile. Featured strip should sort vegetarian recipes first; non-veg recipes get the avoid styling.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(home): featured strip honors profile soft-prefs"
```

### Task 17: Defensive avoid-state badge on dashboard recommendations

**Files:**
- Modify: `js/dashboard-app.jsx`

- [ ] **Step 1: Add `<script src="../shared/recipe-prefs.js"></script>` to `my/dashboard.html`**

(`recipe-prefs.js` lives at `/shared/recipe-prefs.js`; from `my/` the path is `../shared/recipe-prefs.js`.) Insert after the existing `<script src="../shared/db.js"></script>`.

- [ ] **Step 2: In `dashboard-app.jsx`, load the profile and annotate recommendations on render**

Find the component that loads recommendations (search "getRecommendations"). Inside it, add a profile load similar to Task 15 Step 4. Then, when rendering each recommendation card, compute classify and add the avoid badge if there's an allergy violation:

```jsx
const profile = useProfile(); // re-use the same hook pattern; copy from search if not yet shared
// ... existing recommendation render ...
const classify = window.MFC?.recipePrefs?.classify;
const c = (classify && profile) ? classify(recipe, profile) : { score: 0, violations: [] };
const allergyViolations = c.violations.filter((v) => v.type === 'allergy');
return (
  <div className={"reco-card" + (allergyViolations.length ? " is-avoid" : "")}>
    {/* existing card body */}
    {allergyViolations.length > 0 && (
      <span className="fc-avoid-badge">{allergyViolations[0].label}</span>
    )}
  </div>
);
```

CSS for `.is-avoid` and `.fc-avoid-badge`: copy from Task 16 if not already in dashboard's inline `<style>` (or extract to a shared CSS file in a follow-up).

- [ ] **Step 3: Smoke-test**

Reload `http://localhost:8080/my/dashboard.html` with a profile that has `nut-free` allergy. Verify any recommendation that violates shows the avoid styling. (If no recommendation rows exist yet because the pipeline hasn't run, this is a no-op visually — that's fine; verify console-free.)

- [ ] **Step 4: Commit**

```bash
git add my/dashboard.html js/dashboard-app.jsx
git commit -m "feat(dashboard): defensive avoid badge on recommendations that violate allergies"
```

---

## Phase 6 — Documentation update

### Task 18: Update `CLAUDE.md` to reflect the new surface

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "Public pages" line in the Architecture section**

Find the bullet listing the 5 public pages and change "5 public pages" to "6 public pages", adding `my/profile.html` to the list:

```markdown
- 6 public pages: [index.html](index.html), [recipe-search.html](recipe-search.html),
  [recipe.html](recipe.html), [dashboard.html](my/dashboard.html),
  [markers.html](my/markers.html), [profile.html](my/profile.html).
```

Add a sentence after the markers.html bullet:

```markdown
- [profile.html](my/profile.html) imports [profile-app.jsx](js/profile-app.jsx).
  Auth-gated: identity (sex, DOB, units), diet-tag chips, allergies, goals, lifestyle.
  Drives sex-aware ranges on markers.html and soft preferences on recipe-search.html.
```

- [ ] **Step 2: Add `user_profiles` to the Schema layers list**

Find the "**User-owned**" bullet under "Schema layers" and update to:

```markdown
- **User-owned** — `user_profiles`, `saved_recipes`, `cooking_sessions`, `user_prefs`,
  `meal_logs`. RLS scoped to `auth.uid() = user_id`. `user_profiles` holds identity
  (sex/DOB) + diet/allergy/goal tags consumed by both bloodwork ranges and recipe
  ranking.
```

- [ ] **Step 3: Add the new shared scripts to the "Shared JS" section**

Update the numbered list to mention `recipe-prefs.js` and the `mfc:profile-change` event. Insert as item 4 (renumbering subsequent items):

```markdown
4. [shared/recipe-prefs.js](shared/recipe-prefs.js) — `window.MFC.recipePrefs.classify(recipe, profile)`
   returns `{ score, violations[] }`. Single source of truth for soft-pref ranking. Loaded
   on `index.html`, `recipe-search.html`, `my/dashboard.html`, `my/profile.html`.
```

In the auth/profile event section (or as a new line near it), add:

```markdown
`window.MFC.db.upsertUserProfile(payload)` emits `mfc:profile-change` so any open
page (markers, dashboard, search) can re-read the profile and refresh sex-aware
ranges or soft-pref ordering immediately.
```

- [ ] **Step 4: Add `profile-app.jsx` to the Shared assets list**

In the "Shared assets" bullets, after the `admin-shared.jsx` line, add:

```markdown
- [profile-app.jsx](js/profile-app.jsx) — `TAG_TAXONOMY` constant; re-exported on
  `window.MFC.tagTaxonomy` so `recipe-search.html` can keep its chip vocabulary
  in sync without duplication.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for user_profiles, profile page, recipe-prefs.js"
```

---

## Phase 7 — End-to-end verification

### Task 19: Final smoke-test across every surface

**Files:** none

- [ ] **Step 1: Restart dev server clean and walk every flow**

```bash
# kill any stale server first
kill -9 $(lsof -t -i :8080) 2>/dev/null
python3 -m http.server 8080
```

Open in browser, test each surface in order:

1. **Logged-out `index.html`** — featured strip renders without badges, no console errors.
2. **Sign in.** Profile is empty.
3. **`my/profile.html`** — load, fill out: name=anything, sex=female, DOB, diet_tags=[vegetarian, high-protein, gluten-free, indian], allergies=[nut-free], goals=[heart-health]. Save. Reload — selections persist.
4. **`my/markers.html`** — verify hemoglobin shows `Normal: 12–15.5 g/dL` (female-specific). Add a reading of `13.2` → status "ok". New tabs visible: `iron-panel`, `inflammation`, `liver`.
5. **`recipe-search.html`** — soft-pref strip visible with chips; `butter-chicken`, `chicken-biryani`, `tandoori-chicken` are dimmed with "Not vegetarian" badge and sort to bottom; vegetarian recipes show match badges.
6. **`my/dashboard.html`** — pipeline rows (if any) render; no console errors.
7. **`my/profile.html`** → change sex to `male`. Save. Go to `my/markers.html` (open in new tab) — hemoglobin range now `13.5–17.5 g/dL`.

- [ ] **Step 2: Verify no console errors on any surface**

Each page should be silent at the warning/error level. Info-level `[recipe-prefs] 6/6 self-tests passed` is expected.

- [ ] **Step 3: Sign out, verify logged-out flow is clean**

`index.html` and `recipe-search.html` should render without errors when signed out.

- [ ] **Step 4: Final commit (no-op if prior commits already covered this)**

If any tweaks were needed during smoke-test, commit them now:

```bash
git add -A
git status   # review
git commit -m "fix: smoke-test cleanups"
```

---

## Self-review checklist (engineer to confirm before declaring done)

- [ ] All 54 markers seeded; sex-specific values on hemoglobin/ferritin/iron/transferrin_saturation/uric_acid.
- [ ] `user_profiles` table exists, RLS owner-only, trigger maintains `updated_at`.
- [ ] `getUserProfile`/`upsertUserProfile` exposed on `window.MFC.db`; emits `mfc:profile-change` on save.
- [ ] User-menu dropdown order: Profile / Account / —rule— / Sign out (Profile only when `profileHref` is set).
- [ ] `my/profile.html` renders 5 sections, save bar appears only when dirty, allergy chips persist round-trip.
- [ ] Bloodwork ranges respect profile sex; tabs include all 10 categories (`all` + 10).
- [ ] 10 existing recipes carry the new tag arrays in both `recipe-bundles/*/recipe.json` and `public.recipe_tags`.
- [ ] `shared/recipe-prefs.js` self-tests pass on page load (console info).
- [ ] `recipe-search.html` strip + master toggle + dismiss work; allergy violations enforced even when toggle is off.
- [ ] `index.html` featured-strip and `my/dashboard.html` recommendations honor the same classify rules.
- [ ] `CLAUDE.md` mentions `user_profiles`, `recipe-prefs.js`, `mfc:profile-change`, profile-app.jsx.
