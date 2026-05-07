# routine — local Dagster pipelines

Sibling Python project to `automation/`, managed by uv. Hosts five
independent Dagster jobs run from a local `dagster dev` UI.

## Goals

- Local-first orchestration of recurring/manual data tasks.
- Five jobs at launch: schema report, storage fetch, image OCR, PDF text
  extraction, recipe-sync runner.
- Simplicity > flexibility. Each job is self-contained in one file.
- Reuse `automation/` rather than reimplement (recipe-sync shells out).

## Non-goals

- Asset graphs, schedules, sensors, partitions, retries.
- Cloud deploy, CI execution of jobs.
- Generic OCR pipeline (image OCR is Tesseract-only; better backends are a later choice).

## Layout

```
routine/
  pyproject.toml
  README.md
  workspace.yaml
  routine/
    __init__.py
    definitions.py             # Definitions(jobs=[…], resources={…})
    resources/
      env.py                   # repo-root .env loader
      supabase.py              # SupabaseResource (publishable + secret + psycopg)
    jobs/
      schema_report.py
      storage_fetch.py
      ocr_image.py
      pdf_text.py
      recipe_sync.py
    lib/
      paths.py                 # artifact_dir(context), repo_root()
      run_config.py            # shared Pydantic Config classes (placeholder)
    templates/
      schema_report.html.j2    # rendered with frontend-design + design/ tokens
  artifacts/                   # gitignored output root, run_id-scoped subdirs
  tests/
    conftest.py
    test_schema_report.py
    test_storage_fetch.py
    test_ocr_image.py
    test_pdf_text.py
    test_recipe_sync.py
    fixtures/
      text.pdf
      scanned.pdf
```

## Architecture

- Single Dagster code location declared in `routine/definitions.py`.
- Five jobs, each in its own file under `jobs/`. Each file contains the
  job's ops (one or two) and the wired job. Deleting a job = deleting one
  file plus one line in `definitions.py`.
- One shared `SupabaseResource` exposes a publishable client (RLS-respecting),
  a secret client (RLS-bypass), and a `psycopg` connection.
- Repo-root `.env` is the single source of credentials. `automation/` is
  migrated to read from the same file as part of this work.
- Outputs land under `routine/artifacts/<run_id>/…`, gitignored.
- `dagster dev` (UI on `:3000`) is the primary entry point. No CLI-only path.

## Per-job designs

### `schema_report`

- `collect_schema(supabase)` — psycopg queries against the public schema:
  - tables (`pg_class` + `pg_description`)
  - columns (`information_schema.columns` + `pg_description`)
  - PKs/FKs (`information_schema.table_constraints` + `key_column_usage` + `referential_constraints`)
  - RLS policies (`pg_policies`)
  - row counts (`SELECT count(*)` per table)
  - aggregate stats: per-table, for each numeric column emit min/max; for
    each text column with `<= 32` distinct values emit the distinct list
    and counts.
  - Returns a `SchemaReport` Pydantic model.
- `render_html(report)` — renders `templates/schema_report.html.j2` with
  Jinja2, writes to `artifacts/<run_id>/schema_report.html`.
- Run-config: none.

### `storage_fetch`

- `download(supabase, bucket, object_path)` — uses
  `supabase.storage.from_(bucket).download(object_path)`, writes bytes to
  `artifacts/<run_id>/<basename(object_path)>`. Returns local path.
- Run-config: `bucket: str = "recipe-images"`, `object_path: str` (required).
- Refuses to overwrite an existing file in the same `run_id` dir.

### `ocr_image`

- `extract(image_path)` — `pytesseract.image_to_string(Image.open(path))`.
  Writes raw text to `artifacts/<run_id>/<basename>.txt`. Returns the text.
- Run-config: `image_path: str` (required, must exist).
- System dep: `tesseract` (brew). Documented in README.

### `pdf_text`

- `extract(pdf_path)`:
  1. Try `pdfplumber` direct extraction; concat per-page text.
  2. If concatenated text is empty/whitespace, fall back to
     `pdf2image.convert_from_path` + `pytesseract` per page.
  3. Write `artifacts/<run_id>/<basename>.txt`.
  4. Log which path was used at `context.log.info`.
- Run-config: `pdf_path: str` (required).
- System deps: `tesseract`, `poppler` (brew). Documented.

### `recipe_sync`

- `run_sync(direction, only)` — builds
  `["uv", "--project", str(repo_root() / "automation"), "run", "mfc",
  "sync-recipes", "--direction", direction]`, appends `--recipe <id>` per
  entry in `only`, runs via `subprocess.run(check=True,
  capture_output=True, text=True)`.
- Streams `stdout`/`stderr` to Dagster logs via `context.log.info` /
  `context.log.warning`.
- Non-zero exit → raise with command line + stderr.
- Run-config: `direction: Literal["push", "pull", "both"]` (required),
  `only: list[str] = []` (optional recipe-id filter, mirrors the CLI's
  `--recipe`).

## Resources

### `resources/env.py`

- `load_repo_root_env()` calls `dotenv.load_dotenv(repo_root() / ".env",
  override=False)` using `lib.paths.repo_root()`. Idempotent.
- Imported at the top of `definitions.py` so env is loaded before resource
  init.

### `resources/supabase.py`

- `SupabaseResource(ConfigurableResource)` with cached methods:
  - `client()` → `supabase.create_client(url, publishable_key)`
  - `admin_client()` → `supabase.create_client(url, secret_key)`
  - `pg()` → `psycopg.connect(MFC_DB_URL)`
- Reads `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` from env. Names match those
  already used by `automation/mfc/core/config.py`.

## Run-config & artifacts

- All run configs use Dagster's `Config` (Pydantic) for validation; bad
  inputs fail at launch.
- `lib/paths.artifact_dir(context)` → `routine/artifacts/<context.run_id>/`,
  created on first call.
- `lib/paths.repo_root()` → resolves the git repo root once.

## Error handling

- Ops raise on failure; the run-launcher captures the traceback in the UI.
- No try/except around library calls except `recipe_sync` (wraps
  `CalledProcessError` to add the resolved command line and stderr to the
  message).
- No retries, no backoff. Re-launch from the UI.
- `pdf_text` always logs the chosen extraction path so empty results are
  diagnosable from logs alone.

## Templates

- `templates/schema_report.html.j2` is built using the `frontend-design`
  skill against `mfc/design/` (tokens.css, styles, prototype) so it
  matches the MyFoodCraving look. Sections: report header (generation
  timestamp, project name), per-table card (name + comment + columns
  table + PK/FK list + RLS policy list + row count + aggregate stats).
- Template ships with the project; rendering is pure Jinja2, no network.

## Credential migration (touches `automation/`)

- Move `automation/.env` and `automation/.env.sample` to `<repo-root>/.env`
  and `<repo-root>/.env.sample`.
- Update `automation/mfc/core/config.py`:
  - Default `path` in `Config.load` from `AUTOMATION_DIR / ".env"` to
    `REPO_ROOT / ".env"`.
- Update `automation/README.md` setup snippet to copy
  `.env.sample → .env` at repo root.
- Update root `.gitignore` to ignore `/.env`. Leave any existing
  `automation/.env` ignore in place (harmless).

## Testing

- `tests/` uses `pytest`. Run via `make routine-test`.
- One test per job, exercised via `execute_in_process` with a mocked
  `SupabaseResource`. Checks output file paths and shape of structured
  outputs.
- `schema_report`: snapshot test on Jinja2 render against a fixture
  `SchemaReport`.
- `pdf_text`: two fixture PDFs (text + scanned) drive both code paths.
- `recipe_sync`: monkeypatch `subprocess.run`, assert command line shape.
- No CI integration — tests run locally only.

## Make targets (root `Makefile`)

- `make routine` → `uv --project routine run dagster dev`
- `make routine-sync` → `uv --project routine sync`
- `make routine-test` → `uv --project routine run pytest`

## Documentation

- `routine/README.md` mirrors `automation/README.md`'s structure and
  voice: setup (brew deps + uv sync + .env), commands (Make targets),
  layout, "How to add a job" recipe (copy a `jobs/<x>.py`, add to
  `definitions.py` jobs list, add a Make target if it should have one).
- Spec lives at this path; commit alongside the implementation plan.

## Dependencies

`routine/pyproject.toml`:

```toml
[project]
name = "routine"
version = "0.1.0"
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
```

System deps (brew): `tesseract`, `poppler`.

## Out of scope (future work)

- Schedules / sensors (e.g. nightly recipe-sync pull, weekly schema report).
- Cloud-OCR backend swap (Textract / Document Intelligence / Claude vision).
- Asset-graph refactor if downstream caching becomes valuable.
- Publishing the schema report (commit-to-repo, upload to Slack, email).
