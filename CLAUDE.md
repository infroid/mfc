# CLAUDE.md

Guidance for Claude Code working in this repo.

## Style

- Code and docs: concise, precise, no filler
- Docs and MD files: bullet points, no paragraphs unless necessary
- No comments unless the why is non-obvious
- No abstractions beyond what the task needs

## Project

Marketing + recipe site for MyFoodCraving (Infroid Technologies). Static frontend
on GitHub Pages, dynamic data from Supabase. See [README.md](README.md) for the
public-facing summary and [USER-TODO.md](docs/USER-TODO.md) for setup steps the human
performs (project creation, schema apply, auth config, recipe import).

## Dev

The static site has no build system. Backend tooling is a Python CLI in
`automation/` driven by a root `Makefile`.

```
make                   # list every Make target
make serve             # http.server on :8080
make sync              # sync the python venv (after editing automation/pyproject.toml)
make status            # supabase: list public tables + row counts
make list-users        # supabase: list users; optional ROLE=user|chef|admin Q=alice
make set-role          # supabase: change role; USER=<email> ROLE=<user|chef|admin>
make suspend-user      # supabase: ban a user; USER=<email-or-uuid>
make sync-recipes      # supabase: sync recipes (DB + bundles + images); interactive (or DIRECTION=)
make sync-images       # supabase: sync images bucket↔local; interactive (or DIRECTION=)
make reset             # supabase: drop + apply schema + seed metrics + push recipes
```

If port 8080 is in use:

```
kill -9 $(lsof -t -i :8080)
make serve
```

## Architecture

- React 18 + Babel Standalone loaded from CDN; JSX compiled in-browser via
  `<script type="text/babel">`
- 7 public pages: [index.html](web/index.html), [recipe-search.html](web/recipe-search.html),
  [recipe.html](web/recipe.html), [dashboard.html](web/my/dashboard.html),
  [markers.html](web/my/markers.html), [account.html](web/my/account.html),
  [profile.html](web/my/profile.html). Each is mostly self-contained.
- [recipe.html](web/recipe.html) imports [recipe-app.jsx](web/assets/js/app/recipe-app.jsx),
  [recipe-components.jsx](web/assets/js/lib/recipe-components.jsx),
  [tweaks-panel.jsx](web/assets/js/lib/tweaks-panel.jsx) at runtime via `<script type="text/babel" src="…">`
- [dashboard.html](web/my/dashboard.html) imports [dashboard-app.jsx](web/assets/js/app/dashboard-app.jsx).
  Auth-gated: redirects to index.html if not signed in. Also runs a defensive
  client-side allergy check on pipeline recommendations.
- [markers.html](web/my/markers.html) imports [markers-app.jsx](web/assets/js/app/markers-app.jsx).
  Auth-gated: blood marker editor only. Mounts the biological-sex gate when
  `user.biologicalSex` is null — answer is permanent and stored in
  `auth.users.user_metadata.biological_sex`.
- [account.html](web/my/account.html) imports [account-app.jsx](web/assets/js/app/account-app.jsx).
  Identity page: editable display name, read-only biological sex (set via
  bloodwork gate). Both live on `auth.users.user_metadata`.
- [profile.html](web/my/profile.html) imports [profile-app.jsx](web/assets/js/app/profile-app.jsx).
  Food/health preferences: date_of_birth, units, diet style, allergies, goals,
  lifestyle. Powers the soft-pref strip on /recipe-search.html.
- Chef portal: list + edit for recipes at
  [chef/recipes.html](web/chef/recipes.html) and
  [chef/recipe.html](web/chef/recipe.html). Gated by
  `app_metadata.role ∈ {chef, admin}`; chefs see + edit recipes they
  own (via `recipe_owners`), admins see + edit any.
- Admin shell: ingredient + utensil libraries, users, and dashboard
  ([admin/ingredients.html](web/admin/ingredients.html),
  [admin/ingredient.html](web/admin/ingredient.html),
  [admin/utensils.html](web/admin/utensils.html),
  [admin/utensil.html](web/admin/utensil.html),
  [admin/users.html](web/admin/users.html)). Gated by
  `app_metadata.role = 'admin'`. Recipe management lives in the chef
  portal, not here.
- Supabase JS client loaded from CDN; bootstrapped from `<meta>` tags in each
  page's `<head>`

## Data layer

- **Source of truth: Supabase Postgres**, accessed via the Supabase JS client.
  No static-JSON fallback at runtime.
- [web/assets/recipes/{id}/recipe.json](web/assets/recipes/) is the **bundle
  seed** for `make sync-recipes` (the Python CLI in `automation/`); not
  fetched by the browser. Each bundle is self-contained (listing fields +
  full detail). Bidirectional: `DIRECTION=push` upserts the bundle into DB,
  `DIRECTION=pull` rebuilds the bundle from DB rows.
- Recipe images live in **Supabase Storage** (`recipe-images` bucket). Hero
  at `<recipe_id>/hero.jpg`, steps at `<recipe_id>/step-<sort_order>.jpg`.
  Full Storage URLs are persisted on `recipes.media.hero.src` (canonical;
  the legacy `media.image` was retired by an idempotent migration in
  schema.sql) and `recipe_steps.media_src`. Bytes can be pulled to
  `web/assets/recipes/<id>/...` via `make sync-images DIRECTION=pull` for
  offline editing, then pushed back with `DIRECTION=push`. Path/filename
  matches local exactly.

## Schema

- [automation/db/schema.sql](automation/db/schema.sql) — 16 tables, RLS, triggers. Every
  table and column has a `COMMENT ON` description that surfaces in Supabase
  Studio. Idempotent: safe to re-apply.
- [automation/db/seed_metrics.sql](automation/db/seed_metrics.sql) — 54-marker catalog
  (`metric_definitions`) across 10 categories: lipid, metabolic, iron-panel,
  inflammation, liver, kidney, vitamin, mineral, thyroid, other. Sex-specific
  bounds override the unisex baseline on iron, ferritin, hemoglobin,
  transferrin_saturation, uric_acid, and creatinine. Each row carries a
  `description` one-liner that surfaces on the marker card.

Schema layers:

- **Catalog** — `recipes` (with `created_by` audit FK to auth.users,
  NOT NULL after sub-project #2), `recipe_ingredients`, `recipe_steps`
  (with `media_src` for the full Supabase Storage URL of the step
  image), `recipe_utensils`, `recipe_tags`, `recipe_health_facts`.
  Public read, admin writes via secret key or signed-in admin user
  (RLS via `public.is_admin()`); chef writes via
  `public.recipe_owned_by_caller()` checking `recipe_owners`.
- **Recipe ownership** — `recipe_owners (recipe_id, user_id)` join
  table is the single source of truth for who-can-edit. Trigger
  `recipes_after_insert_set_owners` adds (id, creator) and
  (id, first-admin) on every recipes INSERT.
- **Library** — `ingredients`, `utensils`, `utensil_buy_links`. Master tables
  that recipes pick from. `recipe_ingredients.ingredient_id` and
  `recipe_utensils.utensil_id` FK into these with `ON DELETE RESTRICT` — a
  library row cannot be deleted while any recipe references it. The admin UI
  pre-checks usage and disables delete when `usage > 0`; the FK is defence in
  depth. `utensil_buy_links` is a one-to-many child of `utensils`
  (`utensil_id, sort_order` PK).
- **Health markers** — `metric_definitions` (reference catalog) +
  `user_health_markers` (per-user values, history-preserving via
  `(user_id, metric_id, measured_at)` PK).
- **Recommendations** — `recommendations`. Written by the offline data pipeline
  (secret key bypass); user reads only their own rows.
- **User-owned** — `saved_recipes`, `cooking_sessions`, `user_profiles`,
  `meal_logs`. RLS scoped to `auth.uid() = user_id`.
  `user_profiles` (one row per user) holds typed columns the recommender
  pipeline joins on: `date_of_birth`, `diet_tags[]`, `allergies[]`, `goals[]`,
  `units`. Display name and biological sex live separately on
  `auth.users.user_metadata` (mutable for name, permanent for biological sex).
- **Admin gate** — `public.is_admin()` / `public.is_chef()` return true when
  `auth.jwt() -> 'app_metadata' ->> 'role'` matches `'admin'` / `'chef'`. Used
  by RLS policies on the catalog and library tables. `public.list_app_users()`
  is a SECURITY DEFINER function that returns `auth.users` rows to admin
  callers; powers `/admin/users.html`.
- **Roles** — `app_metadata.role ∈ {chef, admin}` (or absent for default
  `user`). Mutated only by `mfc set-role` (= `make set-role USER=<email>
  ROLE=<user|chef|admin>`). Never writable from the browser. (`user_metadata`
  is intentionally avoided — user-writable, would be a privilege-escalation
  vulnerability.)
- **Storage** — `recipe-images` bucket (public read; admin or
  recipe-owning-chef write via RLS). Hero at `<recipe_id>/hero.jpg`,
  step images at `<recipe_id>/step-<sort_order>.jpg`. Full Storage
  URLs are stored on `recipes.media.hero.src` and
  `recipe_steps.media_src`. Helper:
  `public.can_write_recipe_image(text)`. Bytes synced via `mfc
  sync-images`; metadata via `mfc sync-recipes`.

## Shared JS (`<script src>`)

Loaded in this order on every page (after `@supabase/supabase-js` CDN script):

1. [web/assets/js/lib/supabase.js](web/assets/js/lib/supabase.js) — reads `<meta name="mfc-supabase-url">`
   and `<meta name="mfc-supabase-publishable-key">`, creates `window.MFC.supabase`.
2. [web/assets/js/lib/auth.js](web/assets/js/lib/auth.js) — `window.MFC.auth`:
   `getUser()`, `isLoggedIn()`, `signIn({ email })` (magic link),
   `signIn({ provider: 'google' })`, `signOut()`. Emits `mfc:auth-change`.
3. [web/assets/js/lib/db.js](web/assets/js/lib/db.js) — `window.MFC.db`: thin wrappers for every
   table. Calls return `null` / `[]` / `false` when the user isn't signed in
   (anonymous code paths just see nothing).
4. [web/assets/js/lib/meal-time.js](web/assets/js/lib/meal-time.js) — `window.MFC.mealTime.defaultMealTypeForNow()`.
   Loaded on my/dashboard.html; import into any page that needs the meal-slot helper.
5. [web/assets/js/lib/admin-db.js](web/assets/js/lib/admin-db.js) — `window.MFC.adminDb`: CRUD
   wrappers for the admin pages (recipes, ingredients, utensils). Loaded only
   under `admin/`.
6. [web/assets/js/lib/admin-gate.js](web/assets/js/lib/admin-gate.js) — `window.MFC.adminGate.guard()`
   resolves true only when the signed-in user has `app_metadata.role = 'admin'`;
   otherwise renders a sign-in / not-authorized panel and resolves false.
7. [web/assets/js/lib/recipe-prefs.js](web/assets/js/lib/recipe-prefs.js) — `window.MFC.recipePrefs.classify(recipe, profile)`
   returns `{ score, violations[] }`. Single source of truth for matching
   recipes against a user profile (allergies, dietary identity, soft prefs,
   cuisine). Loaded on /recipe-search.html and /my/dashboard.html.

JSX UI components (loaded selectively as `<script type="text/babel" src="…">`,
must run before the page's main babel script that references them):

- [web/assets/js/lib/auth-modal.jsx](web/assets/js/lib/auth-modal.jsx) — self-mounting sign-in modal.
  Opens on `window` event `mfc:open-auth`. Loaded on every public page that
  shows a "Sign in" affordance.
- [web/assets/js/lib/user-menu.jsx](web/assets/js/lib/user-menu.jsx) — `window.MfcUserMenu({ user,
  onSignIn, accountHref, profileHref })`. Logged-out: orange "Sign in →" button.
  Logged-in: white pill + orange-avatar + dropdown (Profile, Account, Sign out).
  `profileHref` is optional — when omitted, the Profile item is hidden.
- [web/assets/js/lib/biological-sex-prompt.jsx](web/assets/js/lib/biological-sex-prompt.jsx) —
  `window.MfcBiologicalSexGate({ user, onSaved })`, `MfcSaveBiologicalSex(value)`,
  `MFC_BIOSEX_OPTIONS`, `MFC_BIOSEX_LABEL_FOR(value)`. Mandatory, non-dismissible
  modal. Loaded on markers.html (gate) and account.html (label lookup).

`useAuth()` is a small React hook defined inline in each page that subscribes to
the `mfc:auth-change` event. `useAuthGuard` (markers/dashboard/account/profile)
must keep `[]` deps on its effect so the listener persists for `USER_UPDATED`
events (e.g. saving display name or biological sex).

`mfc:profile-change` is dispatched by `MFC.db.upsertUserProfile` on success.
Pages that derive UI from the profile (search-page soft-pref strip, dashboard
defensive allergy badge) listen and re-fetch.

## Auth

- Magic link (email) + Google OAuth, both via Supabase Auth
- Session persisted by the Supabase JS client; no custom storage
- Anonymous browsing works fully — auth is additive (saved recipes, health
  markers, recommendations, cooking session sync, meal logs)

### Redirect contract ([web/assets/js/lib/auth.js](web/assets/js/lib/auth.js))

- **Post-login → `my/dashboard.html`** unless the user is on a "stay" page
  (`recipe.html`, `my/dashboard.html`, or any page under `admin/`), in which case they
  stay on the current page. Applies to both Google OAuth (`redirectTo`) and
  magic link (`emailRedirectTo`), plus an in-tab fallback in
  `onAuthStateChange`.
- **Post-logout → `index.html`** always (even from `recipe.html`).
- Constants `POST_LOGIN` / `POST_LOGOUT` / `STAY_ON_PATHS` are defined at the
  top of [web/assets/js/lib/auth.js](web/assets/js/lib/auth.js).

## Recipe preferences (soft-filtering)

When a signed-in user has any tags in their profile, `/recipe-search.html`
runs `MFC.recipePrefs.classify(recipe, profile)` for every recipe and:

- Renders a paper-pill **soft-pref strip** below the filter row (first 2 tags
  visible + "+N more", master toggle, edit link, × dismiss). Strip dismissal
  uses sessionStorage; master toggle (`mfc_respect_prefs`) persists per session.
- Sorts both featured and all-recipes grids: avoid-state recipes last, score
  desc among non-avoid.
- Tags cards as **match** (matcha badge), **avoid** (berry ring + reason
  badge), or neutral.
- Master toggle OFF demotes only identity violations; allergy violations
  still flag (safety floor).

`/my/dashboard.html` runs the same classifier defensively on pipeline-supplied
recommendations and surfaces only allergy violations as a berry warning badge —
the pipeline already accounts for prefs server-side, this is a safety net.

`/index.html` is marketing-only (`AnonymousPersonalize` demo); no real recipes
render there, so no soft-pref treatment.

## Anonymous → authed handoff

On first sign-in, [web/assets/js/lib/auth.js](web/assets/js/lib/auth.js) calls
`window.MFC.db.handoffAnonymous(user)` which migrates any in-progress cooking
sessions (`localStorage.mfc_session_<recipeId>`) into `cooking_sessions`,
then clears the local copies.

## Shared assets

- [recipe-base.css](web/assets/css/recipe-base.css) — CSS custom properties (design tokens)
- [recipe-styles.css](web/assets/css/recipe-styles.css) — recipe page styles
- [tweaks-panel.jsx](web/assets/js/lib/tweaks-panel.jsx) — `TweaksPanel`, `useTweaks`,
  `TweakSection`, `TweakRow`, `TweakSlider`, `TweakToggle`, `TweakColor` on
  `window`
- [recipe-components.jsx](web/assets/js/lib/recipe-components.jsx) +
  [recipe-app.jsx](web/assets/js/app/recipe-app.jsx) — `RecipeNav`, `RecipeHero`, `StepCard`,
  `IngredientsCard`, `UtensilsCard`, `HealthMarquee`, `CookingPlayer`,
  `useScrolled` on `window`
- [admin-styles.css](web/assets/css/admin-styles.css) + [admin-simple.css](web/assets/css/admin-simple.css) —
  admin shell, forms, library picker, list table styles
- [admin-shared.jsx](web/assets/js/lib/admin-shared.jsx) — `AdminSidebar`, `AdminTopbar`,
  `SaveBar`, `FormCard`, `Field`, `RadioPills`, `Toggle`, `ChipInput`,
  `Uploader`, `PreviewFrame`, `slugify` on `window`

## Design tokens (CSS vars)

- `--orange` #FF6D2E · `--matcha` #7A9C5A — primary/secondary accents
- `--cream` / `--paper` / `--ink` — background/text scale
- `--sans` / `--serif` / `--hand` / `--mono` — Geist / Instrument Serif / Caveat / JetBrains Mono

Tokens defined in [recipe-base.css](web/assets/css/recipe-base.css); duplicated inline in
[index.html](web/index.html) and [recipe-search.html](web/recipe-search.html).

## TweaksPanel

Draggable floating panel for live design edits, controlled by a parent frame:

- `__activate_edit_mode` / `__deactivate_edit_mode` → show/hide
- State changes posted as `{ type: '__edit_mode_set_keys', edits }`
