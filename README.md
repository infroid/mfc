# MyFoodCraving

Marketing + recipe site for MyFoodCraving (Infroid Technologies). Static frontend on
GitHub Pages, dynamic data from Supabase.

## Architecture

- **Frontend**: 3 self-contained HTML pages + small set of shared JS/CSS files. No
  build system, no package manager. React 18 + Babel Standalone are loaded from
  CDN; JSX compiles in-browser.
- **Backend**: Supabase (Postgres + Auth + RLS). The site uses the Supabase JS
  client directly — there is no custom API service.
- **Recommendations**: written by an offline data pipeline (separate workstream)
  that reads `user_health_markers` and writes `recommendations`. The site only
  reads from `recommendations`.

## Pages

| File | Purpose |
|---|---|
| [index.html](web/index.html) | Landing · craving picker · personalize panel (blood markers + recommendations when logged in) |
| [recipe-search.html](web/recipe-search.html) | Recipe grid · search · filter chips · save heart |
| [recipe.html](web/recipe.html) | Full recipe + guided cooking · session resume · meal log |

## Shared

| File | Purpose |
|---|---|
| [web/assets/js/lib/supabase.js](web/assets/js/lib/supabase.js) | Creates `window.MFC.supabase` from `<meta>` tags |
| [web/assets/js/lib/auth.js](web/assets/js/lib/auth.js) | `window.MFC.auth`: magic link + Google OAuth via Supabase |
| [web/assets/js/lib/db.js](web/assets/js/lib/db.js) | `window.MFC.db`: thin wrappers for every table |
| [recipe-base.css](recipe-base.css) | CSS custom properties (design tokens) |
| [recipe-styles.css](recipe-styles.css) | Recipe page styles |
| [recipe-app.jsx](recipe-app.jsx), [recipe-components.jsx](recipe-components.jsx) | Recipe page React components |
| [tweaks-panel.jsx](tweaks-panel.jsx) | Live design-tweak panel (dev tool) |

## Data

| Path | Purpose |
|---|---|
| [automation/db/schema.sql](automation/db/schema.sql) | 13-table schema with `COMMENT ON` docs |
| [automation/db/seed_metrics.sql](automation/db/seed_metrics.sql) | ~21 baseline blood markers |
| [web/assets/recipes/](web/assets/recipes/) | Import seed for the catalog (one self-contained `recipe.json` per recipe) |
| [scripts/import_recipes.mjs](scripts/import_recipes.mjs) | One-shot importer (recipe JSON → Supabase) |

## Dev

```
open -a "Google Chrome" http://localhost:8080/ && python3 -m http.server 8080
```

If port 8080 is busy:

```
kill -9 $(lsof -t -i :8080) && open -a "Google Chrome" http://localhost:8080/ && python3 -m http.server 8080
```

## Setup

See [USER-TODO.md](docs/USER-TODO.md) for one-time Supabase setup (project creation,
schema apply, auth provider config, recipe import).

## Recipe admin

Edit recipes via Supabase Studio's table editor. Six normalized tables back each
recipe (`recipes` + `recipe_ingredients` / `recipe_steps` / `recipe_utensils` /
`recipe_tags` / `recipe_health_facts`). Column descriptions are visible in Studio
(from `COMMENT ON COLUMN` statements in the schema).
