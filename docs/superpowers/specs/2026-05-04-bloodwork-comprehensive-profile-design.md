# Comprehensive bloodwork + user profile + soft recipe preferences

Date: 2026-05-04

## Goal

Make the bloodwork page (`my/markers.html`) cover every diet-controllable
blood/nutrition marker a user might see on a standard lab report, give the
ranges sex-awareness where it matters, and feed a new user-profile concept
(diet tags + allergies + goals + lifestyle) into a soft recipe-preference layer
on the search page.

## Non-goals

- CBC differential, coagulation, sex hormones, tumor markers, autoimmune panels
  — not diet-modifiable.
- BMI / blood pressure / body composition — body params, not blood markers.
  Easy to add later under a new `vitals` category.
- Trend charts / multi-reading visualizations — schema already preserves
  history; UI is current-value-only. Separate spec.
- Lab report PDF upload + OCR — schema already accepts `source='lab_upload'`;
  importer is future work.
- Recommender pipeline updates — pipeline lives outside this repo. We document
  the contract; pipeline owns its consumption.
- Locale-specific reference ranges (Indian vs US labs). Use conservative
  global norms.
- Anonymous diet-prefs handoff — profile is signed-in only.

## Schema changes

### `metric_definitions` — sex-aware ranges + description

```sql
ALTER TABLE public.metric_definitions
  ADD COLUMN IF NOT EXISTS normal_min_female numeric,
  ADD COLUMN IF NOT EXISTS normal_max_female numeric,
  ADD COLUMN IF NOT EXISTS normal_min_male   numeric,
  ADD COLUMN IF NOT EXISTS normal_max_male   numeric,
  ADD COLUMN IF NOT EXISTS description       text;
```

- `normal_min` / `normal_max` stay as the unisex fallback.
- Resolution rule (client + pipeline): if user `sex='female'`, prefer
  `normal_min_female ?? normal_min` and `normal_max_female ?? normal_max`.
  Same for male. No-sex / `prefer_not_to_say` falls back to unisex columns.
- `description` is a one-liner explaining what the marker measures and how
  diet affects it; surfaced on the marker card's expanded view.
- Comments added on the new columns following the existing
  `COMMENT ON COLUMN` pattern in `data/db/schema.sql`.

### New `user_profiles` table

```sql
CREATE TABLE public.user_profiles (
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

- One row per user.
- RLS: owner-only `FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id)`. Same pattern as `user_health_markers`.
- Trigger: attach `touch_updated_at` to maintain `updated_at`.
- `diet_tags` / `allergies` / `goals` are separated for UI grouping but their
  values come from a single shared tag namespace that aligns with
  `recipe_tags.tag`.

Why a new table over `user_prefs` (jsonb): profile is identity/health data the
recommender pipeline joins on. Typed columns + indexes beat jsonb for that
workload. `user_prefs` continues to hold ephemeral app state (tweaks, default
servings, voiceover voice).

### `recipe_tags` — no schema change

Already correct shape. Existing rows need richer values; that's a backfill
step, not a schema change.

## Marker catalog (54 entries, idempotent seed)

Replaces the current 21-row `data/db/seed_metrics.sql`. Existing IDs preserved
where they match (`iron`, `ferritin`, `b12`, `b6`, `d3`, `folate`, `vitamin_c`,
`hemoglobin`, `magnesium`, `calcium`, `zinc`, `potassium`, `sodium`,
`cholesterol`, `ldl`, `hdl`, `triglycerides`, `hba1c`, `glucose`, `tsh`,
`creatinine`) so existing user readings don't orphan.

Categories used by the UI: `lipid`, `metabolic`, `iron-panel`, `inflammation`,
`liver`, `kidney`, `vitamin`, `mineral`, `thyroid`, `other`. Three new
categories vs. today: `liver`, `inflammation`, `iron-panel`. Old `blood`
category is folded into `iron-panel`.

Sex-specific normal ranges on **5** markers: `hemoglobin`, `ferritin`,
`iron`, `transferrin_saturation`, `uric_acid`. Everything else uses unisex.

| Category | Markers |
|---|---|
| Lipid | total cholesterol, LDL, HDL, non-HDL, triglycerides, VLDL, ApoB, Lp(a) |
| Glycemic / insulin | fasting glucose, HbA1c, fasting insulin, C-peptide |
| Iron-panel | iron, ferritin, TIBC, transferrin saturation, hemoglobin |
| Inflammation | hs-CRP, homocysteine, uric acid |
| Liver | ALT, AST, GGT, ALP |
| Kidney | albumin, total protein, BUN, creatinine |
| Vitamins, fat-soluble | A (retinol), D (25-OH), E (α-tocopherol), K (phylloquinone) |
| Vitamins, water-soluble | B1, B2, B3, B5, B6, B7, B9 (folate), B12, C |
| Minerals, major | calcium, magnesium, phosphorus, potassium, sodium |
| Minerals, trace | zinc, copper, selenium, iodine (urinary), manganese, chromium |
| Other diet-related | omega-3 index, TSH |

Each row in the seed: `id`, `name`, `unit`, `normal_min`, `normal_max`,
`normal_min_female`, `normal_max_female`, `normal_min_male`, `normal_max_male`,
`category`, `sort_order`, `description`. Seed remains idempotent via
`ON CONFLICT (id) DO UPDATE SET ...` — column list extended to include the new
columns.

Sort order convention: 10s gap per category so admins can wedge in custom rows
between defaults.

## Profile page (`my/profile.html`)

Auth-gated like `my/markers.html`. New file. Same editorial cream/orange
aesthetic. Single-column layout, sectioned.

### Sections (in order)

1. **Identity** — display name, sex (radio pills:
   Female / Male / prefer not to say), date of birth, units (Metric / Imperial).
2. **Diet style** — chip toggles grouped by sub-heading:
   - *How do you eat?*: vegetarian, vegan, pescatarian, gluten-free,
     dairy-free, low-fodmap
   - *Macro orientation*: high-protein, low-carb, low-fat, low-sodium,
     low-sugar
   - *Patterns*: keto, paleo, mediterranean, whole30
   - *Cuisine preference*: indian, asian, mediterranean, mexican, italian
   - *Time / effort*: quick, one-pot, batch-cook
3. **Allergies & exclusions** — nut-free, egg-free, soy-free, shellfish-free
4. **Goals** — weight-loss, muscle-gain, energy, heart-health, gut-health
5. **Lifestyle** — halal, kosher, jain, warming, cooling, raw

### Interaction

- All chips are toggleable. Selected = filled with `--ink` background,
  `--paper` text, pop-shadow. Unselected = `var(--paper)` bg with `--rule-strong`
  border. Same chip vocabulary as `markers.html` `.filter-chip`, restyled.
- Sex / units use radio pills (same chip atom, radio-group semantics).
- Date of birth is `<input type="date">` with `max=today`.
- Save bar (`shared/admin-shared.jsx::SaveBar` is admin-only — recreate the
  pattern locally) appears sticky-bottom only when `dirty=true`. No
  auto-save on blur.
- Empty profile is fine. All fields optional. Page loads with empty state
  and the line: *"Your bloodwork ranges and recipe suggestions get sharper
  as you fill this in."*
- Display name prefills from `user.user_metadata.full_name` on first load
  if the field is currently null. Saved back on first manual save.

### JS

- New `js/profile-app.jsx` — single file, mirrors structure of
  `js/markers-app.jsx`. Inline styles in a `PROFILE_STYLE` template literal.
- Inline `useAuthGuard()` reused (consider promoting to `shared/auth.js` in a
  follow-up; not in scope here).
- Tag taxonomy lives in a single `TAG_TAXONOMY` constant at the top of
  `profile-app.jsx`. Re-exported on `window.MFC.tagTaxonomy` so
  `recipe-search.html` can import the same constants without duplication.

### `shared/db.js` additions

```js
async function getUserProfile() {
  // returns { user_id, display_name, sex, date_of_birth, diet_tags[],
  //   allergies[], goals[], units, updated_at } | null
}

async function upsertUserProfile(payload) {
  // upserts the single row keyed on user_id; emits mfc:profile-change
  // returns boolean
}
```

Both follow the existing `null` / `false` anonymous-fallback pattern.

After successful save, dispatch `window.dispatchEvent(new CustomEvent(
'mfc:profile-change', { detail: { profile } }))` so any other open page tab
(markers, dashboard) can refresh sex-aware ranges immediately.

## Soft recipe preferences

### How profile tags map to recipe matching

Three classes of profile tag, each handled differently:

| Class | Tags | Behavior |
|---|---|---|
| **Allergy** | nut-free, egg-free, soy-free, shellfish-free | Hard violation — recipe enters avoid state with badge "Contains nuts" / etc. Always enforced; not affected by the master toggle. |
| **Dietary identity** | vegetarian, vegan, pescatarian, gluten-free, dairy-free, low-fodmap, halal, kosher, jain | Compatibility check — if a recipe contradicts the identity (e.g. user is vegetarian, recipe tagged `non-veg`), enters avoid state with badge "Not vegetarian". Subject to master toggle. |
| **Soft preference** | high-protein, low-carb, low-fat, low-sodium, low-sugar, keto, paleo, mediterranean, whole30, indian, asian, mexican, italian, quick, one-pot, batch-cook, weight-loss, muscle-gain, energy, heart-health, gut-health, warming, cooling, raw | Adds to match score when present in `recipe.tags`. Never violates. |

Cuisine prefs (indian / asian / mediterranean / mexican / italian) match
case-insensitively against `recipes.cuisine` (e.g. profile `indian` matches
`recipes.cuisine` of `"North Indian"` or `"South Indian"`); they don't need
to appear in `recipe_tags`.

The `mediterranean` token appears in both *Patterns* and *Cuisine preference*
groups in the profile UI. If a user selects it under either, the match
treatment is the same (boost mediterranean recipes); de-dupe at match time.

### Match score

```
score = (# soft-pref tags present in recipe.tags)
      + (1 if any cuisine pref ⊂ recipes.cuisine else 0)
```

Sort: avoid-state recipes last; among non-avoid, score desc, then existing
default order.

### Dietary-identity compatibility table

A recipe violates a dietary-identity profile tag per this map. Encoded as a
plain JS lookup in `shared/recipe-prefs.js` (new file) and reused by every
surface that ranks recipes:

| Profile tag | Violates if recipe has tag... |
|---|---|
| `vegetarian` | `non-veg` |
| `vegan` | `non-veg`, `dairy`, `egg` (or absence of `vegan` and presence of `vegetarian`) |
| `pescatarian` | `non-veg` *and not* `seafood`/`fish` |
| `gluten-free` | absence of `gluten-free` tag (assume unsafe by default) |
| `dairy-free` | `dairy`, or `vegetarian` without `vegan` (heuristic) |
| `low-fodmap` | absence of `low-fodmap` tag |
| `halal` | `pork`, `alcohol`; or `non-veg` without `halal` |
| `kosher` | `pork`, `shellfish`; or `non-veg` without `kosher` |
| `jain` | `non-veg`, `onion`, `garlic`, `root-veg` |

Allergy violations are simpler: profile `nut-free` violates when recipe has
tag `nuts`; same pattern for `egg`, `soy`, `shellfish`, `dairy`, `gluten`.

Recipes that lack a clear classification (no `vegetarian` / `vegan` /
`non-veg` tag at all) default to *neutral* — never violate, never match. This
keeps the system safe by default and incentivizes complete tagging.

The compatibility table will need new "ingredient-class" recipe tags
(`dairy`, `egg`, `nuts`, `soy`, `shellfish`, `gluten`, `pork`, `alcohol`,
`seafood`, `fish`, `onion`, `garlic`, `root-veg`, `halal`, `kosher`) — these
are auto-derivable from `recipe_ingredients` in a future pass; for v1 the
backfill adds them manually for the 10 recipes.

### Visual states

- **Match (score ≥ 1, no violation)**: full opacity, small matcha-green
  badge top-right: *"4 of your prefs"* in mono caps. Card unchanged
  otherwise.
- **Neutral**: card unchanged from current; no badge.
- **Avoid** (allergy violation OR dietary-identity contradiction): 0.55
  opacity, subtle berry-tinted ring, berry badge with the specific reason —
  *"Contains nuts"* / *"Not vegetarian"* / *"Contains gluten"*. If multiple
  reasons, badge shows the first; tooltip lists all. Still clickable. Sorted
  last. Allergy violations always enforced; dietary-identity violations
  honored only when the master toggle is ON.

### Header strip (recipe-search.html)

Below the existing search bar, only when signed-in *and* the profile has any
relevant tags set:

```
Soft-filtering by your prefs: [high-protein] [gluten-free] [+3 more]   [edit ↗]
```

- Read-only chips (greyed bg).
- `edit ↗` → `my/profile.html`.
- `×` button to dismiss for the session (sessionStorage flag; re-appears next
  visit). Independent of the master toggle.
- Master toggle on the same strip: *"Respect my prefs"*. Default ON. When
  OFF, sort and dietary-identity demotion revert to current behavior for the
  session. Allergy violations are still rendered (safety, not preference) —
  the toggle controls preference-driven sort/visual, not allergen flagging.

### Existing hardcoded filter chips

`vegetarian`, `non-veg`, `easy`, `quick`, `south` — left as hard filters,
unchanged. They're page-level, not profile-driven, and useful for one-off
browsing. The soft-pref strip layers on top.

### Where this applies

- `recipe-search.html` — primary surface.
- `index.html` — featured strip uses the same sort + visual rules.
- `my/dashboard.html` — pipeline-generated recommendations already account
  for prefs server-side. Client renders the avoid-state badge defensively if
  any pipeline row violates an allergy.

## User-menu update (`shared/user-menu.jsx`)

- Add `profileHref` prop. Render Profile link above Account in the dropdown.
- If `profileHref` is omitted, the Profile item is hidden (graceful default
  for callers not yet updated). Same pattern `accountHref` follows today.
- All pages mounting `<MfcUserMenu>` get a one-line update to pass
  `profileHref` (path differs by depth):
  - Root pages (`index.html`, `recipe-search.html`, `recipe.html`): `my/profile.html`
  - `my/*` pages: `profile.html`
  - `admin/*` pages: `../my/profile.html`

## Auth redirect contract (`shared/auth.js`)

- Add `my/profile.html` to `STAY_ON_PATHS` so signing in from the profile
  page doesn't bounce to the dashboard.

## Recipe tag backfill (in scope)

Existing 10 recipes:

```
aloo-gobi:           vegetarian, vegan, gluten-free
butter-chicken:      non-veg
chicken-biryani:     non-veg
chole-bhature:       vegetarian, high-fiber
dal-makhani:         vegetarian, high-protein
masala-dosa:         vegetarian, gluten-free
palak-paneer:        vegetarian, iron-rich
paneer-butter-masala: vegetarian, gluten-free
rajma-chawal:        vegetarian, high-protein
tandoori-chicken:    non-veg, gluten-free
```

Re-tag manually through `admin/recipe.html` against the new taxonomy. ~30 min
work, 10 recipes. Human judgment matters for tags like `mediterranean` /
`low-carb`. AI-assist becomes worth it past ~30 recipes.

Each recipe needs:

1. **Dietary identity** — at least one of `vegetarian`, `vegan`, `non-veg`
   (existing convention). For `non-veg`, also add `halal` / `kosher` / etc.
   if applicable.
2. **Allergen / ingredient-class tags** — `dairy`, `egg`, `nuts`, `soy`,
   `shellfish`, `gluten`, `pork`, `alcohol`, `seafood`, `fish`, `onion`,
   `garlic`, `root-veg` — whichever apply, so the compatibility resolver
   can flag violations.
3. **Soft-pref tags from the new taxonomy** — `high-protein`, `low-carb`,
   `mediterranean`, etc. — pick whichever genuinely apply.

`iron-rich` and `high-fiber` (existing free-text tags) are not in the new
taxonomy. Leave them on recipes that have them — recipe_tags is free-text;
they just won't be picker-selectable in the profile UI. They can be removed
in a later cleanup once recipe-page UI no longer surfaces them.

## Affected files

**New:**
- `my/profile.html`
- `js/profile-app.jsx`
- `shared/recipe-prefs.js` — `MFC.recipePrefs.classify(recipe, profile)`
  returning `{ score, violations[] }`. Single source of truth for compat
  table + scoring. Loaded on `index.html`, `recipe-search.html`,
  `my/dashboard.html`.
- `data/db/migration-2026-05-04-profiles-and-marker-ranges.sql` (delta script
  — apply on top of existing schema in Studio)

**Modified:**
- `data/db/schema.sql` — add `user_profiles` table, RLS, trigger; add new
  `metric_definitions` columns; update column COMMENT lines.
- `data/db/seed_metrics.sql` — replace 21 rows with the 54-row catalog;
  preserve existing IDs.
- `shared/user-menu.jsx` — `profileHref` prop, Profile menu item.
- `shared/auth.js` — `my/profile.html` in `STAY_ON_PATHS`.
- `shared/db.js` — `getUserProfile`, `upsertUserProfile`.
- `js/markers-app.jsx` — sex-aware range resolution, expanded category tabs
  (add `liver`, `inflammation`, `iron-panel`), pass `profileHref` to user menu.
- `js/dashboard-app.jsx` — pass `profileHref`; defensive avoid-state badge
  on recommendation cards.
- `recipe-search.html` (in-file React) — soft-pref strip + master toggle,
  match/avoid visuals, sort logic, pass `profileHref`.
- `index.html` (in-file React) — featured strip uses same sort/visual rules,
  pass `profileHref`.
- `recipe.html` — pass `profileHref`.
- `admin/*.html` (recipes/recipe/ingredients/ingredient/utensils/utensil) —
  pass `profileHref` (`../my/profile.html`).
- `data/recipe-bundles/*/recipe.json` — re-tag against new taxonomy
  (10 files).
- `CLAUDE.md` — add `user_profiles` to schema layers list, mention
  `mfc:profile-change` event, add `profile-app.jsx` to shared-JS section.

## Open items (acknowledged, decided)

1. **Display-name source**: prefill from `user.user_metadata.full_name` on
   first profile-page load if empty; persist on first manual save.
2. **Anonymous → authed handoff**: profile is signed-in-only. No pre-auth
   diet picker. Existing `db.handoffAnonymous` untouched.
3. **Recommender pipeline contract**: documented in this spec; pipeline owns
   the implementation.

## Sequencing (rough order, real plan in writing-plans step)

1. Schema migration (`metric_definitions` columns + `user_profiles` table).
2. Seed catalog rewrite (54 markers, sex variants, descriptions).
3. `shared/db.js` additions (`getUserProfile`, `upsertUserProfile`).
4. `shared/recipe-prefs.js` (compat table + scoring).
5. `shared/user-menu.jsx` Profile item + `profileHref` plumbing on every
   mounting page.
6. `my/profile.html` + `js/profile-app.jsx`.
7. `js/markers-app.jsx` sex-aware ranges + new category tabs.
8. Recipe-tag backfill on the 10 existing recipes (identity, allergen, soft
   tags).
9. `recipe-search.html` soft-pref strip, sort, visual states (consumes
   `recipe-prefs.js`).
10. `index.html` featured-strip same treatment.
11. `js/dashboard-app.jsx` defensive avoid badge.
12. `CLAUDE.md` updates.
