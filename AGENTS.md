# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Style

- Code and docs: concise, precise, no filler
- No comments unless the why is non-obvious
- No abstractions beyond what the task needs

## Project

Static marketing + recipe site for MyFoodCraving (Infroid Technologies). Deployed on GitHub Pages.

## Dev

No build system, no package manager. Open files in browser or:

```
python3 -m http.server 8080
```

## Architecture

- React 18 + Babel Standalone loaded from CDN; JSX compiled in-browser via `<script type="text/babel">`
- `index.html` — landing page, fully self-contained (CSS + React app all inline)
- `recipe-search.html` — recipe listing page
- `recipe.html` — shared recipe page template, loaded as `recipe.html?id={recipe-id}`

`recipe.html` imports `tweaks-panel.jsx`, `recipe-app.jsx`, and `recipe-components.jsx` at runtime.

## Recipe bundles

- `data/recipe-bundles/{id}/recipe.json` — self-contained recipe (listing fields + full detail); import seed
- `data/recipe-bundles/{id}/hero.jpg` and `step-*.jpg` — generated recipe images colocated with the recipe JSON

## Shared assets

- `recipe-base.css` — CSS custom properties (design tokens)
- `recipe-styles.css` — recipe page component styles
- `tweaks-panel.jsx` — source for TweaksPanel; exposes `useTweaks`, `TweaksPanel`, `TweakSection`, `TweakRow`, `TweakSlider`, `TweakToggle`, `TweakColor` on `window`
- `recipe-components.jsx` + `recipe-app.jsx` — shared recipe page components

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
