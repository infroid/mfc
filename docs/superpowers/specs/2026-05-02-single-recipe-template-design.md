# Single Recipe Template

**Date:** 2026-05-02

## Problem

10 per-recipe HTML files in `recipes/` each inline ~1096 lines (all shared components + `window.RECIPE` data). Adding or updating a recipe requires duplicating boilerplate. The `data/recipes/*.json` files already contain the authoritative recipe data, making the inline copies redundant.

## Solution

Consolidate to a single `recipe.html` template at the root that fetches recipe data from `data/recipes/{id}.json` based on a `?id=` URL param.

## Architecture

- URL: `recipe.html?id=butter-chicken`
- `recipe.html` reads `id` from URL params → sets `window.MFC_RECIPE_ID`
- Existing fetch logic in `RecipeApp` handles the rest: `fetch('data/recipes/' + id + '.json')`
- `window.MFC_BASE` stays unset → `_BASE = ''` → correct path from root

## Changes

### `recipe.html`
- Add plain `<script>` (before babel) that reads `new URLSearchParams(location.search).get('id')` and sets `window.MFC_RECIPE_ID`
- Remove `<script type="text/babel" src="recipe.jsx">` (sample data, no longer needed)
- Replace simplified `RecipeApp` with fetch-capable version: loading state, not-found state, dynamic `document.title` on fetch success
- Keep existing shared script loads: `tweaks-panel.jsx`, `recipe-app.jsx`, `recipe-components.jsx`

### `recipe-search.html`
- Lines 638, 685: `href={`recipes/${recipe.id}.html`}` → `href={`recipe.html?id=${recipe.id}`}`

### Deleted
- `recipes/aloo-gobi.html`
- `recipes/butter-chicken.html`
- `recipes/chicken-biryani.html`
- `recipes/chole-bhature.html`
- `recipes/dal-makhani.html`
- `recipes/masala-dosa.html`
- `recipes/palak-paneer.html`
- `recipes/paneer-butter-masala.html`
- `recipes/rajma-chawal.html`
- `recipes/tandoori-chicken.html`
- `recipe.jsx` (was only sample inline data for old stub)

### Unchanged
- `data/recipes/*.json` — single source of truth, untouched
- `recipe-components.jsx`, `tweaks-panel.jsx`, `recipe-app.jsx`, all CSS
- `index.html`

## UI/UX

No visual changes. Same components, same styles, same interactions. Loading state shows italic "loading recipe…" (already exists in per-recipe HTMLs). Not-found state shows "recipe not found".

## Notes

- `recipes/recipe-components.jsx`, `recipes/recipe-app.jsx`, `recipes/tweaks-panel.jsx` inside the `recipes/` folder are deleted alongside the HTML files (they were only used by per-recipe HTMLs)
- FOUC: minimal — React mounts quickly; loading state is a placeholder, not a layout shift
