# MyFoodCraving Optimization Findings

Scope: reduce design, business-logic, schema, and project complexity without changing existing functionality.

Core product direction: MyFoodCraving should eventually support three commerce surfaces:

- Food store: buy prepared food from a recipe page.
- Ingredient store: order recipe ingredients adjusted to selected servings.
- Utensil store: click a utensil from a recipe, open a utensil detail page, and buy it there.

This means recipes, ingredients, and utensils should stay first-class entities. The optimization target is not to flatten them into recipe-local strings. The target is to remove duplication, stale fields, and mismatched source-of-truth boundaries around those entities.

## Guiding Rules

- Keep `recipes`, `ingredients`, and `utensils` as durable domain entities.
- Simplify flows, not the domain model.
- Prefer one source of truth per concept.
- Preserve the no-build GitHub Pages setup unless a build step removes more complexity than it adds.
- Preserve current URLs, page behavior, auth flows, and Supabase-backed data.
- Avoid abstractions that do not directly support recipes, ingredients, utensils, or stores.

## Commerce-Aligned Domain Model

### 1. Keep ingredients and utensils as entities

Decision:

- Keep `ingredients` as a master library table.
- Keep `utensils` as a master library table.
- Keep recipe joins through `recipe_ingredients` and `recipe_utensils`.

Why:

- Ingredient-level commerce needs ingredient identity, quantity, units, photos, substitutions, and availability.
- Utensil commerce needs detail pages, affiliate/store links, specs, care tips, and click-through tracking.
- Recipe-local free text cannot support inventory, pricing, cart composition, recommendations, analytics, or SEO detail pages.

Optimization boundary:

- Do not replace `ingredient_id` / `utensil_id` with inline names.
- Do simplify the admin UI and import path so entity relationships are easier to maintain.

### 2. Add store concepts only when they are needed

Recommended long-term layers:

- `recipes`: cooking content and food-store anchor.
- `ingredients`: reusable catalog entity.
- `utensils`: reusable catalog entity.
- `recipe_ingredients`: recipe quantity by serving baseline.
- `recipe_utensils`: recipe-to-utensil relationship.
- Future `ingredient_products`: buyable ingredient SKUs.
- Future `utensil_buy_links` or `utensil_products`: buyable utensil offers.
- Future `food_offers`: prepared-food offers for recipes.

Why:

- The current schema can support entity identity now.
- Store-specific tables can arrive later without polluting recipe content.

Avoid:

- Adding carts, orders, payments, fulfillment, inventory, coupons, or vendor tables before one store surface is real.
- Mixing affiliate/product metadata directly into recipe rows.

## Highest-Value Fixes

### 3. Make utensil commerce use the existing utensil entity

Current state:

- `data/db/schema.sql` defines `utensils` and `utensil_buy_links`.
- `js/admin-utensil-app.jsx` still reads/writes `buy_link` on the utensil row.
- `shared/admin-db.js` does not load or save `utensil_buy_links`.
- Recipe pages list utensils but do not navigate to utensil detail pages.

Simpler direction:

- Keep `utensils` as the canonical entity.
- Make `utensil_buy_links` the canonical buy-link source.
- Update admin read/save paths to load and save buy links through `utensil_buy_links`.
- Make recipe utensil rows link to future `utensil.html?id={utensil_id}` once the page exists.

Why this matters:

- This supports the utensil store without schema churn.
- It removes the current split between schema and admin editor.

### 4. Make ingredient ordering depend on recipe quantities and servings

Current state:

- `recipe_ingredients` has amount/unit per recipe.
- The recipe page can scale display amounts by servings.
- Ingredient ordering is not modeled yet.

Simpler direction:

- Keep `recipe_ingredients` as the recipe-to-ingredient quantity source.
- Standardize amount and unit enough that ingredient cart composition can be deterministic later.
- Add store/SKU data later in a separate ingredient product layer.

Why this matters:

- The ingredient store depends on ingredient identity plus quantity.
- Keeping quantity on `recipe_ingredients` and product data elsewhere avoids mixing cooking instructions with commerce.

### 5. Treat recipe pages as store entry points, not stores themselves

Current state:

- Recipe pages already have ingredients and utensils sidebars.
- Buttons like "Order all" exist as UI affordances but do not have commerce logic behind them.

Simpler direction:

- Keep the recipe page focused on cooking.
- Add clear actions later:
  - `Buy prepared meal` for food offers tied to `recipe_id`.
  - `Order ingredients` based on `recipe_ingredients` and selected servings.
  - `View utensil` from each utensil row, then buy on the utensil page.

Why this matters:

- The page remains understandable while commerce grows around it.
- Each store can evolve independently.

## Design And Frontend Complexity

### 6. Share the design tokens and shell CSS everywhere

Current state:

- `css/recipe-base.css` defines the design system.
- `index.html`, `recipe-search.html`, `my/dashboard.html`, and `my/markers.html` duplicate root variables, reset styles, paper grain, nav styles, buttons, and layout atoms inline.
- `dashboard-app.jsx` and `markers-app.jsx` inject large style strings.

Simpler direction:

- Load `css/recipe-base.css` on all public pages.
- Move dashboard and markers CSS into normal CSS files.
- Keep page-specific CSS only for page-specific layout.

Why this matters:

- Store pages will need the same shell, cards, buttons, and product detail patterns.
- Shared CSS now reduces future store-page duplication.

### 7. Centralize nav, auth hooks, and route helpers

Current state:

- `useAuth()` is repeated in `index.html`, `recipe-search.html`, and `recipe.html`.
- `useAuthGuard()` is repeated in `dashboard-app.jsx` and `markers-app.jsx`.
- Several pages hand-code nav markup and route prefixes.
- `my/dashboard.html` and `my/markers.html` redirect unauthenticated users to `index.html`, which is relative from `/my/`.

Simpler direction:

- Add a small shared browser script for `useAuth`, `useAuthGuard`, `rootHref(path)`, and common nav behavior.
- Use that helper anywhere a page needs root-relative navigation.

Why this matters:

- Store pages will multiply routes. Shared routing helpers prevent broken relative links.

### 8. Reuse recipe cards, entity images, and save-heart behavior

Current state:

- `recipe-search.html`, `recipe.html`, and `dashboard-app.jsx` each render recipe images/cards differently.
- Saved-state fetching is repeated per card or page.
- Ingredients and utensils do not yet have reusable card/detail components.

Simpler direction:

- Create shared `RecipeImage`, `RecipeCard`, and `HeartButton` helpers.
- Later add `IngredientCard` and `UtensilCard` only when detail/store pages need them.
- Load saved recipes once per page and pass a `Set` of saved ids down.

Why this matters:

- Shared entity presentation supports future stores without inventing each page from scratch.

### 9. Use the shared TweaksPanel instead of the landing-page copy

Current state:

- `js/tweaks-panel.jsx` exposes the reusable tweak panel.
- `index.html` embeds another tweak-panel implementation and its CSS.

Simpler direction:

- Load `js/tweaks-panel.jsx` on `index.html` and delete the inline copy.
- Keep only landing-specific tweak defaults in `index.html`.

Why this matters:

- This is pure duplicated tooling.

### 10. Replace hardcoded catalog counts with loaded data

Current state:

- `recipe-search.html` copy says "10 recipes" in multiple places.
- The page already has `recipes.length`.

Simpler direction:

- Render the count from loaded catalog data.

Why this matters:

- Catalog growth should not require copy edits.

## Business Logic

### 11. Eliminate the recipe-step image side channel

Current state:

- Supabase stores step text and captions.
- Step image paths are still recovered from local `data/recipe-bundles/{id}/recipe.json` in `shared/db.js`.
- Recipe bundles are import seed data but still affect runtime rendering.

Simpler direction:

- Store `media_src` and `media_alt` on `recipe_steps`, or store compact `media jsonb` per step.
- Remove the browser fetch of bundle JSON from `getRecipe()`.

Why this matters:

- Recipe pages should load from the catalog source of truth.
- Store links and entity relationships should not depend on seed JSON remaining available.

### 12. Decide whether recipe nutrition is real data or presentation filler

Current state:

- `NutritionCard` reads `recipe.nutrition` and falls back to the same hardcoded nutrition values for every recipe.
- Recipe JSON bundles do not include `nutrition`.
- `recipes` has no nutrition column.
- Ingredient nutrition exists, but recipe nutrition is not computed from it.

Simpler direction:

- If per-recipe nutrition is not ready, hide or simplify the nutrition card until real values exist.
- If nutrition is part of the product, add one canonical source:
  - recipe-level nutrition data, or
  - deterministic calculation from ingredient nutrition and quantities.

Why this matters:

- Ingredient commerce and health personalization both benefit from real ingredient nutrition.
- Fake recipe nutrition creates trust problems and extra fallback logic.

### 13. Align marker ids across seed data, hints, and UI

Current state:

- `seed_metrics.sql` uses ids like `b12`, `d3`, and `glucose`.
- `MARKER_RECIPE_HINTS` uses `vit-b12`, `vit-d`, and `fasting-glucose`.
- Some hints reference ids that are not seeded.

Simpler direction:

- Use the seeded ids everywhere.
- Move marker-to-recipe hints into data instead of keeping them hardcoded in `markers-app.jsx`.

Why this matters:

- Personalized recommendation logic needs stable ids.
- Store recommendations later should not inherit mismatched marker names.

### 14. Keep recommendations as pipeline-owned output

Current state:

- Frontend reads `recommendations`.
- Landing-page demo recommendation logic is separate mock logic.
- Markers page has hardcoded "cook this" hints separate from recommendations.

Simpler direction:

- Treat `recommendations` as the only real personalized meal source.
- Keep landing-page demos clearly static, or derive them from the same catalog/recommendation data.

Why this matters:

- Food, ingredient, and utensil recommendations should not become three independent ad hoc systems.

### 15. Make meal types canonical

Current state:

- Meal types appear as hardcoded arrays in schema checks, dashboard tabs, forms, recipe admin input, and recommendation code.
- The importer sets `meal_types: []` for every recipe.

Simpler direction:

- Keep the schema check, but share one JS constant for UI pages.
- Have the importer preserve `mealTypes` from recipe JSON if present.

Why this matters:

- Meal types will affect food-store availability and recommendation slots.

## Database Schema

### 16. Keep normalized catalog tables

Current state:

- `recipes`, `ingredients`, `utensils`, `recipe_ingredients`, and `recipe_utensils` already model the long-term domain well.

Simpler direction:

- Keep this normalized shape.
- Simplify by removing stale or mismatched fields, not by flattening the schema.

Why this matters:

- Normalization is justified here because entities have future store behavior.

### 17. Remove admin-only recipe draft fields that are not persisted

Current state:

- Admin recipe state includes fields that do not map to schema or public rendering, such as `category`, `prep_minutes`, `cook_minutes`, and `description`.

Simpler direction:

- Remove unused editor-only fields from admin state.
- Add future commerce fields only when their backing tables exist.

Why this matters:

- Admin state should mirror persisted schema.
- Extra draft fields make saves and previews harder to trust.

### 18. Decide whether health marker history is required now

Current state:

- `user_health_markers` preserves history with `(user_id, metric_id, measured_at)`.
- The UI only needs the latest value per metric.
- `shared/db.js` fetches all rows for a user, sorts by date, then dedupes client-side.

Simpler direction:

- If marker history is a product feature, keep the table shape and add a database-level latest-read path later.
- If not, simplify to one current row per `(user_id, metric_id)`.

Why this matters:

- Do not keep historical complexity unless it is part of personalization, trends, or recommendations.

### 19. Keep RLS, but avoid database objects that hide behavior

Current state:

- RLS is enabled on public tables.
- `public.is_admin()` reads `app_metadata.role`, which is the right source for this setup.

Simpler direction:

- Keep the current RLS pattern.
- If adding store tables later, apply the same pattern:
  - public read for catalog/offers,
  - owner read/write for user-owned carts/orders,
  - admin write for catalog management.

Why this matters:

- The security model is already simple. Preserve it as stores arrive.

## Store Roadmap

### 20. Food store

Future source of truth:

- `food_offers` keyed by `recipe_id`.

Likely fields:

- `recipe_id`
- `vendor`
- `price`
- `currency`
- `servings`
- `availability`
- `buy_url` or checkout reference

Keep out of `recipes`:

- Vendor-specific price.
- Fulfillment details.
- Availability windows.

Why:

- A recipe is content. A prepared-food offer is commerce.

### 21. Ingredient store

Future source of truth:

- `ingredient_products` keyed by `ingredient_id`.
- Optional cart-generation logic based on `recipe_ingredients` and selected servings.

Likely fields:

- `ingredient_id`
- `store`
- `sku`
- `package_amount`
- `package_unit`
- `price`
- `currency`
- `buy_url`
- `availability`

Key rule:

- Recipe quantity stays in `recipe_ingredients`.
- Sellable package data stays in ingredient product records.

Why:

- One recipe may require `80g` of cashews, but stores sell `200g` packs.

### 22. Utensil store

Future source of truth:

- Keep `utensils`.
- Use `utensil_buy_links` for affiliate/offsite commerce, or rename/evolve it to `utensil_products` if the app needs richer product records.

Likely user flow:

- Recipe page shows required utensils.
- User clicks a utensil.
- App opens `utensil.html?id={utensil_id}`.
- Utensil detail page shows specs, care tip, recipe usage, and `Buy now`.

Why:

- Utensils deserve entity pages because the same utensil appears across recipes.

## Project Structure And Operations

### 23. Centralize Supabase configuration

Current state:

- Public pages hardcode the same Supabase URL/key in meta tags.
- Admin pages have empty meta tags.
- `shared/supabase.js` is already centralized once the meta tags exist.

Simpler direction:

- Use one checked-in `shared/config.js` or one include snippet pattern that every page loads.
- Keep the publishable key public; do not introduce a secret-bearing backend.

Why this matters:

- Store pages and detail pages will otherwise repeat the same configuration.

### 24. Update docs to match the actual architecture

Current state:

- README says `schema.sql` has 13 tables.
- CLAUDE.md says 15 tables.
- `schema.sql` currently defines 15 tables.
- USER-TODO still says to paste credentials into only three HTML pages, while dashboard/markers also need them and admin pages intentionally have empty meta tags.

Simpler direction:

- Make README, USER-TODO, AGENTS, and CLAUDE agree on the real architecture.
- Document the commerce direction:
  - recipes are content,
  - ingredients and utensils are reusable entities,
  - store data belongs in offer/product layers.

Why this matters:

- Future work should not rediscover the same boundaries.

### 25. Keep no-build, but switch obvious CDN defaults

Current state:

- Pages load React development UMD builds and Babel Standalone in the browser.
- No build system exists by design.

Simpler direction:

- Use React production UMD builds for served pages.
- Keep Babel Standalone only as long as no-build JSX is a hard requirement.

Why this matters:

- Production React is a low-complexity performance improvement.
- Adding a full build system is not needed just to support the store roadmap.

### 26. Compress recipe images in place

Current state:

- `data/recipe-bundles` is about 40 MB.
- Many hero/step images are 600-800 KB each.

Simpler direction:

- Re-encode existing JPGs to a consistent target size and quality while keeping the same filenames.
- Consider separate small card thumbnails only if listing performance still needs it.

Why this matters:

- Store pages will add more media. Compressing now keeps GitHub Pages lightweight.

### 27. Clean generated and planning artifacts from the deploy surface

Current state:

- `tools/MyFoodCraving.zip` is tracked.
- `docs/superpowers/...` contains implementation specs/plans that are not product docs.

Simpler direction:

- Move generated archives out of the repo or ignore them.
- Keep active product docs in `docs/`; archive agent plans elsewhere if they are still useful.

Why this matters:

- Fewer non-runtime artifacts make the repository easier to navigate and reduce accidental GitHub Pages exposure.

### 28. Make the import script dependency story explicit

Current state:

- Project docs say no package manager.
- `scripts/import_recipes.mjs` requires `@supabase/supabase-js`.
- USER-TODO says `npm i @supabase/supabase-js`, which creates package files unless done elsewhere.

Simpler direction:

- Document the importer as an ops script that needs `@supabase/supabase-js` available to Node.
- If imports become routine, add a tiny `package.json` with only the importer dependency and script.

Why this matters:

- The no-build app can remain package-free while import operations stay clear.

## Suggested Order

1. Lock the domain stance: keep recipes, ingredients, and utensils as first-class entities.
2. Fix source-of-truth mismatches: utensil buy links, recipe nutrition, marker ids.
3. Remove duplicated design foundations: shared tokens, nav, auth hooks, tweak panel.
4. Simplify runtime data sources: step media in Supabase, no local JSON detail fetch.
5. Add entity detail pages only when useful: ingredient detail, utensil detail, then store offers.
6. Add commerce tables in layers: food offers, ingredient products, utensil products/buy links.
7. Clean docs/config/artifacts so new work starts from a true map of the project.

## Avoid For Now

- Do not flatten ingredients or utensils into recipe-local strings.
- Do not put store-specific price, SKU, inventory, or vendor data directly on recipe content rows.
- Do not add carts, orders, payments, or fulfillment before one store surface has a concrete integration.
- Do not add a full build system just to share a few browser helpers.
- Do not introduce a custom API service while Supabase RLS already covers access control.
- Do not create three separate recommendation systems for food, ingredients, and utensils.

---

## Hosting alternatives explored

The website lives under `web/` so the repo root stays clean. GitHub Pages
only allows publishing from `/` or `/docs` of a branch — there's no native
"publish from /web" option. We reviewed three workarounds before settling
on the GitHub Actions deploy that currently lives at
`.github/workflows/deploy-pages.yml`.

### Currently chosen — GitHub Actions deploy

- Workflow uploads `./web` as the Pages artifact and publishes via the
  official `actions/deploy-pages`.
- One-time setup: GitHub repo **Settings → Pages → Source: GitHub Actions**.
- CNAME inside `web/CNAME` is what matters; the duplicate root `CNAME`
  is harmless and acts as a fallback if you ever revert to a "Deploy
  from branch" config.
- Trade-off: 20 lines of YAML to maintain. Stays inside GitHub.

### Cloudflare Pages — recommended if Actions ever feel heavy

Better DX for static sites: faster CDN, automatic preview URLs per PR,
no YAML to maintain. Free tier is the most generous of the static hosts.
Cloudflare's UI changed recently — they merged Pages into "Workers &
Pages" and the field labels can be confusing. Two paths to set it up:

#### Path A — UI

1. Cloudflare dash → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick this repo + master branch.
3. **Expand "Build settings"** if collapsed (sometimes hidden under a
   chevron / "Show advanced").
4. Build configuration:
   - **Framework preset**: pick **None** explicitly. Auto-detected presets
     can hide the output-directory field.
   - **Build command**: leave **blank**.
   - **Build output directory**: `web` (no leading or trailing slash).
5. Deploy.
6. **Custom Domains** tab → add `myfoodcraving.com`. Cloudflare DNS makes
   this trivial; for other DNS providers you'll get CNAME instructions
   to paste into the registrar.
7. Disable GitHub Pages on the repo (**Settings → Pages → Source: None**).

#### Path B — `wrangler.jsonc` (newer Workers Static Assets flow)

If the UI is on the new Workers Static Assets flow, the
"Build output directory" field disappears and Cloudflare reads from a
config file at the repo root. Drop:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mfc-landing",
  "compatibility_date": "2026-04-01",
  "assets": {
    "directory": "./web",
    "not_found_handling": "404-page"
  }
}
```

into `wrangler.jsonc` at the repo root. Cloudflare auto-detects on the
next deploy.

### Netlify / Vercel

Identical UX to Cloudflare Pages: Git connection + "Publish directory:
web". Both have free tiers. Cloudflare's free tier wins on bandwidth.

### Rejected — rename `web/` to `docs/`

GitHub Pages serves natively from `/docs`. Could rename `web/` to
`docs/` and rename the existing `docs/` (project notes) to something
else — `notes/`, `dev-docs/`, etc. Would remove the need for
infrastructure but forces `docs/` to mean "website" forever, which
violates the universal "place documentation under `docs/`" expectation
and would trip every new contributor.
