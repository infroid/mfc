# thiings.co ingredient image fetcher — design

- **Date**: 2026-05-07
- **Status**: design (pre-implementation)
- **Owner**: Aman

## Summary

Pull illustrated PNGs for every row in `public.ingredients` from
[thiings.co/things/<slug>](https://www.thiings.co/things), store them in the
repo at `web/assets/img/ingredients/<id>.png`, and update each ingredient's
`photo` column to point at the new path. Driven by a Python CLI command;
idempotent, polite, no admin-UI button, no Edge Function, no new bucket.

The local files are the source of truth; pushing to Supabase Storage is the
human's existing `mfc sync-images`-style flow (out of scope here — see "Sync
to Storage" below).

## Decisions

| # | Question | Choice |
|---|---|---|
| 1 | Where do bytes live? | Local repo — `web/assets/img/ingredients/<id>.png`, committed |
| 2 | Trigger | CLI only (single-id + bulk). No admin UI button — would need an Edge Function and conflicts with repo-storage |
| 3 | Miss behaviour | Skip + log. Stateless; re-runs naturally retry misses |
| 4 | Approach | Scrape page HTML, download Vercel Blob URL directly (bypass Next.js proxy) |
| 5 | Idempotency | If `<id>.png` already on disk, skip unless `--force` |

## Non-goals

- Admin UI button to fetch from the browser. (Static site can't write to the
  laptop; running through Storage diverges from C.)
- Background/automated fetch on row INSERT.
- Image resizing, cropping, or format conversion. PNG bytes from thiings are
  saved verbatim.
- Manifest cache of slug → blob URL. Re-scrape every time; trivial cost.
- New `ingredient-images` Storage bucket. Eventual sync to Storage is the
  user's separate `mfc sync-images` workflow.
- Any change to recipe images, recipe sync, or the Storage RLS layer.

## Architecture

### New files

- `automation/mfc/ops/thiings.py` — pure scraper. One public function
  `fetch_image(slug: str) -> bytes`. Two exception classes: `ThiingsNotFound`
  (slug genuinely missing — page 404 or no image in HTML) and `ThiingsError`
  (transient — network, timeout, malformed PNG, oversize).
- `automation/mfc/commands/fetch_ingredient_images.py` — orchestrator. Reads
  ingredients via existing Supabase client, runs idempotency check, calls
  `thiings.fetch_image`, writes file, updates DB row, accumulates report.
- `automation/tests/test_thiings.py` — three HTML fixture cases (happy /
  no-image / 404 stub) verifying scraper parsing and exception behaviour.
  No live HTTP.

### Modified files

- `automation/mfc/cli.py` — register the two subcommands.
- `Makefile` — add `fetch-ingredient-images` target (bulk only; single-id is
  CLI-direct).
- `automation/db/schema.sql` — update the `COMMENT ON COLUMN
  public.ingredients.photo` to reflect the new path convention.
- `web/assets/js/app/admin-ingredient-app.jsx` — update the placeholder hint
  on the Photo input field. No behaviour change.

### New directory

- `web/assets/img/ingredients/` — created on first run. Contents committed
  to git.

## CLI surface

```
mfc fetch-ingredient-image <id> [--force] [--no-db]
mfc fetch-ingredient-images       [--force] [--no-db] [--limit N] [--ids a,b,c]
```

| Flag | Default | Effect |
|---|---|---|
| `--force` | off | Re-download even if `<id>.png` exists. Also re-writes `photo` if it currently points under `assets/img/ingredients/`; never clobbers a manual override pointing elsewhere |
| `--no-db` | off | Save the file but skip the `UPDATE` on `ingredients.photo` |
| `--limit N` | none | Cap to N ingredients per bulk run (testing / pacing) |
| `--ids a,b,c` | none | Bulk run restricted to this allowlist; layered with idempotency |

Pacing: **0.5 s sleep between requests** by default. Hardcoded; override only
if rate-limit issues surface.

End-of-run report (stdout):

```
Fetched: 38   (downloaded + saved)
Skipped: 12   (already on disk)
Misses:   4   (slug not on thiings.co)
Failed:   1   (network/parse error)

Misses:
  - kasuri-methi   (HTTP 404)
  - aamchur        (image element not in HTML)

Failed:
  - paneer         (timeout after 10s)
```

Exit code: `0` regardless of misses (a miss is not a failure). Non-zero only
on a true failure that suggests broken setup (Supabase auth error, output
directory unwritable, every single request errored — i.e. probable network
breakdown or thiings-side outage).

## Scraper details

`thiings.fetch_image(slug)`:

1. GET `https://www.thiings.co/things/<slug>` via an HTTP client (Python
   `requests` or `httpx` — implementer's pick) with header `User-Agent:
   Mozilla/5.0 ...` (real browser string), `timeout=10`, follow redirects.
   - HTTP 404 → `raise ThiingsNotFound(slug, reason="page-404")`
   - Other non-2xx / connection error → `raise ThiingsError(slug, ...)`
2. Extract image URL from the response body, in order:
   - Regex against the Vercel Blob URL pattern:
     `https://lftz25oez4aqbxpq\.public\.blob\.vercel-storage\.com/image-[A-Za-z0-9]+\.png`
   - Fallback regex: `_next/image\?url=([^&"]+)`, URL-decode group 1, take
     that as the image URL (the encoded value is the same Vercel Blob URL).
   - Neither matches → `raise ThiingsNotFound(slug, reason="no-image-in-html")`.
3. GET the extracted URL, stream to memory:
   - Cap at 5 MB → over → `ThiingsError(slug, reason="oversize")`
   - Validate first 8 bytes are PNG magic (`89 50 4E 47 0D 0A 1A 0A`) →
     mismatch → `ThiingsError(slug, reason="not-png")`
4. Return PNG bytes.

The two-step extraction shields against minor HTML changes: the proxy URL
contains the canonical blob URL URL-encoded, so the fallback recovers it
from a slightly different surrounding markup.

## Orchestrator details

Pseudocode:

```
ingredients = supabase.table("ingredients").select("id, photo").execute().data
ingredients = filter_by_ids(ingredients, args.ids) if args.ids else ingredients
ingredients = ingredients[: args.limit] if args.limit else ingredients

for ing in ingredients:
    path = WEB / "assets/img/ingredients" / f"{ing['id']}.png"

    if path.exists() and not args.force:
        report.skipped.append(ing["id"])
        continue

    try:
        data = thiings.fetch_image(ing["id"])
    except ThiingsNotFound as e:
        report.misses.append((ing["id"], e.reason))
        continue
    except ThiingsError as e:
        report.failed.append((ing["id"], e.reason))
        continue

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    report.fetched.append(ing["id"])

    if not args.no_db:
        rel = f"assets/img/ingredients/{ing['id']}.png"
        update_photo_if_unset_or_default(supabase, ing, rel, force=args.force)

    sleep(0.5)

print_report(report)
```

`update_photo_if_unset_or_default(...)`:

- If `--force` is off: `UPDATE ... SET photo = $rel WHERE id = $id AND (photo
  IS NULL OR photo = '')`. (Doesn't clobber any pre-existing path.)
- If `--force` is on: same as above, plus `OR photo LIKE
  'assets/img/ingredients/%'`. Manual overrides pointing elsewhere remain
  untouched.

Auth: secret service-role key from `automation/.env`, same pattern as
`mfc sync-recipes`. Bypasses RLS for the admin write.

## Schema/UI changes

- `automation/db/schema.sql` — `COMMENT ON COLUMN public.ingredients.photo`
  updated from `data/ingredient-photos/paneer.jpg` to
  `assets/img/ingredients/paneer.png`. Idempotent (`COMMENT ON` is
  re-runnable). No migration required.
- `web/assets/js/app/admin-ingredient-app.jsx` — placeholder + hint text on
  the Photo `<Field>` updated to match the new convention.

## Sync to Storage (out of scope here)

The repo files mirror to Supabase Storage via the human's existing
sync workflow. This spec doesn't touch that. If/when ingredient images join
the sync pipeline, that's a separate spec; until then, the `photo` column
holds a relative repo path, which the static site can resolve directly.

## Testing & verification

- `pytest automation/tests/test_thiings.py` — green on three cases (use
  `responses` or `unittest.mock` to stub HTTP — no live network):
  - **Happy path**: serve a real captured `spinach` HTML body for the page
    GET, then a tiny valid PNG for the blob GET. `fetch_image("spinach")`
    returns those bytes; first 8 bytes are PNG magic.
  - **Page 404**: page GET returns 404. `fetch_image(...)` raises
    `ThiingsNotFound` with `reason="page-404"`.
  - **No image in HTML**: page GET returns 200 with synthetic HTML lacking
    any thiings/Vercel image references. `fetch_image(...)` raises
    `ThiingsNotFound` with `reason="no-image-in-html"`.
- Live smoke: `mfc fetch-ingredient-image spinach --no-db` produces a valid
  PNG at `web/assets/img/ingredients/spinach.png`.
- Visual: after `mfc fetch-ingredient-images`, open
  `admin/ingredients.html`. Every fetched row should render its thumbnail
  via the existing photo binding. No UI work needed.

## Risks & mitigations

- **HTML structure change at thiings.co** — single failure mode. Caught by
  the test fixtures the moment we re-record. Two-tier extraction (literal
  blob URL + proxy fallback) gives one layer of forgiveness. Failure mode
  is loud (`misses` report), not silent.
- **Rate limiting** — 0.5 s pacing + 10 s timeout. If misses explode after
  a long run, lower limit / introduce manifest cache (#3 from approaches).
- **Slug mismatch** — our `ingredient.id` (e.g. `kasuri-methi`) may not
  match thiings' slug. Treated as a miss, logged. Fix is manual: edit the
  `photo` column to a hand-picked URL or paste an image into the
  ingredients dir under the correct filename.
- **Image refresh** — thiings might update an asset. `--force` re-pulls.
  The committed PNGs in git serve as both cache and audit log.
