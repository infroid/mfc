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
| [web/assets/css/recipe-base.css](web/assets/css/recipe-base.css) | CSS custom properties (design tokens) |
| [web/assets/css/recipe-styles.css](web/assets/css/recipe-styles.css) | Recipe page styles |
| [web/assets/js/app/recipe-app.jsx](web/assets/js/app/recipe-app.jsx), [web/assets/js/lib/recipe-components.jsx](web/assets/js/lib/recipe-components.jsx) | Recipe page React components |
| [web/assets/js/lib/tweaks-panel.jsx](web/assets/js/lib/tweaks-panel.jsx) | Live design-tweak panel (dev tool) |

## Data

| Path | Purpose |
|---|---|
| [automation/db/schema.sql](automation/db/schema.sql) | 16-table schema with `COMMENT ON` docs |
| [automation/db/seed_metrics.sql](automation/db/seed_metrics.sql) | 54 blood markers across 10 categories |
| [web/assets/recipes/](web/assets/recipes/) | Import seed for the catalog (one self-contained `recipe.json` per recipe) |
| [automation/](automation/) | Python CLI (`mfc`) — apply schema, seed, import recipes |

## Dev

```
make serve     # static site at http://localhost:8080
```

`make` (no args) lists every target. See [automation/README.md](automation/README.md)
for the Python tooling.

## Setup

See [USER-TODO.md](docs/USER-TODO.md) for one-time Supabase setup (project creation,
schema apply, auth provider config, recipe import).

## Deploy

Live at <https://myfoodcraving.com>. Auto-deployed by GitHub Actions on every
push to `master`.

- Workflow: [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)
- Uploads `./web` as the Pages artifact via `actions/deploy-pages`. No build step.
- Custom domain: `web/CNAME` (the artifact's CNAME is what Pages reads).

### One-time GitHub setup

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
This stops the legacy Jekyll auto-build from clobbering our artifact.

If the live site ever shows the README rendered as Jekyll instead of the
real index, the source flipped back to "Deploy from a branch" — re-set it.

### Verify

```bash
curl -s https://myfoodcraving.com/ | grep -o '<title>[^<]*</title>'
# expect: the real site title, not "MyFoodCraving | mfc" (Jekyll fallback)
```

Other hosting options (Cloudflare Pages, Netlify) are documented in
[docs/OPTIMIZATIONS.md → Hosting alternatives explored](docs/OPTIMIZATIONS.md#hosting-alternatives-explored).

## Recipe admin

Edit recipes via Supabase Studio's table editor. Five normalized tables back each
recipe (`recipes` + `recipe_ingredients` / `recipe_steps` / `recipe_utensils` /
`recipe_tags`); health facts are in the shared `health_facts` table
(`category='recipe'`). Column descriptions are visible in Studio
(from `COMMENT ON COLUMN` statements in the schema).
