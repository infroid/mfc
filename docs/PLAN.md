# Schema redesign + post-auth redirects + dashboard

## Context

Three threads of change:

1. **Clean-slate schema redesign.** The just-merged admin work bolted FK columns onto `recipe_ingredients` / `recipe_utensils` while keeping legacy free-text columns for backward compatibility. The user is willing to drop all tables and re-seed, so we can remove the dual-column ugliness. Concretely:
   - `recipe_utensils.name` is part of the PK and `NOT NULL`, which is awkward (forced lookup-and-write of `name` in [shared/admin-db.js](shared/admin-db.js):163-194).
   - [shared/db.js](shared/db.js):51-118 `getRecipe()` still maps `i.ingredient` and `u.name` (free-text) into the public-site shape; consumers ([recipe-components.jsx](recipe-components.jsx):286-294, 309-314) read those fields. After the wipe, those columns won't exist, so the public read path must JOIN the library tables.
   - The user also asked for "no cascade effect" when deleting ingredients/utensils — i.e. an ingredient referenced by N recipes shouldn't blow up those recipes when removed.

2. **Post-auth redirects.** Today both `redirectTo` (OAuth) and `emailRedirectTo` (magic link) hardcode `window.location.href` in [shared/auth.js](shared/auth.js):57, 65; `onAuthStateChange` ([shared/auth.js](shared/auth.js):36-46) emits an event but performs no navigation. Sign-out buttons ([index.html](index.html):956, [recipe-search.html](recipe-search.html):437) just call `signOut()` without redirecting. Goal: post-login → `my/dashboard.html`; post-logout → `index.html`.

3. **Dashboard page.** No `my/dashboard.html` exists. The closest analog is `AuthedPersonalize` ([index.html](index.html):1247-1338) — a logged-in panel embedded in the landing page. Lift the recommendations half into a real dashboard alongside saved recipes, continue-cooking, recent meal log. Move the editable markers panel into its own page.

Plus expanding USER-TODO.md §4 ("how to make a user admin") with a self-contained how-to.

## Approach

### A. Schema (clean wipe)

Single schema file [data/db/schema.sql](data/db/schema.sql), idempotent via `CREATE TABLE IF NOT EXISTS`. Add a one-time **`DROP` block at the top** that's commented out by default — user uncomments it on the wipe pass:

```sql
-- DESTRUCTIVE: uncomment to wipe everything before re-applying the schema.
-- DROP TABLE IF EXISTS public.meal_logs, public.cooking_sessions, public.saved_recipes,
--   public.recommendations, public.user_health_markers, public.user_prefs,
--   public.recipe_health_facts, public.recipe_tags, public.recipe_utensils,
--   public.recipe_steps, public.recipe_ingredients, public.utensil_buy_links,
--   public.recipes, public.utensils, public.ingredients, public.metric_definitions
--   CASCADE;
-- DROP FUNCTION IF EXISTS public.touch_updated_at, public.is_admin CASCADE;
```

Schema changes (full text in the implementation pass):

- **`ingredients`**:
  - `id text PK`, `name`, `tagline`, `category text`, `default_unit text`, `photo text`,
    `nutrition jsonb`, `health_fact text`, `storage text`, `substitutes text[]`,
    `show jsonb`, `ai_filled_at timestamptz`, `created_at`, `updated_at`,
    **`created_by uuid REFERENCES auth.users(id)`**.

- **`utensils`**:
  - Drop `buy_link jsonb` — replace with one-to-many **`utensil_buy_links`** (`utensil_id`, `sort_order`, `store text`, `url text`, `price text`, `affiliate_tag text`). PK `(utensil_id, sort_order)`. Future-flexible (Amazon + iHerb + …).
  - Add `created_by`.

- **`recipes`** — keep current shape, add `created_by uuid REFERENCES auth.users(id)`.

- **`recipe_ingredients`** — clean shape, no legacy columns:
  ```sql
  recipe_id    text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sort_order   int  NOT NULL,
  ingredient_id text NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  group_name   text,
  amount       text,
  unit         text,
  PRIMARY KEY (recipe_id, sort_order)
  ```
  Drop the legacy `ingredient` (text) column.

- **`recipe_utensils`** — clean shape with synthetic ordering:
  ```sql
  recipe_id   text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sort_order  int  NOT NULL,
  utensil_id  text NOT NULL REFERENCES utensils(id) ON DELETE RESTRICT,
  essential   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (recipe_id, sort_order)
  ```
  Drops the legacy `name` PK column. Removes the lookup-and-write workaround in admin-db.js.

- **Cascade behavior** (the user's "no cascade effect" requirement):
  - `recipe_ingredients.ingredient_id → ingredients.id` is **`ON DELETE RESTRICT`**. Hard delete is allowed only when the row is unused; otherwise the database rejects the delete. Admin UI also pre-checks usage and disables the delete button when `usage > 0`, so the server-side `RESTRICT` is a defense-in-depth guard.
  - Same for utensils.
  - No `deleted_at` / soft-delete column. Simpler schema.
  - Recipe → child join cascades stay (deleting a recipe deletes its ingredients/steps/utensils/tags/health rows — that's intended).
  - `meal_logs.recipe_id → recipes(id) ON DELETE SET NULL` stays — preserves diary history when a recipe is removed.

- **Admin RLS unchanged** from the just-added §7 — `is_admin()` predicate, public read on catalog/library, admin write everywhere.

- **Triggers**: extend `touch_updated_at` to all tables that have `updated_at`.

### B. Public-site read path ([shared/db.js](shared/db.js))

`getRecipe(id)` — change the nested select to JOIN the library tables; the rest of the function and the consumers stay untouched:

```js
const { data } = await sb.from('recipes').select(`
  id, name, tagline, short_tagline, cuisine, difficulty, servings, total_minutes, media,
  recipe_ingredients ( sort_order, group_name, amount, unit,
    ingredient:ingredients ( id, name, photo ) ),
  recipe_steps ( ... ),
  recipe_utensils ( sort_order, essential,
    utensil:utensils ( id, name, photo ) ),
  ...
`).eq('id', id).maybeSingle();
```

Then in the mapper, surface `i.ingredient.name` / `u.utensil.name` as `name`, preserve `amt`/`unit`. [recipe-components.jsx](recipe-components.jsx) consumers continue to read `ing.name` / `u.name` — no JSX changes needed.

### C. Auth redirects + dashboard

**Redirect mechanics**, [shared/auth.js](shared/auth.js):

- Module-level constants near the top: `const POST_LOGIN = 'my/dashboard.html'`, `const POST_LOGOUT = 'index.html'`. Pages that should *not* be the post-login target list themselves in a `STAY_ON_PATHS` set: `recipe.html` (mid-cook), `my/dashboard.html` (already there), all pages under `admin/` (admin gate handles its own).
- `signIn({ email })` and `signIn({ provider: 'google' })`: pass an absolute URL to `redirectTo` / `emailRedirectTo`. The URL is `${origin}/${POST_LOGIN}` *unless* the caller is on a `STAY_ON_PATHS` page (then it's `window.location.href` — current behavior preserved for mid-cook etc.).
- In-tab fallback: on `onAuthStateChange` `SIGNED_IN`, if `location.pathname` is *not* in `STAY_ON_PATHS` and *not* already `my/dashboard.html`, navigate to dashboard. Skips when the user signed in mid-cook on `recipe.html`.
- `signOut()`: navigate to `${origin}/${POST_LOGOUT}` after the call settles. (Single rule — even from recipe.html, signing out goes home.)

Caller-level changes:

- [index.html](index.html):956, [recipe-search.html](recipe-search.html):437 — sign-out button onClicks can stay; the navigation now lives inside `signOut()`.
- Sign-in modal calls in [index.html](index.html):878,885, [recipe-search.html](recipe-search.html):362,369 — unchanged.

**Dashboard page** (`my/dashboard.html` + `dashboard-app.jsx`):

- Same shell as the public pages (recipe-base.css tokens, supabase + auth + db scripts).
- If not signed in → redirect to `index.html`.
- Sections (top-down):
  1. **Hero** — "Hey, {first name}" + small "sign out" action.
  2. **Next meal · recommended for you** — picks the meal slot from a time-of-day helper (lift `defaultMealTypeForNow()` from [index.html](index.html) into `shared/meal-time.js`). Calls `MFC.db.getRecommendations(slot)` and `getRecipes()` to render cards. Header includes a slot-switcher so the user can also see other meal slots, but defaults to the current next-meal one.
  3. **Continue cooking** — adds `MFC.db.getActiveSessions()` to [shared/db.js](shared/db.js) — selects from `cooking_sessions where user_id = auth.uid() and completed_at is null order by updated_at desc limit 5`. Each row links to `recipe.html?id=…&resume=1`.
  4. **Saved recipes** — `MFC.db.getSaved()` joined to `getRecipes()` for the card grid. Empty state: "Tap the heart icon on a recipe to save it."
  5. **Recent meal log** — last 5 rows from `MFC.db.getMealLogs({ from: <7 days ago> })`, with a quick-add row at top (meal type select + recipe select + servings + log button → `MFC.db.logMeal()`).
  6. **Footer link** — "Manage blood markers →" pointing to the new `my/markers.html`.
- No editable health markers panel on dashboard. That moves to a new dedicated page.
- Reuses existing CSS: `recipe-base.css` for tokens. Cards reuse the recipe-search card style if applicable; otherwise a small `dashboard.css` for layout.

**Blood markers page** (`my/markers.html` + `markers-app.jsx`):

- New page. Lifts the markers-only half of `AuthedPersonalize` ([index.html](index.html):1247-1300) — `MarkerRow`, `getMetricDefinitions`, `getHealthMarkers`, `upsertHealthMarker`.
- Sections:
  1. Header: "Your blood markers" + explainer text ("We compute personalized recommendations from these — your offline pipeline reads them and writes to `recommendations`").
  2. Marker list grouped by category, editable inline (date + value).
  3. Footer note: "Recommendations refresh once your data pipeline runs — usually within a few hours."
- Linked from: dashboard footer; landing page's `Personalize` section gets a "Manage your markers →" CTA when logged in.

**Landing page treatment** ([index.html](index.html)) — `AuthedPersonalize` continues to render inline for visits to index.html that *don't* go through the post-login redirect (e.g. a logged-in user manually navigating). Add a small "Open dashboard →" CTA in its header.

### D. Doc + ops

- **USER-TODO.md** §4 — expand admin-role grant to a self-contained how-to:
  - Walkthrough: Authentication → Users → click row → Raw user meta data tab.
  - Exact JSON to paste under **App Metadata**: `{ "role": "admin" }`.
  - Note that `app_metadata` is JWT-issuer-controlled, *not* `user_metadata` (which the user can edit themselves) — important for security.
  - SQL alternative for power users:
    ```sql
    UPDATE auth.users
       SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
     WHERE email = 'you@example.com';
    ```
  - Note re-auth requirement for the JWT to refresh.
  - Verification: visit `admin/recipes.html`, expect the list — not the gate.

- **CLAUDE.md** — note the redirect contract (post-login → dashboard, post-logout → home, recipe.html exempt) and the FK-RESTRICT delete behavior on libraries.

- **scripts/import_recipes.mjs** — must be updated post-wipe because it currently writes `recipe_ingredients(ingredient text, amount text)` and `recipe_utensils(name text)`. Change it to:
  - For each unique ingredient name found in seed JSON, **upsert** an `ingredients` library row (id = slug(name), name, default_unit guessed from amount string).
  - For each unique utensil name, upsert into `utensils`.
  - Then write the recipe joins with `ingredient_id` / `utensil_id` instead of free-text.
  - Idempotent: re-runs reconcile to the same state.

## Files to modify / create

**Modify:**
- [data/db/schema.sql](data/db/schema.sql) — DROP block at top, replace recipe_ingredients/recipe_utensils with FK-only shape, add `utensil_buy_links`, `created_by` columns, triggers/policies.
- [shared/db.js](shared/db.js) — `getRecipe` JOIN library tables; add `getActiveSessions()`.
- [shared/auth.js](shared/auth.js) — `POST_LOGIN` / `POST_LOGOUT` / `STAY_ON_PATHS`, redirect logic in `signIn` / `signOut` / `onAuthStateChange`.
- [shared/admin-db.js](shared/admin-db.js) — drop the recipe_utensils name-lookup workaround now that `name` is gone; everything else stays.
- [admin-recipe-app.jsx](admin-recipe-app.jsx) — drop the `ingredient` / `name` legacy fallbacks in `fromDb` / `toDb`; library lookups assume FK presence.
- [scripts/import_recipes.mjs](scripts/import_recipes.mjs) — auto-create library rows, write FK joins.
- [USER-TODO.md](USER-TODO.md) §4 — expand admin-role grant doc with both Studio path and SQL alternative.
- [CLAUDE.md](CLAUDE.md) — redirect contract + delete contract.
- [index.html](index.html) — leave `AuthedPersonalize` intact; add a small "Open dashboard →" CTA when user is logged in.

**Create:**
- `my/dashboard.html` + `dashboard-app.jsx` — sections from the answer set (next-meal recommendations, continue cooking, saved, recent meal log).
- `my/markers.html` + `markers-app.jsx` — separate blood-markers editor.
- `shared/meal-time.js` — `defaultMealTypeForNow()` extracted from index.html so dashboard can reuse.
- Optional: `dashboard.css` if needed beyond recipe-base.css.

## Reuse

- `MFC.db.getMetricDefinitions()`, `getHealthMarkers()`, `getRecommendations()`, `getRecipes()`, `getSaved()`, `getMealLogs()`, `logMeal()`, `upsertHealthMarker()` — all in [shared/db.js](shared/db.js). Already used by `AuthedPersonalize`. Dashboard uses these + a new `getActiveSessions()`.
- `MFC.auth.getUser()`, `isLoggedIn()` — [shared/auth.js](shared/auth.js).
- `useAuth()` pattern — defined inline in each public page, copy to dashboard / markers.
- Design tokens & cards — [recipe-base.css](recipe-base.css), [recipe-styles.css](recipe-styles.css).
- Admin-side schema/RLS pattern (`is_admin()`, public read + admin write) is already correct; just reapply post-wipe.

## Verification

After implementation:

1. **Schema** — `psql -f data/db/schema.sql` (with the DROP block uncommented once) succeeds; `\dt` shows the expected tables; `\d recipe_ingredients` shows the FK-only shape.
2. **Re-seed** — `SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/import_recipes.mjs` populates `ingredients`, `utensils`, `recipes`, joins. Output: "ingredients populated · utensils populated · recipes populated".
3. **Public site** — `python3 -m http.server 8080`, visit `/recipe.html?id=paneer-butter-masala`. Ingredients & utensils render with the correct names (proves the JOIN read works).
4. **Auth redirect — magic link**: from `index.html`, sign in with email → click magic link → land on `my/dashboard.html`. From `my/dashboard.html`, sign out → land on `index.html`.
5. **Auth redirect — Google OAuth**: same outcome.
6. **Mid-cook stay**: open `recipe.html?id=…` (no auth), sign in via a modal launched from there → land back on the *same* recipe page (not dashboard). Sign out → home.
7. **Dashboard content** — "Continue cooking" lists in-progress sessions; "Saved recipes" shows hearted recipes; "Recommended" defaults to the current meal slot per `defaultMealTypeForNow()` and offers slot-switcher; "Recent meal log" shows last 5 + quick-add row; footer link goes to `my/markers.html`.
8. **Markers page** — `/my/markers.html` shows the blood-markers editor; entering a value upserts to `user_health_markers`; nothing else on the page.
9. **Hard delete blocked when in use** — admin "delete" button is disabled with a "used by N recipes" hint when `usage > 0`. Direct API attempt hits FK `RESTRICT` and returns an error; row remains.
10. **Hard delete succeeds when unused** — create a new ingredient, don't reference it, delete it → succeeds.
11. **Admin gate** — sign in as a non-admin user, visit `/admin/recipes.html`, expect "Not authorized" panel. Grant role per USER-TODO.md §4, sign out + back in, expect the recipes list.
12. **Re-import idempotent** — re-run `node scripts/import_recipes.mjs` after a successful run; row counts unchanged, no duplicate library entries.
