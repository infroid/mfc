# Bundle JSON formats

Bundles are per-id JSON files committed to git that mirror Supabase rows.
They're how recipes and utensils get edited offline (in your editor) and
synced back to the cloud. The static frontend never reads them — the
browser hits Supabase directly. They exist for editorial workflow.

This doc is the canonical reference for bundle structure. Schema tables are
documented inline via `COMMENT ON COLUMN` in
[`automation/db/schema.sql`](../automation/db/schema.sql); this file
covers the JSON shape on disk and how it maps back and forth.

## Bundle types

| Type | Local path | DB tables | Sync command | Image bucket |
|---|---|---|---|---|
| Recipe | `web/assets/recipes/<id>/recipe.json` | `recipes` + 5 child tables | `make sync-recipes` | `recipe-images` |
| Utensil | `web/assets/utensils/<id>/utensil.json` | `utensils` + `utensil_buy_links` | `make sync-utensils` | `utensil-images` |
| Ingredient | *not implemented* | `ingredients` (DB-only today) | — | — |

Ingredient bundles are spec'd at
[`docs/superpowers/specs/2026-05-07-thiings-ingredient-images-design.md`](superpowers/specs/2026-05-07-thiings-ingredient-images-design.md)
and planned at
[`docs/superpowers/plans/2026-05-07-ingredient-bundles-and-nutrition.md`](superpowers/plans/2026-05-07-ingredient-bundles-and-nutrition.md).
Today, ingredients live as DB rows only — no per-ingredient bundle on disk.

## How sync works

Both sync commands are bidirectional with three direction modes:

- `pull` — DB + Storage → local. Rebuilds bundles from rows; downloads image bytes.
- `push` — local → DB + Storage. Upserts rows; uploads image bytes.
- `both` — pull first, then push. Last-modified wins per item: comparing the local file's mtime against the DB row's `updated_at` (±1 s tolerance for clock skew).

The Make targets prompt for direction interactively if `DIRECTION=` isn't set.

`make sync-recipes` chains `make sync-images` automatically (recipe metadata
+ recipe image bytes). `make sync-utensils` chains `make sync-utensil-images`
the same way. The chained image-sync uses the per-image-file mtime, not the
parent row's `updated_at`.

## Round-trip notes

- Optional fields with `null` values are dropped from the JSON on `pull`, so
  files stay clean. `push` reads them as missing and the DB defaults apply.
- Image paths in bundle JSON can be either:
  - **Full Storage URL** — what `pull` writes after the row already lives in
    DB. `push` passes them through unchanged.
  - **Repo-relative path** like `assets/utensils/<id>/<id>.jpg` — what
    `update-utensil` (and the analogous recipe tooling) writes locally
    before any sync. On `push`, the sync layer normalizes these to full
    Storage URLs via `images.normalize_image_value` /
    `utensil_images.normalize_image_value`.
- DB-only fields are never written into bundles: `created_at`, `updated_at`,
  `created_by`. They're row metadata, not editorial.
- Library tables (`ingredients`, `utensils`) are **partially auto-stubbed**
  by `sync-recipes push`: any `(id, name)` referenced by a recipe but
  missing from the library gets a stub row inserted. `sync-utensils push`
  later fills the rest of the columns. The recipe-side stub upsert only
  writes `(id, name)` so it never clobbers a fully-populated library row.

---

# Recipe bundle

Path: `web/assets/recipes/<id>/recipe.json`
Plus image bytes: `web/assets/recipes/<id>/hero.jpg`,
`web/assets/recipes/<id>/step-NN-<slug>.jpg`.

## Annotated example

```jsonc
{
  "id": "aam-panna",                          // PK; matches dir name; stable URL slug
  "name": "Aam Panna",                        // display title
  "tagline": "Raw mango cooler with…",        // marketing tagline (cards/listings)
  "shortTagline": "raw mango · 30 min",       // compact tagline (detail page hero)
  "cuisine": "North Indian",                  // free text; powers cuisine filter
  "difficulty": "Easy",                       // "Easy" | "Medium" | "Hard" (free text)
  "servings": 4,                              // default yield; UI scales ingredients off it
  "totalMinutes": 30,                         // active + passive cook time
  "media": {
    "hero": {
      "alt": "…",                             // accessibility text
      "src": "https://…/recipe-images/aam-panna/hero.jpg",  // full Storage URL
      "caption": "aam panna — crystal glass…",
      "palette": ["#A4C268", "#7A9C5A", "#E9C46A"]
    },
    "emoji": "🥭"                              // single emoji for compact UI
  },
  "color": "#A4C268",                         // brand accent hex
  "colorSoft": "rgba(164,194,104,0.18)",      // translucent variant
  "createdBy": "uuid-of-creating-user",       // optional; sets recipes.created_by on insert
  "ingredients": [
    {
      "name": "Raw green mango (large)",      // free-text display name
      "amt":  "2",                            // quantity as free-text string
      "group": "main"                         // optional grouping label
    }
  ],
  "steps": [
    {
      "id": 1,                                // sort_order; 1-based by convention
      "title": "Boil the raw mango",
      "detail": "…",                          // full instructions
      "duration": 1200,                       // seconds; powers the in-page timer
      "tip": "Roasting gives a smokier…",     // optional one-liner
      "media": {
        "src": "https://…/step-01-boil-raw-mango.jpg",
        "caption": "Softened mango and pulp"
      }
    }
  ],
  "utensils": [
    {
      "name": "Pressure cooker or flame",     // resolved to utensils.id via slugify(name)
      "essential": true                       // false = optional / nice-to-have
    }
  ],
  "tags": ["drink", "electrolyte", "vegan"],  // free-form labels; powers filter chips
  "healthFacts": [                            // 1-N strings; rotated in the detail-page rotator
    "Raw mango is exceptionally high in vitamin C…"
  ]
}
```

## Field semantics

| JSON | DB column | Required | Notes |
|---|---|---|---|
| `id` | `recipes.id` | yes | Stable URL slug; never reuse |
| `name` | `recipes.name` | yes | |
| `tagline` | `recipes.tagline` | optional | |
| `shortTagline` | `recipes.short_tagline` | optional | |
| `cuisine` | `recipes.cuisine` | yes | Free-text; powers filter |
| `difficulty` | `recipes.difficulty` | yes | "Easy" / "Medium" / "Hard" |
| `servings` | `recipes.servings` | yes | int |
| `totalMinutes` | `recipes.total_minutes` | yes | int |
| `media` | `recipes.media` | optional | JSONB blob; structure shown above |
| `color` | `recipes.color` | optional | hex |
| `colorSoft` | `recipes.color_soft` | optional | rgba |
| `createdBy` | `recipes.created_by` | optional | UUID; only used on first insert |
| `ingredients[]` | `recipe_ingredients` rows | optional | sort_order = array index; `ingredient_id` derived from `slugify(name)` |
| `steps[]` | `recipe_steps` rows | optional | sort_order = `id` field on the step |
| `utensils[]` | `recipe_utensils` rows | optional | sort_order = array index after dedup |
| `tags[]` | `recipe_tags` rows | optional | one row per tag |
| `healthFacts[]` | `recipe_health_facts` rows | optional | sort_order = array index |

`steps[].media.src` and `media.hero.src` accept either a full Storage URL
or a legacy `assets/...` path; the `push` path normalizes them.

## Authoring

Recipes are typically authored via the chef portal (`/chef/recipes.html`)
which writes directly to Supabase. The bundle on disk is the editorial
mirror — useful for offline editing, git history, or programmatic fixes.

Push your changes:
```bash
make sync-recipes DIRECTION=push   # rows + images
```

---

# Utensil bundle

Path: `web/assets/utensils/<id>/utensil.json`
Plus image bytes: `web/assets/utensils/<id>/<id>.jpg`
(square JPEG, 1500×1500 typical).

## Annotated example

```jsonc
{
  "id": "kadhai-cast-iron",                   // PK; matches dir name; stable slug
  "name": "Cast-iron kadhai",                 // display name
  "tagline": "Deep, broad, hot — the…",       // first "About this item" bullet from Amazon
  "category": "Cookware",                     // Cookware | Bakeware | Cutlery |
                                              //   "Small appliance" | Utensil | Measuring
  "photo": "assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg",  // see Image paths
  "care_tip": "Hand-wash, dry on heat, oil lightly.",  // optional one-liner
  "specs": {
    "material": "Cast iron",                  // optional sub-keys; rendered in admin/utensil-detail
    "size": "10 x 10 x 4 inches",
    "weight": "2.4 Kilograms"
  },
  "show": {                                   // per-field visibility toggles in the UI
    "buyLink": true,
    "careTip": true,
    "specs": true                             // auto-flips to true when specs is non-empty
  },
  "ai_filled_at": "2026-05-07T15:30:00+00:00",  // timestamp; surfaces the "Auto-filled by Claude" banner
  "amazon": {                                 // optional; written by mfc update-utensil
    "asin": "B07JFTSKXW",                     // 10-char ASIN; PA-API lookup key
    "marketplace": "amazon.com",              // host stripped of "www."
    "fetched_at": "2026-05-07T15:30:00+00:00"
  },
  "buy_links": [                              // 0..N retailer rows
    {
      "sort_order": 0,                        // display order; lower first
      "store": "Amazon",                      // retailer name
      "url": "https://www.amazon.com/dp/B07JFTSKXW?tag=mfc-20",
      "price": "$49.95",                      // free-text string with currency
      "affiliate_tag": "mfc-20"               // appended at render time
    }
  ]
}
```

## Field semantics

| JSON | DB target | Required | Notes |
|---|---|---|---|
| `id` | `utensils.id` | yes | Stable URL slug |
| `name` | `utensils.name` | yes | |
| `tagline` | `utensils.tagline` | optional | First Amazon bullet by default |
| `category` | `utensils.category` | optional | Free text; UI offers a dropdown |
| `photo` | `utensils.photo` | optional | See "Image paths" below |
| `care_tip` | `utensils.care_tip` | optional | Care/cleaning one-liner |
| `specs.material` / `.size` / `.weight` | `utensils.specs` JSONB | optional | All sub-keys optional |
| `show.buyLink` / `.careTip` / `.specs` | `utensils.show` JSONB | optional | UI visibility toggles |
| `ai_filled_at` | `utensils.ai_filled_at` | optional | ISO timestamp |
| `amazon.asin` | `utensils.amazon_asin` | optional | |
| `amazon.marketplace` | `utensils.amazon_marketplace` | optional | |
| `amazon.fetched_at` | `utensils.amazon_fetched_at` | optional | |
| `buy_links[]` | `utensil_buy_links` rows | optional | Replaced wholesale on each push |

DB-only fields not in the bundle: `created_at`, `updated_at`, `created_by`.

## Image paths

`photo` accepts three shapes; `push` normalizes the first two:

1. `assets/utensils/<id>/<id>.jpg` — repo-relative path (what
   `mfc update-utensil` writes). On push, normalized to a full Storage URL.
2. `/assets/utensils/<id>/<id>.jpg` — same as above with leading slash; also
   normalized.
3. `https://…supabase.co/storage/v1/object/public/utensil-images/<id>/<id>.jpg` —
   full Storage URL (what `pull` writes after the row exists in DB). Passed
   through unchanged on push.

The static frontend renders whatever the DB contains, so push-time
normalization is what makes the image actually load in the browser.

## Authoring workflow

```bash
# Create or update a utensil bundle locally (no cloud writes)
make update-utensil                          # interactive: prompts for slug + URL
make update-utensil URL=… ID=…               # scripted

# Propagate to Supabase (rows + image bytes, chained)
make sync-utensils DIRECTION=push
```

`update-utensil` scrapes the Amazon page (title, price, bullets, product
details, images) and writes the bundle + a 1500×1500 square-padded JPEG.
The square pad samples the image's edge pixels for a fill colour that
matches the original background — see
[`automation/mfc/ops/image_processing.py`](../automation/mfc/ops/image_processing.py).

---

# See also

- [`CLAUDE.md`](../CLAUDE.md) — codebase orientation, schema layers, sync
  commands.
- [`automation/db/schema.sql`](../automation/db/schema.sql) — DB schema with
  inline `COMMENT ON COLUMN` on every column.
- [`docs/superpowers/specs/`](superpowers/specs/) — design docs for
  individual features (recipe ownership, images storage, ingredient
  bundles, utensil import, etc.).
