# Utensil import from Amazon URL + bidirectional sync — design

- **Date**: 2026-05-07
- **Status**: design (pre-implementation)
- **Owner**: Aman

## Summary

Two new CLI commands eliminate the manual labour of populating the utensil
library:

- `mfc create-utensil <amazon-url>` — paste an Amazon product URL; the CLI
  scrapes the page, downloads candidate images, lets you pick the best one,
  writes a per-utensil JSON bundle + image to disk, and (optionally) pushes
  the row to Supabase.
- `mfc sync-utensils --direction <pull|push|both>` — bidirectional reconcile
  between local `web/assets/utensils/<id>/utensil.json` bundles and the
  `utensils` + `utensil_buy_links` tables. Same shape as `mfc sync-recipes`.

The Amazon scraper is structured so a future Product Advertising API (PA-API)
path swaps in transparently behind the same `ProductInfo` dataclass. CLI
only — no admin UI button (would require an Edge Function and conflicts with
local-as-source-of-truth).

## Decisions

| # | Question | Choice |
|---|---|---|
| 1 | Amazon source | Hybrid — scrape now; PA-API path stubbed for later |
| 2 | Local source of truth | Per-utensil JSON bundles (`web/assets/utensils/<id>/utensil.json`) |
| 3 | Trigger surface | CLI only |
| 4 | Multi-image handling | Download all candidates, interactive pick, store one |
| 5 | Slug uniqueness | Strict — no auto-suffix; collision aborts unless `--force` |
| 6 | Image bytes location | Local repo, committed to git (no Storage bucket) |

## Non-goals

- Admin UI "paste Amazon URL" button. Static site can't write to the laptop;
  routing through Storage diverges from local-as-source-of-truth.
- Bulk import (`--csv urls.csv`). Single-shot first; bulk is a follow-up.
- Utensil photos in Supabase Storage. Bytes stay in `web/assets/utensils/`.
- Image resizing, cropping, format conversion. Amazon `hiRes` JPEG bytes
  saved verbatim.
- PA-API integration. Stubbed seam only — actual call lands when Amazon
  access is granted.
- Any change to recipe images, recipe sync, or the Storage RLS layer.

## Architecture

### New files

- `automation/mfc/ops/amazon.py` — pure scraper. Public `fetch_product(url)
  -> ProductInfo`. Stub `fetch_product_via_paapi(asin, marketplace)` raises
  `NotImplementedError`. Two exception classes: `AmazonNotFound` (bad URL,
  page 404, missing ASIN) and `AmazonError` (transient — network, parse
  failure, bot wall, oversize image).
- `automation/mfc/ops/utensils.py` — bundle/DB sync. `push_bundles`,
  `pull_bundles`, `sync` orchestrator. Mirrors `ops/recipes.py` shape
  line-for-line.
- `automation/mfc/commands/create_utensil.py` — orchestrator: scrape, image
  selection, bundle write, optional DB push.
- `automation/mfc/commands/sync_utensils.py` — argparse wrapper, mirrors
  `commands/sync_recipes.py`.
- `automation/tests/test_amazon.py` — three HTML fixture cases (happy /
  bot-wall / 404), table-driven ASIN extraction. No live HTTP.
- `automation/tests/test_utensils_sync.py` — push, pull, round-trip.

### Modified files

- `automation/mfc/cli.py` — register two new subcommands.
- `Makefile` — add `create-utensil URL=...` and `sync-utensils` targets.
- `automation/db/schema.sql` — add three columns to `utensils` (idempotent
  `ADD COLUMN IF NOT EXISTS`); update `COMMENT ON COLUMN utensils.photo`.
- `web/assets/js/app/admin-utensil-app.jsx` — update Photo input placeholder
  hint to reflect new path convention. No behaviour change.

### New directory

- `web/assets/utensils/<id>/` — created on first run. Contains
  `utensil.json` and `<id>.jpg`. Contents committed to git.

## Bundle format

`web/assets/utensils/<id>/utensil.json` — round-trips losslessly with the
DB row.

```json
{
  "id": "kadhai-cast-iron",
  "name": "Cast-iron kadhai",
  "tagline": "deep, broad, hot — the workhorse pan",
  "category": "Cookware",
  "photo": "assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg",
  "care_tip": "Hand-wash, dry on heat, oil lightly.",
  "specs": { "material": "cast iron", "size": "10\"", "weight": "2.4 kg" },
  "show": { "buyLink": true, "careTip": true, "specs": false },
  "ai_filled_at": "2026-05-07T15:30:00Z",
  "amazon": {
    "asin": "B07JFTSKXW",
    "marketplace": "amazon.com",
    "fetched_at": "2026-05-07T15:30:00Z"
  },
  "buy_links": [
    {
      "sort_order": 0,
      "store": "Amazon",
      "url": "https://www.amazon.com/dp/B07JFTSKXW?tag=mfc-20",
      "price": "$49.95",
      "affiliate_tag": "mfc-20"
    }
  ]
}
```

Notes:

- `buy_links` flattens `utensil_buy_links` child rows. One Amazon row at
  sort_order 0 today; structure ready for multi-store later.
- `amazon.{asin, marketplace, fetched_at}` map to three new utensils
  columns (Section: Schema changes).
- `photo` is a **local repo path** (matches the thiings ingredient
  convention). Static site loads it directly. No Storage URL.
- Optional fields with null values are dropped from the JSON on pull, so
  files stay clean.

## Schema changes

`automation/db/schema.sql` (idempotent, re-runnable via `mfc apply-schema`):

```sql
ALTER TABLE public.utensils
  ADD COLUMN IF NOT EXISTS amazon_asin        text,
  ADD COLUMN IF NOT EXISTS amazon_marketplace text,
  ADD COLUMN IF NOT EXISTS amazon_fetched_at  timestamptz;

COMMENT ON COLUMN public.utensils.amazon_asin        IS 'Amazon ASIN (10-char). Stable across price/availability changes; lookup key for future PA-API refresh.';
COMMENT ON COLUMN public.utensils.amazon_marketplace IS 'Amazon marketplace host (e.g. "amazon.com", "amazon.in"). Pairs with asin.';
COMMENT ON COLUMN public.utensils.amazon_fetched_at  IS 'When Amazon data (image, price, title) was last refreshed for this row.';
```

`COMMENT ON COLUMN public.utensils.photo` updated to reflect the new path
convention (`assets/utensils/<id>/<id>.jpg`).

`utensil_buy_links` is unchanged.

No migration file — repo applies `schema.sql` directly. `ADD COLUMN IF NOT
EXISTS` is safe to re-run on existing DBs.

## Scraper details (`ops/amazon.py`)

```python
@dataclass
class ProductInfo:
    asin: str
    marketplace: str        # "amazon.com" | "amazon.in" | ...
    title: str
    price: str | None       # display string, e.g. "$49.95" / "₹1,299"
    image_urls: list[str]   # ordered, hero first
    breadcrumbs: list[str]
    canonical_url: str      # "https://www.amazon.com/dp/<ASIN>"

class AmazonNotFound(Exception): ...
class AmazonError(Exception): ...

def fetch_product(url: str) -> ProductInfo: ...
def fetch_product_via_paapi(asin: str, marketplace: str) -> ProductInfo:
    raise NotImplementedError("PA-API path not yet wired up")
```

**ASIN extraction** accepts:

- `amazon.<tld>/dp/<ASIN>[/...]?...`
- `amazon.<tld>/gp/product/<ASIN>[/...]`
- `amazon.<tld>/.../dp/<ASIN>/...` (slug between)
- Bare 10-char alphanumeric ASIN

Anything else → `AmazonNotFound`.

**Page parsing** (BeautifulSoup):

- title → `#productTitle` text
- price → `.a-price .a-offscreen` first match; fallback to
  `#corePrice_feature_div`
- image_urls → parse the `colorImages` JSON block in the product script;
  pull every `hiRes` URL (or `large` if `hiRes` missing); de-dupe, preserve
  order. **Two-tier extraction:** if `colorImages` parsing fails, fall
  back to `<meta property="og:image">` (single image)
- breadcrumbs → `#wayfinding-breadcrumbs_feature_div a` text array
- HTTP 404 → `AmazonNotFound`
- bot-wall ("Robot Check" / captcha) → `AmazonError("bot-wall")`
- title missing → `AmazonError("parse-failure")`

**HTTP behaviour:** real-browser `User-Agent`, `Accept-Language: en-US,en`,
`timeout=15`, follow redirects. No retry loop in the scraper itself.

**Marketplace:** parsed from URL host, stripped of any `www.` prefix
(`www.amazon.com` → `amazon.com`). Stored on the bundle for future PA-API
routing.

## Orchestrator details (`commands/create_utensil.py`)

```
mfc create-utensil <amazon-url> [--id <slug>] [--no-db]
                                [--image-index N] [--no-image] [--force]
```

Flow:

```
1. Parse URL → ASIN + marketplace. AmazonNotFound on bad URL.
2. fetch_product(url) → ProductInfo
3. Resolve id:
     --id <slug>             → use as-is (validate slug shape)
     no flag                 → slugify(title)
4. Collision check:
     bundle dir exists OR DB row exists?
       --force off → abort with clear message:
         "Utensil id "<id>" already exists. Either re-run with
          --id <different-slug>, or pass --force to overwrite."
       --force on  → proceed; will overwrite bundle JSON + DB row on push.
5. mkdir web/assets/utensils/<id>/
6. Image flow (skip if --no-image):
     Download every image_url to _candidates/img-1.jpg ... img-N.jpg
       cap each at 5 MB → AmazonError("oversize")
     Write _candidates/preview.html with grid of <img> + numbered captions
     `open` the HTML (macOS); print path on other OSes
     Prompt "Pick image [1-N, 0 to skip]:"  (or use --image-index N)
     Move chosen → web/assets/utensils/<id>/<id>.jpg
     rm -rf _candidates/ + preview.html
7. Compose bundle dict:
     id, name=title, tagline=null, category=guess_from_breadcrumbs(),
     photo="assets/utensils/<id>/<id>.jpg" (or null if skipped),
     care_tip=null, specs={}, show={buyLink:true,careTip:true,specs:false},
     ai_filled_at=now, amazon={asin, marketplace, fetched_at:now},
     buy_links=[{sort_order:0, store:"Amazon",
                 url:"https://www.<host>/dp/<ASIN>?tag=mfc-20",
                 price, affiliate_tag:"mfc-20"}]
8. Write web/assets/utensils/<id>/utensil.json (pretty, trailing newline)
9. If --no-db is off: utensils.push_bundles(config, only=[id])
10. Print: bundle path, DB id, "Edit at admin/utensil.html?id=<id> to refine."
```

**`guess_from_breadcrumbs()`** literal map:

- `Knives|Cutlery` → `Cutlery`
- `Bakeware|Baking` → `Bakeware`
- `Small Appliances|Blenders|Mixers` → `Small appliance`
- `Measuring|Scales|Thermometers` → `Measuring`
- `Cookware|Pots|Pans|Skillets|Woks` → `Cookware` (default)
- otherwise → `Utensil`

**Affiliate tag.** CLI rewrites every Amazon URL with `tag=mfc-20`
regardless of what was pasted. Matches the existing admin-form convention.
The `mfc-20` value is a constant in code; if it ever changes, one-line
edit.

**`ai_filled_at` timestamp** — set on creation so the existing AI banner in
`admin-utensil-app.jsx` surfaces ("Auto-filled by Claude · …. Review,
toggle which fields appear, publish.").

## Sync details (`ops/utensils.py`)

Three public functions:

**`push_bundles(config, *, only=None) -> SyncReport`** — local → DB.

1. Read all `web/assets/utensils/<id>/utensil.json` (filtered by `only`).
2. Validate `id` + `name` present; warn-skip otherwise.
3. Upsert `utensils` rows (all bundle fields + amazon_asin, amazon_marketplace,
   amazon_fetched_at).
4. Reconcile `utensil_buy_links`: `DELETE WHERE utensil_id IN (...)` then
   bulk `INSERT` from bundle's `buy_links` array. Same delete-then-insert
   as `recipe_*` child tables.
5. Idempotent.

**`pull_bundles(config, *, only=None) -> SyncReport`** — DB → local.

1. Read `utensils` rows (filtered by `only`).
2. Per row, read `utensil_buy_links` ordered by `sort_order`.
3. Compose bundle dict, drop None-valued optional keys, write
   `utensil.json`. Image bytes are NOT moved by this function.

**`sync(config, *, direction, only=None)`** — orchestrator. `pull` /
`push` / `both`. For `both`, last-modified-wins per utensil: compare
`utensils.updated_at` vs `utensil.json` mtime, ±1 s clock-skew tolerance,
push winners and pull losers in two batches.

**Image bytes:** committed to git alongside the JSON. No `sync-utensil-
images` command. If utensil photos ever move to Storage, that's a
follow-up spec mirroring the `recipe-images` work.

**`recipes.py` collateral:** the existing `_collect_library` upsert in
`ops/recipes.py` writes `(id, name)` stubs when a recipe references a new
utensil. That stays — safety net for unseeded utensils. After
`sync-utensils push`, the full row exists; before, it's a stub. The Supabase
`upsert` with `on_conflict="id"` only updates the columns present in the
payload, so the recipe-side stub upsert does not clobber `tagline`, `photo`,
`category`, `specs`, `show`, `care_tip`, `ai_filled_at`, or the `amazon_*`
columns. **However**, it does overwrite `name` if the recipe author wrote
a different name than the canonical utensil. Treat the canonical name as
authoritative: when in doubt, fix it in `utensil.json` and re-push, and
update the recipe bundle to match. (Not a regression — same convention
already applied to `ingredients.name`.)

## Makefile + CLI registration

`automation/mfc/cli.py` — register the two subcommands alongside the
existing list. No structural change.

`Makefile` additions:

```make
.PHONY: ... sync-utensils create-utensil

sync-utensils: ## sync utensil library DB↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-utensils --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — DB → local. Rebuilds utensil.json bundles from rows.\n"; \
	  printf "  push — local → DB. Upserts bundles into utensils + utensil_buy_links.\n"; \
	  printf "  both — pull then push. Last-modified wins per utensil.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-utensils --direction $$d; \
	fi

create-utensil: ## create utensil from amazon url; required URL=<amazon-url> [ID=<slug>] [FORCE=1] [NO_DB=1] [NO_IMAGE=1]
	@$(UV) run mfc create-utensil "$(URL)" $(if $(ID),--id "$(ID)") $(if $(FORCE),--force) $(if $(NO_DB),--no-db) $(if $(NO_IMAGE),--no-image)
```

Usage:

```
make create-utensil URL='https://www.amazon.com/dp/B07JFTSKXW?tag=foo-20'
make create-utensil URL='...' ID='kadhai-cast-iron-shun'
make create-utensil URL='...' FORCE=1
make sync-utensils                          # interactive prompt
make sync-utensils DIRECTION=push
```

## Testing & verification

**Unit tests** (`automation/tests/test_amazon.py`) — three captured HTML
fixtures, no live network:

- **Happy path** — captured product page. `fetch_product(url)` returns
  `ProductInfo` with non-empty `asin`, `title`, ≥3 `image_urls`, parsed
  `price`, breadcrumb chain.
- **Bot-wall** — captured "Robot Check" page. Raises
  `AmazonError("bot-wall")`.
- **Page 404** — server returns 404. Raises `AmazonNotFound`.
- **ASIN extraction** — table-driven across all four input forms +
  malformed.

**Sync tests** (`automation/tests/test_utensils_sync.py`):

- Push a bundle, read back rows, assert equality.
- Pull a row with 2 buy_links, assert bundle JSON has them in
  `sort_order`.
- Round-trip: push → pull → diff bundle == original.

**Live smoke** (manual):

1. `make create-utensil URL='<real Amazon URL>' NO_DB=1` → bundle JSON +
   image present locally, no DB write.
2. Inspect `web/assets/utensils/<id>/utensil.json`. Edit `tagline` by
   hand.
3. `make sync-utensils DIRECTION=push` → row appears in `utensils` table.
4. Open `admin/utensil.html?id=<id>` → AI banner visible, fields
   populated, edit + save.
5. `make sync-utensils DIRECTION=pull` → bundle picks up the saved edits.

**Visual regression:** open a recipe page that references the new utensil
→ utensil card on the recipe detail renders with the new photo and Amazon
buy link.

## Risks & mitigations

- **Amazon HTML changes / bot wall.** Single fragility point. Mitigations:
  (i) two-tier image extraction (`colorImages` JSON → `og:image` fallback);
  (ii) loud failure — `AmazonError("bot-wall")` exits non-zero with clear
  message rather than half-creating a bundle. Long-term fix is the PA-API
  path the scraper already supports as a stub.
- **Slug collisions across marketplaces.** Same product on `amazon.com`
  and `amazon.in` would slugify identically. Resolved by the strict-
  uniqueness rule (Decision #5) — pass `--id` explicitly. Acceptable
  trade-off.
- **Image sizing.** Amazon `hiRes` URLs are typically ≥1500 px JPEGs
  (200–800 KB). Bundle dirs grow git history fast on bulk imports.
  Mitigation: cap each candidate at 5 MB; chosen file committed verbatim,
  no re-encoding. If git size becomes a real issue, follow-up spec moves
  utensil photos to Storage.
- **Affiliate-tag drift.** CLI rewrites every Amazon URL with `tag=mfc-20`
  regardless of what was pasted. Matches existing admin-form convention.
- **PA-API swap when access lands.** Interface already returns
  `ProductInfo`; swap is one new function +
  flag on `create-utensil` to prefer it. Existing scrape path remains as
  fallback.
- **Round-trip drift on non-bundle fields.** `created_by`, `created_at`,
  `updated_at` are DB-only. Pull writes the bundle without them; push
  doesn't touch them. Same convention as recipes.

## Rollout sequence

1. Schema columns (`amazon_asin`, `amazon_marketplace`, `amazon_fetched_at`).
2. `ops/amazon.py` + tests.
3. `ops/utensils.py` + tests.
4. `commands/create_utensil.py` + `commands/sync_utensils.py`, CLI wiring.
5. `Makefile` targets.
6. `schema.sql` `COMMENT ON` polish + `admin-utensil-app.jsx` placeholder
   hint.

One PR or split — implementer's call.

## Out of scope (future specs)

- Bulk import (`mfc create-utensils --csv urls.csv`).
- Utensil image bytes in Supabase Storage (mirror of `recipe-images`).
- PA-API integration once Amazon access is granted.
- Admin UI "paste Amazon URL" button (would need an Edge Function).
