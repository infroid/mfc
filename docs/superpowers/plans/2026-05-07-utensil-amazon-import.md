# Utensil Amazon Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mfc create-utensil <amazon-url>` (scrape → bundle + image → DB) and `mfc sync-utensils` (bidirectional bundle/DB reconcile), so populating the utensil library no longer requires hand-typing every field.

**Architecture:** Two new ops modules (`ops/amazon.py` scraper + `ops/utensils.py` sync) and two new commands (`create_utensil`, `sync_utensils`). Per-utensil bundles live at `web/assets/utensils/<id>/utensil.json` + `<id>.jpg`, mirroring the recipe pattern. Three new columns on `utensils` capture ASIN/marketplace/fetch timestamp.

**Tech Stack:** Python 3.10+, supabase-py, httpx (already in tree via images.py), BeautifulSoup4 (new), pytest (new), respx (new — httpx mocking).

**Spec:** `docs/superpowers/specs/2026-05-07-utensil-amazon-import-design.md`

---

## Task 1: Add Python dependencies + tests skeleton

**Files:**
- Modify: `automation/pyproject.toml`
- Create: `automation/tests/__init__.py` (empty)
- Create: `automation/tests/conftest.py`

- [ ] **Step 1: Add deps to pyproject.toml**

Edit `automation/pyproject.toml` `[project]` table — set `dependencies` to:

```toml
dependencies = [
  "psycopg[binary]>=3.1",
  "supabase>=2.0",
  "python-dotenv>=1.0",
  "httpx>=0.27",
  "beautifulsoup4>=4.12",
]
```

Add a new `[project.optional-dependencies]` table at the bottom:

```toml
[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "respx>=0.21",
]
```

- [ ] **Step 2: Sync venv with dev extras**

```bash
uv --project automation sync --reinstall --extra dev
chflags -R nohidden automation/.venv 2>/dev/null || true
```

Expected: install completes; `uv --project automation run pytest --version` prints a version.

- [ ] **Step 3: Create empty test package**

Create `automation/tests/__init__.py` with no content.

Create `automation/tests/conftest.py`:

```python
"""Shared pytest fixtures for the mfc test suite."""

from __future__ import annotations

from pathlib import Path

import pytest


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_path():
    """Return a callable that resolves <fixtures>/<relpath>."""
    def _resolve(relpath: str) -> Path:
        return FIXTURES_DIR / relpath
    return _resolve
```

- [ ] **Step 4: Verify pytest runs (zero tests)**

```bash
uv --project automation run pytest automation/tests -q
```

Expected: `no tests ran` (exit 5 from pytest is fine here, just confirms collection works). If pytest itself errors, fix the install before continuing.

- [ ] **Step 5: Commit**

```bash
git add automation/pyproject.toml automation/uv.lock automation/tests/
git commit -m "build(automation): add bs4 + pytest + respx for utensil import work"
```

---

## Task 2: Schema columns for Amazon metadata

**Files:**
- Modify: `automation/db/schema.sql` (utensils table block, ~line 97)

- [ ] **Step 1: Add columns + comments to schema.sql**

Find the `CREATE TABLE IF NOT EXISTS public.utensils (...)` block. Immediately **after** that `CREATE TABLE` statement (and before its `COMMENT ON TABLE` lines), insert:

```sql
ALTER TABLE public.utensils
  ADD COLUMN IF NOT EXISTS amazon_asin        text,
  ADD COLUMN IF NOT EXISTS amazon_marketplace text,
  ADD COLUMN IF NOT EXISTS amazon_fetched_at  timestamptz;
```

After the existing `COMMENT ON COLUMN public.utensils.updated_at ...` line, append:

```sql
COMMENT ON COLUMN public.utensils.amazon_asin        IS 'Amazon ASIN (10-char). Stable across price/availability changes; lookup key for future PA-API refresh.';
COMMENT ON COLUMN public.utensils.amazon_marketplace IS 'Amazon marketplace host (e.g. "amazon.com", "amazon.in"). Pairs with asin.';
COMMENT ON COLUMN public.utensils.amazon_fetched_at  IS 'When Amazon data (image, price, title) was last refreshed for this row.';
```

Also update the existing `COMMENT ON COLUMN public.utensils.photo` line — replace its current text with:

```sql
COMMENT ON COLUMN public.utensils.photo        IS 'Repo-relative path to the utensil photo (e.g. "assets/utensils/<id>/<id>.jpg"). Nullable.';
```

- [ ] **Step 2: Apply the schema**

```bash
make apply-schema
```

Expected: `apply-schema` exits 0. Re-running it is a no-op (idempotent).

- [ ] **Step 3: Verify columns in DB**

```bash
make status
```

Expected: `utensils` listed with at least the existing row count (no rows lost). Then run a one-off SQL query via `mfc` to confirm the columns exist:

```bash
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.clients import sb
c = Config.load()
client = sb.service_client(c)
# Selecting the new columns will fail if they don't exist.
client.table('utensils').select('id, amazon_asin, amazon_marketplace, amazon_fetched_at').limit(1).execute()
print('columns ok')
"
```

Expected: prints `columns ok`.

- [ ] **Step 4: Commit**

```bash
git add automation/db/schema.sql
git commit -m "schema(utensils): add amazon_asin/marketplace/fetched_at columns"
```

---

## Task 3: ASIN extraction (TDD)

**Files:**
- Create: `automation/mfc/ops/amazon.py`
- Create: `automation/tests/test_amazon_asin.py`

- [ ] **Step 1: Write failing tests**

Create `automation/tests/test_amazon_asin.py`:

```python
"""Table-driven tests for Amazon ASIN/marketplace extraction."""

from __future__ import annotations

import pytest

from mfc.ops import amazon


@pytest.mark.parametrize(
    "url,expected_asin,expected_market",
    [
        ("https://www.amazon.com/dp/B07JFTSKXW",                          "B07JFTSKXW", "amazon.com"),
        ("https://www.amazon.com/dp/B07JFTSKXW?tag=foo-20",               "B07JFTSKXW", "amazon.com"),
        ("https://www.amazon.com/Cast-Iron-Kadhai/dp/B07JFTSKXW/ref=foo", "B07JFTSKXW", "amazon.com"),
        ("https://www.amazon.com/gp/product/B07JFTSKXW",                  "B07JFTSKXW", "amazon.com"),
        ("https://amazon.in/dp/B0CHWRXH8B",                               "B0CHWRXH8B", "amazon.in"),
        ("https://www.amazon.co.uk/dp/B0CHWRXH8B",                        "B0CHWRXH8B", "amazon.co.uk"),
        ("B07JFTSKXW",                                                    "B07JFTSKXW", "amazon.com"),
    ],
)
def test_parse_url_extracts_asin_and_marketplace(url, expected_asin, expected_market):
    asin, marketplace = amazon.parse_url(url)
    assert asin == expected_asin
    assert marketplace == expected_market


@pytest.mark.parametrize(
    "url",
    [
        "",
        "https://www.amazon.com/",
        "https://www.amazon.com/some/path/with/no/asin",
        "not-a-url",
        "B07JFTSKX",   # 9 chars
        "B07JFTSKXW1", # 11 chars
    ],
)
def test_parse_url_raises_amazon_not_found_on_garbage(url):
    with pytest.raises(amazon.AmazonNotFound):
        amazon.parse_url(url)
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
uv --project automation run pytest automation/tests/test_amazon_asin.py -v
```

Expected: collection error / `ModuleNotFoundError: No module named 'mfc.ops.amazon'`.

- [ ] **Step 3: Create `ops/amazon.py` skeleton with `parse_url` only**

Create `automation/mfc/ops/amazon.py`:

```python
"""Amazon product page scraper. Pure data — no DB or filesystem side effects.

Designed so a future PA-API path slots in transparently behind ProductInfo.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


_ASIN_RX = re.compile(r"^[A-Z0-9]{10}$")
_URL_ASIN_RX = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?]|$)")
_HOST_RX = re.compile(r"^https?://(?:www\.)?(amazon\.[a-z.]+)/", re.IGNORECASE)


class AmazonNotFound(Exception):
    """Bad URL, page 404, or missing ASIN."""


class AmazonError(Exception):
    """Transient failure: network, parse failure, bot wall, oversize."""


@dataclass
class ProductInfo:
    asin: str
    marketplace: str        # "amazon.com" | "amazon.in" | ...
    title: str
    price: Optional[str]
    image_urls: list[str]
    breadcrumbs: list[str]
    canonical_url: str


def parse_url(url: str) -> tuple[str, str]:
    """Extract (asin, marketplace) from an Amazon product URL or bare ASIN.

    Marketplace is the host stripped of www. ("www.amazon.com" -> "amazon.com").
    Bare ASIN defaults to marketplace="amazon.com".
    """
    if not url:
        raise AmazonNotFound("empty url")

    s = url.strip()

    if _ASIN_RX.match(s):
        return s, "amazon.com"

    host_match = _HOST_RX.match(s)
    if not host_match:
        raise AmazonNotFound(f"not an amazon url: {url!r}")
    marketplace = host_match.group(1).lower()

    asin_match = _URL_ASIN_RX.search(s)
    if not asin_match:
        raise AmazonNotFound(f"no ASIN in url: {url!r}")
    return asin_match.group(1), marketplace


def fetch_product(url: str) -> ProductInfo:
    raise NotImplementedError("fetch_product is implemented in Task 4")


def fetch_product_via_paapi(asin: str, marketplace: str) -> ProductInfo:
    """Stub for the future Product Advertising API path."""
    raise NotImplementedError("PA-API path not yet wired up")
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
uv --project automation run pytest automation/tests/test_amazon_asin.py -v
```

Expected: 13 passed (7 happy + 6 error).

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/amazon.py automation/tests/test_amazon_asin.py
git commit -m "feat(amazon): ASIN + marketplace extraction with table-driven tests"
```

---

## Task 4: Amazon page parsing (TDD)

**Files:**
- Modify: `automation/mfc/ops/amazon.py` — implement `fetch_product`
- Create: `automation/tests/fixtures/amazon/happy.html`
- Create: `automation/tests/fixtures/amazon/bot_wall.html`
- Create: `automation/tests/test_amazon_fetch.py`

- [ ] **Step 1: Capture HTML fixtures**

Capture three small fixture files under `automation/tests/fixtures/amazon/`. To keep the plan self-contained, use these synthetic-but-realistic minimal pages:

**`automation/tests/fixtures/amazon/happy.html`:**

```html
<!DOCTYPE html>
<html><head>
<title>Cast-iron Kadhai 10" — Amazon.com</title>
<meta property="og:image" content="https://m.media-amazon.com/images/I/og-image.jpg">
</head><body>
<div id="wayfinding-breadcrumbs_feature_div">
  <ul>
    <li><a>Home & Kitchen</a></li>
    <li><a>Cookware</a></li>
    <li><a>Woks &amp; Stir-Fry Pans</a></li>
  </ul>
</div>
<span id="productTitle">  Cast-iron Kadhai 10" Pre-Seasoned  </span>
<span class="a-price"><span class="a-offscreen">$49.95</span></span>
<script type="text/javascript">
P.when('A').register("ImageBlockATF", function(A){
  var data = {
    'colorImages': { 'initial': [
      {"hiRes":"https://m.media-amazon.com/images/I/hero-1.jpg","large":"https://m.media-amazon.com/images/I/hero-1-large.jpg"},
      {"hiRes":"https://m.media-amazon.com/images/I/hero-2.jpg"},
      {"hiRes":"https://m.media-amazon.com/images/I/hero-3.jpg"},
      {"large":"https://m.media-amazon.com/images/I/hero-4-only-large.jpg"}
    ]}
  };
  return data;
});
</script>
</body></html>
```

**`automation/tests/fixtures/amazon/bot_wall.html`:**

```html
<!DOCTYPE html>
<html><head><title>Robot Check</title></head>
<body>
<h1>Type the characters you see in this image</h1>
<form action="/errors/validateCaptcha"></form>
</body></html>
```

(No file is needed for the 404 case — we just have respx return a 404 status.)

- [ ] **Step 2: Write failing tests**

Create `automation/tests/test_amazon_fetch.py`:

```python
"""HTTP-level tests for amazon.fetch_product, using respx fixtures."""

from __future__ import annotations

import httpx
import pytest
import respx

from mfc.ops import amazon


URL = "https://www.amazon.com/dp/B07JFTSKXW"


def _fixture(fixture_path, name):
    return fixture_path(f"amazon/{name}").read_text(encoding="utf-8")


@respx.mock
def test_fetch_product_happy(fixture_path):
    respx.get(URL).mock(
        return_value=httpx.Response(200, html=_fixture(fixture_path, "happy.html"))
    )
    info = amazon.fetch_product(URL)
    assert info.asin == "B07JFTSKXW"
    assert info.marketplace == "amazon.com"
    assert info.title == 'Cast-iron Kadhai 10" Pre-Seasoned'
    assert info.price == "$49.95"
    # Hero+2+3 picked via hiRes; 4 falls back to "large".
    assert info.image_urls == [
        "https://m.media-amazon.com/images/I/hero-1.jpg",
        "https://m.media-amazon.com/images/I/hero-2.jpg",
        "https://m.media-amazon.com/images/I/hero-3.jpg",
        "https://m.media-amazon.com/images/I/hero-4-only-large.jpg",
    ]
    assert info.breadcrumbs == ["Home & Kitchen", "Cookware", "Woks & Stir-Fry Pans"]
    assert info.canonical_url == "https://www.amazon.com/dp/B07JFTSKXW"


@respx.mock
def test_fetch_product_bot_wall_raises_amazon_error(fixture_path):
    respx.get(URL).mock(
        return_value=httpx.Response(200, html=_fixture(fixture_path, "bot_wall.html"))
    )
    with pytest.raises(amazon.AmazonError) as exc:
        amazon.fetch_product(URL)
    assert "bot-wall" in str(exc.value)


@respx.mock
def test_fetch_product_404_raises_amazon_not_found():
    respx.get(URL).mock(return_value=httpx.Response(404))
    with pytest.raises(amazon.AmazonNotFound):
        amazon.fetch_product(URL)


@respx.mock
def test_fetch_product_falls_back_to_og_image_when_color_images_missing(fixture_path):
    minimal_html = """
        <html><head>
          <meta property="og:image" content="https://example.com/fallback.jpg">
        </head><body>
          <span id="productTitle">Minimal</span>
        </body></html>
    """
    respx.get(URL).mock(return_value=httpx.Response(200, html=minimal_html))
    info = amazon.fetch_product(URL)
    assert info.title == "Minimal"
    assert info.image_urls == ["https://example.com/fallback.jpg"]
    assert info.breadcrumbs == []
    assert info.price is None
```

- [ ] **Step 3: Run the tests, verify they fail**

```bash
uv --project automation run pytest automation/tests/test_amazon_fetch.py -v
```

Expected: all 4 fail with `NotImplementedError` (or assertion noise) from the stub.

- [ ] **Step 4: Implement `fetch_product`**

Replace the body of `fetch_product` in `automation/mfc/ops/amazon.py` and add the helpers below:

```python
import json
import re

import httpx
from bs4 import BeautifulSoup


_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
_HTTP_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
_HTTP_TIMEOUT_S = 15.0
_COLOR_IMAGES_RX = re.compile(r"'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[.*?\])\s*\}", re.DOTALL)


def fetch_product(url: str) -> ProductInfo:
    asin, marketplace = parse_url(url)
    canonical = f"https://www.{marketplace}/dp/{asin}"
    fetch_url = url if url.startswith("http") else canonical

    try:
        resp = httpx.get(
            fetch_url,
            headers=_HTTP_HEADERS,
            timeout=_HTTP_TIMEOUT_S,
            follow_redirects=True,
        )
    except httpx.HTTPError as e:
        raise AmazonError(f"network: {e}") from e

    if resp.status_code == 404:
        raise AmazonNotFound(f"page 404: {fetch_url}")
    if resp.status_code >= 400:
        raise AmazonError(f"http {resp.status_code}: {fetch_url}")

    return _parse_product_html(
        html=resp.text,
        asin=asin,
        marketplace=marketplace,
        canonical_url=canonical,
    )


def _parse_product_html(*, html: str, asin: str, marketplace: str, canonical_url: str) -> ProductInfo:
    if _is_bot_wall(html):
        raise AmazonError(f"bot-wall: amazon served captcha for {asin}")

    soup = BeautifulSoup(html, "html.parser")

    title_el = soup.select_one("#productTitle")
    if not title_el:
        raise AmazonError(f"parse-failure: no #productTitle for {asin}")
    title = title_el.get_text(strip=True)

    price_el = soup.select_one(".a-price .a-offscreen")
    if price_el is None:
        price_el = soup.select_one("#corePrice_feature_div .a-offscreen")
    price = price_el.get_text(strip=True) if price_el else None

    breadcrumbs = [
        a.get_text(strip=True)
        for a in soup.select("#wayfinding-breadcrumbs_feature_div a")
        if a.get_text(strip=True)
    ]

    image_urls = _extract_image_urls(html, soup)

    return ProductInfo(
        asin=asin,
        marketplace=marketplace,
        title=title,
        price=price,
        image_urls=image_urls,
        breadcrumbs=breadcrumbs,
        canonical_url=canonical_url,
    )


def _is_bot_wall(html: str) -> bool:
    head = html[:4096].lower()
    return "<title>robot check</title>" in head or "validatecaptcha" in head


def _extract_image_urls(html: str, soup: "BeautifulSoup") -> list[str]:
    """Two-tier extraction: colorImages JSON block, then og:image fallback."""
    match = _COLOR_IMAGES_RX.search(html)
    if match:
        try:
            entries = _loose_json_array(match.group(1))
            urls: list[str] = []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                u = entry.get("hiRes") or entry.get("large")
                if isinstance(u, str) and u and u not in urls:
                    urls.append(u)
            if urls:
                return urls
        except Exception:
            pass  # fall through to og:image

    og = soup.select_one('meta[property="og:image"]')
    if og and og.get("content"):
        return [og["content"]]
    return []


def _loose_json_array(blob: str) -> list:
    """Amazon serializes colorImages with single quotes; massage into JSON.

    Replaces only quote-style; does not handle every JS construct. If the
    structure changes we fall back to og:image. That is the design.
    """
    cleaned = blob.replace("'", '"')
    return json.loads(cleaned)
```

- [ ] **Step 5: Run the tests, verify they pass**

```bash
uv --project automation run pytest automation/tests/test_amazon_fetch.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/ops/amazon.py automation/tests/test_amazon_fetch.py automation/tests/fixtures/amazon/
git commit -m "feat(amazon): scrape product page → ProductInfo with bot-wall + 404 handling"
```

---

## Task 5: Bundle file helpers

**Files:**
- Modify: `automation/mfc/core/files.py` — add utensil bundle helpers
- Create: `automation/tests/test_utensil_files.py`

- [ ] **Step 1: Write failing tests**

Create `automation/tests/test_utensil_files.py`:

```python
"""utensil bundle path + iter helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from mfc.core import files


def test_utensil_bundles_root(tmp_path):
    assert files.utensil_bundles_root(tmp_path) == tmp_path / "web" / "assets" / "utensils"


def test_utensil_bundle_path(tmp_path):
    assert files.utensil_bundle_path(tmp_path, "kadhai") == \
        tmp_path / "web" / "assets" / "utensils" / "kadhai" / "utensil.json"


def test_iter_utensil_bundles_yields_only_dirs_with_json(tmp_path):
    root = files.utensil_bundles_root(tmp_path)
    (root / "kadhai").mkdir(parents=True)
    (root / "kadhai" / "utensil.json").write_text("{}")
    (root / "no-json-here").mkdir()
    (root / "loose-file.txt").write_text("ignore")
    found = sorted(p.parent.name for p in files.iter_utensil_bundles(tmp_path))
    assert found == ["kadhai"]


def test_load_utensil_json_round_trips(tmp_path):
    root = files.utensil_bundles_root(tmp_path)
    (root / "k").mkdir(parents=True)
    (root / "k" / "utensil.json").write_text(json.dumps({"id": "k", "name": "K"}))
    data = files.load_utensil_json(root / "k" / "utensil.json")
    assert data == {"id": "k", "name": "K"}
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
uv --project automation run pytest automation/tests/test_utensil_files.py -v
```

Expected: AttributeError for the four new helpers.

- [ ] **Step 3: Add helpers to `core/files.py`**

Append to `automation/mfc/core/files.py`:

```python
def utensil_bundles_root(repo_root: Path) -> Path:
    return repo_root / "web" / "assets" / "utensils"


def utensil_bundle_path(repo_root: Path, utensil_id: str) -> Path:
    return utensil_bundles_root(repo_root) / utensil_id / "utensil.json"


def iter_utensil_bundles(repo_root: Path) -> Iterator[Path]:
    """Yield each `utensil.json` under web/assets/utensils/, sorted by id."""
    root = utensil_bundles_root(repo_root)
    if not root.exists():
        return
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        f = child / "utensil.json"
        if f.exists():
            yield f


def load_utensil_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
uv --project automation run pytest automation/tests/test_utensil_files.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/core/files.py automation/tests/test_utensil_files.py
git commit -m "feat(files): utensil bundle path + iter helpers"
```

---

## Task 6: ops/utensils.py — push_bundles

**Files:**
- Create: `automation/mfc/ops/utensils.py`

This task has no DB-integration test (matching the existing `ops/recipes.py` convention — sync layer is exercised via the live smoke test in Task 12). The unit-testable shape transforms live in pure functions.

- [ ] **Step 1: Create the module skeleton**

Create `automation/mfc/ops/utensils.py`:

```python
"""Utensil sync — bidirectional between local utensil.json bundles and the
public.utensils + public.utensil_buy_links tables. Mirrors ops/recipes.py.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from ..clients import sb as sb_client
from ..core import files, log
from ..core.config import Config


_BUNDLE_FIELDS = (
    "id", "name", "tagline", "category", "photo", "care_tip",
    "specs", "show", "ai_filled_at",
)
_BUY_LINK_FIELDS = ("sort_order", "store", "url", "price", "affiliate_tag")


@dataclass
class SyncReport:
    pushed: int = 0
    pulled: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return f"↑ {self.pushed} pushed · ↓ {self.pulled} pulled · - {self.skipped} skipped · ! {len(self.failed)} failed"


def _bundle_to_utensil_row(bundle: dict) -> dict:
    """Translate utensil.json -> public.utensils row payload (excluding child tables)."""
    row = {k: bundle.get(k) for k in _BUNDLE_FIELDS}
    # specs / show default to {} per schema.
    if row["specs"] is None:
        row["specs"] = {}
    if row["show"] is None:
        row["show"] = {}
    az = bundle.get("amazon") or {}
    row["amazon_asin"] = az.get("asin")
    row["amazon_marketplace"] = az.get("marketplace")
    row["amazon_fetched_at"] = az.get("fetched_at")
    return row


def _bundle_to_buy_link_rows(bundle: dict) -> list[dict]:
    out: list[dict] = []
    for entry in (bundle.get("buy_links") or []):
        row = {"utensil_id": bundle["id"]}
        for k in _BUY_LINK_FIELDS:
            row[k] = entry.get(k)
        out.append(row)
    return out


def push_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Upsert local utensil.json bundles into DB. `only` scopes to a subset."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    paths = list(files.iter_utensil_bundles(config.repo_root))
    bundles = [files.load_utensil_json(p) for p in paths]
    if only:
        wanted = set(only)
        bundles = [b for b in bundles if b.get("id") in wanted]

    valid: list[dict] = []
    for b in bundles:
        if not b.get("id") or not b.get("name"):
            log.warn(f"skipping bundle missing id/name: {b.get('id') or '<no-id>'}")
            continue
        valid.append(b)

    if not valid:
        log.warn("no utensil bundles to push")
        return report

    log.step(f"sync-utensils · push · {len(valid)} bundle(s)")

    rows = [_bundle_to_utensil_row(b) for b in valid]
    sb.table("utensils").upsert(rows, on_conflict="id").execute()
    log.ok(f"utensils: {len(valid)}")

    ids = [b["id"] for b in valid]
    sb.table("utensil_buy_links").delete().in_("utensil_id", ids).execute()
    buy_rows = [r for b in valid for r in _bundle_to_buy_link_rows(b)]
    if buy_rows:
        sb.table("utensil_buy_links").insert(buy_rows).execute()
    log.ok(f"utensil_buy_links: {len(buy_rows)} row(s)")

    report.pushed = len(valid)
    log.ok(report.line())
    return report
```

- [ ] **Step 2: Add unit tests for the pure transform functions**

Create `automation/tests/test_utensils_transforms.py`:

```python
"""Pure-function tests for ops/utensils.py transforms (no DB)."""

from __future__ import annotations

from mfc.ops import utensils


SAMPLE_BUNDLE = {
    "id": "kadhai-cast-iron",
    "name": "Cast-iron kadhai",
    "tagline": "deep, broad, hot",
    "category": "Cookware",
    "photo": "assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg",
    "care_tip": None,
    "specs": {"material": "cast iron", "size": "10\""},
    "show": {"buyLink": True, "careTip": True, "specs": False},
    "ai_filled_at": "2026-05-07T15:30:00Z",
    "amazon": {
        "asin": "B07JFTSKXW",
        "marketplace": "amazon.com",
        "fetched_at": "2026-05-07T15:30:00Z",
    },
    "buy_links": [
        {"sort_order": 0, "store": "Amazon", "url": "https://...",
         "price": "$49.95", "affiliate_tag": "mfc-20"}
    ],
}


def test_bundle_to_utensil_row_maps_amazon_block():
    row = utensils._bundle_to_utensil_row(SAMPLE_BUNDLE)
    assert row["id"] == "kadhai-cast-iron"
    assert row["amazon_asin"] == "B07JFTSKXW"
    assert row["amazon_marketplace"] == "amazon.com"
    assert row["amazon_fetched_at"] == "2026-05-07T15:30:00Z"
    assert row["specs"] == {"material": "cast iron", "size": "10\""}
    assert row["show"] == {"buyLink": True, "careTip": True, "specs": False}


def test_bundle_to_utensil_row_defaults_specs_and_show_to_empty_dict():
    row = utensils._bundle_to_utensil_row({"id": "x", "name": "X"})
    assert row["specs"] == {}
    assert row["show"] == {}
    assert row["amazon_asin"] is None


def test_bundle_to_buy_link_rows_attaches_utensil_id():
    rows = utensils._bundle_to_buy_link_rows(SAMPLE_BUNDLE)
    assert rows == [{
        "utensil_id": "kadhai-cast-iron",
        "sort_order": 0,
        "store": "Amazon",
        "url": "https://...",
        "price": "$49.95",
        "affiliate_tag": "mfc-20",
    }]


def test_bundle_to_buy_link_rows_empty_when_missing():
    assert utensils._bundle_to_buy_link_rows({"id": "x"}) == []
```

- [ ] **Step 3: Run the tests**

```bash
uv --project automation run pytest automation/tests/test_utensils_transforms.py -v
```

Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/ops/utensils.py automation/tests/test_utensils_transforms.py
git commit -m "feat(utensils): push_bundles + pure transforms with unit tests"
```

---

## Task 7: ops/utensils.py — pull_bundles + sync orchestrator

**Files:**
- Modify: `automation/mfc/ops/utensils.py`
- Modify: `automation/tests/test_utensils_transforms.py` — add `_db_to_bundle` test

- [ ] **Step 1: Add failing test for the row→bundle transform**

Append to `automation/tests/test_utensils_transforms.py`:

```python
def test_db_to_bundle_round_trips_canonical_fields():
    db_row = {
        "id": "kadhai", "name": "K", "tagline": None, "category": "Cookware",
        "photo": "assets/utensils/kadhai/kadhai.jpg", "care_tip": None,
        "specs": {"material": "ci"}, "show": {"buyLink": True},
        "ai_filled_at": "2026-05-07T15:30:00Z",
        "amazon_asin": "B07X", "amazon_marketplace": "amazon.com",
        "amazon_fetched_at": "2026-05-07T15:30:00Z",
        "created_at": "ignored", "updated_at": "ignored", "created_by": "ignored",
    }
    buy_links = [
        {"sort_order": 0, "store": "Amazon", "url": "https://...", "price": "$1",
         "affiliate_tag": "mfc-20"},
    ]
    bundle = utensils._db_to_bundle(db_row, buy_links)
    assert bundle["id"] == "kadhai"
    assert bundle["category"] == "Cookware"
    assert "tagline" not in bundle  # nones stripped
    assert "care_tip" not in bundle
    assert bundle["amazon"] == {
        "asin": "B07X", "marketplace": "amazon.com",
        "fetched_at": "2026-05-07T15:30:00Z",
    }
    assert bundle["buy_links"] == [{
        "sort_order": 0, "store": "Amazon", "url": "https://...",
        "price": "$1", "affiliate_tag": "mfc-20",
    }]


def test_db_to_bundle_drops_amazon_block_when_no_asin():
    db_row = {"id": "x", "name": "X", "specs": {}, "show": {},
              "amazon_asin": None, "amazon_marketplace": None,
              "amazon_fetched_at": None}
    bundle = utensils._db_to_bundle(db_row, [])
    assert "amazon" not in bundle
```

- [ ] **Step 2: Run, verify it fails**

```bash
uv --project automation run pytest automation/tests/test_utensils_transforms.py -v
```

Expected: AttributeError on `_db_to_bundle`.

- [ ] **Step 3: Implement `_db_to_bundle`, `pull_bundles`, and `sync`**

Append to `automation/mfc/ops/utensils.py`:

```python
def _db_to_bundle(row: dict, buy_links: list[dict]) -> dict:
    bundle = {k: row.get(k) for k in _BUNDLE_FIELDS}
    if row.get("amazon_asin"):
        bundle["amazon"] = {
            "asin": row["amazon_asin"],
            "marketplace": row.get("amazon_marketplace"),
            "fetched_at": row.get("amazon_fetched_at"),
        }
    bundle["buy_links"] = [
        {k: bl.get(k) for k in _BUY_LINK_FIELDS}
        for bl in sorted(buy_links, key=lambda b: b.get("sort_order") or 0)
    ]
    # Strip None-valued optional keys for clean diffs.
    for k in ("tagline", "category", "photo", "care_tip", "ai_filled_at"):
        if bundle.get(k) is None:
            bundle.pop(k, None)
    return bundle


def pull_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Reconstruct utensil.json bundles from DB rows."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    rows = sb.table("utensils").select("*").order("id").execute().data or []
    if only:
        wanted = set(only)
        rows = [r for r in rows if r["id"] in wanted]

    if not rows:
        log.warn("no utensils in DB to pull")
        return report

    log.step(f"sync-utensils · pull · {len(rows)} utensil(s)")

    ids = [r["id"] for r in rows]
    bl_rows = (
        sb.table("utensil_buy_links")
        .select("utensil_id, sort_order, store, url, price, affiliate_tag")
        .in_("utensil_id", ids)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    bl_by_uid: dict[str, list[dict]] = {}
    for bl in bl_rows:
        bl_by_uid.setdefault(bl["utensil_id"], []).append(bl)

    for row in rows:
        rid = row["id"]
        try:
            bundle = _db_to_bundle(row, bl_by_uid.get(rid, []))
            path = files.utensil_bundle_path(config.repo_root, rid)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
            report.pulled += 1
            log.ok(rid)
        except Exception as e:  # noqa: BLE001
            report.failed.append(f"{rid}: {e}")
            log.error(f"{rid}: {e}")

    log.ok(report.line())
    return report


def sync(config: Config, *, direction: str, only: Optional[list[str]] = None) -> SyncReport:
    if direction == "push":
        return push_bundles(config, only=only)
    if direction == "pull":
        return pull_bundles(config, only=only)
    if direction != "both":
        raise ValueError(f"invalid direction: {direction!r}")

    sb = sb_client.service_client(config)
    db_rows = sb.table("utensils").select("id, updated_at").execute().data or []
    db_by_id = {r["id"]: r for r in db_rows}
    if only:
        wanted = set(only)
        db_by_id = {k: v for k, v in db_by_id.items() if k in wanted}

    bundle_paths = list(files.iter_utensil_bundles(config.repo_root))
    local_by_id: dict[str, Path] = {}
    for p in bundle_paths:
        try:
            d = files.load_utensil_json(p)
            uid = d.get("id")
            if uid and (not only or uid in only):
                local_by_id[uid] = p
        except Exception:
            continue

    push_ids: list[str] = []
    pull_ids: list[str] = []

    for uid in sorted(set(db_by_id) | set(local_by_id)):
        db_row = db_by_id.get(uid)
        local_path = local_by_id.get(uid)
        if db_row and not local_path:
            pull_ids.append(uid)
            continue
        if local_path and not db_row:
            push_ids.append(uid)
            continue
        local_mtime = local_path.stat().st_mtime
        db_ts = _parse_iso_to_ts(db_row.get("updated_at") or "")
        delta = local_mtime - db_ts
        if abs(delta) <= 1.0:
            continue
        if delta > 0:
            push_ids.append(uid)
        else:
            pull_ids.append(uid)

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


def _parse_iso_to_ts(iso: str) -> float:
    if not iso:
        return 0.0
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
uv --project automation run pytest automation/tests/test_utensils_transforms.py -v
```

Expected: 6 passed (4 from Task 6 + 2 added here).

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/ops/utensils.py automation/tests/test_utensils_transforms.py
git commit -m "feat(utensils): pull_bundles + last-modified sync orchestrator"
```

---

## Task 8: `mfc sync-utensils` CLI command

**Files:**
- Create: `automation/mfc/commands/sync_utensils.py`
- Modify: `automation/mfc/cli.py` — register

- [ ] **Step 1: Create command module**

Create `automation/mfc/commands/sync_utensils.py` (close mirror of `sync_recipes.py`):

```python
"""`mfc sync-utensils` — reconcile utensil metadata between DB and local
utensil.json bundles. Mirrors ops/recipes.py's three-mode sync."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import utensils as utensils_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-utensils",
        help="Sync utensil library DB↔local bundles (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = DB→local; push = local→DB; both = last-modified wins per utensil",
    )
    p.add_argument(
        "--utensil",
        action="append",
        default=None,
        help="Limit to one or more utensil ids (repeatable)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.utensil or None
    report = utensils_ops.sync(config, direction=args.direction, only=only)
    if report.failed:
        return 1
    return 0
```

- [ ] **Step 2: Register in cli.py**

Edit `automation/mfc/cli.py`. In the `from .commands import (...)` block (currently lines 15-25), add `sync_utensils,` (alphabetical position is between `sync_recipes` and `set_role`). Then update `COMMAND_MODULES` (currently lines 32-42) so it reads:

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    sync_recipes,
    sync_images,
    sync_utensils,
    set_role,
    drop_schema,
    reset,
]
```

- [ ] **Step 3: Smoke-check the command exists**

```bash
uv --project automation run mfc sync-utensils --help
```

Expected: prints help text with `--direction {pull,push,both}` and `--utensil` flags.

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/commands/sync_utensils.py automation/mfc/cli.py
git commit -m "feat(cli): wire mfc sync-utensils command"
```

---

## Task 9: `create_utensil` — slug + URL parsing helpers (TDD)

**Files:**
- Create: `automation/mfc/commands/create_utensil.py` (skeleton)
- Create: `automation/tests/test_create_utensil_helpers.py`

- [ ] **Step 1: Write failing tests**

Create `automation/tests/test_create_utensil_helpers.py`:

```python
"""Pure-function tests for create_utensil helpers."""

from __future__ import annotations

import pytest

from mfc.commands import create_utensil as cu


@pytest.mark.parametrize(
    "title,expected",
    [
        ("Cast-iron Kadhai 10\" Pre-Seasoned", "cast-iron-kadhai-10-pre-seasoned"),
        ("  Trimmed   Spaces  ",                 "trimmed-spaces"),
        ("Émojis 🍳 stripped",                    "emojis-stripped"),
    ],
)
def test_slugify_title(title, expected):
    assert cu.slugify(title) == expected


def test_slugify_empty_raises():
    with pytest.raises(ValueError):
        cu.slugify("   ")


@pytest.mark.parametrize(
    "breadcrumbs,expected",
    [
        (["Home & Kitchen", "Cookware", "Skillets"],          "Cookware"),
        (["Home & Kitchen", "Bakeware", "Sheet Pans"],        "Bakeware"),
        (["Tools & Home Improvement", "Kitchen Knives"],      "Cutlery"),
        (["Home & Kitchen", "Small Appliances", "Blenders"],  "Small appliance"),
        (["Home & Kitchen", "Measuring Tools"],               "Measuring"),
        ([],                                                  "Utensil"),
        (["Garden", "Hose"],                                  "Utensil"),
    ],
)
def test_guess_category(breadcrumbs, expected):
    assert cu.guess_category(breadcrumbs) == expected


def test_canonical_amazon_url_appends_mfc_tag():
    assert cu.canonical_amazon_url("B07JFTSKXW", "amazon.com") == \
        "https://www.amazon.com/dp/B07JFTSKXW?tag=mfc-20"
    assert cu.canonical_amazon_url("B07JFTSKXW", "amazon.in") == \
        "https://www.amazon.in/dp/B07JFTSKXW?tag=mfc-20"
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
uv --project automation run pytest automation/tests/test_create_utensil_helpers.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create skeleton with the three helpers**

Create `automation/mfc/commands/create_utensil.py`:

```python
"""`mfc create-utensil` — scrape an Amazon product page, write a utensil
bundle (JSON + image) to disk, optionally push the row to Supabase.
"""

from __future__ import annotations

import argparse
import re
import unicodedata


AFFILIATE_TAG = "mfc-20"


_SLUG_NORMALIZE_RX = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    """ASCII slug: lowercase, strip diacritics, collapse non-alnum runs to '-'."""
    if not text or not text.strip():
        raise ValueError("cannot slugify empty string")
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_NORMALIZE_RX.sub("-", ascii_only.lower()).strip("-")
    if not slug:
        raise ValueError(f"slug collapsed to empty for input: {text!r}")
    return slug


_CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("Cutlery",         ["knife", "knives", "cutlery"]),
    ("Bakeware",        ["bakeware", "baking"]),
    ("Small appliance", ["small appliance", "blender", "mixer", "appliance"]),
    ("Measuring",       ["measuring", "scale", "thermometer"]),
    ("Cookware",        ["cookware", "pot", "pan", "skillet", "wok", "dutch oven"]),
]


def guess_category(breadcrumbs: list[str]) -> str:
    haystack = " ".join(breadcrumbs).lower()
    for category, keywords in _CATEGORY_RULES:
        if any(kw in haystack for kw in keywords):
            return category
    return "Utensil"


def canonical_amazon_url(asin: str, marketplace: str) -> str:
    return f"https://www.{marketplace}/dp/{asin}?tag={AFFILIATE_TAG}"


def register(subparsers: argparse._SubParsersAction) -> None:
    raise NotImplementedError("CLI surface lands in Task 12")


def run(args: argparse.Namespace, config) -> int:
    raise NotImplementedError("orchestrator lands in Task 11")
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
uv --project automation run pytest automation/tests/test_create_utensil_helpers.py -v
```

Expected: 11 passed (3 slugify + 1 raise + 7 guess_category-ish + 0 url test, count: 3+1+7+1 = 12 actually). Re-tally: 3 slugify happy + 1 slugify raise + 7 guess_category + 1 canonical_url = 12 passed. Confirm 12.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/commands/create_utensil.py automation/tests/test_create_utensil_helpers.py
git commit -m "feat(create-utensil): slugify + category guess + canonical URL helpers"
```

---

## Task 10: `create_utensil` — image candidate download + selection

**Files:**
- Modify: `automation/mfc/commands/create_utensil.py`
- Create: `automation/tests/test_create_utensil_images.py`

The interactive `open` + `input()` part of the flow is exercised through the live smoke test (Task 12). The pure shape-only helpers tested here are: download with size cap, preview HTML, and the selection routine when `image_index` is provided.

- [ ] **Step 1: Write failing tests**

Create `automation/tests/test_create_utensil_images.py`:

```python
"""Tests for create_utensil image-candidate helpers."""

from __future__ import annotations

import httpx
import pytest
import respx

from mfc.commands import create_utensil as cu
from mfc.ops import amazon


def test_download_candidate_writes_file_under_5mb(tmp_path):
    url = "https://example.com/img.jpg"
    payload = b"\x89PNG\r\n\x1a\n" + b"\x00" * 1024  # 1 KB
    with respx.mock:
        respx.get(url).mock(return_value=httpx.Response(200, content=payload))
        out = tmp_path / "candidate.jpg"
        cu._download_candidate(url, out)
    assert out.read_bytes() == payload


def test_download_candidate_raises_oversize():
    url = "https://example.com/big.jpg"
    payload = b"x" * (5 * 1024 * 1024 + 1)  # 5 MB + 1
    with respx.mock:
        respx.get(url).mock(return_value=httpx.Response(200, content=payload))
        with pytest.raises(amazon.AmazonError) as exc:
            cu._download_candidate(url, None)
        assert "oversize" in str(exc.value)


def test_write_preview_html_lists_candidates(tmp_path):
    paths = [tmp_path / "img-1.jpg", tmp_path / "img-2.jpg"]
    for p in paths:
        p.write_bytes(b"x")
    html_path = tmp_path / "preview.html"
    cu._write_preview_html(html_path, paths)
    body = html_path.read_text()
    assert "img-1.jpg" in body
    assert "img-2.jpg" in body
    assert "1" in body and "2" in body


def test_choose_candidate_with_image_index(monkeypatch, tmp_path):
    paths = [tmp_path / "img-1.jpg", tmp_path / "img-2.jpg", tmp_path / "img-3.jpg"]
    for p in paths:
        p.write_bytes(b"x")
    chosen = cu._choose_candidate(paths, image_index=2)
    assert chosen == paths[1]  # 1-indexed


def test_choose_candidate_with_image_index_zero_returns_none(tmp_path):
    paths = [tmp_path / "img-1.jpg"]
    paths[0].write_bytes(b"x")
    assert cu._choose_candidate(paths, image_index=0) is None


def test_choose_candidate_image_index_out_of_range_raises(tmp_path):
    paths = [tmp_path / "img-1.jpg"]
    paths[0].write_bytes(b"x")
    with pytest.raises(ValueError):
        cu._choose_candidate(paths, image_index=99)
```

- [ ] **Step 2: Run, verify failure**

```bash
uv --project automation run pytest automation/tests/test_create_utensil_images.py -v
```

Expected: AttributeError on the `_download_candidate`, `_write_preview_html`, `_choose_candidate` symbols.

- [ ] **Step 3: Implement the helpers**

Append to `automation/mfc/commands/create_utensil.py`:

```python
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import httpx

from ..ops import amazon


_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_DOWNLOAD_TIMEOUT_S = 30.0


def _download_candidate(url: str, out_path: "Optional[Path]") -> None:
    """Stream a candidate image to disk; raise AmazonError if > 5 MB."""
    try:
        with httpx.stream("GET", url, timeout=_DOWNLOAD_TIMEOUT_S, follow_redirects=True) as resp:
            resp.raise_for_status()
            total = 0
            chunks: list[bytes] = []
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > _MAX_IMAGE_BYTES:
                    raise amazon.AmazonError(f"oversize: {url} (>5 MB)")
                chunks.append(chunk)
        if out_path is not None:
            out_path.write_bytes(b"".join(chunks))
    except amazon.AmazonError:
        raise
    except httpx.HTTPError as e:
        raise amazon.AmazonError(f"download {url}: {e}") from e


def _write_preview_html(html_path: "Path", candidate_paths: list["Path"]) -> None:
    """Write a small grid HTML so the user can eyeball candidates."""
    items = "\n".join(
        f'  <figure style="display:inline-block;margin:8px;width:240px;text-align:center">'
        f'<img src="{p.name}" style="max-width:240px;max-height:240px;display:block;margin:0 auto"/>'
        f'<figcaption style="font:12px monospace">{i+1}. {p.name}</figcaption>'
        f'</figure>'
        for i, p in enumerate(candidate_paths)
    )
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>Pick a utensil image</title></head>"
        "<body style='font-family:system-ui;background:#f7f5ee'>"
        "<h2 style='margin:16px'>Pick the image to keep — type its number in the terminal.</h2>"
        f"{items}"
        "</body></html>"
    )
    html_path.write_text(html, encoding="utf-8")


def _choose_candidate(
    candidate_paths: list["Path"],
    *,
    image_index: "Optional[int]" = None,
    open_preview: bool = False,
    preview_html: "Optional[Path]" = None,
) -> "Optional[Path]":
    """Pick one candidate. Returns None if user/flag chooses 'skip'.

    image_index = 0  -> skip
    image_index in [1..N] -> select that 1-indexed candidate
    image_index None -> interactive: open preview, prompt for number
    """
    n = len(candidate_paths)
    if image_index is not None:
        if image_index == 0:
            return None
        if not 1 <= image_index <= n:
            raise ValueError(f"--image-index {image_index} out of range 1..{n}")
        return candidate_paths[image_index - 1]

    if open_preview and preview_html is not None and sys.platform == "darwin":
        subprocess.run(["open", str(preview_html)], check=False)
    elif preview_html is not None:
        print(f"  preview: file://{preview_html.resolve()}")

    while True:
        raw = input(f"Pick image [1-{n}, 0 to skip]: ").strip()
        try:
            idx = int(raw)
        except ValueError:
            print("  not a number — try again")
            continue
        if idx == 0:
            return None
        if 1 <= idx <= n:
            return candidate_paths[idx - 1]
        print(f"  out of range — must be 0..{n}")
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
uv --project automation run pytest automation/tests/test_create_utensil_images.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/commands/create_utensil.py automation/tests/test_create_utensil_images.py
git commit -m "feat(create-utensil): image candidate download + preview + selection"
```

---

## Task 11: `create_utensil` — bundle composition + orchestrator

**Files:**
- Modify: `automation/mfc/commands/create_utensil.py`
- Create: `automation/tests/test_create_utensil_compose.py`

- [ ] **Step 1: Write failing tests for `_compose_bundle`**

Create `automation/tests/test_create_utensil_compose.py`:

```python
"""Tests for create_utensil bundle composition."""

from __future__ import annotations

from datetime import datetime, timezone

from mfc.commands import create_utensil as cu
from mfc.ops.amazon import ProductInfo


_FROZEN = datetime(2026, 5, 7, 15, 30, 0, tzinfo=timezone.utc)


def _info(**overrides):
    base = {
        "asin": "B07JFTSKXW",
        "marketplace": "amazon.com",
        "title": "Cast-iron Kadhai",
        "price": "$49.95",
        "image_urls": ["https://example.com/a.jpg"],
        "breadcrumbs": ["Home & Kitchen", "Cookware", "Woks"],
        "canonical_url": "https://www.amazon.com/dp/B07JFTSKXW",
    }
    base.update(overrides)
    return ProductInfo(**base)


def test_compose_bundle_full():
    info = _info()
    bundle = cu._compose_bundle(
        info=info, utensil_id="kadhai-cast-iron",
        photo_path="assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg",
        now=_FROZEN,
    )
    assert bundle["id"] == "kadhai-cast-iron"
    assert bundle["name"] == "Cast-iron Kadhai"
    assert bundle["category"] == "Cookware"
    assert bundle["photo"] == "assets/utensils/kadhai-cast-iron/kadhai-cast-iron.jpg"
    assert bundle["specs"] == {}
    assert bundle["show"] == {"buyLink": True, "careTip": True, "specs": False}
    assert bundle["ai_filled_at"] == "2026-05-07T15:30:00+00:00"
    assert bundle["amazon"] == {
        "asin": "B07JFTSKXW",
        "marketplace": "amazon.com",
        "fetched_at": "2026-05-07T15:30:00+00:00",
    }
    assert bundle["buy_links"] == [{
        "sort_order": 0,
        "store": "Amazon",
        "url": "https://www.amazon.com/dp/B07JFTSKXW?tag=mfc-20",
        "price": "$49.95",
        "affiliate_tag": "mfc-20",
    }]


def test_compose_bundle_no_photo():
    bundle = cu._compose_bundle(
        info=_info(), utensil_id="x", photo_path=None, now=_FROZEN,
    )
    assert bundle["photo"] is None
```

- [ ] **Step 2: Run, verify failure**

```bash
uv --project automation run pytest automation/tests/test_create_utensil_compose.py -v
```

Expected: AttributeError on `_compose_bundle`.

- [ ] **Step 3: Implement `_compose_bundle` and full `run` orchestrator**

Append to `automation/mfc/commands/create_utensil.py`:

```python
import json
from datetime import datetime, timezone

from ..core import files, log
from ..core.config import Config
from ..ops import utensils as utensils_ops


def _compose_bundle(
    *,
    info: amazon.ProductInfo,
    utensil_id: str,
    photo_path: Optional[str],
    now: datetime,
) -> dict:
    iso = now.isoformat()
    return {
        "id": utensil_id,
        "name": info.title,
        "tagline": None,
        "category": guess_category(info.breadcrumbs),
        "photo": photo_path,
        "care_tip": None,
        "specs": {},
        "show": {"buyLink": True, "careTip": True, "specs": False},
        "ai_filled_at": iso,
        "amazon": {
            "asin": info.asin,
            "marketplace": info.marketplace,
            "fetched_at": iso,
        },
        "buy_links": [{
            "sort_order": 0,
            "store": "Amazon",
            "url": canonical_amazon_url(info.asin, info.marketplace),
            "price": info.price,
            "affiliate_tag": AFFILIATE_TAG,
        }],
    }


def run(args: argparse.Namespace, config: Config) -> int:
    sb = None  # construct lazily only if push needed

    # 1. Parse + scrape
    log.step(f"create-utensil · {args.url}")
    info = amazon.fetch_product(args.url)
    log.ok(f"scraped: {info.title} (asin={info.asin}, market={info.marketplace})")

    # 2. Resolve id
    utensil_id = args.id or slugify(info.title)
    log.info(f"utensil id: {utensil_id}")

    # 3. Collision check
    bundle_dir = files.utensil_bundles_root(config.repo_root) / utensil_id
    bundle_path = files.utensil_bundle_path(config.repo_root, utensil_id)
    if bundle_path.exists() and not args.force:
        log.error(
            f'Utensil id "{utensil_id}" already exists at {bundle_path}.\n'
            f'  Either re-run with --id <different-slug>, or pass --force to overwrite.'
        )
        return 1
    if not args.no_db:
        sb = sb_client.service_client(config)  # noqa: F841 — used below
        existing = sb.table("utensils").select("id").eq("id", utensil_id).execute().data or []
        if existing and not args.force:
            log.error(
                f'Utensil id "{utensil_id}" already exists in DB.\n'
                f'  Either re-run with --id <different-slug>, or pass --force to overwrite.'
            )
            return 1

    bundle_dir.mkdir(parents=True, exist_ok=True)

    # 4. Image flow
    photo_rel: Optional[str] = None
    if not args.no_image and info.image_urls:
        candidates_dir = bundle_dir / "_candidates"
        candidates_dir.mkdir(exist_ok=True)
        candidate_paths: list[Path] = []
        for i, url in enumerate(info.image_urls, start=1):
            target = candidates_dir / f"img-{i}.jpg"
            try:
                _download_candidate(url, target)
                candidate_paths.append(target)
            except amazon.AmazonError as e:
                log.warn(f"skip candidate {i}: {e}")
        if not candidate_paths:
            log.warn("no usable image candidates downloaded")
        else:
            preview = candidates_dir / "preview.html"
            _write_preview_html(preview, candidate_paths)
            chosen = _choose_candidate(
                candidate_paths,
                image_index=args.image_index,
                open_preview=True,
                preview_html=preview,
            )
            if chosen is not None:
                final = bundle_dir / f"{utensil_id}.jpg"
                shutil.copyfile(chosen, final)
                photo_rel = f"assets/utensils/{utensil_id}/{utensil_id}.jpg"
            shutil.rmtree(candidates_dir, ignore_errors=True)
    elif args.no_image:
        log.info("skipping image download (--no-image)")

    # 5. Compose + write bundle
    now = datetime.now(timezone.utc)
    bundle = _compose_bundle(info=info, utensil_id=utensil_id, photo_path=photo_rel, now=now)
    bundle_path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
    log.ok(f"wrote {bundle_path.relative_to(config.repo_root)}")

    # 6. Optional DB push
    if not args.no_db:
        utensils_ops.push_bundles(config, only=[utensil_id])
        log.ok(f"pushed to DB: {utensil_id}")

    log.info(f"Edit at admin/utensil.html?id={utensil_id} to refine.")
    return 0


# Late import so the helper module above doesn't trigger circular imports.
from ..clients import sb as sb_client  # noqa: E402
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
uv --project automation run pytest automation/tests/test_create_utensil_compose.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add automation/mfc/commands/create_utensil.py automation/tests/test_create_utensil_compose.py
git commit -m "feat(create-utensil): compose bundle + orchestrator end-to-end"
```

---

## Task 12: CLI registration + Makefile

**Files:**
- Modify: `automation/mfc/commands/create_utensil.py` — implement `register`
- Modify: `automation/mfc/cli.py` — add to imports + COMMAND_MODULES
- Modify: `Makefile`

- [ ] **Step 1: Implement `register` in create_utensil.py**

Replace the `register(...)` placeholder body in `automation/mfc/commands/create_utensil.py` with:

```python
def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "create-utensil",
        help="Create a utensil bundle (and DB row) from an Amazon product URL",
    )
    p.add_argument("url", help="Amazon product URL or bare 10-char ASIN")
    p.add_argument("--id", default=None, help="Override the auto-slug; must be unique")
    p.add_argument("--no-db", action="store_true", help="Write bundle locally; skip DB push")
    p.add_argument("--no-image", action="store_true", help="Skip image candidate download")
    p.add_argument("--image-index", type=int, default=None,
                   help="Pre-pick the Nth image (1-indexed); 0 = skip image entirely")
    p.add_argument("--force", action="store_true",
                   help="Overwrite an existing bundle dir / DB row")
    p.set_defaults(handler=run)
```

- [ ] **Step 2: Register in cli.py**

Edit `automation/mfc/cli.py`. Update the imports block to add `create_utensil`:

```python
from .commands import (
    apply_schema,
    create_utensil,
    drop_schema,
    list_users,
    reset,
    seed_metrics,
    set_role,
    status,
    sync_images,
    sync_recipes,
    sync_utensils,
)
```

Update `COMMAND_MODULES` to slot `create_utensil` immediately after `sync_utensils`:

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    sync_recipes,
    sync_images,
    sync_utensils,
    create_utensil,
    set_role,
    drop_schema,
    reset,
]
```

- [ ] **Step 3: Smoke-check the CLI**

```bash
uv --project automation run mfc create-utensil --help
```

Expected: prints help text with the URL positional and the five flags.

- [ ] **Step 4: Add Makefile targets**

Edit `Makefile`. In the `.PHONY: help sync status apply-schema ...` line near the top, append `sync-utensils create-utensil` to the list. Then, immediately after the existing `sync-images` target block, insert:

```make
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

- [ ] **Step 5: Smoke-check make targets**

```bash
make help | grep -E "create-utensil|sync-utensils"
```

Expected: both targets visible with their `## ...` blurbs.

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/commands/create_utensil.py automation/mfc/cli.py Makefile
git commit -m "feat(cli): register create-utensil + Makefile targets"
```

---

## Task 13: Admin UI placeholder hint

**Files:**
- Modify: `web/assets/js/app/admin-utensil-app.jsx` (line 187)

- [ ] **Step 1: Update the photo input hint**

Open `web/assets/js/app/admin-utensil-app.jsx`. Find:

```jsx
<Field label="Photo" hint="Path under data/utensil-photos/.">
  <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="data/utensil-photos/kadhai.jpg" />
</Field>
```

Replace with:

```jsx
<Field label="Photo" hint="Path under assets/utensils/<id>/. Set by `mfc create-utensil`.">
  <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="assets/utensils/kadhai/kadhai.jpg" />
</Field>
```

- [ ] **Step 2: Verify it loads**

Open the admin utensil page in a browser:

```bash
make serve &
sleep 2
open "http://localhost:8080/admin/utensil.html?new=1"
```

(If port 8080 is in use, follow the `kill -9 $(lsof -t -i :8080)` recipe in CLAUDE.md.)

Expected: the form renders, Photo field shows the new placeholder. No JS console errors. Stop the server (`kill %1` or `kill -9 $(lsof -t -i :8080)`).

- [ ] **Step 3: Commit**

```bash
git add web/assets/js/app/admin-utensil-app.jsx
git commit -m "ui(admin-utensil): update Photo placeholder for new path convention"
```

---

## Task 14: Live smoke test (manual verification)

**Files:** none — this task is a verification ritual using a real Amazon URL on a throwaway slug.

- [ ] **Step 1: Pick a low-stakes test URL**

Use any current Amazon listing for a kitchen item that you don't already have in the library. Capture it as a shell variable so the rest of this task is copy-pasteable:

```bash
export TEST_URL='https://www.amazon.com/dp/B0D9YF1XJ8'  # replace with a real URL
export TEST_ID='smoke-test-utensil'
```

- [ ] **Step 2: Dry run — bundle + image only, no DB**

```bash
make create-utensil URL="$TEST_URL" ID="$TEST_ID" NO_DB=1
```

Expected:
- A browser opens showing the candidate-image preview grid.
- Terminal prompts `Pick image [1-N, 0 to skip]:`. Type the number for the cleanest hero image and press enter.
- `web/assets/utensils/$TEST_ID/utensil.json` and `web/assets/utensils/$TEST_ID/$TEST_ID.jpg` exist.
- `_candidates/` is gone.
- Exit code 0.

Inspect the JSON:

```bash
cat "web/assets/utensils/$TEST_ID/utensil.json"
```

Verify the structure matches the spec (Section "Bundle format").

- [ ] **Step 3: Hand-edit a field, push to DB**

```bash
# Edit tagline by hand — e.g. add "test fixture, safe to delete"
$EDITOR "web/assets/utensils/$TEST_ID/utensil.json"

make sync-utensils DIRECTION=push
```

Expected: `↑ 1 pushed` in the report. No failures.

Verify the row landed:

```bash
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.clients import sb
import os
client = sb.service_client(Config.load())
row = client.table('utensils').select('id, name, amazon_asin, tagline, photo').eq('id', os.environ['TEST_ID']).single().execute().data
bl  = client.table('utensil_buy_links').select('*').eq('utensil_id', os.environ['TEST_ID']).execute().data
print(row); print(bl)
"
```

Expected: row has `name`, `amazon_asin`, edited `tagline`, and one buy_link with `tag=mfc-20` in the URL.

- [ ] **Step 4: Round-trip via pull**

```bash
# Edit a different field via admin UI
make serve &
sleep 2
open "http://localhost:8080/admin/utensil.html?id=$TEST_ID"
```

Edit `care_tip` in the form, click publish. Then:

```bash
kill -9 $(lsof -t -i :8080) 2>/dev/null
make sync-utensils DIRECTION=pull
cat "web/assets/utensils/$TEST_ID/utensil.json" | grep care_tip
```

Expected: the `care_tip` field reflects the edit you made in the UI.

- [ ] **Step 5: Cleanup**

```bash
# Delete the test row from DB
uv --project automation run python -c "
from mfc.core.config import Config
from mfc.clients import sb
import os
client = sb.service_client(Config.load())
client.table('utensil_buy_links').delete().eq('utensil_id', os.environ['TEST_ID']).execute()
client.table('utensils').delete().eq('id', os.environ['TEST_ID']).execute()
print('deleted')
"

# Remove the local bundle
rm -rf "web/assets/utensils/$TEST_ID"
```

- [ ] **Step 6: Commit (if any incidental fixes were made during smoke testing)**

If the smoke test surfaced bugs and you fixed them, commit those fixes with descriptive messages. Otherwise, no commit needed for this task.

```bash
git status   # confirm clean working tree
```

Expected: `nothing to commit, working tree clean`.

---

## Self-Review

**Spec coverage:**
- ✅ `mfc create-utensil <url>` — Tasks 9–12.
- ✅ `mfc sync-utensils` — Tasks 6, 7, 8.
- ✅ `ops/amazon.py` w/ `ProductInfo` + PA-API stub — Tasks 3, 4.
- ✅ `ops/utensils.py` push/pull/sync — Tasks 6, 7.
- ✅ Schema columns + COMMENT — Task 2.
- ✅ Per-utensil JSON bundle format — Tasks 5, 11.
- ✅ Multi-image candidate flow + interactive selection — Task 10.
- ✅ Strict slug uniqueness w/ `--force` — Task 11.
- ✅ Affiliate-tag rewrite to `mfc-20` — Task 9.
- ✅ Bot-wall + 404 handling — Task 4.
- ✅ Two-tier image extraction (`colorImages` → `og:image`) — Task 4.
- ✅ Marketplace stripped of `www.` — Task 3.
- ✅ Makefile targets — Task 12.
- ✅ Admin UI placeholder hint — Task 13.
- ✅ Live smoke test — Task 14.

**Type consistency check:**
- `ProductInfo` fields used identically in `ops/amazon.py` (defined Task 3, populated Task 4) and `commands/create_utensil.py` (consumed Tasks 10, 11).
- `_BUNDLE_FIELDS` / `_BUY_LINK_FIELDS` constants in `ops/utensils.py` align with bundle keys produced by `_compose_bundle` in `create_utensil`.
- `slugify`, `guess_category`, `canonical_amazon_url` signatures match between Task 9 tests and Task 11 caller.

**Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" placeholders remain. Every code-changing step shows the exact code to add.

**Spec-to-plan one gap:** The spec mentions `automation/tests/test_utensils_sync.py` (round-trip integration test). This plan exercises sync via Task 14 (live smoke) rather than a parallel mocked-supabase integration test, since `ops/recipes.py` doesn't have one either. The pure transforms are covered by `test_utensils_transforms.py`. Acceptable given the existing test-suite norms; if a strict integration test is wanted later, it's a one-PR follow-up.
