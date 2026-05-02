# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Style

- Code and docs: concise, precise, no filler
- Docs and MD files: bullet points, no paragraphs unless necessary
- No comments unless the why is non-obvious
- No abstractions beyond what the task needs

## Project

Static marketing + recipe site for MyFoodCraving (Infroid Technologies). Deployed on GitHub Pages.

## Dev

No build system, no package manager. Open files in browser or:

```
python3 -m http.server 8080
```

If port 8080 is in use, kill the process using it and try again.

```
kill -9 $(lsof -t -i :8080)
python3 -m http.server 8080
```


## Architecture

- React 18 + Babel Standalone loaded from CDN; JSX compiled in-browser via `<script type="text/babel">`
- `index.html` — landing page, fully self-contained (CSS + React app all inline)
- `recipe-search.html` — recipe listing page; fetches `data/recipes.json` on load, falls back to inline RECIPES array
- `recipes/*.html` — individual recipe pages; use inline `window.RECIPE` (fast, no fetch needed) with `window.MFC_RECIPE_ID` set as future fallback

**Shared JS (real `<script src>`):** `shared/auth.js` is loaded on every page. All other components (TweaksPanel, recipe components) are still inlined per-HTML file — editing those requires updating all affected files.

## Data layer

- `data/recipes.json` — recipe list metadata (search page source of truth; swap `fetch()` target to API when backend is ready)
- `data/recipes/{id}.json` — full recipe detail per recipe (mirrors inline `window.RECIPE` data)
- To go fully dynamic: remove `window.RECIPE = {...}` blocks from recipe HTML files; `RecipeApp` fetches `data/recipes/{id}.json` automatically via `window.MFC_RECIPE_ID`

## Auth scaffolding

- `shared/auth.js` — `window.MFC.auth` namespace: `getUser()`, `isLoggedIn()`, `signIn({name, email})`, `signOut()`
- State in `localStorage` key `mfc_user`; swap internals to API/OAuth when backend is ready
- User shape: `{ id, name, email, avatar, provider }`
- Auth state changes fire `mfc:auth-change` CustomEvent on `window`
- `useAuth()` React hook (defined inline in each page's babel script) subscribes to the event
- All content is public — auth is additive (saved recipes, health metrics, personalisation)

## Shared assets

- `recipe-base.css` — CSS custom properties (design tokens)
- `recipe-styles.css` — recipe page component styles
- `tweaks-panel.jsx` — source for TweaksPanel; exposes `useTweaks`, `TweaksPanel`, `TweakSection`, `TweakRow`, `TweakSlider`, `TweakToggle`, `TweakColor` on `window`
- `recipe-components.jsx` + `recipe-app.jsx` — shared recipe page components (source files; contents are inlined in HTML)

## Design tokens (CSS vars)

- `--orange` #FF6D2E · `--matcha` #7A9C5A — primary/secondary accents
- `--cream` / `--paper` / `--ink` — background/text scale
- `--sans` / `--serif` / `--hand` / `--mono` — Geist / Instrument Serif / Caveat / JetBrains Mono

Tokens defined in `recipe-base.css`; duplicated inline in `index.html` and `recipe-search.html`.

## TweaksPanel

Draggable floating panel for live design edits, controlled by a parent frame:
- `__activate_edit_mode` / `__deactivate_edit_mode` → show/hide
- State changes posted as `{ type: '__edit_mode_set_keys', edits }`

## Path resolution

Recipe pages set `window.MFC_BASE` to resolve URLs back to root. Components use `const _BASE = window.MFC_BASE || ''`.
