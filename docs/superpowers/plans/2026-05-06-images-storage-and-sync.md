# Images on Storage + Bidirectional Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all recipe images to Supabase Storage, expose three Python sync commands (`sync-images`, `sync-recipes`, `migrate-image-urls`), and add browser image upload to `/admin/recipe.html`. Replaces today's `mfc import-recipes` outright.

**Architecture:** A public-read `recipe-images` Supabase Storage bucket whose paths exactly match today's local-file convention. CLI commands pull/push/both bytes (`sync-images`) and metadata (`sync-recipes`); a one-shot `migrate-image-urls` rewrites legacy `assets/...` paths to full Storage URLs. Browser uploads go through a shared `MFC.imageUpload` helper that compresses client-side via `browser-image-compression` and writes through supabase-js to the bucket.

**Tech Stack:** Python 3.10+ (psycopg, supabase-py), PL/pgSQL (storage RLS + ALTER TABLE), Makefile, vanilla React via Babel-standalone (admin recipe editor), Supabase Storage SDK in the browser, Supabase MCP for live migration apply.

**Spec:** [`docs/superpowers/specs/2026-05-06-images-storage-and-sync-design.md`](../specs/2026-05-06-images-storage-and-sync-design.md)

**Verification approach:** No pytest (matches existing repo convention; see `mfc.commands.import_recipes`, `apply_schema`, `status` — none have unit tests). Each task ends with a concrete `make`/`mfc`/SQL verification or browser load. Live project URL captured in `automation/.env` (`https://fqjzhntqppbcwvqtjscb.supabase.co`); re-confirm before destructive calls.

---

## Task 1: Schema migration — `media_src` column + bucket + Storage RLS

**Files:**
- Create: `automation/db/migration-2026-05-06-images-storage.sql`
- Modify: `automation/db/schema.sql` (insert near `recipe_steps` definition + add the bucket/RLS section after admin policies)

- [ ] **Step 1: Write the migration SQL**

Create `automation/db/migration-2026-05-06-images-storage.sql`:

```sql
-- Migration: images on Storage + sync foundation (sub-project #2.5)
-- Adds:
--   1. recipe_steps.media_src text column
--   2. storage.buckets row for 'recipe-images' (public read)
--   3. RLS policies on storage.objects scoped to that bucket:
--        - public SELECT
--        - admin-only INSERT / UPDATE / DELETE (uses public.is_admin())
--
-- Idempotent. Folded into schema.sql.

-- ── 1. recipe_steps.media_src ──────────────────────────────────────────
ALTER TABLE public.recipe_steps
  ADD COLUMN IF NOT EXISTS media_src text;

COMMENT ON COLUMN public.recipe_steps.media_src IS
  'Full Supabase Storage URL of the step image (or NULL if no image). Populated by mfc migrate-image-urls for existing rows.';

-- ── 2. Bucket ──────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('recipe-images', 'recipe-images', true)
  ON CONFLICT (id) DO UPDATE SET public = excluded.public;

-- ── 3. Storage RLS ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "recipe_images_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_write"   ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_update"  ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_delete"  ON storage.objects;

CREATE POLICY "recipe_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recipe-images');

CREATE POLICY "recipe_images_admin_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'recipe-images' AND public.is_admin());

CREATE POLICY "recipe_images_admin_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'recipe-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'recipe-images' AND public.is_admin());

CREATE POLICY "recipe_images_admin_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'recipe-images' AND public.is_admin());
```

- [ ] **Step 2: Fold the column into `automation/db/schema.sql`**

Locate the `CREATE TABLE public.recipe_steps` block (search `CREATE TABLE public.recipe_steps`). Inside the column list, immediately after the existing `media_caption text,` line, add `media_src   text,`.

The column list will look like this fragment afterward (use this to confirm the location/format match):

```sql
  duration_seconds  int CHECK (duration_seconds >= 0),
  tip               text,
  media_caption     text,
  media_src         text,
  PRIMARY KEY (recipe_id, sort_order)
```

Then add a `COMMENT ON COLUMN` line near the existing comments for `recipe_steps`:

```sql
COMMENT ON COLUMN public.recipe_steps.media_src IS
  'Full Supabase Storage URL of the step image (or NULL if no image). Populated by mfc migrate-image-urls for existing rows.';
```

- [ ] **Step 3: Fold the bucket + RLS section into `automation/db/schema.sql`**

After the existing admin RLS block (ends with `recipe_health_facts_admin_write` policy creation, around line 566), append:

```sql

-- =============================================================================
-- 9. STORAGE — recipe-images bucket + RLS
-- Public read; admin-only writes via public.is_admin().
-- See sub-project #2.5 spec.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
  VALUES ('recipe-images', 'recipe-images', true)
  ON CONFLICT (id) DO UPDATE SET public = excluded.public;

DROP POLICY IF EXISTS "recipe_images_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_write"   ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_update"  ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_delete"  ON storage.objects;

CREATE POLICY "recipe_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recipe-images');

CREATE POLICY "recipe_images_admin_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'recipe-images' AND public.is_admin());

CREATE POLICY "recipe_images_admin_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'recipe-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'recipe-images' AND public.is_admin());

CREATE POLICY "recipe_images_admin_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'recipe-images' AND public.is_admin());
```

- [ ] **Step 4: Apply the migration to the live Supabase project via MCP**

The Supabase MCP tools were authenticated during sub-project #1; the project ID is `fqjzhntqppbcwvqtjscb`. If session is fresh and the tool isn't loaded, search for it:

```
ToolSearch: select:mcp__plugin_supabase_supabase__apply_migration,mcp__plugin_supabase_supabase__execute_sql,mcp__plugin_supabase_supabase__list_projects
```

Confirm the project URL with `list_projects` (expected: `MyFoodCraving` at `fqjzhntqppbcwvqtjscb`).

Apply via:

```
mcp__plugin_supabase_supabase__apply_migration
  project_id: fqjzhntqppbcwvqtjscb
  name: images_storage_2026_05_06
  query: <contents of automation/db/migration-2026-05-06-images-storage.sql>
```

- [ ] **Step 5: Verify schema + bucket + RLS**

Via the MCP `execute_sql` tool:

```sql
-- Column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='recipe_steps' AND column_name='media_src';

-- Bucket exists, public
SELECT id, name, public FROM storage.buckets WHERE id='recipe-images';

-- Four storage policies present
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'recipe_images%'
ORDER BY policyname;
```

Expected: column row with `text`, bucket row with `public=true`, four policy rows (`recipe_images_admin_delete`/`update`/`write`/`public_read`).

- [ ] **Step 6: Commit**

```bash
git add automation/db/migration-2026-05-06-images-storage.sql automation/db/schema.sql
git commit -m "feat(db): images-storage foundation — recipe_steps.media_src + bucket + RLS

Adds the recipe_steps.media_src column, creates the public-read
recipe-images bucket, and applies four RLS policies to storage.objects
scoped to that bucket. Admin-only writes via public.is_admin().
Idempotent. Folded into schema.sql §9 (new storage section)."
```

---

## Task 2: `automation/mfc/ops/images.py` — sync engine + URL rewriter + helpers

**Files:**
- Create: `automation/mfc/ops/images.py`

- [ ] **Step 1: Write the module**

Create `automation/mfc/ops/images.py`:

```python
"""Image-byte sync between local web/assets/recipes/* and Supabase Storage,
plus a one-shot DB rewriter that swaps legacy 'assets/...' paths for full
Storage URLs.

IMPORTANT: this module never touches recipe metadata schemas other than
recipes.media (the JSONB) and recipe_steps.media_src. Bundle JSON is owned
by mfc.ops.recipes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Literal, Optional

import httpx

from ..clients import sb as sb_client
from ..core import log
from ..core.config import Config


BUCKET = "recipe-images"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
LEGACY_PATH_PREFIX = "assets/"

# httpx default (5s) is tight for the Auth/Storage admin API in distant regions.
_HTTP_TIMEOUT_SECONDS = 60.0


@dataclass
class SyncReport:
    uploaded:   int = 0
    downloaded: int = 0
    skipped:    int = 0
    conflicts:  int = 0
    errors:     list[str] = field(default_factory=list)

    def line(self) -> str:
        return (
            f"↓ {self.downloaded} downloaded · "
            f"↑ {self.uploaded} uploaded · "
            f"- {self.skipped} skipped · "
            f"! {self.conflicts} conflicts"
        )


@dataclass
class MigrationReport:
    recipes_rewritten: int = 0
    steps_rewritten:   int = 0
    skipped_recipes:   int = 0
    skipped_steps:     int = 0


# ─────────────────────────────────────────────────────────────────────────
# Service-client + URL helper
# ─────────────────────────────────────────────────────────────────────────

def _service_client(config: Config):
    """Wrap sb_client.service_client and bump the storage httpx timeout."""
    client = sb_client.service_client(config)
    # supabase-py exposes the Storage client at client.storage; its underlying
    # httpx timeout is on the postgrest auth admin client. Easiest broadly-safe
    # fix: bump both auth admin and storage clients.
    try:
        client.auth.admin._http_client.timeout = httpx.Timeout(_HTTP_TIMEOUT_SECONDS)
    except Exception:
        pass
    try:
        client.storage._client.timeout = httpx.Timeout(_HTTP_TIMEOUT_SECONDS)
    except Exception:
        pass
    return client


def storage_url(config: Config, *, recipe_id: str, filename: str) -> str:
    """Returns the canonical public URL for a path inside the bucket."""
    base = (config.supabase_url or "").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL not set")
    return f"{base}/storage/v1/object/public/{BUCKET}/{recipe_id}/{filename}"


# ─────────────────────────────────────────────────────────────────────────
# Local enumeration
# ─────────────────────────────────────────────────────────────────────────

def _recipes_dir(config: Config) -> Path:
    return config.repo_root / "web" / "assets" / "recipes"


def _local_recipe_ids(config: Config) -> list[str]:
    root = _recipes_dir(config)
    if not root.exists():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def _local_files_for(config: Config, recipe_id: str) -> dict[str, dict]:
    """Returns filename -> {mtime: float} for image files in the recipe dir."""
    out: dict[str, dict] = {}
    d = _recipes_dir(config) / recipe_id
    if not d.exists():
        return out
    for p in d.iterdir():
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            out[p.name] = {"mtime": p.stat().st_mtime}
    return out


# ─────────────────────────────────────────────────────────────────────────
# Storage enumeration
# ─────────────────────────────────────────────────────────────────────────

def _storage_files_for(client, recipe_id: str) -> dict[str, dict]:
    """Returns filename -> {updated_at_ts: float} for objects under <recipe_id>/."""
    out: dict[str, dict] = {}
    try:
        objects = client.storage.from_(BUCKET).list(recipe_id) or []
    except Exception:
        return out
    for o in objects:
        # supabase-py returns dicts; mtime is in 'updated_at' as ISO8601.
        name = o.get("name") if isinstance(o, dict) else getattr(o, "name", None)
        if not name:
            continue
        if Path(name).suffix.lower() not in IMAGE_EXTS:
            continue
        ts_iso = (
            o.get("updated_at") if isinstance(o, dict) else getattr(o, "updated_at", None)
        )
        ts = _parse_iso_to_ts(ts_iso) if ts_iso else 0.0
        out[name] = {"updated_at_ts": ts}
    return out


def _parse_iso_to_ts(iso: str) -> float:
    # Supabase returns "2026-05-06T01:23:45.678Z"; tolerate trailing Z.
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


# ─────────────────────────────────────────────────────────────────────────
# Per-file decision rule
# ─────────────────────────────────────────────────────────────────────────

CLOCK_SKEW_TOLERANCE_S = 1.0


def _decide(
    *,
    local: Optional[dict],
    remote: Optional[dict],
    direction: str,
) -> Literal["upload", "download", "skip"]:
    if not local and not remote:
        return "skip"
    if local and not remote:
        return "upload" if direction in ("push", "both") else "skip"
    if remote and not local:
        return "download" if direction in ("pull", "both") else "skip"
    # Both sides exist; compare timestamps.
    delta = local["mtime"] - remote["updated_at_ts"]
    if abs(delta) <= CLOCK_SKEW_TOLERANCE_S:
        return "skip"
    if delta > 0:  # local newer
        return "upload" if direction in ("push", "both") else "skip"
    # remote newer
    return "download" if direction in ("pull", "both") else "skip"


# ─────────────────────────────────────────────────────────────────────────
# Public ops
# ─────────────────────────────────────────────────────────────────────────

def sync_files(
    config: Config,
    *,
    direction: Literal["pull", "push", "both"],
    only: Optional[list[str]] = None,
) -> SyncReport:
    """Reconcile bytes between the bucket and web/assets/recipes/*.

    `only`: optional list of recipe ids to scope the sync to. Default: union of
    local-recipe-dirs and DB recipes (DB ids fetched on demand).
    """
    if direction not in ("pull", "push", "both"):
        raise ValueError(f"invalid direction: {direction!r}")

    client = _service_client(config)
    report = SyncReport()

    # Enumerate the recipe-id universe.
    if only:
        ids = list(only)
    else:
        local_ids = set(_local_recipe_ids(config))
        # DB ids
        try:
            db_rows = client.table("recipes").select("id").execute().data or []
            db_ids = {r["id"] for r in db_rows}
        except Exception as e:
            log.warn(f"could not list DB recipes (continuing with local only): {e}")
            db_ids = set()
        ids = sorted(local_ids | db_ids)

    log.step(f"sync-images · {direction} · {len(ids)} recipe(s)")

    for rid in ids:
        local_files = _local_files_for(config, rid)
        remote_files = _storage_files_for(client, rid)
        all_names = sorted(set(local_files) | set(remote_files))

        for name in all_names:
            l = local_files.get(name)
            r = remote_files.get(name)
            action = _decide(local=l, remote=r, direction=direction)

            if action == "skip":
                report.skipped += 1
                continue
            if action == "upload":
                try:
                    _upload_one(client, config, rid, name)
                    report.uploaded += 1
                except Exception as e:
                    report.errors.append(f"upload {rid}/{name}: {e}")
            elif action == "download":
                try:
                    _download_one(client, config, rid, name)
                    report.downloaded += 1
                except Exception as e:
                    report.errors.append(f"download {rid}/{name}: {e}")

    log.ok(report.line())
    if report.errors:
        for err in report.errors[:10]:
            log.error(err)
        if len(report.errors) > 10:
            log.warn(f"…and {len(report.errors) - 10} more")
    return report


def _upload_one(client, config: Config, recipe_id: str, filename: str) -> None:
    p = _recipes_dir(config) / recipe_id / filename
    data = p.read_bytes()
    path = f"{recipe_id}/{filename}"
    # supabase-py upload accepts file_options with content-type + upsert.
    content_type = _content_type_for(filename)
    client.storage.from_(BUCKET).upload(
        path,
        data,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def _download_one(client, config: Config, recipe_id: str, filename: str) -> None:
    path = f"{recipe_id}/{filename}"
    data = client.storage.from_(BUCKET).download(path)
    p = _recipes_dir(config) / recipe_id / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def _content_type_for(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")


# ─────────────────────────────────────────────────────────────────────────
# DB URL rewriter
# ─────────────────────────────────────────────────────────────────────────

def migrate_urls(config: Config) -> MigrationReport:
    """Rewrite legacy 'assets/...' paths in recipes.media + populate
    recipe_steps.media_src from local file presence. Idempotent."""
    client = _service_client(config)
    report = MigrationReport()

    rows = client.table("recipes").select("id, media").execute().data or []
    log.step(f"migrate-image-urls · {len(rows)} recipe(s)")

    for r in rows:
        rid = r["id"]
        media = r.get("media") or {}
        new_media, changed = _rewrite_media(config, rid, media)
        if changed:
            client.table("recipes").update({"media": new_media}).eq("id", rid).execute()
            report.recipes_rewritten += 1
        else:
            report.skipped_recipes += 1

        # Steps: populate media_src from local file existence.
        steps = (
            client.table("recipe_steps")
            .select("recipe_id, sort_order, media_src")
            .eq("recipe_id", rid)
            .order("sort_order")
            .execute()
            .data
            or []
        )
        for s in steps:
            if s.get("media_src"):
                report.skipped_steps += 1
                continue
            sort_order = s["sort_order"]
            # Look for step-<N>.<ext> locally
            local_filename = _find_local_step_file(config, rid, sort_order)
            if not local_filename:
                report.skipped_steps += 1
                continue
            url = storage_url(config, recipe_id=rid, filename=local_filename)
            client.table("recipe_steps").update({"media_src": url}).eq(
                "recipe_id", rid
            ).eq("sort_order", sort_order).execute()
            report.steps_rewritten += 1

    log.ok(
        f"recipes: {report.recipes_rewritten} rewritten, {report.skipped_recipes} skipped · "
        f"steps: {report.steps_rewritten} populated, {report.skipped_steps} skipped"
    )
    return report


def _rewrite_media(config: Config, recipe_id: str, media: dict) -> tuple[dict, bool]:
    """Returns (new_media, changed). Rewrites media.image and media.hero.src
    when they start with 'assets/'."""
    new_media = dict(media)
    changed = False

    img = new_media.get("image")
    if isinstance(img, str) and img.startswith(LEGACY_PATH_PREFIX):
        filename = Path(img).name
        new_media["image"] = storage_url(config, recipe_id=recipe_id, filename=filename)
        changed = True

    hero = new_media.get("hero")
    if isinstance(hero, dict):
        new_hero = dict(hero)
        src = new_hero.get("src")
        if isinstance(src, str) and src.startswith(LEGACY_PATH_PREFIX):
            filename = Path(src).name
            new_hero["src"] = storage_url(
                config, recipe_id=recipe_id, filename=filename
            )
            changed = True
        new_media["hero"] = new_hero

    return new_media, changed


def _find_local_step_file(config: Config, recipe_id: str, sort_order: int) -> Optional[str]:
    d = _recipes_dir(config) / recipe_id
    if not d.exists():
        return None
    for ext in IMAGE_EXTS:
        candidate = d / f"step-{sort_order}{ext}"
        if candidate.exists():
            return candidate.name
    return None
```

- [ ] **Step 2: Smoke-import the module**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run python -c "
from mfc.ops import images
print('BUCKET =', images.BUCKET)
print('SyncReport =', images.SyncReport)
print('MigrationReport =', images.MigrationReport)
print('storage_url =', images.storage_url)
"
```

Expected:
```
BUCKET = recipe-images
SyncReport = <class 'mfc.ops.images.SyncReport'>
MigrationReport = <class 'mfc.ops.images.MigrationReport'>
storage_url = <function storage_url at 0x...>
```

- [ ] **Step 3: Smoke-test storage_url**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run python -c "
from mfc.core.config import Config
from mfc.ops import images
print(images.storage_url(Config.load(), recipe_id='butter-chicken', filename='hero.jpg'))
"
```

Expected (matches your project URL):
```
https://fqjzhntqppbcwvqtjscb.supabase.co/storage/v1/object/public/recipe-images/butter-chicken/hero.jpg
```

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/ops/images.py
git commit -m "feat(cli): mfc.ops.images — sync engine + URL rewriter

sync_files reconciles bytes between local web/assets/recipes/* and the
recipe-images Supabase Storage bucket; per-file decision rule by mtime.
migrate_urls is the one-shot DB rewriter for the initial Storage migration:
rewrites legacy 'assets/...' paths in recipes.media to full Storage URLs
and populates recipe_steps.media_src from local file presence."
```

---

## Task 3: `mfc sync-images` command

**Files:**
- Create: `automation/mfc/commands/sync_images.py`
- Modify: `automation/mfc/cli.py`

- [ ] **Step 1: Write the command module**

Create `automation/mfc/commands/sync_images.py`:

```python
"""`mfc sync-images` — reconcile bytes between the recipe-images bucket
and web/assets/recipes/*."""

from __future__ import annotations

import argparse

from ..core import log
from ..core.config import Config
from ..ops import images as images_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-images",
        help="Sync recipe images bucket↔local (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = Storage→local; push = local→Storage; both = last-modified wins per file",
    )
    p.add_argument(
        "--recipe",
        action="append",
        default=None,
        help="Limit to one or more recipe ids (repeatable)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.recipe or None
    report = images_ops.sync_files(config, direction=args.direction, only=only)
    if report.errors:
        return 1
    return 0
```

- [ ] **Step 2: Register the command in `cli.py`**

Edit `automation/mfc/cli.py`. Find the imports block:

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    reset,
    seed_metrics,
    set_role,
    status,
)
```

Replace with:

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    reset,
    seed_metrics,
    set_role,
    status,
    sync_images,
)
```

(`import_recipes` stays in this task — Task 8 deletes it.)

Find `COMMAND_MODULES`:

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    set_role,
    drop_schema,
    reset,
]
```

Replace with:

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    sync_images,
    set_role,
    drop_schema,
    reset,
]
```

- [ ] **Step 3: Verify help works**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run mfc sync-images --help
```

Expected:
```
usage: mfc sync-images [-h] --direction {pull,push,both} [--recipe RECIPE]

options:
  -h, --help            show this help message and exit
  --direction {pull,push,both}
                        pull = Storage→local; push = local→Storage; both = ...
  --recipe RECIPE       Limit to one or more recipe ids (repeatable)
```

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/cli.py automation/mfc/commands/sync_images.py
git commit -m "feat(cli): mfc sync-images — pull/push/both byte sync

Thin argparse wrapper around mfc.ops.images.sync_files. --recipe scopes
to one or more ids (repeatable); --direction is required."
```

---

## Task 4: `mfc migrate-image-urls` command

**Files:**
- Create: `automation/mfc/commands/migrate_image_urls.py`
- Modify: `automation/mfc/cli.py`

- [ ] **Step 1: Write the command module**

Create `automation/mfc/commands/migrate_image_urls.py`:

```python
"""`mfc migrate-image-urls` — one-shot DB rewriter.

Rewrites legacy 'assets/...' paths in recipes.media to full Storage URLs
and populates recipe_steps.media_src from local file presence. Idempotent.
"""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import images as images_ops


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "migrate-image-urls",
        help="One-shot — rewrite legacy paths to full Storage URLs (idempotent)",
    )
    p.set_defaults(handler=run)


def run(_args: argparse.Namespace, config: Config) -> int:
    images_ops.migrate_urls(config)
    return 0
```

- [ ] **Step 2: Register the command in `cli.py`**

Edit `automation/mfc/cli.py`. Find the imports block (after Task 3):

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    reset,
    seed_metrics,
    set_role,
    status,
    sync_images,
)
```

Replace with:

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    migrate_image_urls,
    reset,
    seed_metrics,
    set_role,
    status,
    sync_images,
)
```

Find `COMMAND_MODULES` (after Task 3):

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    sync_images,
    set_role,
    drop_schema,
    reset,
]
```

Replace with:

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    sync_images,
    migrate_image_urls,
    set_role,
    drop_schema,
    reset,
]
```

- [ ] **Step 3: Verify help works**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run mfc migrate-image-urls --help
```

Expected:
```
usage: mfc migrate-image-urls [-h]

options:
  -h, --help  show this help message and exit
```

- [ ] **Step 4: Commit**

```bash
git add automation/mfc/cli.py automation/mfc/commands/migrate_image_urls.py
git commit -m "feat(cli): mfc migrate-image-urls — DB rewriter for the initial migration

One-shot, idempotent. Calls mfc.ops.images.migrate_urls."
```

---

## Task 5: Makefile targets — `sync-images` + `migrate-image-urls`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add `.PHONY` line**

Edit `Makefile`. Find:

```make
.PHONY: help sync status apply-schema seed-metrics import-recipes \
        list-users set-role drop-schema reset serve
```

Replace with:

```make
.PHONY: help sync status apply-schema seed-metrics import-recipes \
        sync-images migrate-image-urls \
        list-users set-role drop-schema reset serve
```

(`sync-recipes` is added in Task 9.)

- [ ] **Step 2: Add the `sync-images` target**

Edit `Makefile`. Find:

```make
import-recipes: ## upsert ingredients, utensils, and recipes from web/assets/recipes/
	@$(UV) run mfc import-recipes
```

Insert immediately AFTER it:

```make
sync-images: ## sync recipe images bucket↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-images --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — Storage → local. Downloads Storage-only files; overwrites local where Storage is newer.\n"; \
	  printf "  push — local → Storage. Uploads local-only files; overwrites remote where local is newer.\n"; \
	  printf "  both — pull then push. Last-modified wins per file. Safe when no concurrent edits.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-images --direction $$d; \
	fi

migrate-image-urls: ## one-shot — rewrite recipe rows to use full Storage URLs (idempotent)
	@$(UV) run mfc migrate-image-urls
```

- [ ] **Step 3: Verify both targets show up in `make help`**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make help
```

Expected: list includes `sync-images` and `migrate-image-urls` with their descriptions.

- [ ] **Step 4: Verify the interactive prompt path (use Ctrl-C to abort after the prompt prints)**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && timeout 2 make sync-images || true
```

Expected stdout (before timeout):
```
Pick sync direction:
  pull — Storage → local. ...
  push — local → Storage. ...
  both — pull then push. ...

Direction [pull/push/both]:
```

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -m "feat(make): sync-images + migrate-image-urls targets

sync-images is interactive (prompts for direction) or accepts DIRECTION=.
migrate-image-urls is a one-shot wrapper around the CLI command."
```

---

## Task 6: Live migration — push bytes + rewrite URLs + verify

**Files:**
- (No code changes; runs live commands against the Supabase project.)

- [ ] **Step 1: Push all local images into the bucket**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-images DIRECTION=push
```

Expected: a step header line + an `↑ N uploaded · - 0 skipped · ! 0 conflicts` summary, where N is the total number of `.jpg`/`.png`/`.webp` files under `web/assets/recipes/`.

- [ ] **Step 2: Spot-check a hero appears at the public URL**

Pick a recipe id from `web/assets/recipes/` (e.g. `butter-chicken`). Then:

```bash
curl -s -o /dev/null -w "%{http_code} · %{size_download} bytes\n" \
  "https://fqjzhntqppbcwvqtjscb.supabase.co/storage/v1/object/public/recipe-images/butter-chicken/hero.jpg"
```

Expected: `200 · <number> bytes` (file size matches local — `wc -c < web/assets/recipes/butter-chicken/hero.jpg` for comparison).

- [ ] **Step 3: Rewrite DB URLs**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make migrate-image-urls
```

Expected: a step header + an `recipes: N rewritten, M skipped · steps: K populated, L skipped` summary.

- [ ] **Step 4: Spot-check that DB now has full URLs**

Via Supabase MCP `execute_sql` (replace `butter-chicken` with any recipe id):

```sql
SELECT id, media->>'image' AS image, media->'hero'->>'src' AS hero_src
FROM public.recipes
WHERE id = 'butter-chicken';

SELECT recipe_id, sort_order, media_src
FROM public.recipe_steps
WHERE recipe_id = 'butter-chicken'
ORDER BY sort_order
LIMIT 5;
```

Expected: all values should now begin with `https://fqjzhntqppbcwvqtjscb.supabase.co/storage/v1/object/public/recipe-images/`. None should still start with `assets/`.

- [ ] **Step 5: Re-run migrate-image-urls; verify it's idempotent (everything skipped)**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make migrate-image-urls
```

Expected: `recipes: 0 rewritten, M skipped · steps: 0 populated, L skipped` where M/L match the previous run's totals.

- [ ] **Step 6: Browser smoke — hero renders from Supabase**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s "http://localhost:8080/recipe.html?id=butter-chicken" \
  | grep -oE 'src="[^"]*hero[^"]*"' | head -3
lsof -ti :8080 | xargs kill -9 2>/dev/null
```

The `<img>` `src` should resolve through the `media.image` field. (The page is React-rendered, so a literal `src=` may not appear in the static HTML; if the grep returns nothing, that's actually expected — load the page in a real browser and confirm the hero renders. Open `http://localhost:8080/recipe.html?id=butter-chicken` and visually verify the hero image loads from `*.supabase.co`.)

- [ ] **Step 7: No commit (this task is verification-only)**

The migration is now complete on the live project. Subsequent runs of `sync-images push` are pure byte sync; `migrate-image-urls` is a no-op.

---

## Task 7: Rewrite `automation/mfc/ops/recipes.py` — push + pull + sync orchestrator

**Files:**
- Modify: `automation/mfc/ops/recipes.py` (full rewrite, keeping `import_all` as a thin alias)

- [ ] **Step 1: Read the current ops/recipes.py**

This file holds today's `import_all`. Read it end-to-end to understand the bundle JSON shape and child-table mappings (the rewrite preserves them).

```bash
cat /Users/amanrai/Documents/Code/mfc-landing/automation/mfc/ops/recipes.py
```

- [ ] **Step 2: Replace ops/recipes.py with the bidirectional sync version**

Rewrite the entire file:

```python
"""Recipe metadata sync — bidirectional between local recipe.json bundles
and Supabase recipes + child tables.

Three public functions:
  - push_bundles : local → DB (was import_all)
  - pull_bundles : DB → local
  - sync         : per-recipe, last-modified wins

import_all is preserved as a deprecated alias to keep mfc.commands.reset
from breaking until Task 8 deletes the old command.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from ..clients import sb as sb_client
from ..core import files, log
from ..core.config import Config


_SLUG_RX = re.compile(r"[^a-z0-9]+")


def _slugify(s: str) -> str:
    return _SLUG_RX.sub("-", s.lower()).strip("-")


def _guess_unit(amount: str | None) -> str:
    if not amount:
        return "g"
    a = amount.lower()
    if re.search(r"\btbsp\b", a):    return "tbsp"
    if re.search(r"\btsp\b", a):     return "tsp"
    if re.search(r"\bcups?\b", a):   return "cup"
    if re.search(r"\bml\b", a):      return "ml"
    if re.search(r"\bmedium\b", a):  return "medium"
    if re.search(r"\blarge\b", a):   return "large"
    if re.search(r"\bwhole\b", a):   return "whole"
    if re.search(r"\bpinch\b", a):   return "pinch"
    return "g"


@dataclass
class SyncReport:
    pushed: int = 0
    pulled: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)

    def line(self) -> str:
        return f"↑ {self.pushed} pushed · ↓ {self.pulled} pulled · - {self.skipped} skipped · ! {len(self.failed)} failed"


# ─────────────────────────────────────────────────────────────────────────
# PUSH (local → DB)  — equivalent of legacy import_all
# ─────────────────────────────────────────────────────────────────────────


@dataclass
class _LibraryRows:
    ingredients: dict[str, dict]
    utensils: dict[str, dict]


def _collect_library(bundles: Iterable[dict]) -> _LibraryRows:
    ingredients: dict[str, dict] = {}
    utensils: dict[str, dict] = {}
    for detail in bundles:
        for ing in detail.get("ingredients") or []:
            name = ing.get("name")
            if not name:
                continue
            slug = _slugify(name)
            ingredients.setdefault(slug, {
                "id": slug,
                "name": name,
                "default_unit": _guess_unit(ing.get("amt")),
            })
        for u in detail.get("utensils") or []:
            name = u.get("name")
            if not name:
                continue
            slug = _slugify(name)
            utensils.setdefault(slug, {"id": slug, "name": name})
    return _LibraryRows(ingredients=ingredients, utensils=utensils)


def _build_recipe_row(detail: dict) -> dict:
    rid = detail["id"]
    media = detail.get("media") or {}
    return {
        "id": rid,
        "name": detail["name"],
        "tagline": detail.get("tagline"),
        "short_tagline": detail.get("shortTagline"),
        "cuisine": detail["cuisine"],
        "difficulty": detail["difficulty"],
        "servings": detail["servings"],
        "total_minutes": detail["totalMinutes"],
        "media": media,
        "color": detail.get("color"),
        "color_soft": detail.get("colorSoft"),
        "featured": bool(detail.get("featured")),
        "highlight": detail.get("highlight"),
        "meal_types": [],
    }


def _replace_children(sb, table: str, recipe_id: str, rows: list[dict]) -> None:
    sb.table(table).delete().eq("recipe_id", recipe_id).execute()
    if rows:
        sb.table(table).insert(rows).execute()


def _upsert_recipe(sb, detail: dict) -> None:
    rid = detail["id"]
    sb.table("recipes").upsert(_build_recipe_row(detail), on_conflict="id").execute()

    tags = detail.get("tags") or []
    _replace_children(sb, "recipe_tags", rid,
        [{"recipe_id": rid, "tag": t} for t in tags])

    ings = detail.get("ingredients") or []
    _replace_children(sb, "recipe_ingredients", rid, [
        {
            "recipe_id": rid,
            "sort_order": i,
            "ingredient_id": _slugify(ing["name"]),
            "group_name": ing.get("group"),
            "amount": ing.get("amt"),
            "unit": None,
        }
        for i, ing in enumerate(ings) if ing.get("name")
    ])

    steps = detail.get("steps") or []
    _replace_children(sb, "recipe_steps", rid, [
        {
            "recipe_id": rid,
            "sort_order": step["id"] if isinstance(step.get("id"), int) else (i + 1),
            "title": step["title"],
            "detail": step["detail"],
            "duration_seconds": step.get("duration"),
            "tip": step.get("tip"),
            "media_caption": (step.get("media") or {}).get("caption"),
            "media_src": (step.get("media") or {}).get("src"),
        }
        for i, step in enumerate(steps)
    ])

    utensils = detail.get("utensils") or []
    seen_u: set[str] = set()
    util_rows: list[dict] = []
    for u in utensils:
        if not u.get("name"):
            continue
        slug = _slugify(u["name"])
        if slug in seen_u:
            continue
        seen_u.add(slug)
        util_rows.append({
            "recipe_id": rid,
            "sort_order": len(util_rows),
            "utensil_id": slug,
            "essential": bool(u.get("essential")),
        })
    _replace_children(sb, "recipe_utensils", rid, util_rows)

    facts = detail.get("healthFacts") or []
    _replace_children(sb, "recipe_health_facts", rid,
        [{"recipe_id": rid, "sort_order": i, "fact": f} for i, f in enumerate(facts)])


def push_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Upsert local recipe.json bundles into DB. `only` scopes to a subset."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    bundle_paths = list(files.iter_recipe_bundles(config.repo_root))
    bundles = [files.load_recipe_json(p) for p in bundle_paths]
    if only:
        wanted = set(only)
        bundles = [b for b in bundles if b.get("id") in wanted]

    if not bundles:
        log.warn("no recipe bundles to push")
        return report

    log.step(f"sync-recipes · push · {len(bundles)} bundle(s)")

    lib = _collect_library(bundles)
    if lib.ingredients:
        sb.table("ingredients").upsert(
            list(lib.ingredients.values()), on_conflict="id"
        ).execute()
        log.ok(f"ingredients populated ({len(lib.ingredients)})")
    if lib.utensils:
        sb.table("utensils").upsert(
            list(lib.utensils.values()), on_conflict="id"
        ).execute()
        log.ok(f"utensils populated ({len(lib.utensils)})")

    for detail in bundles:
        rid = detail.get("id", "<unknown>")
        try:
            _upsert_recipe(sb, detail)
            report.pushed += 1
            log.ok(rid)
        except Exception as e:  # noqa: BLE001 — per-recipe isolation
            report.failed.append(f"{rid}: {e}")
            log.error(f"{rid}: {e}")

    log.ok(report.line())
    return report


# ─────────────────────────────────────────────────────────────────────────
# PULL (DB → local)  — new direction
# ─────────────────────────────────────────────────────────────────────────


def _bundle_path(config: Config, recipe_id: str) -> Path:
    return config.repo_root / "web" / "assets" / "recipes" / recipe_id / "recipe.json"


def _build_bundle(sb, recipe_row: dict) -> dict:
    rid = recipe_row["id"]

    # Children with joined library names where applicable.
    ing_rows = (
        sb.table("recipe_ingredients")
        .select("recipe_id, sort_order, ingredient_id, group_name, amount, ingredients(name)")
        .eq("recipe_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    step_rows = (
        sb.table("recipe_steps")
        .select("recipe_id, sort_order, title, detail, duration_seconds, tip, media_caption, media_src")
        .eq("recipe_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    util_rows = (
        sb.table("recipe_utensils")
        .select("recipe_id, sort_order, utensil_id, essential, utensils(name)")
        .eq("recipe_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )
    tag_rows = (
        sb.table("recipe_tags")
        .select("tag")
        .eq("recipe_id", rid)
        .execute()
        .data
        or []
    )
    fact_rows = (
        sb.table("recipe_health_facts")
        .select("sort_order, fact")
        .eq("recipe_id", rid)
        .order("sort_order")
        .execute()
        .data
        or []
    )

    bundle = {
        "id": rid,
        "name": recipe_row["name"],
        "tagline": recipe_row.get("tagline"),
        "shortTagline": recipe_row.get("short_tagline"),
        "cuisine": recipe_row["cuisine"],
        "difficulty": recipe_row["difficulty"],
        "servings": recipe_row["servings"],
        "totalMinutes": recipe_row["total_minutes"],
        "media": recipe_row.get("media") or {},
        "color": recipe_row.get("color"),
        "colorSoft": recipe_row.get("color_soft"),
        "featured": bool(recipe_row.get("featured")),
        "highlight": recipe_row.get("highlight"),
        "ingredients": [
            {
                "name": (i.get("ingredients") or {}).get("name") or i["ingredient_id"],
                "amt": i.get("amount"),
                "group": i.get("group_name"),
            }
            for i in ing_rows
        ],
        "steps": [
            {
                "id": s["sort_order"],
                "title": s["title"],
                "detail": s["detail"],
                "duration": s.get("duration_seconds"),
                "tip": s.get("tip"),
                "media": {
                    "src": s.get("media_src"),
                    "caption": s.get("media_caption"),
                },
            }
            for s in step_rows
        ],
        "utensils": [
            {
                "name": (u.get("utensils") or {}).get("name") or u["utensil_id"],
                "essential": bool(u.get("essential")),
            }
            for u in util_rows
        ],
        "tags": [t["tag"] for t in tag_rows],
        "healthFacts": [f["fact"] for f in fact_rows],
    }
    # Strip Nones that round-trip ugly
    if bundle["tagline"] is None: del bundle["tagline"]
    if bundle["shortTagline"] is None: del bundle["shortTagline"]
    if bundle["color"] is None: del bundle["color"]
    if bundle["colorSoft"] is None: del bundle["colorSoft"]
    if bundle["highlight"] is None: del bundle["highlight"]
    return bundle


def pull_bundles(config: Config, *, only: Optional[list[str]] = None) -> SyncReport:
    """Reconstruct recipe.json bundles from DB rows."""
    sb = sb_client.service_client(config)
    report = SyncReport()

    q = sb.table("recipes").select("*").order("id")
    rows = q.execute().data or []
    if only:
        wanted = set(only)
        rows = [r for r in rows if r["id"] in wanted]

    if not rows:
        log.warn("no recipes in DB to pull")
        return report

    log.step(f"sync-recipes · pull · {len(rows)} recipe(s)")

    for row in rows:
        rid = row["id"]
        try:
            bundle = _build_bundle(sb, row)
            path = _bundle_path(config, rid)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(bundle, indent=2) + "\n")
            report.pulled += 1
            log.ok(rid)
        except Exception as e:  # noqa: BLE001
            report.failed.append(f"{rid}: {e}")
            log.error(f"{rid}: {e}")

    log.ok(report.line())
    return report


# ─────────────────────────────────────────────────────────────────────────
# Orchestrator (per-recipe last-modified wins)
# ─────────────────────────────────────────────────────────────────────────


def sync(config: Config, *, direction: str, only: Optional[list[str]] = None) -> SyncReport:
    if direction == "push":
        return push_bundles(config, only=only)
    if direction == "pull":
        return pull_bundles(config, only=only)
    if direction != "both":
        raise ValueError(f"invalid direction: {direction!r}")

    # Both: per-recipe, choose direction by mtime / updated_at.
    sb = sb_client.service_client(config)
    db_rows = sb.table("recipes").select("id, updated_at").execute().data or []
    db_by_id = {r["id"]: r for r in db_rows}
    if only:
        wanted = set(only)
        db_by_id = {k: v for k, v in db_by_id.items() if k in wanted}

    bundle_paths = list(files.iter_recipe_bundles(config.repo_root))
    local_by_id: dict[str, Path] = {}
    for p in bundle_paths:
        try:
            d = files.load_recipe_json(p)
            rid = d.get("id")
            if rid and (not only or rid in only):
                local_by_id[rid] = p
        except Exception:
            continue

    push_ids: list[str] = []
    pull_ids: list[str] = []

    all_ids = sorted(set(db_by_id) | set(local_by_id))
    for rid in all_ids:
        db_row = db_by_id.get(rid)
        local_path = local_by_id.get(rid)
        if db_row and not local_path:
            pull_ids.append(rid)
            continue
        if local_path and not db_row:
            push_ids.append(rid)
            continue
        # Both present
        local_mtime = local_path.stat().st_mtime
        db_ts = _parse_iso_to_ts(db_row.get("updated_at") or "")
        delta = local_mtime - db_ts
        if abs(delta) <= 1.0:
            continue
        if delta > 0:
            push_ids.append(rid)
        else:
            pull_ids.append(rid)

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
        from datetime import datetime
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


# ─────────────────────────────────────────────────────────────────────────
# Backwards-compat alias (removed in Task 8 along with import_recipes command)
# ─────────────────────────────────────────────────────────────────────────


def import_all(config: Config) -> None:
    """Deprecated: kept until Task 8 deletes import_recipes command + reset hook."""
    push_bundles(config)
```

- [ ] **Step 3: Smoke-test pull on a single recipe**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run python -c "
from mfc.core.config import Config
from mfc.ops import recipes
report = recipes.pull_bundles(Config.load(), only=['butter-chicken'])
print('Report:', report.line())
"
```

(If `butter-chicken` doesn't exist locally yet, the pull WILL CREATE it. Choose another id from `make list-users`-style enumeration if needed: any id present in DB works. Use `mfc status` to see table row counts; pick an id from `web/assets/recipes/` to be safe.)

Expected:
```
→ sync-recipes · pull · 1 recipe(s)
  ✓ butter-chicken
  ✓ ↑ 0 pushed · ↓ 1 pulled · - 0 skipped · ! 0 failed
Report: ↑ 0 pushed · ↓ 1 pulled · - 0 skipped · ! 0 failed
```

After this, `git diff web/assets/recipes/butter-chicken/recipe.json` should show only the additions for any new fields (e.g. step `media.src` URLs from migrate-image-urls). Don't commit those — they'll come back on the next `make sync-recipes DIRECTION=pull` if needed.

- [ ] **Step 4: Smoke-test push (idempotent re-upsert)**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run python -c "
from mfc.core.config import Config
from mfc.ops import recipes
report = recipes.push_bundles(Config.load(), only=['butter-chicken'])
print('Report:', report.line())
"
```

Expected:
```
→ sync-recipes · push · 1 bundle(s)
  ✓ ingredients populated (...)
  ✓ utensils populated (...)
  ✓ butter-chicken
  ✓ ↑ 1 pushed · ↓ 0 pulled · - 0 skipped · ! 0 failed
```

- [ ] **Step 5: Revert any uncommitted changes to recipe.json (cleanup before commit)**

The pull in step 3 may have rewritten one or more `recipe.json` files. Restore them:

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && git checkout -- web/assets/recipes/
```

(They will be regenerated by an actual `make sync-recipes DIRECTION=pull` later if you want them in git.)

- [ ] **Step 6: Commit**

```bash
git add automation/mfc/ops/recipes.py
git commit -m "feat(cli): mfc.ops.recipes — bidirectional sync

Adds push_bundles (replaces import_all logic), pull_bundles (new),
and sync orchestrator (per-recipe last-modified wins for direction=both).
import_all kept as a deprecated alias until Task 8 removes the
import-recipes command + reset hook."
```

---

## Task 8: `mfc sync-recipes` command + delete `mfc import-recipes`

**Files:**
- Create: `automation/mfc/commands/sync_recipes.py`
- Modify: `automation/mfc/cli.py`
- Modify: `automation/mfc/commands/reset.py`
- Modify: `automation/mfc/ops/recipes.py` (drop `import_all` alias)
- Delete: `automation/mfc/commands/import_recipes.py`

- [ ] **Step 1: Write the new command module**

Create `automation/mfc/commands/sync_recipes.py`:

```python
"""`mfc sync-recipes` — reconcile recipe metadata between DB and local
recipe.json bundles. Replaces mfc import-recipes."""

from __future__ import annotations

import argparse

from ..core.config import Config
from ..ops import recipes as recipes_ops


DIRECTIONS = ("pull", "push", "both")


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "sync-recipes",
        help="Sync recipe metadata DB↔local bundles (pull|push|both)",
    )
    p.add_argument(
        "--direction",
        required=True,
        choices=DIRECTIONS,
        help="pull = DB→local; push = local→DB; both = last-modified wins per recipe",
    )
    p.add_argument(
        "--recipe",
        action="append",
        default=None,
        help="Limit to one or more recipe ids (repeatable)",
    )
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    only = args.recipe or None
    report = recipes_ops.sync(config, direction=args.direction, only=only)
    if report.failed:
        return 1
    return 0
```

- [ ] **Step 2: Inspect `commands/reset.py` for the import_recipes hook**

```bash
cat /Users/amanrai/Documents/Code/mfc-landing/automation/mfc/commands/reset.py
```

Look for any reference to `import_recipes` (the command module) or `recipes.import_all` (the ops function). Note them — they get rewritten in step 3.

- [ ] **Step 3: Update reset.py to use push_bundles directly**

Edit `automation/mfc/commands/reset.py`. The exact change depends on what's there; the goal is to replace the import-recipes step with `recipes.push_bundles(config)`.

If the file calls `import_recipes.run(args, config)` or similar:

Find:
```python
from . import import_recipes
```
…and:
```python
import_recipes.run(args, config)
```

Replace the import with:
```python
from ..ops import recipes
```

Replace the call with:
```python
recipes.push_bundles(config)
```

If reset.py instead calls `recipes.import_all(config)` directly, change that single call to `recipes.push_bundles(config)`.

- [ ] **Step 4: Delete commands/import_recipes.py**

```bash
git rm /Users/amanrai/Documents/Code/mfc-landing/automation/mfc/commands/import_recipes.py
```

- [ ] **Step 5: Update cli.py — drop import_recipes, add sync_recipes**

Edit `automation/mfc/cli.py`. Find the imports block (after Task 4):

```python
from .commands import (
    apply_schema,
    drop_schema,
    import_recipes,
    list_users,
    migrate_image_urls,
    reset,
    seed_metrics,
    set_role,
    status,
    sync_images,
)
```

Replace with:

```python
from .commands import (
    apply_schema,
    drop_schema,
    list_users,
    migrate_image_urls,
    reset,
    seed_metrics,
    set_role,
    status,
    sync_images,
    sync_recipes,
)
```

Find `COMMAND_MODULES` (after Task 4):

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    import_recipes,
    sync_images,
    migrate_image_urls,
    set_role,
    drop_schema,
    reset,
]
```

Replace with:

```python
COMMAND_MODULES = [
    status,
    list_users,
    apply_schema,
    seed_metrics,
    sync_recipes,
    sync_images,
    migrate_image_urls,
    set_role,
    drop_schema,
    reset,
]
```

- [ ] **Step 6: Drop the `import_all` alias from ops/recipes.py**

Edit `automation/mfc/ops/recipes.py`. Find at the bottom:

```python
# ─────────────────────────────────────────────────────────────────────────
# Backwards-compat alias (removed in Task 8 along with import_recipes command)
# ─────────────────────────────────────────────────────────────────────────


def import_all(config: Config) -> None:
    """Deprecated: kept until Task 8 deletes import_recipes command + reset hook."""
    push_bundles(config)
```

Delete those lines (the section comment and the function).

- [ ] **Step 7: Verify help works for both new and removed commands**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run mfc --help 2>&1 | grep -E "(import-recipes|sync-recipes|sync-images|migrate-image-urls)"
```

Expected:
- `sync-recipes`, `sync-images`, `migrate-image-urls` appear.
- `import-recipes` does NOT appear.

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run mfc sync-recipes --help
```

Expected:
```
usage: mfc sync-recipes [-h] --direction {pull,push,both} [--recipe RECIPE]
...
```

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run mfc import-recipes --help 2>&1 | head -3
```

Expected:
```
usage: mfc [-h] [--env-file ENV_FILE] [--yes] {...} ...
mfc: error: argument cmd: invalid choice: 'import-recipes' (choose from ...)
```

- [ ] **Step 8: Smoke-test sync-recipes**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing/automation && uv run mfc sync-recipes --direction push --recipe butter-chicken
```

Expected: same output shape as Task 7 step 4 (bundle pushed successfully).

- [ ] **Step 9: Commit**

```bash
git add automation/mfc/cli.py automation/mfc/commands/sync_recipes.py automation/mfc/commands/reset.py automation/mfc/ops/recipes.py
git rm automation/mfc/commands/import_recipes.py
git commit -m "feat(cli): mfc sync-recipes — replaces mfc import-recipes

Deletes commands/import_recipes.py and the import_all alias in
ops/recipes.py. reset command now calls push_bundles directly."
```

---

## Task 9: Makefile — add `sync-recipes`, remove `import-recipes`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add `sync-recipes` to .PHONY, remove `import-recipes`**

Edit `Makefile`. Find:

```make
.PHONY: help sync status apply-schema seed-metrics import-recipes \
        sync-images migrate-image-urls \
        list-users set-role drop-schema reset serve
```

Replace with:

```make
.PHONY: help sync status apply-schema seed-metrics \
        sync-recipes sync-images migrate-image-urls \
        list-users set-role drop-schema reset serve
```

- [ ] **Step 2: Remove the `import-recipes` target, add `sync-recipes`**

Edit `Makefile`. Find:

```make
import-recipes: ## upsert ingredients, utensils, and recipes from web/assets/recipes/
	@$(UV) run mfc import-recipes
```

Replace with:

```make
sync-recipes: ## sync recipe metadata bucket↔local; chains sync-images in same direction
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-recipes --direction $(DIRECTION) && \
	  $(UV) run mfc sync-images  --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — DB+Storage → local. Recipe rows become recipe.json files; bytes pulled into web/assets/recipes/.\n"; \
	  printf "  push — local → DB+Storage. Bundle JSONs upserted into DB; local images pushed to Storage.\n"; \
	  printf "  both — pull then push. Last-modified wins per recipe and per image.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-recipes --direction $$d && $(UV) run mfc sync-images --direction $$d; \
	fi
```

- [ ] **Step 3: Verify help and the new chaining target**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make help
```

Expected: `sync-recipes` appears; `import-recipes` does not.

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-recipes DIRECTION=push 2>&1 | tail -10
```

Expected: a recipe-push pass followed by an image-push pass; both succeed.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(make): sync-recipes target; remove import-recipes

sync-recipes is interactive (prompts) or accepts DIRECTION=. Chains
sync-images in the same direction so a single command round-trips
metadata + bytes."
```

---

## Task 10: Browser image-upload helper — `web/assets/js/lib/image-upload.js`

**Files:**
- Create: `web/assets/js/lib/image-upload.js`
- Modify: `web/admin/recipe.html` (add `<script>` tags for the helper + browser-image-compression)

- [ ] **Step 1: Add the helper script + the compression library to `recipe.html`**

Edit `web/admin/recipe.html`. Find the existing script block. Insert two new lines BEFORE the `<script type="text/babel" src="../assets/js/app/admin-recipe-app.jsx">` line:

```html
<script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
<script src="../assets/js/lib/image-upload.js"></script>
```

The result should look like:
```html
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" crossorigin="anonymous"></script>

<div id="root"></div>

<script type="text/babel" src="../assets/js/lib/admin-shared.jsx"></script>
<script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
<script src="../assets/js/lib/image-upload.js"></script>
<script type="text/babel" src="../assets/js/app/admin-recipe-app.jsx"></script>
```

- [ ] **Step 2: Write the helper module**

Create `web/assets/js/lib/image-upload.js`:

```javascript
// MFC.imageUpload — shared helper for browser image uploads to the
// recipe-images bucket. Compresses client-side then uses supabase-js to
// upload via the admin's authenticated session (RLS gated by is_admin()).
//
// All paths are scoped to <recipeId>/<filename>. Path traversal is rejected.

(function () {
  const BUCKET = "recipe-images";
  const HERO_OPTS = {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 2048,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.8,
  };
  const STEP_OPTS = {
    maxSizeMB: 0.3,
    maxWidthOrHeight: 1024,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.8,
  };

  function ensureSafePath(recipeId, filename) {
    if (!recipeId || /[/\\]/.test(recipeId) || recipeId.includes("..")) {
      throw new Error(`invalid recipeId: ${recipeId}`);
    }
    if (!filename || /[/\\]/.test(filename) || filename.includes("..")) {
      throw new Error(`invalid filename: ${filename}`);
    }
    return `${recipeId}/${filename}`;
  }

  function publicUrl(path) {
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function compress(file, kind) {
    const opts = kind === "step" ? STEP_OPTS : HERO_OPTS;
    if (!window.imageCompression) {
      // browser-image-compression CDN load failed — fall back to raw upload
      return file;
    }
    return await window.imageCompression(file, opts);
  }

  async function upload(file, { recipeId, filename, kind }) {
    const path = ensureSafePath(recipeId, filename);
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    const compressed = await compress(file, kind);
    const { error } = await sb.storage.from(BUCKET).upload(path, compressed, {
      cacheControl: "3600",
      upsert: true,
      contentType: "image/jpeg",
    });
    if (error) throw error;
    return publicUrl(path);
  }

  function urlFor(recipeId, filename) {
    return publicUrl(ensureSafePath(recipeId, filename));
  }

  async function remove(paths) {
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    if (!Array.isArray(paths) || paths.length === 0) return;
    paths.forEach((p) => {
      // Sanity-check shape; quietly drop anything malformed.
      if (typeof p !== "string" || !p.includes("/") || p.includes("..")) {
        throw new Error(`invalid storage path: ${p}`);
      }
    });
    const { error } = await sb.storage.from(BUCKET).remove(paths);
    if (error) throw error;
  }

  async function move(from, to) {
    const sb = window.MFC?.supabase;
    if (!sb) throw new Error("MFC.supabase not initialised");
    const { error } = await sb.storage.from(BUCKET).move(from, to);
    if (error) throw error;
  }

  window.MFC = window.MFC || {};
  window.MFC.imageUpload = { upload, urlFor, remove, move };
})();
```

- [ ] **Step 3: Smoke-test the assets serve and the helper loads**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "image-upload.js: %{http_code}\n" http://localhost:8080/assets/js/lib/image-upload.js
curl -s -o /dev/null -w "recipe.html: %{http_code}\n" http://localhost:8080/admin/recipe.html
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected:
```
image-upload.js: 200
recipe.html: 200
done
```

- [ ] **Step 4: Commit**

```bash
git add web/admin/recipe.html web/assets/js/lib/image-upload.js
git commit -m "feat(admin): MFC.imageUpload helper

Shared helper for browser image uploads to the recipe-images bucket.
Compresses with browser-image-compression (loaded from CDN), enforces
<recipeId>/<filename> path shape (rejects traversal), and exposes
upload/urlFor/remove/move via window.MFC.imageUpload."
```

---

## Task 11: Hero image control on `/admin/recipe.html`

**Files:**
- Modify: `web/assets/js/app/admin-recipe-app.jsx`

- [ ] **Step 1: Inspect the existing hero section**

```bash
grep -nE "hero|media\.image" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/app/admin-recipe-app.jsx | head -20
```

Note where the recipe state is set, where save is called, and where (if anywhere) the hero is currently rendered/edited. The hero control fits inside the existing recipe-form layout — no new top-level layout work.

- [ ] **Step 2: Add a `HeroImageControl` component to admin-recipe-app.jsx**

Edit `web/assets/js/app/admin-recipe-app.jsx`. Add this component near the other form components (search for an existing `function` definition like `IngredientsEditor` or similar to pick a sensible insertion point — alphabetical or near hero-adjacent fields):

```jsx
function HeroImageControl({ recipeId, value, onChange }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const inputRef = React.useRef(null);

  async function pickFile() {
    inputRef.current?.click();
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const url = await window.MFC.imageUpload.upload(file, {
        recipeId, filename: "hero.jpg", kind: "hero",
      });
      // Cache-bust on save: append ?v=<ts> so an immediate replace shows new
      const bust = `${url}?v=${Date.now()}`;
      onChange(bust);
    } catch (x) {
      setErr(x?.message || String(x));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function removeHero() {
    if (!value) return;
    if (!confirm("Remove hero image? This deletes hero.jpg from Storage.")) return;
    setBusy(true); setErr(null);
    try {
      await window.MFC.imageUpload.remove([`${recipeId}/hero.jpg`]);
      onChange(null);
    } catch (x) {
      setErr(x?.message || String(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hero-image-control">
      <div className="hero-image-preview">
        {value
          ? <img src={value} alt="hero" />
          : <div className="hero-image-empty">No hero yet</div>}
      </div>
      <div className="hero-image-actions">
        <button
          type="button"
          className="btn-sm"
          onClick={pickFile}
          disabled={busy}
        >
          {busy ? "Uploading…" : value ? "Replace" : "Upload hero"}
        </button>
        {value && (
          <button
            type="button"
            className="btn-sm danger"
            onClick={removeHero}
            disabled={busy}
          >Remove</button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={onFile}
        />
      </div>
      {err && <div className="hero-image-err">Upload failed: {err}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Wire `HeroImageControl` into the recipe form**

Find the form rendering for the recipe's hero/media. The recipe state object is shaped like `{ ..., media: { image, hero: { src, ... }, ... }, ... }`. Locate the section where `recipe.media.image` (or `recipe.media.hero.src`) is currently rendered or edited.

Insert the control such that:

```jsx
<HeroImageControl
  recipeId={recipe.id}
  value={recipe.media?.image || recipe.media?.hero?.src || null}
  onChange={(url) => {
    setRecipe((r) => ({
      ...r,
      media: {
        ...(r.media || {}),
        image: url,
        hero: { ...(r.media?.hero || {}), src: url },
      },
    }));
  }}
/>
```

The exact location depends on the existing form layout — look for where other media fields are rendered or where the user can edit `tagline`/`cuisine`-adjacent fields. If unsure, place it just below the recipe header fields.

- [ ] **Step 4: Add CSS for the hero control**

Find the end of `web/assets/css/admin-styles.css`:

```bash
wc -l /Users/amanrai/Documents/Code/mfc-landing/web/assets/css/admin-styles.css
```

Append:

```css

/* ── hero image control (admin) ───────────────────────────────────── */
.hero-image-control {
  display: flex; gap: 14px; align-items: flex-start;
  margin: 12px 0 18px;
}
.hero-image-preview {
  width: 220px; height: 140px;
  border: 1.5px solid var(--ink);
  border-radius: 12px;
  overflow: hidden;
  display: grid; place-items: center;
  background: var(--cream-deep);
}
.hero-image-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-image-empty {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-muted);
}
.hero-image-actions { display: flex; flex-direction: column; gap: 8px; }
.hero-image-err {
  margin-top: 6px;
  color: var(--berry);
  font-size: 12px;
}
```

- [ ] **Step 5: Smoke-test in browser**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve
```

Open `http://localhost:8080/admin/recipe.html?id=butter-chicken` in a browser, signed in as the admin user. Expected:
- Hero preview shows the existing image (now served from `*.supabase.co`).
- "Replace" button visible.
- Click Replace → file picker → pick a JPEG → upload completes → preview updates.
- Reload the page (or go to `/recipe.html?id=butter-chicken`) → new image renders.
- "Remove" deletes the hero from Storage; preview reverts to "No hero yet".

(Re-upload the original image to restore state if needed: drop the original file with the picker.)

Stop the server: `lsof -ti :8080 | xargs kill -9 2>/dev/null`.

- [ ] **Step 6: Commit**

```bash
git add web/assets/js/app/admin-recipe-app.jsx web/assets/css/admin-styles.css
git commit -m "feat(admin): hero image upload control

Adds HeroImageControl component to /admin/recipe.html. Pick → compress
(via MFC.imageUpload) → upload to recipe-images/<id>/hero.jpg →
update recipe.media.image and recipe.media.hero.src. Replace replaces;
Remove deletes the Storage object and clears the fields."
```

---

## Task 12: Step image controls + reorder rename + delete cascade

**Files:**
- Modify: `web/assets/js/app/admin-recipe-app.jsx`

- [ ] **Step 1: Add a `StepImageControl` component**

Edit `web/assets/js/app/admin-recipe-app.jsx`. Add near the `HeroImageControl` from Task 11:

```jsx
function StepImageControl({ recipeId, sortOrder, value, onChange }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const inputRef = React.useRef(null);

  async function pickFile() { inputRef.current?.click(); }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const url = await window.MFC.imageUpload.upload(file, {
        recipeId,
        filename: `step-${sortOrder}.jpg`,
        kind: "step",
      });
      onChange(`${url}?v=${Date.now()}`);
    } catch (x) {
      setErr(x?.message || String(x));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function removeStepImage() {
    if (!value) return;
    if (!confirm(`Remove image for step ${sortOrder}?`)) return;
    setBusy(true); setErr(null);
    try {
      await window.MFC.imageUpload.remove([`${recipeId}/step-${sortOrder}.jpg`]);
      onChange(null);
    } catch (x) {
      setErr(x?.message || String(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="step-image-control">
      <div className="step-image-preview">
        {value
          ? <img src={value} alt={`step ${sortOrder}`} />
          : <div className="step-image-empty">no img</div>}
      </div>
      <div className="step-image-actions">
        <button type="button" className="btn-sm" onClick={pickFile} disabled={busy}>
          {busy ? "…" : value ? "Replace" : "Upload"}
        </button>
        {value && (
          <button type="button" className="btn-sm danger" onClick={removeStepImage} disabled={busy}>Remove</button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={onFile}
        />
      </div>
      {err && <div className="step-image-err">{err}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Wire `StepImageControl` into the step editor**

Find the step list / step editor in `admin-recipe-app.jsx` (search for `recipe_steps`, `steps.map`, `sort_order`, or `media_caption`). For each step rendering, add:

```jsx
<StepImageControl
  recipeId={recipe.id}
  sortOrder={step.sort_order ?? (idx + 1)}
  value={step.media_src || null}
  onChange={(url) => {
    setRecipe((r) => ({
      ...r,
      steps: r.steps.map((s, i) =>
        i === idx ? { ...s, media_src: url } : s
      ),
    }));
  }}
/>
```

`idx` is the iteration index in the steps map; adjust to match the existing step-render code's variable name.

- [ ] **Step 3: Two-phase rename on step reorder**

Find the existing reorder handler in `admin-recipe-app.jsx` (search for `move`, `arrayMove`, `dnd`, `reorder`, or `sort_order`). Add a helper that runs after step indices are recomputed and before save:

```jsx
async function renameStepImagesAfterReorder(recipeId, oldSteps, newSteps) {
  // Map: old sort_order → new sort_order, but only for steps that have images
  // and changed position. Use a stable identifier (step id from DB) to match
  // old to new; if step uses an in-memory uuid/temp id, keep it through reorder.
  const moves = [];
  for (const newStep of newSteps) {
    const matching = oldSteps.find((o) => o.tempId === newStep.tempId || o.id === newStep.id);
    if (!matching) continue;
    if (!matching.media_src) continue;
    if (matching.sort_order === newStep.sort_order) continue;
    moves.push({
      from: `${recipeId}/step-${matching.sort_order}.jpg`,
      to:   `${recipeId}/step-${newStep.sort_order}.jpg`,
      newSortOrder: newStep.sort_order,
      oldSortOrder: matching.sort_order,
      stepIdentifier: newStep.tempId || newStep.id,
    });
  }
  if (moves.length === 0) return newSteps;

  // Phase 1: move all to temp paths.
  const ts = Date.now();
  for (const m of moves) {
    const tempPath = `${recipeId}/step-${m.oldSortOrder}.tmp-${ts}.jpg`;
    await window.MFC.imageUpload.move(m.from, tempPath);
    m.tempPath = tempPath;
  }
  // Phase 2: move from temp to final.
  for (const m of moves) {
    await window.MFC.imageUpload.move(m.tempPath, m.to);
  }

  // Update media_src on each affected step to its new public URL.
  const updated = newSteps.map((s) => {
    const m = moves.find((x) => x.stepIdentifier === (s.tempId || s.id));
    if (!m) return s;
    const url = window.MFC.imageUpload.urlFor(recipeId, `step-${m.newSortOrder}.jpg`);
    return { ...s, media_src: `${url}?v=${ts}` };
  });
  return updated;
}
```

Wire it into the existing reorder save path. The exact insertion depends on the editor's structure; the helper takes the pre-reorder steps and the post-reorder steps (with updated `sort_order`) and returns the steps with updated `media_src`. Call it before the recipe save:

```jsx
// somewhere in the reorder/save flow:
const renamedSteps = await renameStepImagesAfterReorder(recipe.id, oldSteps, newSteps);
setRecipe((r) => ({ ...r, steps: renamedSteps }));
// then proceed with save
```

If the editor doesn't model "tempId" on each step today, generate one when the step is first added or when the editor mounts:
```jsx
// When initialising / loading recipe
recipe.steps = recipe.steps.map((s) => ({ ...s, tempId: s.tempId || crypto.randomUUID() }));
```

- [ ] **Step 4: Storage cleanup in the recipe-delete handler**

Find the existing delete handler (search for `deleteRecipe` or the row-action handler in `admin-recipes-app.jsx` if delete lives in the list view, or the editor's delete button if it lives there). Wherever the delete confirmation succeeds, add a Storage cleanup before/after the DB delete:

```jsx
async function deleteRecipeWithStorage(recipe) {
  // Best-effort Storage cleanup; orphans cleared by future gc-images.
  const paths = [`${recipe.id}/hero.jpg`];
  for (const s of (recipe.steps || [])) {
    paths.push(`${recipe.id}/step-${s.sort_order}.jpg`);
  }
  try {
    await window.MFC.imageUpload.remove(paths);
  } catch (e) {
    console.warn("[admin] storage cleanup failed (orphans may remain)", e);
  }
  // Existing DB delete:
  await window.MFC.adminDb.deleteRecipe(recipe.id);
}
```

Replace the existing `MFC.adminDb.deleteRecipe(...)` call with `deleteRecipeWithStorage(recipe)`.

- [ ] **Step 5: Append CSS for step image control**

Append to `web/assets/css/admin-styles.css`:

```css

/* ── step image control (admin) ───────────────────────────────────── */
.step-image-control {
  display: flex; gap: 10px; align-items: center;
  margin: 8px 0;
}
.step-image-preview {
  width: 90px; height: 60px;
  border: 1px solid var(--rule);
  border-radius: 6px;
  overflow: hidden;
  display: grid; place-items: center;
  background: var(--cream-soft);
}
.step-image-preview img { width: 100%; height: 100%; object-fit: cover; }
.step-image-empty {
  font-family: var(--mono); font-size: 10px;
  color: var(--ink-faint);
}
.step-image-actions { display: flex; gap: 6px; }
.step-image-err { color: var(--berry); font-size: 11px; }
```

- [ ] **Step 6: Smoke-test step + reorder in browser**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve
```

Open `/admin/recipe.html?id=butter-chicken`:

1. Each step row shows the step-image control with its existing image preview.
2. Upload a fresh image to step 1 → preview updates → save the recipe → reload `/recipe.html?id=butter-chicken` → new step 1 image renders.
3. Reorder steps (drag to swap step 2 and step 3, save) → verify in Supabase Studio that `<id>/step-2.jpg` and `<id>/step-3.jpg` were swapped → reload `/recipe.html?id=butter-chicken` → step images correspond to the new order.
4. Delete a different recipe (one you won't miss) → verify its Storage folder is empty in Studio.

Stop server: `lsof -ti :8080 | xargs kill -9 2>/dev/null`.

- [ ] **Step 7: Commit**

```bash
git add web/assets/js/app/admin-recipe-app.jsx web/assets/css/admin-styles.css
git commit -m "feat(admin): step image controls + reorder rename + delete cascade

StepImageControl per step (upload/replace/remove). Two-phase rename on
step reorder (temp → final) keeps Storage filenames matching sort_order.
Recipe delete cascades to Storage (best-effort; orphans deferred to a
future gc-images)."
```

---

## Task 13: Documentation updates

**Files:**
- Modify: `docs/USER-TODO.md` (§6 rewrite)
- Modify: `CLAUDE.md` (catalog bullet, new storage layer bullet, make-target list)
- Modify: `automation/README.md` (layout tree)

- [ ] **Step 1: Rewrite USER-TODO.md §6**

Open `docs/USER-TODO.md`. Find `## 6. Import the recipes (one-time)`.

Replace the entire §6 section with:

```markdown
## 6. Sync recipes

All recipe data (rows + child rows + bundle JSON + images) stays consistent
across local and Supabase via the sync commands. Push for upload, pull for
download.

### First-time setup after enabling Storage

Run these once after `make apply-schema` adds the `recipe_steps.media_src`
column and creates the `recipe-images` bucket.

```bash
make sync-images DIRECTION=push   # uploads web/assets/recipes/*/*.jpg into the bucket
make migrate-image-urls           # rewrites recipe rows to point at Storage URLs
```

Verify by loading any recipe page locally; images should now load from
`*.supabase.co/storage/v1/object/public/recipe-images/...`. After verified,
`git rm web/assets/recipes/*/*.jpg` is optional cleanup; bundle JSON files
(`recipe.json`) stay — they're still used by `mfc sync-recipes`.

### Ongoing

```bash
make sync-recipes                  # interactive: prompts for direction
make sync-recipes DIRECTION=push   # local → DB + bytes pushed to Storage
make sync-recipes DIRECTION=pull   # DB → local; rebuilds recipe.json from rows

make sync-images                   # interactive
make sync-images DIRECTION=pull    # bulk-image processing: pull → process → push
```

### What pull writes

`web/assets/recipes/<id>/recipe.json` is overwritten from DB; image files
appear under the same directory. The bundle shape is identical to what push
reads, so a pull-then-push round-trip is lossless.
```

- [ ] **Step 2: Update CLAUDE.md — catalog bullet + new storage bullet**

Open `CLAUDE.md`. Find the "Catalog" bullet:

```
- **Catalog** — `recipes`, `recipe_ingredients`, `recipe_steps`, `recipe_utensils`,
  `recipe_tags`, `recipe_health_facts`. Public read, admin writes via secret key
  or signed-in admin user (RLS via `public.is_admin()`).
```

Replace with:

```
- **Catalog** — `recipes`, `recipe_ingredients`, `recipe_steps` (with
  `media_src` for the full Supabase Storage URL of the step image),
  `recipe_utensils`, `recipe_tags`, `recipe_health_facts`. Public read,
  admin writes via secret key or signed-in admin user (RLS via
  `public.is_admin()`).
```

Find the "Admin gate" bullet at the end of the Schema-layers section. Add a new bullet AFTER it:

```
- **Storage** — `recipe-images` bucket (public read, admin-write via RLS).
  Hero at `<recipe_id>/hero.jpg`, step images at
  `<recipe_id>/step-<sort_order>.jpg`. Full Storage URLs are stored on
  `recipes.media.image`, `recipes.media.hero.src`, and
  `recipe_steps.media_src`.
```

- [ ] **Step 3: Update CLAUDE.md make-target list**

Find the `## Dev` section's command list. Locate:

```
make import-recipes  # supabase: …
```

…or, if the list doesn't currently mention `import-recipes` (it may not — depends on the current state), find the existing list of make targets. Replace the line(s) such that the relevant block reads:

```
make sync-images       # supabase: sync images bucket↔local; interactive (or DIRECTION=)
make sync-recipes      # supabase: sync recipes (DB + bundles + images); interactive (or DIRECTION=)
make migrate-image-urls# one-shot: rewrite legacy paths to full Storage URLs
```

Remove any line that mentions `make import-recipes`.

- [ ] **Step 4: Update automation/README.md layout tree**

Open `automation/README.md`. Find the "Layout" tree:

```
mfc/                the Python package
  cli.py            argparse + command registry
  core/             config, log, prompts, files (filesystem helpers)
  clients/          pg (psycopg) + sb (supabase-py) factories
  ops/              schema, seed, recipes — task-category logic
  commands/         thin CLI wrappers, one per `mfc <cmd>`
```

Replace the `ops/` line with:

```
  ops/              schema, seed, recipes (bidirectional sync), images
```

- [ ] **Step 5: Verify markdown renders cleanly (visual scan)**

```bash
grep -nE "^## " /Users/amanrai/Documents/Code/mfc-landing/docs/USER-TODO.md | head
```

Expected: §6 still appears in the section list with the new title "Sync recipes".

- [ ] **Step 6: Commit**

```bash
git add docs/USER-TODO.md CLAUDE.md automation/README.md
git commit -m "docs: images + sync — USER-TODO §6 rewrite, CLAUDE.md storage layer, README layout"
```

---

## Task 14: End-to-end smoke verification

**Files:**
- (No code changes; live verification.)

- [ ] **Step 1: CLI — list-users still works (regression check from #1)**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make list-users
```

Expected: shows your admin row. (Sanity check that the cli.py rewrites in this plan didn't break #1's commands.)

- [ ] **Step 2: CLI — sync-images push idempotent**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-images DIRECTION=push
```

Expected: `↑ 0 uploaded · - N skipped · ! 0 conflicts` (everything already up).

- [ ] **Step 3: CLI — sync-recipes pull round-trips losslessly**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-recipes DIRECTION=pull
echo "---"
git -C /Users/amanrai/Documents/Code/mfc-landing diff --stat web/assets/recipes/
```

Expected: pull completes without errors. The diff stat may show changes (bundle JSON now reflects current DB state, including post-migration URLs). These are the canonical-from-DB bundles; if they look right, they can be committed in a separate documentation commit (not part of this plan).

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing checkout -- web/assets/recipes/
```

Restores files (no commit needed for this plan).

- [ ] **Step 4: CLI — sync-recipes push rebuilds DB from local bundles**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-recipes DIRECTION=push
```

Expected: each recipe processed; `↑ N pushed`.

- [ ] **Step 5: Browser — recipe page renders entirely from Supabase**

Open `http://localhost:8080/recipe.html?id=butter-chicken` (after `make serve`).

DevTools → Network → filter on `supabase.co`. Verify hero + step images all load from `*.supabase.co/storage/v1/object/public/recipe-images/...`. None should load from `web/assets/recipes/...`.

- [ ] **Step 6: Browser — admin upload round-trip**

Still in browser:
1. Sign in as admin (`raiaman15@gmail.com`).
2. Open `/admin/recipe.html?id=<some recipe>`.
3. Replace the hero with a fresh JPEG.
4. Save the recipe.
5. Reload `/recipe.html?id=<same recipe>`.

Expected: the new hero is visible.

- [ ] **Step 7: Browser — admin step reorder preserves images**

Same recipe (or any with multiple step images):
1. In `/admin/recipe.html?id=<id>`, drag step 1 below step 2 (or whichever reorder UI exists).
2. Save.
3. Reload `/recipe.html?id=<id>`.

Expected: step images appear in the NEW order, matching their step content.

Verify via Studio (or MCP `execute_sql`):
```sql
SELECT recipe_id, sort_order, media_src
FROM public.recipe_steps
WHERE recipe_id = '<id>'
ORDER BY sort_order;
```

`media_src` URLs should reflect the new sort_order in their filenames (`step-1.jpg`, `step-2.jpg`, ...).

- [ ] **Step 8: Browser — admin delete cascades**

Pick a throwaway recipe (or create one via `make sync-recipes DIRECTION=push` after dropping a tiny `recipe.json` + image into `web/assets/recipes/`):
1. Delete it via the admin UI.
2. Verify (via Studio) that the recipe row is gone.
3. Verify (via Studio → Storage) that the recipe folder under `recipe-images/` is empty/gone.

- [ ] **Step 9: Tag the milestone (optional)**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing
git tag -a images-storage-and-sync -m "Sub-project #2.5: images on Storage + bidirectional sync complete"
```

(No push; operator may want to review before publishing the tag.)

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task(s) |
|---|---|
| Schema (`recipe_steps.media_src`, bucket, RLS) | Task 1 |
| `mfc.ops.images` (sync_files, migrate_urls, storage_url) | Task 2 |
| `mfc sync-images` command | Task 3 |
| `mfc migrate-image-urls` command | Task 4 |
| Makefile `sync-images` + `migrate-image-urls` | Task 5 |
| Live initial migration (push bytes + rewrite URLs) | Task 6 |
| `mfc.ops.recipes` rewrite (push/pull/sync) | Task 7 |
| `mfc sync-recipes` + delete `mfc import-recipes` | Task 8 |
| Makefile `sync-recipes` + remove `import-recipes` | Task 9 |
| Browser `MFC.imageUpload` helper | Task 10 |
| Hero image control on /admin/recipe.html | Task 11 |
| Step image controls + reorder + delete cascade | Task 12 |
| USER-TODO.md / CLAUDE.md / automation/README.md | Task 13 |
| End-to-end smoke | Task 14 |
| Out-of-scope items | (intentionally not addressed) |

All spec sections covered.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / vague error-handling phrases remain. Each step shows the actual content the engineer needs.

**Type / signature consistency:**

- `BUCKET = "recipe-images"` constant used in Task 2 (Python) and Task 10 (JS). Same string.
- Storage path conventions: `<recipe_id>/hero.jpg`, `<recipe_id>/step-<sort_order>.jpg` — used identically in Task 2 (Python sync), Task 6 (verification SQL), Tasks 10–12 (JS), Task 14 (verification SQL).
- `SyncReport` dataclass has different fields in `mfc.ops.images` (uploaded/downloaded/skipped/conflicts) vs `mfc.ops.recipes` (pushed/pulled/skipped/failed) — this is intentional; they describe different domains. Both have `.line()` returning the formatted summary.
- `MFC.imageUpload.upload(file, { recipeId, filename, kind })` signature matches in Task 10 (definition) and Tasks 11–12 (call sites). `kind` is `"hero"` or `"step"`.
- `_decide` decision rule's table in Task 2 step 1 matches the spec's per-file rule table.

**Known caveats** (documented in spec, restated for the implementer):

- Removing `mfc import-recipes` is hard (no deprecation alias). Done in Task 8 alongside the `reset.py` update so destructive `make reset` keeps working.
- Two-phase rename on step reorder needs the editor to track a stable per-step identifier (`tempId` proposed in Task 12). If the existing editor already has one, use it; otherwise generate via `crypto.randomUUID()` on step add/load.
- Storage delete is best-effort client-side. Task 12 logs warnings on failure rather than blocking the recipe delete.
- Cache-busting: hero/step uploads append `?v=<timestamp>` so an immediate replace in the same session shows the new image without a hard reload. The DB stores the URL with the `?v=...` suffix; that's harmless but does mean a re-pull will write that suffix into bundle JSON. If you'd rather strip the suffix, do it in `recipes.media.image` setter before save — small change inside Task 11/12's `onChange` callbacks.
