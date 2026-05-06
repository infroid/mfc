# Ingredient Bundles & Nutrition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the recipe-bundle pattern for ingredients — per-ingredient bundle dirs (JSON + image) committed to git, full USDA FDC nutrition profile, new Storage bucket, FDC-primary + Anthropic AI-fallback nutrition fetcher, thiings.co image fetcher, and bidirectional sync between bundles and Supabase.

**Architecture:** New ops modules (`thiings`, `fdc`, `aifill`, `ingredients`, `ingredient_images`, `nutrition_migration`) following the existing `mfc.ops.*` pattern. Five new CLI subcommands + one one-shot migration command. Schema additions are additive: three nullable columns on `public.ingredients`, two updated comments, and a new `ingredient-images` Storage bucket with admin-only RLS. Tests are stdlib `unittest` against mocked I/O.

**Tech Stack:** Python 3.10+, stdlib `urllib.request` (FDC + thiings clients), stdlib `unittest`, `anthropic` SDK (new dep, used only for `--ai-fallback`), existing `supabase-py` service-role client.

**Spec:** [docs/superpowers/specs/2026-05-07-thiings-ingredient-images-design.md](../specs/2026-05-07-thiings-ingredient-images-design.md)

---

## File Structure

**New files**
- `automation/mfc/ops/thiings.py` — thiings.co scraper.
- `automation/mfc/ops/fdc.py` — USDA FDC API client.
- `automation/mfc/ops/fdc_nutrient_map.py` — FDC nutrient ID → bundle key dict.
- `automation/mfc/ops/aifill.py` — Anthropic Claude nutrition AI fallback.
- `automation/mfc/ops/ingredients.py` — bundle ↔ DB sync (push / pull / both).
- `automation/mfc/ops/ingredient_images.py` — bucket ↔ local image bytes.
- `automation/mfc/ops/nutrition_migration.py` — `reshape_legacy(nutrition)` pure helper.
- `automation/mfc/commands/sync_ingredients.py`
- `automation/mfc/commands/sync_ingredient_images.py`
- `automation/mfc/commands/fetch_ingredient_images.py`
- `automation/mfc/commands/fetch_ingredient_nutrition.py`
- `automation/mfc/commands/migrate_ingredient_nutrition.py`
- `automation/tests/__init__.py`
- `automation/tests/test_thiings.py`
- `automation/tests/test_fdc.py`
- `automation/tests/test_aifill.py`
- `automation/tests/test_nutrition_migration.py`

**Modified files**
- `automation/mfc/cli.py`
- `automation/mfc/core/config.py`
- `automation/.env.sample`
- `automation/pyproject.toml`
- `automation/db/schema.sql`
- `Makefile`
- `web/assets/js/app/admin-ingredient-app.jsx`

**New directory**
- `web/assets/ingredients/` — bundle root, contents committed to git.

---

### Task 1: Test scaffolding + .env / Config keys

**Files:**
- Create: `automation/tests/__init__.py`
- Modify: `automation/.env.sample`
- Modify: `automation/mfc/core/config.py`

- [ ] **Step 1: Create the test package marker**

```bash
mkdir -p automation/tests
: > automation/tests/__init__.py
```

- [ ] **Step 2: Append the FDC + Anthropic blocks to `automation/.env.sample`**

Append to the end of `automation/.env.sample`:

```
# ─── Optional: USDA FoodData Central ───────────────────────────────────────
# Required only for `mfc fetch-ingredient-nutrition`. Free key from
# https://fdc.nal.usda.gov/api-key-signup.html (1,000 req/hr default).
FDC_API_KEY=DEMO_KEY

# ─── Optional: Anthropic (for nutrition AI fallback) ───────────────────────
# Required only when `mfc fetch-ingredient-nutrition --ai-fallback` is used.
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
```

- [ ] **Step 3: Add the two new fields + `require_*` helpers in `Config`**

Edit `automation/mfc/core/config.py`. Inside the `Config` dataclass, add two fields after `supabase_publishable_key`:

```python
    fdc_api_key: Optional[str]
    anthropic_api_key: Optional[str]
```

Inside `Config.load`, add to the constructor call after `supabase_publishable_key=...`:

```python
            fdc_api_key=os.environ.get("FDC_API_KEY") or None,
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
```

After `require_supabase`, add:

```python
    def require_fdc(self) -> str:
        if not self.fdc_api_key:
            raise ConfigError(
                "FDC_API_KEY is required for this command. "
                "Free key from https://fdc.nal.usda.gov/api-key-signup.html — "
                "set it in automation/.env."
            )
        return self.fdc_api_key

    def require_anthropic(self) -> str:
        if not self.anthropic_api_key:
            raise ConfigError(
                "ANTHROPIC_API_KEY is required when --ai-fallback is set. "
                "Set it in automation/.env."
            )
        return self.anthropic_api_key
```

- [ ] **Step 4: Verify the package still imports**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run python -c "from mfc.core.config import Config; c = Config.load(); print(bool(c.repo_root))"`
Expected: prints `True`. No traceback.

- [ ] **Step 5: Commit**

```bash
git add automation/tests/__init__.py automation/.env.sample automation/mfc/core/config.py
git commit -m "feat(config): wire FDC_API_KEY + ANTHROPIC_API_KEY through Config"
```

---

### Task 2: Schema additions (columns, comments, bucket, RLS)

**Files:**
- Modify: `automation/db/schema.sql`

- [ ] **Step 1: Add the three new columns + index + new comments**

In `automation/db/schema.sql`, immediately after the `CREATE TABLE IF NOT EXISTS public.ingredients (...);` block (and before its `COMMENT ON COLUMN` lines), insert:

```sql
ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS emoji            TEXT,
  ADD COLUMN IF NOT EXISTS nutrition_source TEXT,
  ADD COLUMN IF NOT EXISTS fdc_id           INTEGER;

CREATE INDEX IF NOT EXISTS ingredients_nutrition_source_idx
  ON public.ingredients (nutrition_source);

COMMENT ON COLUMN public.ingredients.emoji            IS 'Single grapheme used on ingredient cards (e.g. "🧀"). Nullable.';
COMMENT ON COLUMN public.ingredients.nutrition_source IS '"fdc" | "ai" | "manual" | NULL. Powers "what still needs review" filters.';
COMMENT ON COLUMN public.ingredients.fdc_id           IS 'USDA FoodData Central food id (when nutrition_source = ''fdc''). Lets re-pulls hit the same record without re-searching.';
```

- [ ] **Step 2: Replace the photo + nutrition column comments**

Find the existing line:

```sql
COMMENT ON COLUMN public.ingredients.photo        IS 'Relative path to the ingredient photo (e.g. "data/ingredient-photos/paneer.jpg"). Nullable.';
```

Replace with:

```sql
COMMENT ON COLUMN public.ingredients.photo        IS 'Full Supabase Storage URL of the ingredient image (https://<ref>.supabase.co/storage/v1/object/public/ingredient-images/<id>/image.png). Bytes also live at web/assets/ingredients/<id>/image.png in the repo. Nullable.';
```

Find the existing line:

```sql
COMMENT ON COLUMN public.ingredients.nutrition    IS 'Per-100g macros: { calories, protein, fat, carbs }. Numbers; the four macros surface in the UI.';
```

Replace with:

```sql
COMMENT ON COLUMN public.ingredients.nutrition    IS 'Per-100g USDA FoodData Central nutrient profile. JSONB { source, fdcId, filledAt, aiFilledAt, per:"100g", energy_kcal, protein_g, total_fat_g, ... }. All nutrient fields optional; missing renders as "—". See docs/superpowers/specs/2026-05-07-thiings-ingredient-images-design.md for full key list.';
```

- [ ] **Step 3: Add the ingredient-images bucket + RLS helper + policies**

At the end of `automation/db/schema.sql` (after the existing `recipe-images` storage section §9), append:

```sql
-- ────────────────────────────────────────────────────────────────────────
-- 10. STORAGE — ingredient-images bucket + RLS
-- Public read; admin-only writes (no chef-write tier — ingredients are
-- admin-managed).
-- ────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
  VALUES ('ingredient-images', 'ingredient-images', true)
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_write_ingredient_image(path TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE
  AS $$ SELECT public.is_admin() $$;

COMMENT ON FUNCTION public.can_write_ingredient_image(text) IS
  'Returns true when caller is admin. Used by storage.objects RLS for the ingredient-images bucket. No chef-write tier — ingredients are admin-managed.';

DROP POLICY IF EXISTS "ingredient_images_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "ingredient_images_admin_write"  ON storage.objects;
DROP POLICY IF EXISTS "ingredient_images_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "ingredient_images_admin_delete" ON storage.objects;

CREATE POLICY "ingredient_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ingredient-images');

CREATE POLICY "ingredient_images_admin_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name));

CREATE POLICY "ingredient_images_admin_update"
  ON storage.objects FOR UPDATE
  USING      (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name))
  WITH CHECK (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name));

CREATE POLICY "ingredient_images_admin_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'ingredient-images' AND public.can_write_ingredient_image(name));
```

- [ ] **Step 4: Apply the schema to verify it parses + lands**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && make apply-schema`
Expected: success, no errors. Re-running the schema is idempotent.

- [ ] **Step 5: Verify columns + bucket**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc status`
Expected: `ingredients` row count unchanged. (Status command lists table sizes.)

- [ ] **Step 6: Commit**

```bash
git add automation/db/schema.sql
git commit -m "feat(schema): add ingredient.emoji/nutrition_source/fdc_id + ingredient-images bucket"
```

---

### Task 3: Nutrition migration pure function + tests

**Files:**
- Create: `automation/mfc/ops/nutrition_migration.py`
- Create: `automation/tests/test_nutrition_migration.py`

- [ ] **Step 1: Write the failing test**

Create `automation/tests/test_nutrition_migration.py`:

```python
"""Tests for mfc.ops.nutrition_migration.reshape_legacy."""

from __future__ import annotations

import unittest


class ReshapeLegacy(unittest.TestCase):
    def test_legacy_keys_renamed_and_source_set(self):
        from mfc.ops.nutrition_migration import reshape_legacy

        out = reshape_legacy({"calories": 321, "protein": 18.3, "fat": 25.0, "carbs": 3.5})

        self.assertEqual(out["energy_kcal"], 321)
        self.assertEqual(out["protein_g"], 18.3)
        self.assertEqual(out["total_fat_g"], 25.0)
        self.assertEqual(out["carbohydrate_g"], 3.5)
        self.assertEqual(out["source"], "manual")
        self.assertEqual(out["per"], "100g")
        self.assertIn("filledAt", out)
        # Legacy keys must be gone
        for k in ("calories", "protein", "fat", "carbs"):
            self.assertNotIn(k, out)

    def test_already_new_shape_returned_unchanged(self):
        from mfc.ops.nutrition_migration import reshape_legacy

        already = {
            "source": "fdc",
            "fdcId": 173436,
            "per": "100g",
            "energy_kcal": 321,
        }
        self.assertEqual(reshape_legacy(already), already)

    def test_empty_or_null_returned_unchanged(self):
        from mfc.ops.nutrition_migration import reshape_legacy

        self.assertIsNone(reshape_legacy(None))
        self.assertEqual(reshape_legacy({}), {})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Verify it fails**

Run: `cd automation && uv run python -m unittest tests.test_nutrition_migration -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'mfc.ops.nutrition_migration'`.

- [ ] **Step 3: Implement the module**

Create `automation/mfc/ops/nutrition_migration.py`:

```python
"""Pure helper that reshapes legacy ingredient nutrition jsonb into the
USDA-aligned schema. Idempotent: rows already in new shape pass through
unchanged.

Legacy schema:
    { "calories": N, "protein": N, "fat": N, "carbs": N }

New schema (subset shown):
    { "source": "manual", "per": "100g", "filledAt": <ISO8601>,
      "energy_kcal": N, "protein_g": N, "total_fat_g": N,
      "carbohydrate_g": N }
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


_KEY_RENAME = {
    "calories": "energy_kcal",
    "protein":  "protein_g",
    "fat":      "total_fat_g",
    "carbs":    "carbohydrate_g",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def reshape_legacy(nutrition: Optional[dict]) -> Optional[dict]:
    """Return the nutrition jsonb in new shape, or input unchanged when
    not legacy (already-new, empty, or None)."""
    if nutrition is None:
        return None
    if not isinstance(nutrition, dict) or not nutrition:
        return nutrition
    if "source" in nutrition:
        return nutrition

    out: dict = {}
    out["source"] = "manual"
    out["per"] = nutrition.get("per", "100g")
    out["filledAt"] = nutrition.get("filledAt", _now_iso())

    for k, v in nutrition.items():
        if k in ("source", "per", "filledAt"):
            continue
        out[_KEY_RENAME.get(k, k)] = v
    return out
```

- [ ] **Step 4: Verify it passes**

Run: `cd automation && uv run python -m unittest tests.test_nutrition_migration -v`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/nutrition_migration.py automation/tests/test_nutrition_migration.py
git commit -m "feat(nutrition): pure reshape_legacy helper + unit tests"
```

---

### Task 4: `mfc migrate-ingredient-nutrition` command

**Files:**
- Create: `automation/mfc/commands/migrate_ingredient_nutrition.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create the command module**

Create `automation/mfc/commands/migrate_ingredient_nutrition.py`:

```python
"""`mfc migrate-ingredient-nutrition` — one-shot reshape of legacy
ingredient nutrition jsonb. Idempotent."""

from __future__ import annotations

import argparse

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops.nutrition_migration import reshape_legacy


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "migrate-ingredient-nutrition",
        help="Reshape legacy ingredient nutrition jsonb to USDA schema (idempotent)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = (
        sb.table("ingredients")
        .select("id, nutrition")
        .order("id")
        .execute()
        .data
        or []
    )

    log.step(f"migrate-ingredient-nutrition · {len(rows)} row(s) to inspect")
    touched = 0
    skipped = 0
    for row in rows:
        before = row.get("nutrition")
        after = reshape_legacy(before)
        if after is before or after == before:
            skipped += 1
            continue
        sb.table("ingredients").update(
            {"nutrition": after, "nutrition_source": "manual"}
        ).eq("id", row["id"]).execute()
        touched += 1
        log.ok(f"reshaped {row['id']}")

    log.step(f"done · reshaped {touched} · skipped {skipped}")
    return 0
```

- [ ] **Step 2: Wire into the CLI**

Edit `automation/mfc/cli.py`. Add to the import block:

```python
    migrate_ingredient_nutrition,
```

Add to `COMMAND_MODULES` between `seed_metrics` and `sync_recipes`:

```python
    migrate_ingredient_nutrition,
```

- [ ] **Step 3: Add Makefile target**

Append to `Makefile` after the `reset` target (or at the bottom of the recipe/sync section):

```make
migrate-ingredient-nutrition: ## one-shot: reshape legacy nutrition jsonb to USDA schema (idempotent)
	@$(UV) run mfc migrate-ingredient-nutrition
```

Add `migrate-ingredient-nutrition` to the `.PHONY` line.

- [ ] **Step 4: Smoke**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc migrate-ingredient-nutrition --help`
Expected: usage prints; no traceback.

- [ ] **Step 5: Run live (idempotent)**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && make migrate-ingredient-nutrition`
Expected: prints "reshaped N · skipped M". Re-run: `reshaped 0 · skipped (N+M)`.

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/commands/migrate_ingredient_nutrition.py automation/mfc/cli.py Makefile
git commit -m "feat(cli): add mfc migrate-ingredient-nutrition (one-shot, idempotent)"
```

---

### Task 5: thiings.co scraper module + tests

**Files:**
- Create: `automation/mfc/ops/thiings.py`
- Create: `automation/tests/test_thiings.py`

- [ ] **Step 1: Write happy-path test**

Create `automation/tests/test_thiings.py`:

```python
"""Tests for mfc.ops.thiings — scraper for thiings.co/things/<slug>."""

from __future__ import annotations

import io
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
TINY_PNG = PNG_MAGIC + b"rest-of-png-bytes"

SPINACH_HTML = b"""<!doctype html><html><body>
<img src="/_next/image?url=https%3A%2F%2Flftz25oez4aqbxpq.public.blob.vercel-storage.com%2Fimage-YOHxnWgKxTUQknXCGBBSQmI9XcJ1WN.png&amp;w=1000&amp;q=75"/>
</body></html>"""


class _FakeResp(io.BytesIO):
    def __init__(self, body: bytes, status: int = 200):
        super().__init__(body)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()


def _urlopen_factory(responses):
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

        with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory([(200, SPINACH_HTML), (200, TINY_PNG)])):
            data = thiings.fetch_image("spinach")

        self.assertEqual(data[:8], PNG_MAGIC)
        self.assertEqual(data, TINY_PNG)


class FetchImage404(unittest.TestCase):
    def test_page_404_raises_not_found_with_reason(self):
        from mfc.ops import thiings

        not_found = HTTPError(
            url="https://www.thiings.co/things/nope",
            code=404, msg="Not Found", hdrs=None, fp=None,
        )
        with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory([not_found])):
            with self.assertRaises(thiings.ThiingsNotFound) as ctx:
                thiings.fetch_image("nope")
        self.assertEqual(ctx.exception.slug, "nope")
        self.assertEqual(ctx.exception.reason, "page-404")


class FetchImageNoImageInHtml(unittest.TestCase):
    def test_html_without_blob_url_raises_not_found(self):
        from mfc.ops import thiings

        empty = b"<html><body><p>nothing here</p></body></html>"
        with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory([(200, empty)])):
            with self.assertRaises(thiings.ThiingsNotFound) as ctx:
                thiings.fetch_image("aamchur")
        self.assertEqual(ctx.exception.reason, "no-image-in-html")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Verify they fail (no module yet)**

Run: `cd automation && uv run python -m unittest tests.test_thiings -v`
Expected: failure on import.

- [ ] **Step 3: Implement scraper**

Create `automation/mfc/ops/thiings.py`:

```python
"""Scraper for thiings.co/things/<slug>.

Pulls the underlying Vercel Blob PNG URL out of the Next.js page HTML
and downloads the bytes. Pure I/O — no DB, no filesystem.
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
MAX_BYTES = 5 * 1024 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

_BLOB_HOST = r"lftz25oez4aqbxpq\.public\.blob\.vercel-storage\.com"
_BLOB_RE = re.compile(rf"https://{_BLOB_HOST}/image-[A-Za-z0-9]+\.png")
_PROXY_RE = re.compile(r'_next/image\?url=([^&"\']+)')


class ThiingsError(RuntimeError):
    def __init__(self, slug: str, reason: str):
        super().__init__(f"{slug}: {reason}")
        self.slug = slug
        self.reason = reason


class ThiingsNotFound(ThiingsError):
    pass


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
    Raises ThiingsError on network / structural failures.
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

- [ ] **Step 4: Run tests, expect all 3 green**

Run: `cd automation && uv run python -m unittest tests.test_thiings -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/thiings.py automation/tests/test_thiings.py
git commit -m "feat(thiings): scraper module + tests (happy / page-404 / no-image)"
```

---

### Task 6: `mfc fetch-ingredient-image` (single + bulk)

**Files:**
- Create: `automation/mfc/commands/fetch_ingredient_images.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create the command module**

Create `automation/mfc/commands/fetch_ingredient_images.py`:

```python
"""`mfc fetch-ingredient-image[s]` — download illustrated PNGs from
thiings.co/things/<slug> into ingredient bundle dirs.

Idempotent on disk: files that already exist are skipped unless --force.
DB rows are NOT updated by this command — sync-ingredient-images +
sync-ingredients handle that downstream.
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops import thiings


REL_DIR = "assets/ingredients"
SLEEP_BETWEEN_REQUESTS_S = 0.5


@dataclass
class RunReport:
    fetched: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    misses:  list[tuple[str, str]] = field(default_factory=list)
    failed:  list[tuple[str, str]] = field(default_factory=list)

    def print(self) -> None:
        log.step(
            f"Fetched: {len(self.fetched)}   Skipped: {len(self.skipped)}   "
            f"Misses: {len(self.misses)}   Failed: {len(self.failed)}"
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
    return config.repo_root / "web" / REL_DIR / ingredient_id / "image.png"


def _process_one(
    config: Config,
    ingredient_id: str,
    *,
    force: bool,
    no_write: bool,
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

    if not no_write:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
    report.fetched.append(ingredient_id)


def _run_single(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id").eq("id", args.id).execute().data or []
    if not rows:
        log.error(f"ingredient '{args.id}' not found in public.ingredients")
        return 2
    report = RunReport()
    _process_one(config, rows[0]["id"], force=args.force, no_write=args.no_write, report=report)
    report.print()
    return 0 if not report.failed else 1


def _run_bulk(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id").order("id").execute().data or []
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.limit:
        rows = rows[: args.limit]

    log.step(f"fetch-ingredient-images · {len(rows)} ingredient(s)")
    report = RunReport()
    for i, row in enumerate(rows):
        _process_one(config, row["id"], force=args.force, no_write=args.no_write, report=report)
        if i < len(rows) - 1:
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)
    report.print()

    if rows and not (report.fetched or report.skipped or report.misses):
        return 1
    return 0


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-image",
        help="Fetch one ingredient image from thiings.co",
    )
    p.add_argument("id", help="ingredient id (used as the thiings slug)")
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.set_defaults(handler=_run_single)


def register_bulk(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-images",
        help="Bulk fetch ingredient images from thiings.co (idempotent)",
    )
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--ids", default=None, help="comma-separated ingredient ids")
    p.set_defaults(handler=_run_bulk)
```

- [ ] **Step 2: Wire both subcommands into CLI**

Edit `automation/mfc/cli.py`. Add to imports:

```python
    fetch_ingredient_images,
```

Add to `COMMAND_MODULES` after `sync_images`:

```python
    fetch_ingredient_images,
```

Update the registration loop in `build_parser()` to also call `register_bulk` when present:

```python
    for mod in COMMAND_MODULES:
        mod.register(sub)
        register_bulk = getattr(mod, "register_bulk", None)
        if register_bulk is not None:
            register_bulk(sub)
```

- [ ] **Step 3: Add Makefile target**

Append:

```make
fetch-ingredient-images: ## fetch ingredient PNGs from thiings.co into bundle dirs; FORCE=1 LIMIT=N IDS=a,b
	@$(UV) run mfc fetch-ingredient-images \
	  $(if $(FORCE),--force) \
	  $(if $(LIMIT),--limit $(LIMIT)) \
	  $(if $(IDS),--ids $(IDS))
```

Add `fetch-ingredient-images` to `.PHONY`.

- [ ] **Step 4: Smoke**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-image --help && uv --project automation run mfc fetch-ingredient-images --help`
Expected: both usages print.

- [ ] **Step 5: Live smoke (real network)**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-image spinach --no-write`
Expected: report shows `Fetched: 1`. (No file write because `--no-write`.) Re-run without `--no-write` → `web/assets/ingredients/spinach/image.png` exists; `file <that path>` reports `PNG image data`.

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/commands/fetch_ingredient_images.py automation/mfc/cli.py Makefile web/assets/ingredients/spinach/image.png
git commit -m "feat(cli): mfc fetch-ingredient-image[s] — thiings.co into bundle dirs"
```

---

### Task 7: FDC nutrient ID → bundle key map

**Files:**
- Create: `automation/mfc/ops/fdc_nutrient_map.py`

- [ ] **Step 1: Create the mapping module**

Create `automation/mfc/ops/fdc_nutrient_map.py`:

```python
"""USDA FoodData Central nutrient-id → bundle-key map.

FDC nutrient ids are stable across data sources. Only ids listed here are
copied into the bundle nutrition block; everything else is ignored.

Sources for the ids:
  - https://fdc.nal.usda.gov/portal-data/external/nutrients
  - Cross-referenced with Foundation/SR Legacy/FNDDS reports.
"""

from __future__ import annotations


# id → (bundle_key, expected_unit). The unit is informational; FDC reports
# already standardize to per-100g for the data types we use, and the key
# carries the unit suffix so values are stored verbatim.
NUTRIENT_MAP: dict[int, tuple[str, str]] = {
    # ── Energy + proximates ────────────────────────────────────────────
    1008: ("energy_kcal", "kcal"),
    2047: ("energy_kcal", "kcal"),     # Atwater general (preferred when present)
    2048: ("energy_kcal", "kcal"),     # Atwater specific
    1062: ("energy_kj",   "kJ"),
    1051: ("water_g",     "g"),
    1003: ("protein_g",   "g"),
    1004: ("total_fat_g", "g"),
    1005: ("carbohydrate_g", "g"),
    1007: ("ash_g",       "g"),

    # ── Fats ───────────────────────────────────────────────────────────
    1258: ("saturated_fat_g",          "g"),
    1292: ("monounsaturated_fat_g",    "g"),
    1293: ("polyunsaturated_fat_g",    "g"),
    1257: ("trans_fat_g",              "g"),
    1253: ("cholesterol_mg",           "mg"),

    # ── Carbohydrate breakdown ─────────────────────────────────────────
    1079: ("fiber_total_g",     "g"),
    2033: ("fiber_soluble_g",   "g"),
    1084: ("fiber_insoluble_g", "g"),
    2000: ("sugars_total_g",    "g"),
    1063: ("sugars_total_g",    "g"),  # legacy id for "sugars, total"
    1235: ("sugars_added_g",    "g"),
    1009: ("starch_g",          "g"),

    # ── Minerals ───────────────────────────────────────────────────────
    1087: ("calcium_mg",    "mg"),
    1089: ("iron_mg",       "mg"),
    1090: ("magnesium_mg",  "mg"),
    1091: ("phosphorus_mg", "mg"),
    1092: ("potassium_mg",  "mg"),
    1093: ("sodium_mg",     "mg"),
    1095: ("zinc_mg",       "mg"),
    1098: ("copper_mg",     "mg"),
    1101: ("manganese_mg",  "mg"),
    1103: ("selenium_ug",   "µg"),
    1099: ("fluoride_ug",   "µg"),

    # ── Vitamins ───────────────────────────────────────────────────────
    1106: ("vitamin_a_rae_ug",   "µg"),
    1162: ("vitamin_c_mg",       "mg"),
    1114: ("vitamin_d_ug",       "µg"),
    1109: ("vitamin_e_mg",       "mg"),
    1185: ("vitamin_k_ug",       "µg"),
    1165: ("thiamin_mg",         "mg"),
    1166: ("riboflavin_mg",      "mg"),
    1167: ("niacin_mg",          "mg"),
    1170: ("pantothenic_acid_mg","mg"),
    1175: ("vitamin_b6_mg",      "mg"),
    1176: ("biotin_ug",          "µg"),
    1177: ("folate_total_ug",    "µg"),
    1190: ("folate_dfe_ug",      "µg"),
    1178: ("vitamin_b12_ug",     "µg"),
    1180: ("choline_mg",         "mg"),

    # ── Selected fatty acids ───────────────────────────────────────────
    1404: ("fa_18_3_n3_alpha_linolenic_g", "g"),
    1278: ("fa_20_5_n3_epa_g",             "g"),
    1272: ("fa_22_6_n3_dha_g",             "g"),
    1269: ("fa_18_2_n6_linoleic_g",        "g"),
    1316: ("fa_20_4_n6_arachidonic_g",     "g"),

    # ── Amino acids ────────────────────────────────────────────────────
    1210: ("tryptophan_g",     "g"),
    1211: ("threonine_g",      "g"),
    1212: ("isoleucine_g",     "g"),
    1213: ("leucine_g",        "g"),
    1214: ("lysine_g",         "g"),
    1215: ("methionine_g",     "g"),
    1216: ("cystine_g",        "g"),
    1217: ("phenylalanine_g",  "g"),
    1218: ("tyrosine_g",       "g"),
    1219: ("valine_g",         "g"),
    1220: ("arginine_g",       "g"),
    1221: ("histidine_g",      "g"),
    1222: ("alanine_g",        "g"),
    1223: ("aspartic_acid_g",  "g"),
    1224: ("glutamic_acid_g",  "g"),
    1225: ("glycine_g",        "g"),
    1226: ("proline_g",        "g"),
    1227: ("serine_g",         "g"),

    # ── Stimulants ─────────────────────────────────────────────────────
    1057: ("caffeine_mg",     "mg"),
    1058: ("theobromine_mg",  "mg"),
}
```

- [ ] **Step 2: Quick syntax check**

Run: `cd automation && uv run python -c "from mfc.ops.fdc_nutrient_map import NUTRIENT_MAP; print(len(NUTRIENT_MAP))"`
Expected: prints a positive integer (~75).

- [ ] **Step 3: Commit**

```bash
git add automation/mfc/ops/fdc_nutrient_map.py
git commit -m "feat(fdc): nutrient-id → bundle-key mapping (USDA FDC)"
```

---

### Task 8: FDC client + tests

**Files:**
- Create: `automation/mfc/ops/fdc.py`
- Create: `automation/tests/test_fdc.py`

- [ ] **Step 1: Write failing tests**

Create `automation/tests/test_fdc.py`:

```python
"""Tests for mfc.ops.fdc — USDA FDC client."""

from __future__ import annotations

import io
import json
import unittest
from unittest.mock import patch


class _FakeResp(io.BytesIO):
    def __init__(self, body: bytes):
        super().__init__(body)
    def __enter__(self):
        return self
    def __exit__(self, *_exc):
        self.close()


def _urlopen_factory(bodies):
    queue = [b if isinstance(b, bytes) else json.dumps(b).encode() for b in bodies]
    def fake(req, timeout=None):
        return _FakeResp(queue.pop(0))
    return fake


SEARCH_FOUNDATION_HIT = {
    "foods": [
        {"fdcId": 9999, "dataType": "Branded",      "description": "Branded spinach"},
        {"fdcId": 173436, "dataType": "Foundation", "description": "Spinach, raw"},
    ]
}

FOOD_DETAIL_SPINACH = {
    "fdcId": 173436,
    "description": "Spinach, raw",
    "dataType": "Foundation",
    "foodNutrients": [
        {"nutrient": {"id": 1008}, "amount": 23},
        {"nutrient": {"id": 1003}, "amount": 2.86},
        {"nutrient": {"id": 1004}, "amount": 0.39},
        {"nutrient": {"id": 1005}, "amount": 3.63},
        {"nutrient": {"id": 1087}, "amount": 99},
        {"nutrient": {"id": 1106}, "amount": 469},
        {"nutrient": {"id": 1213}, "amount": 0.223},
        {"nutrient": {"id": 9999999}, "amount": 0.0},  # unmapped, ignored
    ],
}


class FdcHappyPath(unittest.TestCase):
    def test_search_then_fetch_then_map(self):
        from mfc.ops import fdc

        with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([SEARCH_FOUNDATION_HIT, FOOD_DETAIL_SPINACH])):
            block = fdc.fetch_for_name("spinach", api_key="KEY")

        self.assertEqual(block["source"], "fdc")
        self.assertEqual(block["fdcId"], 173436)
        self.assertEqual(block["per"], "100g")
        self.assertEqual(block["energy_kcal"], 23)
        self.assertEqual(block["protein_g"], 2.86)
        self.assertEqual(block["calcium_mg"], 99)
        self.assertEqual(block["vitamin_a_rae_ug"], 469)
        self.assertEqual(block["leucine_g"], 0.223)
        self.assertNotIn(9999999, block)


class FdcNoMatch(unittest.TestCase):
    def test_empty_search_raises_not_found(self):
        from mfc.ops import fdc

        with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([{"foods": []}])):
            with self.assertRaises(fdc.FdcNotFound):
                fdc.fetch_for_name("xyz-nonexistent", api_key="KEY")


class FdcPinnedId(unittest.TestCase):
    def test_pinned_id_skips_search(self):
        from mfc.ops import fdc

        with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([FOOD_DETAIL_SPINACH])):
            block = fdc.fetch_for_id(173436, api_key="KEY")

        self.assertEqual(block["fdcId"], 173436)
        self.assertEqual(block["protein_g"], 2.86)


class FdcPriorityPick(unittest.TestCase):
    def test_foundation_beats_branded_even_when_branded_first(self):
        from mfc.ops import fdc

        SEARCH = {
            "foods": [
                {"fdcId": 1, "dataType": "Branded",      "description": "Spinach Brand"},
                {"fdcId": 2, "dataType": "Survey (FNDDS)","description": "Spinach, cooked"},
                {"fdcId": 173436, "dataType": "Foundation","description": "Spinach, raw"},
            ]
        }
        with patch("mfc.ops.fdc.urlopen", new=_urlopen_factory([SEARCH, FOOD_DETAIL_SPINACH])):
            block = fdc.fetch_for_name("spinach", api_key="KEY")
        self.assertEqual(block["fdcId"], 173436)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Verify failure**

Run: `cd automation && uv run python -m unittest tests.test_fdc -v`
Expected: import failure.

- [ ] **Step 3: Implement the client**

Create `automation/mfc/ops/fdc.py`:

```python
"""USDA FoodData Central API client.

Two flows:
  fetch_for_name(name, api_key) — search by name → pick best match → pull
                                  nutrients → map to bundle nutrition block.
  fetch_for_id(fdc_id, api_key) — skip search; pull + map directly.

Pure I/O. No DB, no filesystem.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .fdc_nutrient_map import NUTRIENT_MAP


SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
FOOD_URL   = "https://api.nal.usda.gov/fdc/v1/food/{fdc_id}"
TIMEOUT_S  = 15

# Highest-trust dataType first. Anything not in this list is ignored.
DATA_TYPE_PRIORITY = ("Foundation", "SR Legacy", "Survey (FNDDS)")


class FdcError(RuntimeError):
    pass


class FdcNotFound(FdcError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_json(url: str) -> dict:
    req = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=TIMEOUT_S) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        raise FdcError(f"HTTP {exc.code} for {url}") from exc
    except (URLError, TimeoutError) as exc:
        raise FdcError(f"network: {exc}") from exc


def _search(name: str, api_key: str) -> dict:
    qs = urlencode({
        "query": name,
        "api_key": api_key,
        "dataType": ",".join(DATA_TYPE_PRIORITY),
        "pageSize": 25,
    })
    return _get_json(f"{SEARCH_URL}?{qs}")


def _pick_best(foods: list[dict]) -> dict | None:
    """Pick the highest-priority food. Returns None if no acceptable match."""
    by_type: dict[str, dict] = {}
    for f in foods:
        dt = f.get("dataType")
        if dt in DATA_TYPE_PRIORITY and dt not in by_type:
            by_type[dt] = f
    for dt in DATA_TYPE_PRIORITY:
        if dt in by_type:
            return by_type[dt]
    return None


def _fetch_food(fdc_id: int, api_key: str) -> dict:
    return _get_json(FOOD_URL.format(fdc_id=fdc_id) + f"?api_key={quote(api_key)}")


def _build_block(food: dict) -> dict:
    block: dict = {
        "source": "fdc",
        "fdcId":  int(food["fdcId"]),
        "filledAt": _now_iso(),
        "aiFilledAt": None,
        "per": "100g",
    }
    for nutrient_entry in food.get("foodNutrients") or []:
        nid = (nutrient_entry.get("nutrient") or {}).get("id")
        amount = nutrient_entry.get("amount")
        if nid is None or amount is None:
            continue
        mapped = NUTRIENT_MAP.get(int(nid))
        if mapped is None:
            continue
        key, _unit = mapped
        # Last write wins when multiple FDC ids map to the same key
        # (e.g. 1008 vs 2047 both → energy_kcal). Foundation reports
        # come back in id order, so the more specific Atwater id ends up
        # winning, which is the desired behavior.
        block[key] = amount
    return block


def fetch_for_id(fdc_id: int, *, api_key: str) -> dict:
    food = _fetch_food(fdc_id, api_key)
    return _build_block(food)


def fetch_for_name(name: str, *, api_key: str) -> dict:
    payload = _search(name, api_key)
    foods = payload.get("foods") or []
    pick = _pick_best(foods)
    if pick is None:
        raise FdcNotFound(f"no FDC match for {name!r}")
    return fetch_for_id(int(pick["fdcId"]), api_key=api_key)
```

- [ ] **Step 4: Run tests, expect 4 green**

Run: `cd automation && uv run python -m unittest tests.test_fdc -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/fdc.py automation/tests/test_fdc.py
git commit -m "feat(fdc): client (search/pick/fetch/map) + 4 unit tests"
```

---

### Task 9: `mfc fetch-ingredient-nutrition` (FDC primary, no AI yet)

**Files:**
- Create: `automation/mfc/commands/fetch_ingredient_nutrition.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create the command module**

Create `automation/mfc/commands/fetch_ingredient_nutrition.py`:

```python
"""`mfc fetch-ingredient-nutrition[s]` — populate USDA FDC nutrition into
ingredient bundle JSONs. AI fallback wired in next task."""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config
from ..ops import fdc


REL_DIR = "assets/ingredients"
SLEEP_BETWEEN_REQUESTS_S = 0.5


@dataclass
class RunReport:
    fetched: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    misses:  list[tuple[str, str]] = field(default_factory=list)
    failed:  list[tuple[str, str]] = field(default_factory=list)

    def print(self) -> None:
        log.step(
            f"Fetched: {len(self.fetched)}   Skipped: {len(self.skipped)}   "
            f"Misses: {len(self.misses)}   Failed: {len(self.failed)}"
        )
        for label, items in (("Misses", self.misses), ("Failed", self.failed)):
            if items:
                log.info(f"{label}:")
                for slug, reason in items:
                    log.info(f"  - {slug}   ({reason})")


def _bundle_path(config: Config, ingredient_id: str) -> Path:
    return config.repo_root / "web" / REL_DIR / ingredient_id / "ingredient.json"


def _load_or_init_bundle(config: Config, ingredient_id: str, name: str) -> dict:
    p = _bundle_path(config, ingredient_id)
    if p.exists():
        return json.loads(p.read_text())
    return {"id": ingredient_id, "name": name}


def _write_bundle(config: Config, ingredient_id: str, bundle: dict) -> None:
    p = _bundle_path(config, ingredient_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")


def _process_one(
    sb,
    config: Config,
    row: dict,
    *,
    force: bool,
    no_write: bool,
    fdc_id_pin: int | None,
    report: RunReport,
) -> None:
    iid = row["id"]
    existing_block = (row.get("nutrition") or {}) if isinstance(row.get("nutrition"), dict) else {}
    if existing_block.get("source") and not force:
        report.skipped.append(iid)
        return

    api_key = config.require_fdc()
    try:
        if fdc_id_pin is not None:
            block = fdc.fetch_for_id(fdc_id_pin, api_key=api_key)
        else:
            block = fdc.fetch_for_name(row["name"], api_key=api_key)
    except fdc.FdcNotFound:
        report.misses.append((iid, "fdc-no-match"))
        return
    except fdc.FdcError as exc:
        report.failed.append((iid, f"fdc-error: {exc}"))
        return

    if not no_write:
        bundle = _load_or_init_bundle(config, iid, row["name"])
        bundle["nutrition"] = block
        _write_bundle(config, iid, bundle)

        sb.table("ingredients").update({
            "nutrition": block,
            "nutrition_source": "fdc",
            "fdc_id": block["fdcId"],
        }).eq("id", iid).execute()

    report.fetched.append(iid)


def _run_single(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id, name, category, nutrition").eq("id", args.id).execute().data or []
    if not rows:
        log.error(f"ingredient '{args.id}' not found")
        return 2
    report = RunReport()
    _process_one(
        sb, config, rows[0],
        force=args.force,
        no_write=args.no_write,
        fdc_id_pin=args.fdc_id,
        report=report,
    )
    report.print()
    return 0 if not report.failed else 1


def _run_bulk(args: argparse.Namespace, config: Config) -> int:
    sb = sb_client.service_client(config)
    rows = sb.table("ingredients").select("id, name, category, nutrition").order("id").execute().data or []
    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.limit:
        rows = rows[: args.limit]

    log.step(f"fetch-ingredient-nutrition · {len(rows)} ingredient(s)")
    report = RunReport()
    for i, row in enumerate(rows):
        _process_one(
            sb, config, row,
            force=args.force,
            no_write=args.no_write,
            fdc_id_pin=None,
            report=report,
        )
        if i < len(rows) - 1:
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)
    report.print()
    if rows and not (report.fetched or report.skipped or report.misses):
        return 1
    return 0


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "fetch-ingredient-nutrition",
        help="Fetch USDA FDC nutrition for one ingredient (or bulk if no id)",
    )
    p.add_argument("id", nargs="?", help="ingredient id (omit for bulk form)")
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.add_argument("--fdc-id", type=int, default=None,
                   help="(single only) skip search; pull this FDC food id directly")
    p.add_argument("--ai-fallback", action="store_true",
                   help="(wired in a later commit) try Anthropic AI when FDC misses")
    p.add_argument("--limit", type=int, default=None,
                   help="(bulk only) cap to first N rows after --ids filter")
    p.add_argument("--ids", default=None,
                   help="(bulk only) comma-separated ingredient ids")
    p.set_defaults(handler=_dispatch)


def _dispatch(args: argparse.Namespace, config: Config) -> int:
    if args.id:
        return _run_single(args, config)
    return _run_bulk(args, config)
```

- [ ] **Step 2: Wire into CLI**

Edit `automation/mfc/cli.py`. Add to imports:

```python
    fetch_ingredient_nutrition,
```

Add to `COMMAND_MODULES` after `fetch_ingredient_images`:

```python
    fetch_ingredient_nutrition,
```

- [ ] **Step 3: Add Makefile target**

Append:

```make
fetch-ingredient-nutrition: ## fetch USDA FDC nutrition into bundle JSONs; FORCE=1 LIMIT=N IDS=a,b AI=1
	@$(UV) run mfc fetch-ingredient-nutrition \
	  $(if $(FORCE),--force) \
	  $(if $(AI),--ai-fallback) \
	  $(if $(LIMIT),--limit $(LIMIT)) \
	  $(if $(IDS),--ids $(IDS))
```

Add to `.PHONY`.

- [ ] **Step 4: CLI smoke**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-nutrition --help`
Expected: usage prints; both single (id positional) and bulk (omitted) flows visible.

- [ ] **Step 5: Live FDC smoke**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-nutrition spinach --no-write`
Expected: exit 0, report shows `Fetched: 1`. (No file/DB write because `--no-write`.) Re-run *without* `--no-write` and confirm `web/assets/ingredients/spinach/ingredient.json` exists with a `nutrition` block whose `source` is `fdc` and `fdcId` is a 4-digit integer.

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/commands/fetch_ingredient_nutrition.py automation/mfc/cli.py Makefile web/assets/ingredients/spinach/ingredient.json
git commit -m "feat(cli): mfc fetch-ingredient-nutrition (FDC primary)"
```

---

### Task 10: Anthropic dep + AI fallback module + tests

**Files:**
- Modify: `automation/pyproject.toml`
- Create: `automation/mfc/ops/aifill.py`
- Create: `automation/tests/test_aifill.py`

- [ ] **Step 1: Add anthropic dep + sync**

Edit `automation/pyproject.toml`. Inside `dependencies`, add:

```toml
  "anthropic>=0.40",
```

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && make sync`
Expected: `anthropic` installed.

- [ ] **Step 2: Write failing tests**

Create `automation/tests/test_aifill.py`:

```python
"""Tests for mfc.ops.aifill — Anthropic-backed nutrition fallback."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch


def _good_tool_use_response():
    """Minimal stand-in for the Anthropic Messages API response shape."""
    block = MagicMock()
    block.type = "tool_use"
    block.name = "report_nutrition"
    block.input = {
        "energy_kcal": 572,
        "protein_g":   25.5,
        "total_fat_g": 50.0,
        "carbohydrate_g": 21.7,
        "calcium_mg":  140,
    }
    msg = MagicMock()
    msg.content = [block]
    return msg


def _bad_tool_use_response():
    block = MagicMock()
    block.type = "tool_use"
    block.name = "report_nutrition"
    block.input = {"calories": 572, "protein": 25.5}    # legacy keys, not allowed
    msg = MagicMock()
    msg.content = [block]
    return msg


class AifillHappyPath(unittest.TestCase):
    def test_returns_block_with_source_ai(self):
        from mfc.ops import aifill

        client = MagicMock()
        client.messages.create.return_value = _good_tool_use_response()
        with patch("mfc.ops.aifill._client", return_value=client):
            block = aifill.suggest_nutrition("kasuri methi", category="Herb", api_key="K")
        self.assertEqual(block["source"], "ai")
        self.assertEqual(block["per"], "100g")
        self.assertEqual(block["energy_kcal"], 572)
        self.assertIn("filledAt", block)
        self.assertIn("aiFilledAt", block)
        self.assertIsNotNone(block["aiFilledAt"])


class AifillSchemaViolation(unittest.TestCase):
    def test_legacy_or_unknown_keys_raise_aifill_error(self):
        from mfc.ops import aifill

        client = MagicMock()
        client.messages.create.return_value = _bad_tool_use_response()
        with patch("mfc.ops.aifill._client", return_value=client):
            with self.assertRaises(aifill.AiFillError):
                aifill.suggest_nutrition("xyz", category="Herb", api_key="K")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Implement aifill module**

Create `automation/mfc/ops/aifill.py`:

```python
"""Anthropic Claude fallback for ingredient nutrition.

Used only when FDC has no match for an ingredient. Returns a bundle
nutrition block with source="ai". Strict schema check: all returned keys
must be in the allowed nutrition vocabulary; values must be non-negative
numbers.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .fdc_nutrient_map import NUTRIENT_MAP


class AiFillError(RuntimeError):
    pass


# Allowed nutrient keys = anything in the FDC mapping (which defines the
# bundle vocabulary) plus a small fixed set.
ALLOWED_KEYS = {key for key, _u in NUTRIENT_MAP.values()}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Tool input schema — Anthropic uses this for tool_use validation. We then
# revalidate locally to be strict about negative values + extra keys.
_TOOL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {key: {"type": "number", "minimum": 0} for key in sorted(ALLOWED_KEYS)},
}

_TOOL = {
    "name": "report_nutrition",
    "description": "Report best-estimate per-100g nutrition for the ingredient.",
    "input_schema": _TOOL_SCHEMA,
}

_SYSTEM = (
    "You are a nutrition database. For the ingredient described, return your "
    "best per-100g estimate of standard food nutrients via the report_nutrition "
    "tool. Use Indian/regional reference values where applicable. Omit any "
    "nutrient you are not confident estimating — never invent placeholder "
    "values. Values must be non-negative numbers in the units encoded by the "
    "key suffixes (_g, _mg, _ug, _kcal, _kj)."
)


def _client(api_key: str):
    # Imported lazily so that tests can patch this factory without
    # the anthropic SDK being importable.
    from anthropic import Anthropic
    return Anthropic(api_key=api_key)


def suggest_nutrition(name: str, *, category: str | None, api_key: str) -> dict:
    user_msg = f"Ingredient: {name}"
    if category:
        user_msg += f"\nCategory: {category}"
    client = _client(api_key)
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=_SYSTEM,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": "report_nutrition"},
        messages=[{"role": "user", "content": user_msg}],
    )

    payload: dict | None = None
    for block in msg.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "report_nutrition":
            payload = getattr(block, "input", None)
            break
    if not isinstance(payload, dict):
        raise AiFillError("model did not call report_nutrition")

    bad = [k for k in payload.keys() if k not in ALLOWED_KEYS]
    if bad:
        raise AiFillError(f"model returned out-of-schema keys: {bad[:5]}")
    for k, v in payload.items():
        if not isinstance(v, (int, float)) or v < 0:
            raise AiFillError(f"value for {k} is invalid: {v!r}")

    now = _now_iso()
    block: dict = {
        "source": "ai",
        "fdcId": None,
        "filledAt": now,
        "aiFilledAt": now,
        "per": "100g",
    }
    block.update(payload)
    return block
```

- [ ] **Step 4: Run aifill tests**

Run: `cd automation && uv run python -m unittest tests.test_aifill -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/pyproject.toml automation/uv.lock automation/mfc/ops/aifill.py automation/tests/test_aifill.py
git commit -m "feat(aifill): Anthropic-backed nutrition fallback + schema validation"
```

---

### Task 11: Wire `--ai-fallback` into the nutrition fetcher

**Files:**
- Modify: `automation/mfc/commands/fetch_ingredient_nutrition.py`

- [ ] **Step 1: Update `_process_one` to fall back to AI on FDC miss**

In `automation/mfc/commands/fetch_ingredient_nutrition.py`, add to imports:

```python
from ..ops import aifill
```

Replace the block:

```python
    except fdc.FdcNotFound:
        report.misses.append((iid, "fdc-no-match"))
        return
    except fdc.FdcError as exc:
        report.failed.append((iid, f"fdc-error: {exc}"))
        return
```

with:

```python
    except fdc.FdcNotFound:
        if not getattr(args_namespace, "ai_fallback", False):
            report.misses.append((iid, "fdc-no-match"))
            return
        try:
            ai_key = config.require_anthropic()
            block = aifill.suggest_nutrition(row["name"], category=row.get("category"), api_key=ai_key)
        except aifill.AiFillError as exc:
            report.misses.append((iid, f"ai-fallback-failed: {exc}"))
            return
    except fdc.FdcError as exc:
        report.failed.append((iid, f"fdc-error: {exc}"))
        return
```

The function signature needs to accept the namespace; update the call sites in `_run_single`/`_run_bulk` to pass `args_namespace=args` and add it to the function definition:

```python
def _process_one(
    sb,
    config: Config,
    row: dict,
    *,
    force: bool,
    no_write: bool,
    fdc_id_pin: int | None,
    report: RunReport,
    args_namespace,
) -> None:
```

In `_run_single` and `_run_bulk`, pass `args_namespace=args` to every `_process_one` call.

Also update the block writeback to set `nutrition_source` correctly: change

```python
        sb.table("ingredients").update({
            "nutrition": block,
            "nutrition_source": "fdc",
            "fdc_id": block["fdcId"],
        }).eq("id", iid).execute()
```

to:

```python
        sb.table("ingredients").update({
            "nutrition": block,
            "nutrition_source": block["source"],
            "fdc_id": block.get("fdcId"),
            "ai_filled_at": block.get("aiFilledAt"),
        }).eq("id", iid).execute()
```

- [ ] **Step 2: Smoke**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-nutrition --help`
Expected: usage shows `--ai-fallback`.

- [ ] **Step 3: Live AI fallback smoke**

Pick an ingredient FDC won't have (e.g., `kasuri-methi`). Ensure ANTHROPIC_API_KEY is set in `.env`.

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc fetch-ingredient-nutrition kasuri-methi --ai-fallback --no-write`
Expected: exit 0, report `Fetched: 1`. Re-run without `--no-write` → bundle JSON's `nutrition.source` is `"ai"`, `aiFilledAt` is populated, multiple non-zero macros.

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/commands/fetch_ingredient_nutrition.py web/assets/ingredients/kasuri-methi/ingredient.json
git commit -m "feat(cli): wire --ai-fallback into fetch-ingredient-nutrition"
```

---

### Task 12: Bundle ↔ DB sync — `mfc.ops.ingredients`

**Files:**
- Create: `automation/mfc/ops/ingredients.py`

- [ ] **Step 1: Implement push / pull / both**

Create `automation/mfc/ops/ingredients.py`:

```python
"""Bundle ↔ DB sync for ingredients. Mirror of mfc.ops.recipes.

Bundle path:  web/assets/ingredients/<id>/ingredient.json
Image path:   web/assets/ingredients/<id>/image.png   (handled by ingredient_images.py)

Push: bundle JSONs → ingredients table (upsert; image URL normalized).
Pull: ingredients rows → bundle JSONs.
Both: per-ingredient last-modified-wins (DB.updated_at vs file mtime, ±1 s).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config


REL_DIR = Path("web/assets/ingredients")
BUCKET = "ingredient-images"


@dataclass
class SyncReport:
    pushed: int = 0
    pulled: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return f"↑ {self.pushed} pushed · ↓ {self.pulled} pulled · - {self.skipped} skipped · ! {len(self.failed)} failed"


# DB ↔ bundle key mapping
_DB_TO_BUNDLE = {
    "id":               "id",
    "name":             "name",
    "tagline":          "tagline",
    "category":         "category",
    "default_unit":     "defaultUnit",
    "photo":            "image",
    "emoji":            "emoji",
    "health_fact":      "healthFact",
    "storage":          "storage",
    "substitutes":      "substitutes",
    "show":             "show",
    "nutrition":        "nutrition",
    "created_by":       "createdBy",
}


def _bundle_path(config: Config, ingredient_id: str) -> Path:
    return config.repo_root / REL_DIR / ingredient_id / "ingredient.json"


def _row_to_bundle(row: dict) -> dict:
    bundle: dict = {}
    for db_key, json_key in _DB_TO_BUNDLE.items():
        if db_key in row and row[db_key] is not None:
            bundle[json_key] = row[db_key]
    return bundle


def _bundle_to_row(config: Config, bundle: dict) -> dict:
    row: dict = {}
    for db_key, json_key in _DB_TO_BUNDLE.items():
        if json_key in bundle and bundle[json_key] is not None:
            row[db_key] = bundle[json_key]
    # Normalize image: full URLs pass through; relative paths under
    # assets/ingredients become full Storage URLs.
    photo = row.get("photo")
    if isinstance(photo, str) and photo.startswith("assets/ingredients/"):
        base = (config.supabase_url or "").rstrip("/")
        if not base:
            raise RuntimeError("SUPABASE_URL required to normalize image path")
        # path on disk = assets/ingredients/<id>/image.png ; bucket path = <id>/image.png
        leaf = photo[len("assets/ingredients/"):]
        row["photo"] = f"{base}/storage/v1/object/public/{BUCKET}/{leaf}"
    # Pull source/fdcId/aiFilledAt out of nutrition.* into top-level cols.
    n = bundle.get("nutrition") if isinstance(bundle.get("nutrition"), dict) else None
    if n:
        if n.get("source"):
            row["nutrition_source"] = n["source"]
        if n.get("fdcId") is not None:
            row["fdc_id"] = n["fdcId"]
        if n.get("aiFilledAt"):
            row["ai_filled_at"] = n["aiFilledAt"]
    return row


def push_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    sb = sb_client.service_client(config)
    report = SyncReport()

    bundle_root = config.repo_root / REL_DIR
    if not bundle_root.exists():
        log.warn("no ingredient bundles to push (web/assets/ingredients/ missing)")
        return report

    rows: list[dict] = []
    for child in sorted(bundle_root.iterdir()):
        if not child.is_dir():
            continue
        bp = child / "ingredient.json"
        if not bp.exists():
            continue
        try:
            bundle = json.loads(bp.read_text())
        except json.JSONDecodeError as exc:
            report.failed.append(f"{child.name}: invalid json ({exc})")
            continue
        if only and bundle.get("id") not in only:
            continue
        try:
            rows.append(_bundle_to_row(config, bundle))
        except Exception as exc:  # noqa: BLE001
            report.failed.append(f"{child.name}: {exc}")

    if not rows:
        log.warn("no valid bundles to push")
        return report

    log.step(f"sync-ingredients · push · {len(rows)} bundle(s)")
    sb.table("ingredients").upsert(rows, on_conflict="id").execute()
    report.pushed = len(rows)
    log.ok(report.line())
    return report


def pull_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    sb = sb_client.service_client(config)
    report = SyncReport()

    rows = sb.table("ingredients").select("*").order("id").execute().data or []
    if only:
        wanted = set(only)
        rows = [r for r in rows if r["id"] in wanted]
    if not rows:
        log.warn("no ingredients to pull")
        return report

    log.step(f"sync-ingredients · pull · {len(rows)} ingredient(s)")
    for row in rows:
        try:
            bundle = _row_to_bundle(row)
            p = _bundle_path(config, row["id"])
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
            report.pulled += 1
            log.ok(row["id"])
        except Exception as exc:  # noqa: BLE001
            report.failed.append(f"{row['id']}: {exc}")
            log.error(f"{row['id']}: {exc}")

    log.ok(report.line())
    return report


def _parse_iso_to_ts(iso: str) -> float:
    if not iso:
        return 0.0
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


def sync(config: Config, *, direction: str, only: Optional[list[str]] = None) -> SyncReport:
    if direction == "push":
        return push_bundles(config, only=only)
    if direction == "pull":
        return pull_bundles(config, only=only)
    if direction != "both":
        raise ValueError(f"invalid direction: {direction!r}")

    sb = sb_client.service_client(config)
    db_rows = sb.table("ingredients").select("id, updated_at").execute().data or []
    db_by_id = {r["id"]: r for r in db_rows}
    if only:
        wanted = set(only)
        db_by_id = {k: v for k, v in db_by_id.items() if k in wanted}

    bundle_root = config.repo_root / REL_DIR
    local_by_id: dict[str, Path] = {}
    if bundle_root.exists():
        for child in sorted(bundle_root.iterdir()):
            bp = child / "ingredient.json"
            if not bp.exists():
                continue
            try:
                d = json.loads(bp.read_text())
            except Exception:
                continue
            iid = d.get("id")
            if iid and (not only or iid in only):
                local_by_id[iid] = bp

    push_ids: list[str] = []
    pull_ids: list[str] = []

    for iid in sorted(set(db_by_id) | set(local_by_id)):
        db_row = db_by_id.get(iid)
        local_path = local_by_id.get(iid)
        if db_row and not local_path:
            pull_ids.append(iid); continue
        if local_path and not db_row:
            push_ids.append(iid); continue
        local_mtime = local_path.stat().st_mtime
        db_ts = _parse_iso_to_ts(db_row.get("updated_at") or "")
        delta = local_mtime - db_ts
        if abs(delta) <= 1.0:
            continue
        (push_ids if delta > 0 else pull_ids).append(iid)

    report = SyncReport()
    if pull_ids:
        sub = pull_bundles(config, only=pull_ids)
        report.pulled += sub.pulled
        report.failed.extend(sub.failed)
    if push_ids:
        sub = push_bundles(config, only=push_ids)
        report.pushed += sub.pushed
        report.failed.extend(sub.failed)
    log.ok(report.line())
    return report
```

- [ ] **Step 2: Sanity-import**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run python -c "from mfc.ops import ingredients; print(ingredients.BUCKET)"`
Expected: prints `ingredient-images`.

- [ ] **Step 3: Commit**

```bash
git add automation/mfc/ops/ingredients.py
git commit -m "feat(ingredients): bundle↔DB sync (push/pull/both, last-mod wins)"
```

---

### Task 13: `mfc sync-ingredients` command

**Files:**
- Create: `automation/mfc/commands/sync_ingredients.py`
- Modify: `automation/mfc/cli.py`

- [ ] **Step 1: Create the command module**

Create `automation/mfc/commands/sync_ingredients.py`:

```python
"""`mfc sync-ingredients` — bundle↔DB metadata sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import ingredients as ingredients_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-ingredients",
        help="Sync ingredient metadata DB↔local bundles (pull|push|both)",
    )
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.add_argument("--ingredient", action="append", default=None,
                   help="Limit to one or more ingredient ids (repeatable)")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.ingredient or None
    report = ingredients_ops.sync(config, direction=args.direction, only=only)
    if report.failed:
        return 1
    return 0
```

- [ ] **Step 2: Wire into CLI**

Edit `automation/mfc/cli.py`. Add to imports:

```python
    sync_ingredients,
```

Add to `COMMAND_MODULES` after `sync_images`:

```python
    sync_ingredients,
```

- [ ] **Step 3: Smoke**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc sync-ingredients --help`
Expected: usage with `--direction` and `--ingredient`.

- [ ] **Step 4: Live pull smoke (no risk — read-only against DB)**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc sync-ingredients --direction pull`
Expected: `web/assets/ingredients/<id>/ingredient.json` files appear (or update) for every row in `public.ingredients`.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/commands/sync_ingredients.py automation/mfc/cli.py web/assets/ingredients/
git commit -m "feat(cli): mfc sync-ingredients (bundle↔DB metadata)"
```

---

### Task 14: `mfc.ops.ingredient_images` (Storage ↔ local bytes)

**Files:**
- Create: `automation/mfc/ops/ingredient_images.py`

- [ ] **Step 1: Implement bucket sync**

Create `automation/mfc/ops/ingredient_images.py`:

```python
"""Storage ↔ local image bytes for ingredients. Mirror of mfc.ops.images
(scoped to a single filename per ingredient: image.png)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config


BUCKET = "ingredient-images"
REL_DIR = Path("web/assets/ingredients")
FILENAME = "image.png"

_HTTP_TIMEOUT_SECONDS = 60.0


@dataclass
class SyncReport:
    uploaded: int = 0
    downloaded: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def line(self) -> str:
        return f"↓ {self.downloaded} downloaded · ↑ {self.uploaded} uploaded · - {self.skipped} skipped · ! {len(self.errors)} errors"


def _service_client(config: Config):
    client = sb_client.service_client(config)
    try:
        client.storage._client.timeout = httpx.Timeout(_HTTP_TIMEOUT_SECONDS)
    except Exception:
        pass
    return client


def _local_path(config: Config, ingredient_id: str) -> Path:
    return config.repo_root / REL_DIR / ingredient_id / FILENAME


def _bucket_path(ingredient_id: str) -> str:
    return f"{ingredient_id}/{FILENAME}"


def _list_remote(client) -> dict[str, dict]:
    """Return {ingredient_id: object_metadata} for every <id>/image.png in the bucket."""
    out: dict[str, dict] = {}
    # Storage API: list with prefix=""
    items = client.storage.from_(BUCKET).list("", {"limit": 10000}) or []
    # Top-level entries are folders (ingredient ids).
    for entry in items:
        name = entry.get("name")
        if not name:
            continue
        children = client.storage.from_(BUCKET).list(name, {"limit": 1000}) or []
        for ch in children:
            if ch.get("name") == FILENAME:
                out[name] = ch
                break
    return out


def _parse_iso_to_ts(iso: str | None) -> float:
    if not iso:
        return 0.0
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


def push_files(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    client = _service_client(config)
    report = SyncReport()
    bundle_root = config.repo_root / REL_DIR
    if not bundle_root.exists():
        return report

    remote = _list_remote(client)

    for child in sorted(bundle_root.iterdir()):
        if not child.is_dir():
            continue
        iid = child.name
        if only and iid not in only:
            continue
        local = _local_path(config, iid)
        if not local.exists():
            continue
        local_ts = local.stat().st_mtime
        rmeta = remote.get(iid)
        remote_ts = _parse_iso_to_ts((rmeta or {}).get("updated_at"))
        if rmeta and remote_ts >= local_ts - 1.0:
            report.skipped += 1
            continue
        try:
            client.storage.from_(BUCKET).upload(
                _bucket_path(iid),
                local.read_bytes(),
                {"content-type": "image/png", "upsert": "true"},
            )
            report.uploaded += 1
            log.ok(f"↑ {iid}/image.png")
        except Exception as exc:  # noqa: BLE001
            report.errors.append(f"{iid}: {exc}")
    log.ok(report.line())
    return report


def pull_files(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    client = _service_client(config)
    report = SyncReport()
    remote = _list_remote(client)

    for iid, rmeta in remote.items():
        if only and iid not in only:
            continue
        local = _local_path(config, iid)
        local_ts = local.stat().st_mtime if local.exists() else 0.0
        remote_ts = _parse_iso_to_ts(rmeta.get("updated_at"))
        if local.exists() and local_ts >= remote_ts - 1.0:
            report.skipped += 1
            continue
        try:
            data = client.storage.from_(BUCKET).download(_bucket_path(iid))
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(data)
            report.downloaded += 1
            log.ok(f"↓ {iid}/image.png")
        except Exception as exc:  # noqa: BLE001
            report.errors.append(f"{iid}: {exc}")
    log.ok(report.line())
    return report


def sync_files(config: Config, *, direction: str, only: Optional[list[str]] = None) -> SyncReport:
    if direction == "push":
        return push_files(config, only=only)
    if direction == "pull":
        return pull_files(config, only=only)
    if direction != "both":
        raise ValueError(f"invalid direction: {direction!r}")
    a = pull_files(config, only=only)
    b = push_files(config, only=only)
    return SyncReport(
        uploaded=b.uploaded,
        downloaded=a.downloaded,
        skipped=a.skipped + b.skipped,
        errors=a.errors + b.errors,
    )
```

- [ ] **Step 2: Sanity import**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run python -c "from mfc.ops.ingredient_images import BUCKET, FILENAME; print(BUCKET, FILENAME)"`
Expected: prints `ingredient-images image.png`.

- [ ] **Step 3: Commit**

```bash
git add automation/mfc/ops/ingredient_images.py
git commit -m "feat(ingredient-images): Storage↔local bytes sync"
```

---

### Task 15: `mfc sync-ingredient-images` command + Makefile targets

**Files:**
- Create: `automation/mfc/commands/sync_ingredient_images.py`
- Modify: `automation/mfc/cli.py`
- Modify: `Makefile`

- [ ] **Step 1: Create command**

Create `automation/mfc/commands/sync_ingredient_images.py`:

```python
"""`mfc sync-ingredient-images` — bucket↔local image-bytes sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import ingredient_images as ingredient_images_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-ingredient-images",
        help="Sync ingredient images bucket↔local (pull|push|both)",
    )
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.add_argument("--ingredient", action="append", default=None)
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.ingredient or None
    report = ingredient_images_ops.sync_files(config, direction=args.direction, only=only)
    if report.errors:
        return 1
    return 0
```

- [ ] **Step 2: Wire into CLI**

Edit `automation/mfc/cli.py`. Add to imports:

```python
    sync_ingredient_images,
```

Add to `COMMAND_MODULES` after `sync_ingredients`:

```python
    sync_ingredient_images,
```

- [ ] **Step 3: Add the two Makefile targets**

Append to `Makefile`:

```make
sync-ingredients: ## sync ingredient metadata DB↔local; chains sync-ingredient-images in same direction
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-ingredients        --direction $(DIRECTION) && \
	  $(UV) run mfc sync-ingredient-images  --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — DB+Storage → local. ingredient rows become ingredient.json files; bytes pulled into web/assets/ingredients/.\n"; \
	  printf "  push — local → DB+Storage. Bundle JSONs upserted into DB; local images pushed to Storage.\n"; \
	  printf "  both — pull then push. Last-modified wins per ingredient and per image.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-ingredients --direction $$d && $(UV) run mfc sync-ingredient-images --direction $$d; \
	fi

sync-ingredient-images: ## sync ingredient images bucket↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-ingredient-images --direction $(DIRECTION); \
	else \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-ingredient-images --direction $$d; \
	fi
```

Add both target names to `.PHONY`.

- [ ] **Step 4: CLI smoke**

Run: `cd /Users/amanrai/Documents/Code.nosync/mfc && uv --project automation run mfc sync-ingredient-images --help && make 2>&1 | grep ingredient`
Expected: usage prints; `make` lists `sync-ingredients`, `sync-ingredient-images`, `fetch-ingredient-images`, `fetch-ingredient-nutrition`, `migrate-ingredient-nutrition`.

- [ ] **Step 5: Live round-trip smoke**

Run (assuming you've already run the thiings + nutrition fetches earlier so `web/assets/ingredients/spinach/` has both files):

```
cd /Users/amanrai/Documents/Code.nosync/mfc && \
uv --project automation run mfc sync-ingredients --direction push && \
uv --project automation run mfc sync-ingredient-images --direction push
```

Expected: DB row for spinach updated; bucket has `ingredient-images/spinach/image.png`. Spot-check `photo` column → full Storage URL.

Then:

```
uv --project automation run mfc sync-ingredients --direction pull --ingredient spinach
```

Expected: bundle re-written; diff against pre-pull is empty (modulo timestamp formatting).

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/commands/sync_ingredient_images.py automation/mfc/cli.py Makefile
git commit -m "feat(cli): mfc sync-ingredient-images + Makefile chain targets"
```

---

### Task 16: Admin form placeholder + final integration smoke

**Files:**
- Modify: `web/assets/js/app/admin-ingredient-app.jsx:194-195`

- [ ] **Step 1: Update the admin form placeholder**

Edit `web/assets/js/app/admin-ingredient-app.jsx`. Find:

```jsx
                  <Field label="Photo" hint="Path under data/ingredient-photos/.">
                    <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="data/ingredient-photos/paneer.jpg" />
```

Replace with:

```jsx
                  <Field label="Photo" hint="Full Supabase Storage URL (auto-set by `mfc sync-ingredient-images`).">
                    <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="https://<ref>.supabase.co/storage/v1/object/public/ingredient-images/paneer/image.png" />
```

- [ ] **Step 2: Visual verification**

Start: `cd /Users/amanrai/Documents/Code.nosync/mfc && make serve`
Open `http://localhost:8080/admin/ingredients.html`. Confirm:
- Thumbnail shows for spinach (and any other ingredient with `photo` populated).
- Click into spinach's edit page (`/admin/ingredient.html?id=spinach`) — Photo field shows the new Storage URL; nutrition surface renders the new fields without crashing.

- [ ] **Step 3: Run the full unit-test suite**

Run: `cd automation && uv run python -m unittest discover tests -v`
Expected: every test green (thiings: 3, fdc: 4, aifill: 2, nutrition_migration: 3 = 12 total).

- [ ] **Step 4: Commit**

```bash
git add web/assets/js/app/admin-ingredient-app.jsx
git commit -m "ui(admin): refresh ingredient Photo placeholder for Storage URLs"
```

- [ ] **Step 5: Final review pass**

Run: `git log --oneline -25`
Confirm the commit history reads as a coherent feature build (config → schema → migration → thiings → fdc → ai → sync → ui).

---

## Self-review notes

- **Spec coverage**:
  - §"Architecture" → tasks 1–2 (config / schema), 12–15 (sync infra)
  - §"Bundle JSON shape" → task 12 (`_DB_TO_BUNDLE` carries the mapping)
  - §"Nutrition block" → tasks 7–11 (FDC mapper + AI fallback both produce this shape)
  - §"Schema changes" → task 2
  - §"Migration of existing data" → tasks 3–4
  - §"CLI surface" → tasks 4, 6, 9, 11, 13, 15
  - §"Sync mechanics" → tasks 12, 14
  - §"Fetcher mechanics" → tasks 5–6 (thiings), 7–9 (FDC), 10–11 (AI)
  - §"Auth / config" → task 1
  - §"Makefile targets" → tasks 4, 6, 9, 15
  - §"Testing & verification" → tasks 3 (migration), 5 (thiings), 8 (fdc), 10 (aifill), 16 (full suite)
- **No new runtime deps for I/O modules**: thiings + FDC use stdlib `urllib`. Only AI fallback adds `anthropic`.
- **Idempotency invariants**:
  - thiings: file existence on disk
  - FDC: `nutrition.source` already set
  - migration: `nutrition.source` already set
- **Mutation safety**: every DB-update command leaves rows untouched when `--no-write`. `migrate-ingredient-nutrition` is a no-op on already-reshaped rows.
- **Recipe pipeline regression risk**: zero. No edits to `mfc.ops.recipes`, `mfc.ops.images`, recipe-images bucket, or recipe schema. Five new commands, additive only.
