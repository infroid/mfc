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
public-facing summary and [USER-TODO.md](USER-TODO.md) for setup steps the human
performs (project creation, schema apply, auth config, recipe import).

## Dev

No build system, no package manager.

```
python3 -m http.server 8080
```

If port 8080 is in use:

```
kill -9 $(lsof -t -i :8080)
python3 -m http.server 8080
```

## Architecture

- React 18 + Babel Standalone loaded from CDN; JSX compiled in-browser via
  `<script type="text/babel">`
- 3 public pages: [index.html](index.html), [recipe-search.html](recipe-search.html),
  [recipe.html](recipe.html). Each is mostly self-contained with inline React.
- [recipe.html](recipe.html) imports [recipe-app.jsx](recipe-app.jsx),
  [recipe-components.jsx](recipe-components.jsx),
  [tweaks-panel.jsx](tweaks-panel.jsx) at runtime via `<script type="text/babel" src="…">`
- 6 admin pages: list + edit for each of recipes, ingredients, utensils
  ([admin-recipes.html](admin-recipes.html), [admin-recipe.html](admin-recipe.html),
  and the parallel `-ingredient(s)` / `-utensil(s)` files). Gated by
  `app_metadata.role = 'admin'`.
- Supabase JS client loaded from CDN; bootstrapped from `<meta>` tags in each
  page's `<head>`

## Data layer

- **Source of truth: Supabase Postgres**, accessed via the Supabase JS client.
  No static-JSON fallback at runtime.
- [data/recipes.json](data/recipes.json) and
  [data/recipe-bundles/{id}/recipe.json](data/recipe-bundles/) are the **import
  seed** for [scripts/import_recipes.mjs](scripts/import_recipes.mjs); not
  fetched by the browser.
- Recipe images stay at `data/recipe-bundles/{id}/hero.jpg` (and `step-*.jpg`),
  served by GH Pages CDN. Recipe rows store the relative path.

## Schema

- [data/db/schema.sql](data/db/schema.sql) — 15 tables, RLS, triggers. Every
  table and column has a `COMMENT ON` description that surfaces in Supabase
  Studio. Idempotent: safe to re-apply.
- [data/db/seed_metrics.sql](data/db/seed_metrics.sql) — ~21 baseline blood
  markers (`metric_definitions`).

Schema layers:

- **Catalog** — `recipes`, `recipe_ingredients`, `recipe_steps`, `recipe_utensils`,
  `recipe_tags`, `recipe_health_facts`. Public read, admin writes via secret key
  or signed-in admin user (RLS via `public.is_admin()`).
- **Library** — `ingredients`, `utensils`. Master tables that recipes pick from.
  `recipe_ingredients.ingredient_id` and `recipe_utensils.utensil_id` FK into
  these. Old free-text columns (`recipe_ingredients.ingredient/amount`,
  `recipe_utensils.name`) remain for the seed import; new admin writes populate
  the FK columns.
- **Health markers** — `metric_definitions` (reference catalog) +
  `user_health_markers` (per-user values, history-preserving via
  `(user_id, metric_id, measured_at)` PK).
- **Recommendations** — `recommendations`. Written by the offline data pipeline
  (secret key bypass); user reads only their own rows.
- **User-owned** — `saved_recipes`, `cooking_sessions`, `user_prefs`,
  `meal_logs`. RLS scoped to `auth.uid() = user_id`.
- **Admin gate** — `public.is_admin()` returns true when
  `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`. Used by RLS policies on
  the catalog and library tables.

## Shared JS (`<script src>`)

Loaded in this order on every page (after `@supabase/supabase-js` CDN script):

1. [shared/supabase.js](shared/supabase.js) — reads `<meta name="mfc-supabase-url">`
   and `<meta name="mfc-supabase-publishable-key">`, creates `window.MFC.supabase`.
2. [shared/auth.js](shared/auth.js) — `window.MFC.auth`:
   `getUser()`, `isLoggedIn()`, `signIn({ email })` (magic link),
   `signIn({ provider: 'google' })`, `signOut()`. Emits `mfc:auth-change`.
3. [shared/db.js](shared/db.js) — `window.MFC.db`: thin wrappers for every
   table. Calls return `null` / `[]` / `false` when the user isn't signed in
   (anonymous code paths just see nothing).
4. [shared/admin-db.js](shared/admin-db.js) — `window.MFC.adminDb`: CRUD
   wrappers for the admin pages (recipes, ingredients, utensils). Loaded only
   on `admin-*.html`.
5. [shared/admin-gate.js](shared/admin-gate.js) — `window.MFC.adminGate.guard()`
   resolves true only when the signed-in user has `app_metadata.role = 'admin'`;
   otherwise renders a sign-in / not-authorized panel and resolves false.

`useAuth()` is a small React hook defined inline in each page that subscribes to
the `mfc:auth-change` event.

## Auth

- Magic link (email) + Google OAuth, both via Supabase Auth
- Session persisted by the Supabase JS client; no custom storage
- Anonymous browsing works fully — auth is additive (saved recipes, health
  markers, recommendations, cooking session sync, meal logs)

## Anonymous → authed handoff

On first sign-in, [shared/auth.js](shared/auth.js) calls
`window.MFC.db.handoffAnonymous(user)` which migrates any pre-auth tweaks
(`localStorage.mfc_tweaks`) and in-progress cooking sessions
(`localStorage.mfc_session_<recipeId>`) into `user_prefs` / `cooking_sessions`,
then clears the local copies.

## Shared assets

- [recipe-base.css](recipe-base.css) — CSS custom properties (design tokens)
- [recipe-styles.css](recipe-styles.css) — recipe page styles
- [tweaks-panel.jsx](tweaks-panel.jsx) — `TweaksPanel`, `useTweaks`,
  `TweakSection`, `TweakRow`, `TweakSlider`, `TweakToggle`, `TweakColor` on
  `window`
- [recipe-components.jsx](recipe-components.jsx) +
  [recipe-app.jsx](recipe-app.jsx) — `RecipeNav`, `RecipeHero`, `StepCard`,
  `IngredientsCard`, `UtensilsCard`, `HealthMarquee`, `CookingPlayer`,
  `useScrolled` on `window`
- [admin-styles.css](admin-styles.css) + [admin-simple.css](admin-simple.css) —
  admin shell, forms, library picker, list table styles
- [admin-shared.jsx](admin-shared.jsx) — `AdminSidebar`, `AdminTopbar`,
  `SaveBar`, `FormCard`, `Field`, `RadioPills`, `Toggle`, `ChipInput`,
  `Uploader`, `PreviewFrame`, `slugify` on `window`

## Design tokens (CSS vars)

- `--orange` #FF6D2E · `--matcha` #7A9C5A — primary/secondary accents
- `--cream` / `--paper` / `--ink` — background/text scale
- `--sans` / `--serif` / `--hand` / `--mono` — Geist / Instrument Serif / Caveat / JetBrains Mono

Tokens defined in [recipe-base.css](recipe-base.css); duplicated inline in
[index.html](index.html) and [recipe-search.html](recipe-search.html).

## TweaksPanel

Draggable floating panel for live design edits, controlled by a parent frame:

- `__activate_edit_mode` / `__deactivate_edit_mode` → show/hide
- State changes posted as `{ type: '__edit_mode_set_keys', edits }`
