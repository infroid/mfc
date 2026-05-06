# thiings.co Ingredient Image Fetcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Python CLI that scrapes thiings.co for ingredient illustrations and saves them to `web/assets/img/ingredients/<id>.png`, updating the `public.ingredients.photo` column to point at each new file.

**Architecture:** A pure scraper (`automation/mfc/ops/thiings.py`) extracts the underlying Vercel Blob URL from the thiings page HTML and downloads the PNG bytes. An orchestrator command (`automation/mfc/commands/fetch_ingredient_images.py`) iterates ingredients, enforces on-disk idempotency, writes files, and updates DB rows via the existing service-role Supabase client. Misses (slug not on thiings) are skipped + logged.

**Tech Stack:** Python 3.10+, stdlib `urllib.request` (no new runtime deps), stdlib `unittest` (no new test framework), existing supabase-py service-role client.

**Spec:** [docs/superpowers/specs/2026-05-07-thiings-ingredient-images-design.md](../specs/2026-05-07-thiings-ingredient-images-design.md)

---

## File Structure

**New files**
- `automation/mfc/ops/thiings.py` — pure scraper. `fetch_image(slug) -> bytes`, exception classes `ThiingsNotFound` / `ThiingsError`.
- `automation/mfc/commands/fetch_ingredient_images.py` — single + bulk subcommand orchestration. Idempotency, DB update, run report.
- `automation/tests/__init__.py` — empty marker so unittest discovery treats `tests/` as a package.
- `automation/tests/test_thiings.py` — three unittest cases (happy, page-404, no-image-in-html).

**Modified files**
- `automation/mfc/cli.py` — register the new commands.
- `Makefile` — add `fetch-ingredient-images` target.
- `automation/db/schema.sql` — update the `COMMENT ON COLUMN public.ingredients.photo` text.
- `web/assets/js/app/admin-ingredient-app.jsx` — update Photo `<Field>` placeholder + hint.

**New directory**
- `web/assets/img/ingredients/` — created on first fetch run; PNG files committed to git.

---

### Task 1: Test scaffolding + scraper happy-path test

**Files:**
- Create: `automation/tests/__init__.py`
- Create: `automation/tests/test_thiings.py`
- Create: `automation/mfc/ops/thiings.py` (stub only — empty module to make import succeed in step 3)

- [ ] **Step 1: Create the empty test package marker**

```bash
mkdir -p automation/tests
: > automation/tests/__init__.py
```

- [ ] **Step 2: Write `automation/tests/test_thiings.py` with the happy-path test**

```python
"""Tests for mfc.ops.thiings — scraper for thiings.co/things/<slug>."""

from __future__ import annotations

import io
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
TINY_PNG = PNG_MAGIC + b"rest-of-png-bytes"

# Minimal HTML fragment containing the canonical Vercel Blob URL the
# real thiings.co page exposes inside the Next.js <Image> component.
SPINACH_HTML = b"""<!doctype html><html><body>
<img src="/_next/image?url=https%3A%2F%2Flftz25oez4aqbxpq.public.blob.vercel-storage.com%2Fimage-YOHxnWgKxTUQknXCGBBSQmI9XcJ1WN.png&amp;w=1000&amp;q=75"/>
</body></html>"""


class _FakeResp(io.BytesIO):
    """Stand-in for `urllib.request.urlopen` return value."""

    def __init__(self, body: bytes, status: int = 200):
        super().__init__(body)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()


def _urlopen_factory(responses):
    """Return a function that pops one canned response per call.

    Each entry in `responses` is either a (status, body) tuple → 2xx body, or
    an HTTPError instance → raised immediately.
    """
    queue = list(responses)

    def fake(req, timeout=None):
        item = queue.pop(0)
        if isinstance(item, HTTPError):
            raise item
        status, body = item
        return _FakeResp(body, status=status)

    return fake


class FetchImageHappyPath(unittest.TestCase):
    def test_returns_png_bytes_when_html_exposes_blob_url(self):
        from mfc.ops import thiings

        responses = [
            (200, SPINACH_HTML),  # page GET
            (200, TINY_PNG),       # blob GET
        ]
        with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory(responses)):
            data = thiings.fetch_image("spinach")

        self.assertEqual(data[:8], PNG_MAGIC)
        self.assertEqual(data, TINY_PNG)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Create empty scraper module so import resolves**

```bash
: > automation/mfc/ops/thiings.py
```

- [ ] **Step 4: Run the test to verify it fails for the right reason**

Run: `cd automation && uv run python -m unittest tests.test_thiings -v`
Expected: FAIL with `AttributeError: module 'mfc.ops.thiings' has no attribute 'fetch_image'` (or `ImportError` on `urlopen`).

- [ ] **Step 5: Commit the failing-test scaffolding**

```bash
git add automation/tests/__init__.py automation/tests/test_thiings.py automation/mfc/ops/thiings.py
git commit -m "test(thiings): add happy-path scraper test (failing)"
```

---

### Task 2: Implement scraper happy path

**Files:**
- Modify: `automation/mfc/ops/thiings.py`

- [ ] **Step 1: Write the minimal scraper to pass the happy-path test**

Replace the contents of `automation/mfc/ops/thiings.py` with:

```python
"""Scraper for thiings.co/things/<slug>.

Pulls the underlying Vercel Blob PNG URL out of the Next.js page HTML
and downloads the bytes. Pure I/O — no DB, no filesystem.

Public API:
    fetch_image(slug) -> bytes
    ThiingsNotFound   — raised when slug is genuinely missing
    ThiingsError      — raised on transient/structural failures
"""

from __future__ import annotations

import re
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from urllib.request import Request, urlopen


PAGE_URL = "https://www.thiings.co/things/{slug}"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
TIMEOUT_S = 10
MAX_BYTES = 5 * 1024 * 1024  # 5 MB sanity cap on the blob download
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

_BLOB_HOST = r"lftz25oez4aqbxpq\.public\.blob\.vercel-storage\.com"
_BLOB_RE = re.compile(rf"https://{_BLOB_HOST}/image-[A-Za-z0-9]+\.png")
_PROXY_RE = re.compile(r'_next/image\?url=([^&"\']+)')


class ThiingsError(RuntimeError):
    """Transient / unexpected failure (network, timeout, bad payload)."""

    def __init__(self, slug: str, reason: str):
        super().__init__(f"{slug}: {reason}")
        self.slug = slug
        self.reason = reason


class ThiingsNotFound(ThiingsError):
    """Slug genuinely missing — page 404 or no image in HTML."""


def _get(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(req, timeout=TIMEOUT_S) as resp:
            return resp.read(MAX_BYTES + 1)
    except HTTPError:
        raise
    except (URLError, TimeoutError) as exc:
        raise ThiingsError(url, f"network: {exc}") from exc


def _extract_blob_url(html: bytes) -> str | None:
    text = html.decode("utf-8", errors="ignore")
    m = _BLOB_RE.search(text)
    if m:
        return m.group(0)
    m = _PROXY_RE.search(text)
    if m:
        decoded = unquote(m.group(1))
        if _BLOB_RE.fullmatch(decoded):
            return decoded
    return None


def fetch_image(slug: str) -> bytes:
    """Return PNG bytes for the given thiings slug.

    Raises ThiingsNotFound if the slug is missing on thiings.co.
    Raises ThiingsError on network/structural failures.
    """
    page_url = PAGE_URL.format(slug=slug)
    try:
        html = _get(page_url)
    except HTTPError as exc:
        if exc.code == 404:
            raise ThiingsNotFound(slug, "page-404") from exc
        raise ThiingsError(slug, f"page-http-{exc.code}") from exc

    blob_url = _extract_blob_url(html)
    if blob_url is None:
        raise ThiingsNotFound(slug, "no-image-in-html")

    try:
        data = _get(blob_url)
    except HTTPError as exc:
        raise ThiingsError(slug, f"blob-http-{exc.code}") from exc

    if len(data) > MAX_BYTES:
        raise ThiingsError(slug, "oversize")
    if not data.startswith(PNG_MAGIC):
        raise ThiingsError(slug, "not-png")
    return data
```

- [ ] **Step 2: Run the happy-path test to verify it passes**

Run: `cd automation && uv run python -m unittest tests.test_thiings -v`
Expected: PASS — `FetchImageHappyPath.test_returns_png_bytes_when_html_exposes_blob_url … ok`.

- [ ] **Step 3: Commit**

```bash
git add automation/mfc/ops/thiings.py
git commit -m "feat(thiings): scraper happy path — extract Vercel Blob URL from page HTML"
```

---

### Task 3: Page-404 → ThiingsNotFound

**Files:**
- Modify: `automation/tests/test_thiings.py`

- [ ] **Step 1: Append the failing 404 test**

Append to `automation/tests/test_thiings.py` before the `if __name__ == "__main__":` line:

```python
class FetchImage404(unittest.TestCase):
    def test_page_404_raises_not_found_with_reason(self):
        from mfc.ops import thiings

        not_found = HTTPError(
            url="https://www.thiings.co/things/nope",
            code=404,
            msg="Not Found",
            hdrs=None,
            fp=None,
        )
        with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory([not_found])):
            with self.assertRaises(thiings.ThiingsNotFound) as ctx:
                thiings.fetch_image("nope")

        self.assertEqual(ctx.exception.slug, "nope")
        self.assertEqual(ctx.exception.reason, "page-404")
```

- [ ] **Step 2: Run the test — should pass against the Task 2 implementation**

Run: `cd automation && uv run python -m unittest tests.test_thiings -v`
Expected: both tests PASS. The 404 path is already implemented; this test locks the contract.

- [ ] **Step 3: Commit**

```bash
git add automation/tests/test_thiings.py
git commit -m "test(thiings): lock 404 → ThiingsNotFound(reason='page-404') contract"
```

---

### Task 4: HTML-without-image → ThiingsNotFound

**Files:**
- Modify: `automation/tests/test_thiings.py`

- [ ] **Step 1: Append the failing no-image test**

Append to `automation/tests/test_thiings.py` before `if __name__ == "__main__":`:

```python
class FetchImageNoImageInHtml(unittest.TestCase):
    def test_html_without_blob_url_raises_not_found(self):
        from mfc.ops import thiings

        empty_html = b"<html><body><p>nothing here</p></body></html>"
        with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory([(200, empty_html)])):
            with self.assertRaises(thiings.ThiingsNotFound) as ctx:
                thiings.fetch_image("aamchur")

        self.assertEqual(ctx.exception.slug, "aamchur")
        self.assertEqual(ctx.exception.reason, "no-image-in-html")
```

- [ ] **Step 2: Run all three tests**

Run: `cd automation && uv run python -m unittest tests.test_thiings -v`
Expected: all three tests PASS. `_extract_blob_url` already returns `None` for empty HTML.

- [ ] **Step 3: Commit**

```bash
git add automation/tests/test_thiings.py
git commit -m "test(thiings): lock no-image-in-html → ThiingsNotFound(reason='no-image-in-html')"
```

---

### Task 5: Orchestrator command — single-id form

**Files:**
- Create: `automation/mfc/commands/fetch_ingredient_images.py`
- Modify: `automation/mfc/cli.py`

- [ ] **Step 1: Create the command module with single-id support only**

Create `automation/mfc/commands/fetch_ingredient_images.py`:

```python
"""`mfc fetch-ingredient-image` / `mfc fetch-ingredient-images` —
download illustrated PNGs from thiings.co/things/<slug> for the
public.ingredients table. Idempotent on disk."""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from ..clients.sb import service_client
from ..core import log
from ..core.config import Config
from ..ops import thiings


REL_DIR = "assets/img/ingredients"
SLEEP_BETWEEN_REQUESTS_S = 0.5


@dataclass
class RunReport:
    fetched: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    misses:  list[tuple[str, str]] = field(default_factory=list)
    failed:  list[tuple[str, str]] = field(default_factory=list)

    def print(self) -> None:
        log.step(
            f"Fetched: {len(self.fetched)}   "
            f"Skipped: {len(self.skipped)}   "
            f"Misses: {len(self.misses)}   "
            f"Failed: {len(self.failed)}"
        )
        if self.misses:
            log.info("Misses:")
            for slug, reason in self.misses:
                log.info(f"  - {slug}   ({reason})")
        if self.failed:
            log.info("Failed:")
            for slug, reason in self.failed:
                log.info(f"  - {slug}   ({reason})")


def _output_path(config: Config, ingredient_id: str) -> Path:
    return config.repo_root / "web" / REL_DIR / f"{ingredient_id}.png"


def _update_photo(client, ingredient_id: str, current_photo: str | None, force: bool) -> None:
    rel = f"{REL_DIR}/{ingredient_id}.png"
    is_default = (current_photo or "").startswith(REL_DIR + "/")
    is_unset = not (current_photo or "").strip()
    if is_unset or (force and is_default):
        client.table("ingredients").update({"photo": rel}).eq("id", ingredient_id).execute()


def _process_one(
    client,
    config: Config,
    ingredient_id: str,
    current_photo: str | None,
    *,
    force: bool,
    no_db: bool,
    report: RunReport,
) -> None:
    out = _output_path(config, ingredient_id)
    if out.exists() and not force:
        report.skipped.append(ingredient_id)
        return
    try:
        data = thiings.fetch_image(ingredient_id)
    except thiings.ThiingsNotFound as exc:
        report.misses.append((ingredient_id, exc.reason))
        return
    except thiings.ThiingsError as exc:
        report.failed.append((ingredient_id, exc.reason))
        return

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    report.fetched.append(ingredient_id)

    if not no_db:
        _update_photo(client, ingredient_id, current_photo, force)


def _run_single(args: argparse.Namespace, config: Config) -> int:
    client = service_client(config)
    rows = (
        client.table("ingredients")
        .select("id, photo")
        .eq("id", args.id)
        .execute()
        .data
    )
    if not rows:
        log.error(f"ingredient '{args.id}' not found in public.ingredients")
        return 2
    report = RunReport()
    _process_one(
        client,
        config,
        rows[0]["id"],
        rows[0].get("photo"),
        force=args.force,
        no_db=args.no_db,
        report=report,
    )
    report.print()
    return 0 if not report.failed else 1


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-image",
        help="Fetch one ingredient image from thiings.co",
    )
    p.add_argument("id", help="ingredient id (slug used as thiings.co/things/<id>)")
    p.add_argument("--force", action="store_true", help="re-download even if local file exists")
    p.add_argument("--no-db", action="store_true", help="save file but skip DB update")
    p.set_defaults(handler=_run_single)
```

- [ ] **Step 2: Wire it into the CLI**

Edit `automation/mfc/cli.py`:

Change the import block:

```python
from .commands import (
    apply_schema,
    drop_schema,
    fetch_ingredient_images,
    list_users,
    reset,
    seed_metrics,
    set_role,
    status,
    sync_images,
    sync_recipes,
)
```

Change `COMMAND_MODULES` to include `fetch_ingredient_images` between `sync_images` and `set_role`:

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    sync_recipes,
    sync_images,
    fetch_ingredient_images,
    set_role,
    drop_schema,
    reset,
]
```

- [ ] **Step 3: Smoke test the wiring (no live HTTP yet)**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-image --help`
Expected: usage output shows `fetch-ingredient-image` with `--force` and `--no-db`. No traceback.

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/commands/fetch_ingredient_images.py automation/mfc/cli.py
git commit -m "feat(cli): add mfc fetch-ingredient-image (single-id form)"
```

---

### Task 6: Bulk form

**Files:**
- Modify: `automation/mfc/commands/fetch_ingredient_images.py`
- Modify: `automation/mfc/cli.py`

- [ ] **Step 1: Add the bulk runner + register function**

Append to `automation/mfc/commands/fetch_ingredient_images.py`:

```python
def _filter_by_ids(rows: Iterable[dict], ids: list[str] | None) -> list[dict]:
    if not ids:
        return list(rows)
    allow = set(ids)
    return [r for r in rows if r["id"] in allow]


def _run_bulk(args: argparse.Namespace, config: Config) -> int:
    client = service_client(config)
    rows = (
        client.table("ingredients")
        .select("id, photo")
        .order("id")
        .execute()
        .data
    )
    ids = [s.strip() for s in args.ids.split(",")] if args.ids else None
    rows = _filter_by_ids(rows, ids)
    if args.limit:
        rows = rows[: args.limit]

    log.step(f"Fetching {len(rows)} ingredient(s) from thiings.co")
    report = RunReport()
    for i, row in enumerate(rows):
        _process_one(
            client,
            config,
            row["id"],
            row.get("photo"),
            force=args.force,
            no_db=args.no_db,
            report=report,
        )
        if i < len(rows) - 1:
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)
    report.print()

    if rows and not (report.fetched or report.skipped or report.misses):
        # Every single row failed → likely network breakdown / thiings outage.
        return 1
    return 0


def register_bulk(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-images",
        help="Bulk fetch ingredient images from thiings.co (idempotent)",
    )
    p.add_argument("--force", action="store_true", help="re-download even if local file exists")
    p.add_argument("--no-db", action="store_true", help="save files but skip DB updates")
    p.add_argument("--limit", type=int, default=None, help="cap to first N ingredients (post-filter)")
    p.add_argument("--ids", default=None, help="comma-separated ingredient ids to include")
    p.set_defaults(handler=_run_bulk)
```

- [ ] **Step 2: Register the bulk command alongside the single one**

Edit `automation/mfc/cli.py` so the loop registers both forms. Replace:

```python
    for mod in COMMAND_MODULES:
        mod.register(sub)
```

with:

```python
    for mod in COMMAND_MODULES:
        mod.register(sub)
        register_bulk = getattr(mod, "register_bulk", None)
        if register_bulk is not None:
            register_bulk(sub)
```

- [ ] **Step 3: Smoke test the bulk wiring**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-images --help`
Expected: usage shows `--force --no-db --limit --ids`. No traceback.

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/commands/fetch_ingredient_images.py automation/mfc/cli.py
git commit -m "feat(cli): add mfc fetch-ingredient-images bulk form with --limit/--ids/--force/--no-db"
```

---

### Task 7: Makefile target

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add the target**

Edit `Makefile`. In the `.PHONY` line near the top, append `fetch-ingredient-images`:

```make
.PHONY: help sync status apply-schema seed-metrics \
        sync-recipes sync-images fetch-ingredient-images \
        list-users set-role drop-schema reset serve
```

Then insert this target after the `sync-images` block (before `list-users`):

```make
fetch-ingredient-images: ## fetch ingredient PNGs from thiings.co into web/assets/img/ingredients/ (idempotent); supports FORCE=1 LIMIT=N IDS=a,b
	@$(UV) run mfc fetch-ingredient-images \
	  $(if $(FORCE),--force) \
	  $(if $(LIMIT),--limit $(LIMIT)) \
	  $(if $(IDS),--ids $(IDS))
```

- [ ] **Step 2: Verify `make` lists the new target**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && make`
Expected: `fetch-ingredient-images` appears in the help output with the description above.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "build(make): add fetch-ingredient-images target with FORCE/LIMIT/IDS knobs"
```

---

### Task 8: Schema comment + admin form placeholder

**Files:**
- Modify: `automation/db/schema.sql`
- Modify: `web/assets/js/app/admin-ingredient-app.jsx:194-195`

- [ ] **Step 1: Update the schema comment**

Edit `automation/db/schema.sql`. Find:

```sql
COMMENT ON COLUMN public.ingredients.photo        IS 'Relative path to the ingredient photo (e.g. "data/ingredient-photos/paneer.jpg"). Nullable.';
```

Replace with:

```sql
COMMENT ON COLUMN public.ingredients.photo        IS 'Relative path under web/ to the ingredient photo (e.g. "assets/img/ingredients/paneer.png"). Populated by `mfc fetch-ingredient-images`. Nullable.';
```

- [ ] **Step 2: Update the admin form**

Edit `web/assets/js/app/admin-ingredient-app.jsx`. Find:

```jsx
                  <Field label="Photo" hint="Path under data/ingredient-photos/.">
                    <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="data/ingredient-photos/paneer.jpg" />
```

Replace with:

```jsx
                  <Field label="Photo" hint="Path under web/assets/img/ingredients/. Auto-populated by `mfc fetch-ingredient-images`.">
                    <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="assets/img/ingredients/paneer.png" />
```

- [ ] **Step 3: Apply the comment update to the live DB**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && make apply-schema`
Expected: idempotent re-apply succeeds; no errors.

- [ ] **Step 4: Commit**

```bash
git add automation/db/schema.sql web/assets/js/app/admin-ingredient-app.jsx
git commit -m "docs(schema): update ingredients.photo path convention to assets/img/ingredients/"
```

---

### Task 9: Live smoke test

**Files:**
- (no edits — verification only)

- [ ] **Step 1: Pick a likely-present slug and run no-DB single fetch**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-image spinach --no-db`
Expected:
- exit code 0
- file `web/assets/img/ingredients/spinach.png` exists
- `file web/assets/img/ingredients/spinach.png` reports `PNG image data, ...`
- run report shows `Fetched: 1`

- [ ] **Step 2: Re-run same command — should idempotently skip**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-image spinach --no-db`
Expected: report shows `Skipped: 1   Fetched: 0`.

- [ ] **Step 3: Force re-download**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-image spinach --no-db --force`
Expected: report shows `Fetched: 1` again.

- [ ] **Step 4: Try a slug that won't exist on thiings.co (synthetic miss)**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-image kasuri-methi-zzz-not-real --no-db`
Expected: exit 0, report shows `Misses: 1` with `kasuri-methi-zzz-not-real (page-404)` or `(no-image-in-html)`. No file created.

- [ ] **Step 5: Commit the verified spinach.png**

```bash
git add web/assets/img/ingredients/spinach.png
git commit -m "data(ingredients): seed spinach.png from thiings.co (live smoke test)"
```

---

### Task 10: First real bulk run

**Files:**
- (no edits — bulk fetch + commit)

- [ ] **Step 1: Pre-flight on a small batch to confirm pacing + DB writes**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && make fetch-ingredient-images LIMIT=5`
Expected: up to 5 PNGs land in `web/assets/img/ingredients/`, end-of-run report prints, exit 0.

Verify a fetched row's `photo` column was updated:
Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc status` and confirm the bulk run modified rows (or query Studio directly).

- [ ] **Step 2: Full bulk run**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && make fetch-ingredient-images`
Expected:
- New PNGs appear under `web/assets/img/ingredients/`.
- Report at the end shows fetched/skipped/misses/failed counts.
- DB rows have their `photo` column updated for every fetched id.

- [ ] **Step 3: Spot-check the admin UI**

Open `http://localhost:8080/admin/ingredients.html` (start with `make serve` if not running). Verify thumbnails render for ingredients that were fetched.

- [ ] **Step 4: Commit the new images**

```bash
git add web/assets/img/ingredients/
git commit -m "data(ingredients): seed initial batch of ingredient images from thiings.co"
```

- [ ] **Step 5: Document the misses for follow-up**

If the report listed any misses, note them in the commit body or in `docs/USER-TODO.md` as ingredients needing manual photo overrides. (Skip this step if there were zero misses.)

---

## Self-review notes

- **Spec coverage:** Tasks 1–4 implement scraper + 3 unittest cases (spec §"Testing & verification"). Task 5–6 build single + bulk CLI surface (spec §"CLI surface"). Task 7 adds Makefile entry. Task 8 covers the schema comment + admin form placeholder edits (spec §"Schema/UI changes"). Task 9 is the live smoke (spec §"Testing & verification"). Task 10 is the first real bulk run.
- **No new runtime deps:** scraper uses stdlib `urllib.request` + `re`. Tests use stdlib `unittest` + `unittest.mock`. No `pytest`, no `requests`, no `responses` introduced.
- **Idempotency invariants:** file existence is the only state. No miss-cache table. `--force` re-downloads and re-writes the DB row only when the row's `photo` is empty or already points under `assets/img/ingredients/`.
- **Failure semantics:** misses (page-404, no-image-in-html) → `ThiingsNotFound` → `report.misses`, exit 0. Network/oversize/non-PNG → `ThiingsError` → `report.failed`, exit 1 only if every row failed.
