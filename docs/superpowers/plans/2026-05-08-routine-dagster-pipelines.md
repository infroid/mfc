# routine — local Dagster pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `mfc/routine/`, a sibling uv project running a local Dagster instance with five independent jobs (schema report, storage fetch, image OCR, PDF text extraction, recipe-sync runner).

**Architecture:** Single Dagster code location declared in `routine/definitions.py`. One `SupabaseResource` shared by jobs. Each job lives in its own file under `routine/jobs/`. Outputs land under `routine/artifacts/<run_id>/` (gitignored). Credentials live at the **repo root** `.env`; both `automation/` and `routine/` read from it.

**Tech Stack:** Python ≥ 3.10, uv, Dagster (`dagster`, `dagster-webserver`), `supabase-py`, `psycopg`, Jinja2, `pdfplumber`, `pdf2image`, `pytesseract`, Pillow. System deps: `tesseract`, `poppler` (brew). Spec: `docs/superpowers/specs/2026-05-08-routine-dagster-pipelines-design.md`.

**File map:**

```
.env                                        moved from automation/.env (local)
.env.sample                                 moved from automation/.env.sample
.gitignore                                  add /.env, /routine/artifacts/
Makefile                                    add routine / routine-sync / routine-test targets
automation/mfc/core/config.py               default env path → REPO_ROOT/.env
automation/README.md                        update setup snippet
routine/pyproject.toml                      uv-managed, dagster + supabase + jinja2 + ocr deps
routine/.python-version                     "3.11" (matches automation pin if present)
routine/README.md                           setup, run, "how to add a job"
routine/workspace.yaml                      points dagster at routine.definitions
routine/routine/__init__.py
routine/routine/definitions.py              Definitions(jobs=[…], resources={"supabase": …})
routine/routine/lib/__init__.py
routine/routine/lib/paths.py                repo_root(), artifact_dir(context)
routine/routine/lib/run_config.py           shared Pydantic Config classes (placeholder)
routine/routine/resources/__init__.py
routine/routine/resources/env.py            load_repo_root_env()
routine/routine/resources/supabase.py       SupabaseResource (client/admin_client/pg)
routine/routine/jobs/__init__.py
routine/routine/jobs/storage_fetch.py
routine/routine/jobs/ocr_image.py
routine/routine/jobs/pdf_text.py
routine/routine/jobs/recipe_sync.py
routine/routine/jobs/schema_report.py
routine/routine/templates/schema_report.html.j2
routine/tests/conftest.py
routine/tests/test_paths.py
routine/tests/test_storage_fetch.py
routine/tests/test_ocr_image.py
routine/tests/test_pdf_text.py
routine/tests/test_recipe_sync.py
routine/tests/test_schema_report.py
routine/tests/fixtures/text.pdf             tiny one-page text PDF
routine/tests/fixtures/scanned.pdf          tiny one-page image-only PDF
routine/tests/fixtures/sample.png           tiny image (mocked tesseract path)
```

---

## Task 1: Migrate `.env` from `automation/` to repo root

**Files:**
- Move: `automation/.env.sample` → `.env.sample`
- Modify: `automation/mfc/core/config.py:46`
- Modify: `automation/README.md` (setup snippet)
- Modify: `.gitignore`

- [ ] **Step 1: Move `.env.sample` to repo root**

```bash
git mv automation/.env.sample .env.sample
```

If a local `automation/.env` exists, copy it manually (it's gitignored, not tracked):

```bash
[ -f automation/.env ] && cp automation/.env .env || true
```

- [ ] **Step 2: Patch the config loader to default to the repo-root `.env`**

In `automation/mfc/core/config.py`, replace the line that resolves `path`:

```python
        # Default: <repo-root>/.env (shared with routine/).
        path = Path(env_file) if env_file else (REPO_ROOT / ".env")
```

(The `REPO_ROOT` constant on line 26 already points at the right place.)

- [ ] **Step 3: Update `.gitignore`**

Add at the top of `.gitignore`:

```
/.env
/routine/artifacts/
```

(Leave any existing `automation/.env` ignore in place — harmless if the file no longer exists there.)

- [ ] **Step 4: Update `automation/README.md` setup snippet**

Replace the `cp automation/.env.sample automation/.env` lines with:

```bash
cp .env.sample .env
$EDITOR .env
```

- [ ] **Step 5: Smoke-test that `automation` still works**

Run:

```bash
make status
```

Expected: lists Supabase tables. (If `make status` is not green, env loading is broken — debug before continuing.)

- [ ] **Step 6: Commit**

```bash
git add .env.sample .gitignore automation/mfc/core/config.py automation/README.md
git commit -m "refactor(env): move .env to repo root, shared by automation and routine"
```

---

## Task 2: Scaffold the `routine/` uv project

**Files:**
- Create: `routine/pyproject.toml`
- Create: `routine/.python-version`
- Create: `routine/README.md`
- Create: `routine/workspace.yaml`
- Create: `routine/routine/__init__.py`
- Create: `routine/routine/definitions.py`
- Create: `routine/routine/jobs/__init__.py`
- Create: `routine/routine/lib/__init__.py`
- Create: `routine/routine/resources/__init__.py`
- Create: `routine/routine/templates/.gitkeep`
- Create: `routine/tests/__init__.py`
- Modify: `Makefile`

- [ ] **Step 1: Create `routine/pyproject.toml`**

```toml
[project]
name = "routine"
version = "0.1.0"
description = "Local Dagster pipelines for MyFoodCraving"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
  "dagster>=1.8",
  "dagster-webserver>=1.8",
  "supabase>=2.0",
  "psycopg[binary]>=3.1",
  "python-dotenv>=1.0",
  "pydantic>=2.0",
  "jinja2>=3.1",
  "pdfplumber>=0.11",
  "pdf2image>=1.17",
  "pytesseract>=0.3",
  "Pillow>=10",
]

[dependency-groups]
dev = ["pytest>=8"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["routine"]

[tool.dagster]
module_name = "routine.definitions"
code_location_name = "routine"
```

- [ ] **Step 2: Pin Python**

```bash
echo "3.11" > routine/.python-version
```

- [ ] **Step 3: Create `routine/workspace.yaml`**

```yaml
load_from:
  - python_module:
      module_name: routine.definitions
      location_name: routine
```

- [ ] **Step 4: Create empty `__init__.py` and template placeholder**

```bash
mkdir -p routine/routine/jobs routine/routine/lib routine/routine/resources routine/routine/templates routine/tests
touch routine/routine/__init__.py routine/routine/jobs/__init__.py \
      routine/routine/lib/__init__.py routine/routine/resources/__init__.py \
      routine/routine/templates/.gitkeep routine/tests/__init__.py
```

- [ ] **Step 5: Create `routine/routine/definitions.py` (empty job list, no resources yet)**

```python
"""Dagster code location for the routine project. Loaded by workspace.yaml."""

from __future__ import annotations

from dagster import Definitions

defs = Definitions(jobs=[], resources={})
```

- [ ] **Step 6: Create `routine/README.md`**

```markdown
# routine — local Dagster pipelines

Sibling to `automation/`. Hosts five Dagster jobs run from a local
`dagster dev` UI. Outputs land under `routine/artifacts/<run_id>/`
(gitignored).

## Setup (once)

```bash
brew install uv tesseract poppler

# from the repo root, copy the env template if you haven't already
cp .env.sample .env
$EDITOR .env

make routine-sync
```

## Run

```bash
make routine        # launches dagster dev on http://localhost:3000
make routine-test   # pytest
```

## Layout

```
routine/
  pyproject.toml
  workspace.yaml
  routine/
    definitions.py        # Dagster code location
    resources/            # SupabaseResource, env loader
    jobs/                 # one file per job
    lib/                  # tiny shared helpers (paths, run config)
    templates/            # Jinja2 templates
  artifacts/              # gitignored output root
  tests/
```

## How to add a job

1. Copy an existing file under `routine/routine/jobs/<name>.py`.
2. Define your op(s) and wire a `@job`.
3. Append the new job to the `jobs=[…]` list in `routine/routine/definitions.py`.
4. (Optional) Add a Make target if it should have a one-shot launcher.
```

- [ ] **Step 7: Add Make targets**

Append to `Makefile`:

```makefile
.PHONY: routine routine-sync routine-test

routine: ## launch the routine dagster UI on :3000
	uv --project routine run dagster dev

routine-sync: ## sync the routine python venv (after editing routine/pyproject.toml)
	uv --project routine sync

routine-test: ## run the routine pytest suite
	uv --project routine run pytest
```

- [ ] **Step 8: Sync the venv**

```bash
make routine-sync
```

Expected: uv resolves the lockfile, installs dagster + deps. (First run may take a minute.)

- [ ] **Step 9: Smoke-test the empty Dagster code location**

```bash
uv --project routine run dagster definitions list-locations -w routine/workspace.yaml
```

Expected: `routine` listed with 0 jobs. (Or just run `make routine`, confirm UI loads at http://localhost:3000, ctrl-C.)

- [ ] **Step 10: Commit**

```bash
git add routine Makefile
git commit -m "feat(routine): scaffold uv project with empty dagster code location"
```

---

## Task 3: `lib/paths.py` and `resources/env.py` with tests

**Files:**
- Create: `routine/routine/lib/paths.py`
- Create: `routine/routine/resources/env.py`
- Create: `routine/tests/conftest.py`
- Create: `routine/tests/test_paths.py`

- [ ] **Step 1: Write the failing test for `repo_root()` and `artifact_dir()`**

Create `routine/tests/test_paths.py`:

```python
from pathlib import Path

from dagster import build_op_context

from routine.lib.paths import artifact_dir, repo_root


def test_repo_root_points_at_mfc_repo():
    root = repo_root()
    assert (root / ".gitignore").exists()
    assert (root / "automation").is_dir()
    assert (root / "routine").is_dir()


def test_artifact_dir_creates_run_scoped_directory():
    ctx = build_op_context()
    out = artifact_dir(ctx)
    assert out.is_dir()
    assert out.parent.name == "artifacts"
    # run_id (or "EPHEMERAL" under build_op_context) is the leaf
    assert out.name == ctx.run_id
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
make routine-test
```

Expected: ImportError (module not found).

- [ ] **Step 3: Implement `routine/routine/lib/paths.py`**

```python
"""Filesystem path helpers for routine jobs."""

from __future__ import annotations

from functools import cache
from pathlib import Path


@cache
def repo_root() -> Path:
    """Return the mfc repo root.

    Resolved from this file's location: routine/routine/lib/paths.py
    parents[0] = lib/, [1] = routine package, [2] = routine project, [3] = repo root.
    """
    return Path(__file__).resolve().parents[3]


def artifact_dir(context) -> Path:
    """Return (and create) routine/artifacts/<run_id>/ for the current run."""
    out = repo_root() / "routine" / "artifacts" / context.run_id
    out.mkdir(parents=True, exist_ok=True)
    return out
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
make routine-test
```

Expected: PASS, both tests green.

- [ ] **Step 5: Implement `routine/routine/resources/env.py`**

```python
"""Loads the repo-root .env so resources see SUPABASE_* env vars."""

from __future__ import annotations

from dotenv import load_dotenv

from ..lib.paths import repo_root


def load_repo_root_env() -> None:
    """Idempotent: load <repo-root>/.env without overriding existing env vars."""
    load_dotenv(repo_root() / ".env", override=False)
```

- [ ] **Step 6: Wire the env loader into `definitions.py`**

Replace the contents of `routine/routine/definitions.py`:

```python
"""Dagster code location for the routine project. Loaded by workspace.yaml."""

from __future__ import annotations

from dagster import Definitions

from .resources.env import load_repo_root_env

load_repo_root_env()

defs = Definitions(jobs=[], resources={})
```

- [ ] **Step 7: Commit**

```bash
git add routine/routine/lib/paths.py routine/routine/resources/env.py \
        routine/routine/definitions.py routine/tests/test_paths.py routine/tests/conftest.py
git commit -m "feat(routine): repo_root + artifact_dir helpers, repo-root .env loader"
```

(Note: `conftest.py` is empty for now — created so pytest discovers `tests/` as a package.)

---

## Task 4: `SupabaseResource` (no test, exercised via job tests)

**Files:**
- Create: `routine/routine/resources/supabase.py`

- [ ] **Step 1: Implement `SupabaseResource`**

```python
"""Supabase resource: publishable client, secret client, raw psycopg connection."""

from __future__ import annotations

import psycopg
from dagster import ConfigurableResource
from supabase import Client, create_client


class SupabaseResource(ConfigurableResource):
    """Reads SUPABASE_* env vars at construction time."""

    url: str
    publishable_key: str
    secret_key: str
    db_url: str

    def client(self) -> Client:
        """RLS-respecting client (publishable key)."""
        return create_client(self.url, self.publishable_key)

    def admin_client(self) -> Client:
        """RLS-bypass client (secret key)."""
        return create_client(self.url, self.secret_key)

    def pg(self) -> psycopg.Connection:
        """Raw psycopg connection — caller is responsible for closing."""
        return psycopg.connect(self.db_url)
```

- [ ] **Step 2: Wire the resource into `definitions.py`**

Replace `routine/routine/definitions.py`:

```python
"""Dagster code location for the routine project. Loaded by workspace.yaml."""

from __future__ import annotations

from dagster import Definitions, EnvVar

from .resources.env import load_repo_root_env
from .resources.supabase import SupabaseResource

load_repo_root_env()

defs = Definitions(
    jobs=[],
    resources={
        "supabase": SupabaseResource(
            url=EnvVar("SUPABASE_URL"),
            publishable_key=EnvVar("SUPABASE_PUBLISHABLE_KEY"),
            secret_key=EnvVar("SUPABASE_SECRET_KEY"),
            db_url=EnvVar("SUPABASE_DB_URL"),
        ),
    },
)
```

- [ ] **Step 3: Verify the code location still loads**

```bash
uv --project routine run dagster definitions list-locations -w routine/workspace.yaml
```

Expected: `routine` listed, no errors.

- [ ] **Step 4: Commit**

```bash
git add routine/routine/resources/supabase.py routine/routine/definitions.py
git commit -m "feat(routine): SupabaseResource with publishable/admin/pg accessors"
```

---

## Task 5: `storage_fetch` job (TDD)

**Files:**
- Create: `routine/routine/jobs/storage_fetch.py`
- Create: `routine/tests/test_storage_fetch.py`

- [ ] **Step 1: Write the failing test**

Create `routine/tests/test_storage_fetch.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest
from dagster import build_op_context

from routine.jobs.storage_fetch import DownloadConfig, download
from routine.resources.supabase import SupabaseResource


class _FakeBucket:
    def __init__(self, blob: bytes) -> None:
        self.blob = blob
        self.last_path: str | None = None

    def download(self, path: str) -> bytes:
        self.last_path = path
        return self.blob


class _FakeStorage:
    def __init__(self, bucket: _FakeBucket) -> None:
        self._bucket = bucket
        self.last_bucket: str | None = None

    def from_(self, bucket: str) -> _FakeBucket:
        self.last_bucket = bucket
        return self._bucket


class _FakeClient:
    def __init__(self, blob: bytes) -> None:
        self.bucket = _FakeBucket(blob)
        self.storage = _FakeStorage(self.bucket)


class _FakeSupabase(SupabaseResource):
    blob: bytes = b"hello"

    def client(self):  # type: ignore[override]
        return _FakeClient(self.blob)


def _resource() -> _FakeSupabase:
    return _FakeSupabase(
        url="x", publishable_key="x", secret_key="x", db_url="x", blob=b"hello",
    )


def test_download_writes_blob_to_artifact_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context(resources={"supabase": _resource()})
    out = download(ctx, DownloadConfig(bucket="recipe-images", object_path="x/y.bin"))
    assert Path(out).read_bytes() == b"hello"
    assert Path(out).name == "y.bin"


def test_download_refuses_to_overwrite(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context(resources={"supabase": _resource()})
    download(ctx, DownloadConfig(bucket="b", object_path="x/y.bin"))
    with pytest.raises(FileExistsError):
        download(ctx, DownloadConfig(bucket="b", object_path="x/y.bin"))
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
make routine-test
```

Expected: ImportError (`routine.jobs.storage_fetch` not found).

- [ ] **Step 3: Implement the job**

Create `routine/routine/jobs/storage_fetch.py`:

```python
"""Download a single object from Supabase Storage to artifacts/<run_id>/."""

from __future__ import annotations

from pathlib import PurePosixPath

from dagster import Config, OpExecutionContext, job, op

from ..lib.paths import artifact_dir
from ..resources.supabase import SupabaseResource


class DownloadConfig(Config):
    bucket: str = "recipe-images"
    object_path: str


@op
def download(context: OpExecutionContext, config: DownloadConfig, supabase: SupabaseResource) -> str:
    name = PurePosixPath(config.object_path).name
    dest = artifact_dir(context) / name
    if dest.exists():
        raise FileExistsError(f"refusing to overwrite {dest}")
    blob = supabase.client().storage.from_(config.bucket).download(config.object_path)
    dest.write_bytes(blob)
    context.log.info(f"wrote {len(blob)} bytes to {dest}")
    return str(dest)


@job
def storage_fetch_job() -> None:
    download()
```

Wait — Dagster requires resources to be passed via `required_resource_keys` or as a typed parameter. The op signature above uses `supabase: SupabaseResource` which Dagster recognises as a Pythonic resource (1.5+). Confirm by running the test.

- [ ] **Step 4: Run the test and verify it passes**

```bash
make routine-test -- tests/test_storage_fetch.py
```

(or just `make routine-test`)

Expected: both storage_fetch tests pass.

- [ ] **Step 5: Register the job in `definitions.py`**

In `routine/routine/definitions.py`, change `jobs=[]` to:

```python
from .jobs.storage_fetch import storage_fetch_job

# ...
    jobs=[storage_fetch_job],
```

(Add the import near the existing imports.)

- [ ] **Step 6: Verify the code location loads with the job**

```bash
uv --project routine run dagster definitions list -w routine/workspace.yaml
```

Expected: `storage_fetch_job` appears.

- [ ] **Step 7: Commit**

```bash
git add routine/routine/jobs/storage_fetch.py routine/routine/definitions.py \
        routine/tests/test_storage_fetch.py
git commit -m "feat(routine): storage_fetch job — download a Supabase Storage object"
```

---

## Task 6: `ocr_image` job (TDD)

**Files:**
- Create: `routine/routine/jobs/ocr_image.py`
- Create: `routine/tests/test_ocr_image.py`

- [ ] **Step 1: Write the failing test**

Create `routine/tests/test_ocr_image.py`:

```python
from __future__ import annotations

from pathlib import Path

from dagster import build_op_context

from routine.jobs.ocr_image import OcrConfig, extract


def test_extract_writes_text_next_to_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    monkeypatch.setattr("pytesseract.image_to_string", lambda _img: "HEMOGLOBIN 14.2")
    img = tmp_path / "report.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")  # not actually opened — pytesseract is mocked

    # Pillow's Image.open is called before pytesseract; mock it too.
    class _FakeImg: ...
    monkeypatch.setattr("PIL.Image.open", lambda _p: _FakeImg())

    ctx = build_op_context()
    text = extract(ctx, OcrConfig(image_path=str(img)))
    assert text == "HEMOGLOBIN 14.2"
    out = Path(tmp_path) / "routine" / "artifacts" / ctx.run_id / "report.txt"
    assert out.read_text() == "HEMOGLOBIN 14.2"
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
make routine-test
```

Expected: ImportError.

- [ ] **Step 3: Implement the job**

Create `routine/routine/jobs/ocr_image.py`:

```python
"""Extract text from an image using Tesseract (system: brew install tesseract)."""

from __future__ import annotations

from pathlib import Path

import pytesseract
from dagster import Config, OpExecutionContext, job, op
from PIL import Image

from ..lib.paths import artifact_dir


class OcrConfig(Config):
    image_path: str


@op
def extract(context: OpExecutionContext, config: OcrConfig) -> str:
    src = Path(config.image_path)
    if not src.exists():
        raise FileNotFoundError(src)
    text = pytesseract.image_to_string(Image.open(src))
    dest = artifact_dir(context) / (src.stem + ".txt")
    dest.write_text(text)
    context.log.info(f"OCR wrote {len(text)} chars to {dest}")
    return text


@job
def ocr_image_job() -> None:
    extract()
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
make routine-test
```

Expected: PASS.

- [ ] **Step 5: Register the job**

In `routine/routine/definitions.py`, import and add `ocr_image_job` to the `jobs=[…]` list.

- [ ] **Step 6: Commit**

```bash
git add routine/routine/jobs/ocr_image.py routine/routine/definitions.py \
        routine/tests/test_ocr_image.py
git commit -m "feat(routine): ocr_image job — Tesseract extract for blood-test images"
```

---

## Task 7: `pdf_text` job with direct + OCR-fallback paths (TDD)

**Files:**
- Create: `routine/routine/jobs/pdf_text.py`
- Create: `routine/tests/test_pdf_text.py`
- Create: `routine/tests/fixtures/text.pdf` (small one-page text PDF, generated)
- Create: `routine/tests/fixtures/scanned.pdf` (small one-page image-only PDF, generated)

- [ ] **Step 1: Generate fixture PDFs**

Run this one-shot script (don't commit the script — just the resulting PDFs):

```bash
mkdir -p routine/tests/fixtures
uv --project routine run python -c "
from PIL import Image
from pdf2image import convert_from_bytes
import io

# text.pdf: pdfplumber extracts 'BLOOD TEST DEMO TEXT'
import reportlab.pdfgen.canvas as c, reportlab.lib.pagesizes as ps
buf = io.BytesIO()
canvas = c.Canvas(buf, pagesize=ps.letter)
canvas.drawString(100, 750, 'BLOOD TEST DEMO TEXT')
canvas.save()
open('routine/tests/fixtures/text.pdf','wb').write(buf.getvalue())

# scanned.pdf: a 1x1 black PNG embedded as the page (pdfplumber returns empty)
img = Image.new('RGB', (50, 50), 'white')
img.save('routine/tests/fixtures/scanned.pdf', 'PDF')
"
```

If `reportlab` isn't installed, add it as a dev dep temporarily or hand-craft `text.pdf` with `pdfplumber`-compatible content via another tool. Verify:

```bash
uv --project routine run python -c "
import pdfplumber
with pdfplumber.open('routine/tests/fixtures/text.pdf') as p:
    print(repr(p.pages[0].extract_text()))
with pdfplumber.open('routine/tests/fixtures/scanned.pdf') as p:
    print(repr(p.pages[0].extract_text()))
"
```

Expected: first prints something containing `BLOOD TEST DEMO TEXT`; second prints `None` or empty string.

- [ ] **Step 2: Write the failing test**

Create `routine/tests/test_pdf_text.py`:

```python
from __future__ import annotations

from pathlib import Path

from dagster import build_op_context

from routine.jobs.pdf_text import PdfConfig, extract

FIXTURES = Path(__file__).parent / "fixtures"


def test_extract_uses_direct_path_when_text_present(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context()
    text = extract(ctx, PdfConfig(pdf_path=str(FIXTURES / "text.pdf")))
    assert "BLOOD TEST DEMO TEXT" in text
    out = tmp_path / "routine" / "artifacts" / ctx.run_id / "text.txt"
    assert "BLOOD TEST DEMO TEXT" in out.read_text()


def test_extract_falls_back_to_ocr_for_scanned(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    monkeypatch.setattr(
        "routine.jobs.pdf_text.convert_from_path",
        lambda _p: ["fake-image"],
    )
    monkeypatch.setattr(
        "routine.jobs.pdf_text.pytesseract.image_to_string",
        lambda _img: "OCR FALLBACK TEXT",
    )
    ctx = build_op_context()
    text = extract(ctx, PdfConfig(pdf_path=str(FIXTURES / "scanned.pdf")))
    assert text == "OCR FALLBACK TEXT"
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
make routine-test
```

Expected: ImportError.

- [ ] **Step 4: Implement the job**

Create `routine/routine/jobs/pdf_text.py`:

```python
"""Extract text from a PDF.

Strategy:
  1. pdfplumber direct extract; concat per-page text.
  2. If empty/whitespace, rasterize with pdf2image and OCR each page with Tesseract.
"""

from __future__ import annotations

from pathlib import Path

import pdfplumber
import pytesseract
from dagster import Config, OpExecutionContext, job, op
from pdf2image import convert_from_path

from ..lib.paths import artifact_dir


class PdfConfig(Config):
    pdf_path: str


def _direct_extract(path: Path) -> str:
    with pdfplumber.open(path) as pdf:
        chunks = [page.extract_text() or "" for page in pdf.pages]
    return "\n".join(chunks).strip()


def _ocr_extract(path: Path) -> str:
    pages = convert_from_path(str(path))
    return "\n".join(pytesseract.image_to_string(p) for p in pages).strip()


@op
def extract(context: OpExecutionContext, config: PdfConfig) -> str:
    src = Path(config.pdf_path)
    if not src.exists():
        raise FileNotFoundError(src)
    text = _direct_extract(src)
    if text:
        context.log.info("pdf_text: direct extraction succeeded")
    else:
        context.log.info("pdf_text: direct extraction empty, falling back to OCR")
        text = _ocr_extract(src)
    dest = artifact_dir(context) / (src.stem + ".txt")
    dest.write_text(text)
    return text


@job
def pdf_text_job() -> None:
    extract()
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
make routine-test
```

Expected: both `pdf_text` tests pass.

- [ ] **Step 6: Register the job**

Import and add `pdf_text_job` to the `jobs=[…]` list in `definitions.py`.

- [ ] **Step 7: Commit**

```bash
git add routine/routine/jobs/pdf_text.py routine/routine/definitions.py \
        routine/tests/test_pdf_text.py routine/tests/fixtures/
git commit -m "feat(routine): pdf_text job — direct extract with OCR fallback"
```

---

## Task 8: `recipe_sync` job (TDD, mocks subprocess)

**Files:**
- Create: `routine/routine/jobs/recipe_sync.py`
- Create: `routine/tests/test_recipe_sync.py`

- [ ] **Step 1: Write the failing test**

Create `routine/tests/test_recipe_sync.py`:

```python
from __future__ import annotations

import subprocess
from typing import Any

import pytest
from dagster import build_op_context

from routine.jobs.recipe_sync import SyncConfig, run_sync


def _capture(monkeypatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr("subprocess.run", fake_run)
    return captured


def test_run_sync_builds_expected_command(monkeypatch):
    captured = _capture(monkeypatch)
    ctx = build_op_context()
    run_sync(ctx, SyncConfig(direction="push"))
    cmd = captured["cmd"]
    assert cmd[:4] == ["uv", "--project"]
    assert cmd[-3:] == ["sync-recipes", "--direction", "push"]
    assert cmd[3].endswith("automation")


def test_run_sync_appends_recipe_filter(monkeypatch):
    captured = _capture(monkeypatch)
    ctx = build_op_context()
    run_sync(ctx, SyncConfig(direction="pull", only=["a", "b"]))
    cmd = captured["cmd"]
    assert cmd[-4:] == ["--recipe", "a", "--recipe", "b"]  # last filter wins as suffix


def test_run_sync_raises_on_nonzero_exit(monkeypatch):
    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="boom")

    monkeypatch.setattr("subprocess.run", fake_run)
    ctx = build_op_context()
    with pytest.raises(RuntimeError, match="boom"):
        run_sync(ctx, SyncConfig(direction="push"))
```

Note: the second test asserts the suffix is `["--recipe", "a", "--recipe", "b"]`. Implementation must append filters as the **last** elements of the command. Adjust the assertion to whatever ordering you implement, but be consistent.

- [ ] **Step 2: Run the tests and verify they fail**

```bash
make routine-test
```

Expected: ImportError.

- [ ] **Step 3: Implement the job**

Create `routine/routine/jobs/recipe_sync.py`:

```python
"""Run `mfc sync-recipes` from the automation/ project as a Dagster op."""

from __future__ import annotations

import subprocess
from typing import Literal

from dagster import Config, OpExecutionContext, job, op

from ..lib.paths import repo_root


class SyncConfig(Config):
    direction: Literal["pull", "push", "both"]
    only: list[str] = []


def _build_cmd(direction: str, only: list[str]) -> list[str]:
    cmd = [
        "uv",
        "--project",
        str(repo_root() / "automation"),
        "run",
        "mfc",
        "sync-recipes",
        "--direction",
        direction,
    ]
    for rid in only:
        cmd.extend(["--recipe", rid])
    return cmd


@op
def run_sync(context: OpExecutionContext, config: SyncConfig) -> str:
    cmd = _build_cmd(config.direction, config.only)
    context.log.info("running: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.stdout:
        context.log.info(proc.stdout)
    if proc.stderr:
        context.log.warning(proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError(
            f"recipe-sync failed (exit {proc.returncode}): {proc.stderr.strip() or 'no stderr'}"
        )
    return proc.stdout


@job
def recipe_sync_job() -> None:
    run_sync()
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
make routine-test
```

Expected: PASS. If the suffix-ordering test fails, fix the test assertion to match `_build_cmd`'s actual ordering.

- [ ] **Step 5: Register the job**

Import and add `recipe_sync_job` to the `jobs=[…]` list in `definitions.py`.

- [ ] **Step 6: Commit**

```bash
git add routine/routine/jobs/recipe_sync.py routine/routine/definitions.py \
        routine/tests/test_recipe_sync.py
git commit -m "feat(routine): recipe_sync job — shells out to mfc sync-recipes"
```

---

## Task 9: `schema_report` job — data collection (TDD)

**Files:**
- Create: `routine/routine/jobs/schema_report.py` (collect_schema only; render added in Task 10)
- Create: `routine/tests/test_schema_report.py`

- [ ] **Step 1: Write the failing test for `collect_schema`**

Create `routine/tests/test_schema_report.py`:

```python
from __future__ import annotations

from contextlib import contextmanager

from dagster import build_op_context

from routine.jobs.schema_report import (
    Column,
    ForeignKey,
    SchemaReport,
    Table,
    collect_schema,
)
from routine.resources.supabase import SupabaseResource


class _FakeCursor:
    def __init__(self, scripted: dict[str, list[tuple]]) -> None:
        self.scripted = scripted
        self._rows: list[tuple] = []

    def execute(self, sql, params=None):
        # Return a different row set per query keyword.
        for key, rows in self.scripted.items():
            if key in sql:
                self._rows = rows
                return
        self._rows = []

    def fetchall(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)


class _FakeConn:
    def __init__(self, scripted): self.scripted = scripted
    def cursor(self): return _FakeCursor(self.scripted)
    def close(self): pass
    def __enter__(self): return self
    def __exit__(self, *a): self.close()


class _FakeSupabase(SupabaseResource):
    scripted: dict = {}
    def pg(self):  # type: ignore[override]
        return _FakeConn(self.scripted)


def _resource(scripted):
    return _FakeSupabase(
        url="x", publishable_key="x", secret_key="x", db_url="x", scripted=scripted,
    )


def test_collect_schema_returns_structured_report():
    scripted = {
        "pg_class": [("recipes", "Recipe catalog")],
        "information_schema.columns": [
            ("recipes", "id", "uuid", "NO", None, "Primary key"),
            ("recipes", "title", "text", "NO", None, None),
        ],
        "table_constraints": [("recipes", "id")],          # PK
        "referential_constraints": [],                      # FKs (none)
        "pg_policies": [("recipes", "recipes_select", "SELECT", "true")],
        "count(*)": [(42,)],
    }
    ctx = build_op_context(resources={"supabase": _resource(scripted)})
    report = collect_schema(ctx)
    assert isinstance(report, SchemaReport)
    assert len(report.tables) == 1
    t = report.tables[0]
    assert isinstance(t, Table)
    assert t.name == "recipes"
    assert t.row_count == 42
    assert [c.name for c in t.columns] == ["id", "title"]
    assert t.primary_key == ["id"]
    assert t.foreign_keys == []
    assert any("SELECT" in p for p in t.policies)
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
make routine-test
```

Expected: ImportError.

- [ ] **Step 3: Implement `collect_schema` and the data model**

Create `routine/routine/jobs/schema_report.py`:

```python
"""Generate an HTML report of every public-schema table.

Two ops:
  - collect_schema: queries pg_catalog/information_schema/pg_policies via psycopg.
  - render_html:    renders templates/schema_report.html.j2 to artifacts/<run_id>/.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dagster import Config, OpExecutionContext, job, op
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel

from ..lib.paths import artifact_dir, repo_root
from ..resources.supabase import SupabaseResource


class Column(BaseModel):
    name: str
    type: str
    nullable: bool
    default: str | None
    comment: str | None


class ForeignKey(BaseModel):
    column: str
    references_table: str
    references_column: str


class AggregateStat(BaseModel):
    column: str
    kind: str  # "numeric_range" | "distinct_values"
    detail: dict[str, Any]


class Table(BaseModel):
    name: str
    comment: str | None
    columns: list[Column]
    primary_key: list[str]
    foreign_keys: list[ForeignKey]
    policies: list[str]
    row_count: int
    stats: list[AggregateStat] = []


class SchemaReport(BaseModel):
    generated_at: str
    tables: list[Table]


_TABLES_SQL = """
SELECT c.relname,
       obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
 ORDER BY c.relname;
"""

_COLUMNS_SQL = """
SELECT cols.table_name,
       cols.column_name,
       cols.data_type,
       cols.is_nullable,
       cols.column_default,
       col_description(format('public.%I', cols.table_name)::regclass, cols.ordinal_position)
  FROM information_schema.columns cols
 WHERE cols.table_schema = 'public'
 ORDER BY cols.table_name, cols.ordinal_position;
"""

_PK_SQL = """
SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
 WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
 ORDER BY tc.table_name, kcu.ordinal_position;
"""

_FK_SQL = """
SELECT tc.table_name, kcu.column_name,
       ccu.table_name AS ref_table, ccu.column_name AS ref_column
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = rc.unique_constraint_name
 WHERE tc.table_schema = 'public'
 ORDER BY tc.table_name, kcu.ordinal_position;
"""

_POLICIES_SQL = """
SELECT tablename, policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, policyname;
"""


@op
def collect_schema(context: OpExecutionContext, supabase: SupabaseResource) -> SchemaReport:
    with supabase.pg() as conn, conn.cursor() as cur:
        cur.execute(_TABLES_SQL)
        tables_raw = list(cur.fetchall())

        cur.execute(_COLUMNS_SQL)
        cols_by_table: dict[str, list[Column]] = {}
        for row in cur.fetchall():
            tname, cname, ctype, is_null, cdefault, ccomment = row
            cols_by_table.setdefault(tname, []).append(
                Column(name=cname, type=ctype, nullable=(is_null == "YES"),
                       default=cdefault, comment=ccomment)
            )

        cur.execute(_PK_SQL)
        pk_by_table: dict[str, list[str]] = {}
        for tname, cname in cur.fetchall():
            pk_by_table.setdefault(tname, []).append(cname)

        cur.execute(_FK_SQL)
        fk_by_table: dict[str, list[ForeignKey]] = {}
        for tname, col, ref_table, ref_col in cur.fetchall():
            fk_by_table.setdefault(tname, []).append(
                ForeignKey(column=col, references_table=ref_table, references_column=ref_col)
            )

        cur.execute(_POLICIES_SQL)
        pol_by_table: dict[str, list[str]] = {}
        for tname, pname, cmd, qual in cur.fetchall():
            pol_by_table.setdefault(tname, []).append(f"{pname} ({cmd}): {qual}")

        tables: list[Table] = []
        for tname, tcomment in tables_raw:
            cur.execute(f'SELECT count(*) FROM public."{tname}"')
            (rcount,) = cur.fetchone() or (0,)
            cols = cols_by_table.get(tname, [])
            stats = _collect_stats(cur, tname, cols)
            tables.append(Table(
                name=tname, comment=tcomment, columns=cols,
                primary_key=pk_by_table.get(tname, []),
                foreign_keys=fk_by_table.get(tname, []),
                policies=pol_by_table.get(tname, []),
                row_count=rcount, stats=stats,
            ))

    return SchemaReport(
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        tables=tables,
    )


_NUMERIC_TYPES = {"smallint", "integer", "bigint", "numeric", "real", "double precision"}


def _collect_stats(cur, table: str, columns: list[Column]) -> list[AggregateStat]:
    stats: list[AggregateStat] = []
    for col in columns:
        if col.type in _NUMERIC_TYPES:
            cur.execute(f'SELECT min("{col.name}"), max("{col.name}") FROM public."{table}"')
            mn, mx = cur.fetchone() or (None, None)
            stats.append(AggregateStat(
                column=col.name, kind="numeric_range",
                detail={"min": mn, "max": mx},
            ))
        elif col.type == "text":
            cur.execute(
                f'SELECT count(DISTINCT "{col.name}") FROM public."{table}"'
            )
            (n,) = cur.fetchone() or (0,)
            if n is not None and n <= 32:
                cur.execute(
                    f'SELECT "{col.name}", count(*) FROM public."{table}" '
                    f'GROUP BY 1 ORDER BY 2 DESC LIMIT 32'
                )
                stats.append(AggregateStat(
                    column=col.name, kind="distinct_values",
                    detail={"counts": list(cur.fetchall())},
                ))
    return stats
```

(Note: the test in Step 1 uses a coarse "any matching SQL keyword wins" mock. That's fine for verifying shape; the SQL itself is exercised manually against Supabase in Task 11.)

- [ ] **Step 4: Run the test and verify it passes**

```bash
make routine-test
```

Expected: PASS. If it fails because the fake cursor doesn't match a query keyword, adjust the keys in `scripted` to substrings actually present in the SQL constants.

- [ ] **Step 5: Commit**

```bash
git add routine/routine/jobs/schema_report.py routine/tests/test_schema_report.py
git commit -m "feat(routine): schema_report — collect_schema op + Pydantic models"
```

---

## Task 10: `schema_report` rendering — bare template + render op (TDD)

**Files:**
- Modify: `routine/routine/jobs/schema_report.py`
- Create: `routine/routine/templates/schema_report.html.j2` (functional, bare — Task 11 styles it)
- Modify: `routine/tests/test_schema_report.py`

- [ ] **Step 1: Append the failing render test**

Add to `routine/tests/test_schema_report.py`:

```python
from routine.jobs.schema_report import render_html


def _sample_report() -> SchemaReport:
    return SchemaReport(
        generated_at="2026-05-08T00:00:00+00:00",
        tables=[Table(
            name="recipes", comment="Recipe catalog",
            columns=[Column(name="id", type="uuid", nullable=False, default=None, comment="PK")],
            primary_key=["id"], foreign_keys=[], policies=[],
            row_count=42, stats=[],
        )],
    )


def test_render_html_writes_file_with_table_name(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context()
    out = render_html(ctx, _sample_report())
    body = open(out).read()
    assert "recipes" in body
    assert "Recipe catalog" in body
    assert "42" in body
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
make routine-test
```

Expected: ImportError on `render_html`.

- [ ] **Step 3: Add the bare template**

Create `routine/routine/templates/schema_report.html.j2`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Schema report — {{ report.generated_at }}</title>
</head>
<body>
  <h1>MyFoodCraving — Supabase schema report</h1>
  <p>Generated {{ report.generated_at }}</p>

  {% for table in report.tables %}
  <section>
    <h2>{{ table.name }}</h2>
    {% if table.comment %}<p>{{ table.comment }}</p>{% endif %}
    <p>{{ table.row_count }} rows</p>

    <h3>Columns</h3>
    <table>
      <thead><tr><th>name</th><th>type</th><th>nullable</th><th>default</th><th>comment</th></tr></thead>
      <tbody>
      {% for c in table.columns %}
        <tr>
          <td>{{ c.name }}</td><td>{{ c.type }}</td>
          <td>{{ "yes" if c.nullable else "no" }}</td>
          <td>{{ c.default or "" }}</td>
          <td>{{ c.comment or "" }}</td>
        </tr>
      {% endfor %}
      </tbody>
    </table>

    {% if table.primary_key %}<p><strong>PK:</strong> {{ table.primary_key | join(", ") }}</p>{% endif %}
    {% if table.foreign_keys %}
      <h3>Foreign keys</h3>
      <ul>
      {% for fk in table.foreign_keys %}
        <li>{{ fk.column }} → {{ fk.references_table }}.{{ fk.references_column }}</li>
      {% endfor %}
      </ul>
    {% endif %}
    {% if table.policies %}
      <h3>RLS policies</h3>
      <ul>{% for p in table.policies %}<li>{{ p }}</li>{% endfor %}</ul>
    {% endif %}
    {% if table.stats %}
      <h3>Stats</h3>
      <ul>{% for s in table.stats %}<li>{{ s.column }} · {{ s.kind }} · {{ s.detail }}</li>{% endfor %}</ul>
    {% endif %}
  </section>
  {% endfor %}
</body>
</html>
```

- [ ] **Step 4: Implement `render_html` and the wired job**

Append to `routine/routine/jobs/schema_report.py`:

```python
@op
def render_html(context: OpExecutionContext, report: SchemaReport) -> str:
    template_dir = Path(__file__).resolve().parent.parent / "templates"
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("schema_report.html.j2")
    body = template.render(report=report)
    dest = artifact_dir(context) / "schema_report.html"
    dest.write_text(body)
    context.log.info(f"wrote {dest}")
    return str(dest)


@job
def schema_report_job() -> None:
    render_html(collect_schema())
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
make routine-test
```

Expected: PASS.

- [ ] **Step 6: Register the job**

Import and add `schema_report_job` to the `jobs=[…]` list in `definitions.py`.

- [ ] **Step 7: Commit**

```bash
git add routine/routine/jobs/schema_report.py routine/routine/templates/schema_report.html.j2 \
        routine/routine/definitions.py routine/tests/test_schema_report.py
git commit -m "feat(routine): schema_report — render_html op + bare Jinja template"
```

---

## Task 11: Style the schema-report template using `frontend-design` and `mfc/design/`

**Files:**
- Modify: `routine/routine/templates/schema_report.html.j2`

- [ ] **Step 1: Skim `mfc/design/` to inventory the design system**

```bash
ls mfc/design/ mfc/design/styles 2>/dev/null
head -60 mfc/design/tokens.css
```

Note the colour tokens (`--orange`, `--matcha`, `--cream`, `--paper`, `--ink`) and font stacks (`--sans`, `--serif`, `--hand`, `--mono`).

- [ ] **Step 2: Invoke the `frontend-design` skill**

Use the Skill tool with `skill: "frontend-design:frontend-design"` and a prompt like:

> Restyle `routine/routine/templates/schema_report.html.j2` so it matches the MyFoodCraving look defined in `mfc/design/` (tokens.css and styles/). The template is a pure Jinja2 file rendered server-side — no JS, no external assets, all CSS inline in `<style>`. Sections to keep: report header (title + generated_at), one card per table containing name, comment, row count, columns table, PK, FKs, RLS policies, stats. Render must continue to satisfy the existing `test_render_html_writes_file_with_table_name` test (the strings "recipes", "Recipe catalog", and "42" appear in the body).

- [ ] **Step 3: Run the tests**

```bash
make routine-test
```

Expected: PASS (template render test still green).

- [ ] **Step 4: Visual smoke-test with a fixture render**

```bash
uv --project routine run python -c "
from routine.jobs.schema_report import render_html, SchemaReport, Table, Column
from dagster import build_op_context
ctx = build_op_context()
report = SchemaReport(generated_at='2026-05-08T00:00:00+00:00', tables=[
  Table(name='recipes', comment='Recipe catalog',
        columns=[Column(name='id', type='uuid', nullable=False, default=None, comment='PK'),
                 Column(name='title', type='text', nullable=False, default=None, comment=None)],
        primary_key=['id'], foreign_keys=[], policies=[], row_count=42, stats=[])])
print(render_html(ctx, report))
"
```

Open the printed path in a browser. Confirm it looks on-brand.

- [ ] **Step 5: Commit**

```bash
git add routine/routine/templates/schema_report.html.j2
git commit -m "style(routine): apply MyFoodCraving design tokens to schema report template"
```

---

## Task 12: End-to-end smoke test against the live Supabase

**Files:** none (manual verification + small fixes if anything breaks).

- [ ] **Step 1: Launch the Dagster UI**

```bash
make routine
```

Open http://localhost:3000.

- [ ] **Step 2: Confirm all five jobs are listed**

`storage_fetch_job`, `ocr_image_job`, `pdf_text_job`, `recipe_sync_job`, `schema_report_job`.

- [ ] **Step 3: Run `schema_report_job`**

Use **Launchpad → Launch run** (no config needed). Expected: succeeds, writes `routine/artifacts/<run_id>/schema_report.html`. Open the file in a browser.

- [ ] **Step 4: Run `storage_fetch_job` with a known image**

Run config:

```yaml
ops:
  download:
    config:
      bucket: recipe-images
      object_path: almond-burfi/hero.jpg
```

Expected: the JPG lands under `routine/artifacts/<run_id>/hero.jpg`.

- [ ] **Step 5: Chain into `ocr_image_job` (manual hand-off)**

Take the path from Step 4, plug it into `ocr_image_job`'s config:

```yaml
ops:
  extract:
    config:
      image_path: <absolute path printed in step 4 logs>
```

Expected: the run completes; `*.txt` is written under that run's `artifacts/<run_id>/`.

- [ ] **Step 6: Run `recipe_sync_job` with `direction: pull`**

```yaml
ops:
  run_sync:
    config:
      direction: pull
```

Expected: succeeds; logs show the same output you'd see from `make sync-recipes` choosing pull.

- [ ] **Step 7: If anything failed**

Fix in place, add a regression test if the failure mode is testable, commit:

```bash
git add <files>
git commit -m "fix(routine): <specific fix>"
```

- [ ] **Step 8: Done — push when ready**

```bash
git push origin master
```

---

## Self-review

**Spec coverage:**
- Layout (Tasks 2, 3) ✓
- Architecture: single code location + 5 independent jobs (Tasks 5–10) ✓
- `SupabaseResource` with publishable/admin/pg (Task 4) ✓
- Repo-root `.env` + automation migration (Task 1) ✓
- Jobs: storage_fetch (5), ocr_image (6), pdf_text (7), recipe_sync (8), schema_report (9, 10) ✓
- Resources `env.py` + `supabase.py` (Tasks 3, 4) ✓
- `lib/paths.py` + `lib/run_config.py` — `paths.py` covered (Task 3); `lib/run_config.py` is a placeholder, intentionally not created until needed (per spec: "may end up empty"). Skipped on YAGNI grounds.
- Run-config & artifacts under `<run_id>/` ✓
- Error handling (raise on failure, no retries, log fallback path in pdf_text) ✓
- Templates: bare template + frontend-design pass (Tasks 10, 11) ✓
- Credential migration touching `automation/` (Task 1) ✓
- Testing per-job ✓
- Make targets + README ✓
- Dependencies in pyproject.toml ✓
- End-to-end smoke (Task 12) ✓

**Placeholder scan:** No TBD/TODO. All test code is concrete. All commit messages are concrete.

**Type consistency:** `SupabaseResource.client/admin_client/pg` defined in Task 4, used as-is in Tasks 5 (storage_fetch) and 9 (schema_report). `Config` subclasses (`DownloadConfig`, `OcrConfig`, `PdfConfig`, `SyncConfig`) defined in their job files; tests import them from the same module. `SchemaReport`/`Table`/`Column`/`ForeignKey`/`AggregateStat` defined in Task 9, reused in Task 10 test. `artifact_dir(context)` and `repo_root()` defined in Task 3, used everywhere consistently. `_build_cmd` ordering in Task 8 is internal — test asserts on the actual ordering produced by the implementation, not a fixed external contract.

**Known minor risks:**
- Task 7's fixture-PDF generator depends on `reportlab`, which is not in `pyproject.toml`. Fix: install it as a one-off (`uv --project routine run pip install reportlab`) only to generate the fixtures, then remove. Or hand-craft the fixtures with another tool.
- Task 9's mocked-cursor test uses substring matching against SQL constants. If the real SQL is rewritten so the keywords change, the test won't match — flag for the implementer in the comment within `test_collect_schema_returns_structured_report`.

