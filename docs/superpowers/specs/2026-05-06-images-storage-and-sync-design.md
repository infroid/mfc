# Images on Storage + Bidirectional Sync — Design

- **Date:** 2026-05-06
- **Status:** Approved (brainstorm). Ready for implementation plan.
- **Sub-project:** #2.5 of the broader role/ownership/transfer/freeze + image-management rollout.

## Context

Sub-project #1 (roles foundation) shipped on 2026-05-05. Subsequent brainstorming for #2 (recipe ownership) surfaced an open question: chef-authored recipes need an in-browser path to upload hero + step images, but today's image flow is static-files-checked-into-git served by GitHub Pages — no browser write path exists.

This spec is sub-project **#2.5** — image storage + bidirectional sync. It lands before #2 so the chef workspace in #2 inherits the upload component. It is independently valuable: admin gets browser-based image management for the existing recipes, and the operator gets bulk-image tooling regardless of ownership.

Decomposition order: ✅ #1 (roles) → **#2.5 (images + sync)** → #2 (ownership) → #3 (transfer) → #4 (freeze).

## Goals

- Move all recipe images (hero + step) to Supabase Storage. **Full migration** of existing imported recipes (not additive).
- Store the **full Supabase Storage URL** on the recipe row (`recipes.media.image`, `recipes.media.hero.src`, `recipe_steps.media_src`).
- Storage path naming exactly matches today's local-file naming so migration is a pure DB rewrite (no Storage renames needed): `<recipe_id>/hero.jpg`, `<recipe_id>/step-<sort_order>.jpg`.
- Provide browser image upload on `/admin/recipe.html` (hero + per-step), with client-side compression. Reusable component for #2's chef workspace.
- Provide three Python CLI commands:
  - `mfc sync-images --direction pull|push|both` — bytes sync between bucket and local.
  - `mfc sync-recipes --direction pull|push|both` — metadata sync between DB and bundle JSON, replacing today's `mfc import-recipes`.
  - `mfc migrate-image-urls` — one-shot DB rewriter for the initial migration (idempotent).
- Provide three Make targets: `sync-images`, `sync-recipes`, `migrate-image-urls`. The two sync targets are interactive (prompt for direction) or accept `DIRECTION=`. `make sync-recipes` chains image sync in the same direction.
- Remove `mfc import-recipes` (CLI command) and `make import-recipes` (Make target) outright.

## Non-goals (deferred)

- **Recipe ownership** (`recipes.owner_id`, chef-write RLS, chef workspace UI) → sub-project #2. Storage RLS in #2.5 is admin-only; #2 will tighten to admin-or-owning-chef.
- **Ownership transfer with admin approval** → sub-project #3.
- **Global freeze switch** → sub-project #4.
- **Image transformations server-side** (on-demand resize, format negotiation, CDN). If/when egress or quality demands it, a follow-up spec swaps to R2 + an image proxy.
- **`mfc gc-images`** — orphan-Storage-object cleanup. Deferred until orphans appear.
- **Storage usage / egress alerts.** Deferred; eyeball the Supabase project page.

## Decisions captured

1. **Bucket access model** — `recipe-images`, **public-read**. Recipes are public; signed URLs add complexity for zero gain.
2. **Storage path = local path, byte-for-byte.** Hero: `<recipe_id>/hero.jpg`. Step: `<recipe_id>/step-<sort_order>.jpg`. Trade-off accepted: step reorders rename Storage objects via a two-phase rename. Bounded cost; preserves migration parity.
3. **DB stores full Supabase URLs** (not paths). Trade-off acknowledged: a future swap to a different image host (e.g. R2) requires a re-run of a migration script. Chosen for simpler render-time logic.
4. **Three sync modes (pull/push/both)** at the CLI for both `sync-images` and `sync-recipes`. `both` is last-modified-wins per file (or per recipe). The two sync Make targets are interactive but accept `DIRECTION=` for non-interactive runs.
5. **`make sync-recipes` chains** `mfc sync-recipes` then `mfc sync-images` in the same direction. Operators wanting independence call the CLI directly.
6. **Existing `mfc import-recipes` and `make import-recipes` removed** outright (no deprecation alias). Their job is now `make sync-recipes DIRECTION=push`.
7. **One-shot migration via separate command** (`mfc migrate-image-urls`), not folded into `sync-images push`. Keeps responsibilities clean: bytes vs DB. Idempotent, safe to re-run.
8. **Client-side compression** before upload via `browser-image-compression` (loaded from CDN). Hero ≤2048px max, JPEG q=0.8. Step ≤1024px max, JPEG q=0.8.
9. **Storage admin-only writes in #2.5.** RLS uses `is_admin()`. Sub-project #2 tightens to admin-or-owning-chef.
10. **Recipe delete cascades to Storage in the browser handler** (best-effort, client-side). If the tab closes mid-flight, objects orphan; future `gc-images` would catch these. Acceptable for #2.5.
11. **`recipe_steps.media_src` is added** as a new `text` column. Stores the full Storage URL of the step image (or NULL).
12. **No DB-side trigger for storage cleanup.** Would need pg_net or similar; deferred.

## Architecture

```
                ┌─────────────────────────────────────────┐
                │  Supabase Storage  (bucket: recipe-images)
                │     <recipe_id>/hero.jpg                 │
                │     <recipe_id>/step-<sort_order>.jpg    │
                │     public-read · is_admin() write       │
                └─────────────────────────────────────────┘
                  ▲                              ▲
                  │ supabase-js                  │
       ┌──────────┴──────────┐    ┌──────────────┴────────┐
       │ /admin/recipe.html   │    │ mfc sync-images        │
       │  upload.js           │    │  --direction pull/push/both
       └──────────────────────┘    └────────────────────────┘
                                                 ▲
                                                 │ chained by Make
       ┌─────────────────────────────────────────┴────────────┐
       │ Supabase Postgres (recipes + children + library)      │
       │     ▲                                                  │
       │     │ mfc sync-recipes  --direction pull/push/both     │
       │     │   reads/writes web/assets/recipes/<id>/recipe.json│
       └─────┴──────────────────────────────────────────────────┘
```

## Schema changes

One column, one bucket, four storage RLS policies. Idempotent.

Delivered as `automation/db/migration-2026-05-06-images-storage.sql`. Folded into `automation/db/schema.sql` next to the existing `recipe_steps` definition.

```sql
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

Service-role calls bypass RLS — `mfc sync-images` works regardless of caller role.

## Python CLI

Layout under `automation/mfc/`:

```
mfc/
  ops/
    images.py        ← bytes sync + URL rewriter (new)
    recipes.py       ← bidirectional metadata sync (rewrite of today's recipes.py)
  commands/
    sync_images.py        (new)
    sync_recipes.py       (new)
    migrate_image_urls.py (new)
    import_recipes.py     (DELETED)
  cli.py             ← register new commands; drop import_recipes
```

### `mfc.ops.images`

```python
def sync_files(config, *, direction: Literal["pull","push","both"]) -> SyncReport: ...
def migrate_urls(config) -> MigrationReport: ...
def storage_url(config, *, recipe_id: str, filename: str) -> str: ...
```

`sync_files` per-file decision rule (uses OS mtime locally vs Storage `updated_at`, with 1-second clock-skew tolerance):

| Local exists? | Storage exists? | direction=pull | direction=push | direction=both |
|---|---|---|---|---|
| ✓ | ✗ | skip | upload | upload |
| ✗ | ✓ | download | skip | download |
| ✓ | ✓, local newer | skip | upload | upload |
| ✓ | ✓, storage newer | download | skip | download |
| ✓ | ✓, equal | skip | skip | skip |

Outputs a one-line report at the end: `↓ N downloaded · ↑ M uploaded · - K skipped · ! C conflicts`.

`migrate_urls` rewrites `recipes.media.image`, `recipes.media.hero.src`, and `recipe_steps.media_src` to full Storage URLs. Detects "old format" by checking whether the value starts with `assets/`. Idempotent.

### `mfc.ops.recipes`

```python
def push_bundles(config, *, only: list[str] | None = None) -> SyncReport: ...
def pull_bundles(config, *, only: list[str] | None = None) -> SyncReport: ...
def sync(config, *, direction) -> SyncReport: ...
```

`push_bundles` covers everything today's `import_all` does (recipe + children + library). `pull_bundles` is new — reconstructs `recipe.json` from DB rows.

For `pull_bundles` to round-trip losslessly through `push_bundles`, the dumper reverses the importer:
- `recipe_ingredients` → `{name, amt, group}`
- `recipe_utensils` → `{name, essential}`
- `recipe_steps` → `{id: <sort_order>, title, detail, duration: <duration_seconds>, tip, media: {src: <media_src>, caption: <media_caption>}}`
- `recipe_tags` → `[<tag>, ...]`
- `recipe_health_facts` → `[<fact>, ...]`

Comparison key for `direction=both`: `recipes.updated_at` vs `recipe.json` file mtime. Per-recipe: only-DB → pull, only-local → push, both-present → newer side wins.

### Commands (thin argparse wrappers, ~40 LOC each)

- `sync_images.py` — `--direction {pull,push,both}`, `--recipe <id>` optional scope.
- `sync_recipes.py` — `--direction {pull,push,both}`, `--recipe <id>` optional scope.
- `migrate_image_urls.py` — no flags. Calls `images.migrate_urls`.

### `cli.py` registry update

```python
from .commands import (
    apply_schema, drop_schema,
    list_users,
    migrate_image_urls,
    reset, seed_metrics, set_role, status,
    sync_images, sync_recipes,
)

COMMAND_MODULES = [
    status, list_users,
    apply_schema, seed_metrics,
    sync_recipes,                 # was: import_recipes
    sync_images,
    migrate_image_urls,
    set_role,
    drop_schema, reset,
]
```

`mfc.commands.import_recipes` is deleted. `mfc.ops.recipes.import_all` is removed. No deprecation alias.

## Browser image upload

### `web/assets/js/lib/image-upload.js` (new)

Loaded as a `<script>` on `/admin/recipe.html`. Adds `window.MFC.imageUpload`:

```js
window.MFC.imageUpload = {
  upload: async (file, { recipeId, filename, kind }) => "<full storage URL>",
  urlFor: (recipeId, filename) => "<full storage URL>",
  remove: async (paths /* string[] */) => void,
  move: async (from, to) => void,
};
```

`browser-image-compression` loaded from CDN once. Settings:
- **Hero** (`kind: "hero"`): `maxSizeMB: 0.5, maxWidthOrHeight: 2048, useWebWorker: true, fileType: "image/jpeg"`.
- **Step** (`kind: "step"`): same but `maxWidthOrHeight: 1024`.

Path enforcement: helper rejects path traversal; only accepts `<recipeId>/<filename>` shape.

### Hero image control on `/admin/recipe.html`

Three states in the existing hero block:
- **No image** — emoji fallback shown, "Upload hero" button.
- **Has image** — preview thumbnail + Replace + Remove.
- **Uploading** — spinner.

On upload: compress → `MFC.imageUpload.upload(...)` → set `recipe.media.image` (and `recipe.media.hero.src`) → save row.

On remove: `MFC.imageUpload.remove([...])` → clear fields → save row.

### Step image controls

Per-step in the existing step editor row. Same UX scaled down. Saves to `recipe_steps.media_src`. Path: `<recipeId>/step-<sort_order>.jpg`.

### Reorder handling — two-phase rename

When the admin saves a reordered step list:
1. Compute old→new mapping for each step with `media_src` whose `sort_order` changed.
2. Phase 1: move every affected file to a temp name (`step-<oldN>.tmp-<timestamp>.jpg`).
3. Phase 2: move every temp file to its final `step-<newN>.jpg`.
4. Update each affected `media_src` and save.

~40 LOC in the recipe-editor save handler. On any failure mid-flight, files are recoverable via the temp names; rerunning a save cleans up.

### Recipe delete cascades to Storage

The existing admin `deleteRecipe` handler additionally calls:

```js
await MFC.imageUpload.remove([
  `${id}/hero.jpg`,
  ...recipe.steps.map((_, i) => `${id}/step-${i + 1}.jpg`),
]);
```

Best-effort. If the tab closes mid-flight, objects orphan; deferred to a future `gc-images`.

## Make targets and operator workflow

### Targets

```make
.PHONY: ... sync-images sync-recipes migrate-image-urls ...

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

migrate-image-urls: ## one-shot — rewrite recipe rows to use full Storage URLs (idempotent)
	@$(UV) run mfc migrate-image-urls
```

`make import-recipes` is **deleted** (target + `.PHONY` line).

### One-time migration workflow (operator)

1. `make apply-schema` — adds `recipe_steps.media_src`, creates the bucket, applies Storage RLS.
2. `make sync-images DIRECTION=push` — uploads every local `.jpg` under `web/assets/recipes/` into the bucket, identical paths.
3. `make migrate-image-urls` — rewrites `recipes.media.image`, `recipes.media.hero.src`, and `recipe_steps.media_src` to full Storage URLs.
4. Verify: load `/recipe.html?id=butter-chicken` (or any), confirm hero + step images render from `<project>.supabase.co`.
5. Optional: `git rm` the static `web/assets/recipes/*/*.jpg` files.

All steps idempotent / rerun-safe.

### Ongoing operator workflows

| Goal | Command |
|---|---|
| New admin-imported recipe (wrote `recipe.json` + dropped images locally) | `make sync-recipes DIRECTION=push` |
| Pull recent admin edits from the browser back to local for git tracking | `make sync-recipes DIRECTION=pull` |
| Bulk image processing | `make sync-images DIRECTION=pull` → process locally → `make sync-images DIRECTION=push` |
| Quick interactive sync after an unknown set of edits | `make sync-recipes` (prompts) |
| Just images, no metadata | `make sync-images` |

## Documentation

### `docs/USER-TODO.md` §6

Rewritten as "Sync recipes" — describes the first-time migration steps + ongoing workflow. The old "import recipes" boilerplate is dropped.

### `CLAUDE.md`

- **Catalog bullet** updated to mention `recipe_steps.media_src`.
- **New "Storage" bullet** under Schema layers: `recipe-images` bucket, public read, admin-write via RLS, path conventions.
- **Make-target list** gains `sync-images`, `sync-recipes`, `migrate-image-urls`. `import-recipes` line removed.

### `automation/README.md`

Layout tree updated: `ops/images.py` added; `ops/recipes.py` description changes from "recipe import" to "bidirectional recipe sync".

## Build sequence

All steps performed by the assistant; no operator handoff.

1. Write `automation/db/migration-2026-05-06-images-storage.sql`. Fold into `automation/db/schema.sql`.
2. Apply migration to live Supabase via the Supabase MCP (`apply_migration`); verify column + bucket + RLS policies.
3. Build `automation/mfc/ops/images.py` — `sync_files`, `migrate_urls`, `storage_url`.
4. Build `automation/mfc/ops/recipes.py` (rewrite) — `push_bundles`, `pull_bundles`, `sync`.
5. Build CLI commands `sync_images.py`, `sync_recipes.py`, `migrate_image_urls.py`. Register in `cli.py`. Delete `commands/import_recipes.py`.
6. Update `Makefile` — add three new targets, delete `import-recipes`.
7. Run live: `make sync-images DIRECTION=push` → `make migrate-image-urls`. Verify with a recipe-page load.
8. Build `web/assets/js/lib/image-upload.js`. Wire `browser-image-compression` from CDN.
9. Add hero + step image controls to `web/assets/js/app/admin-recipe-app.jsx`. Two-phase rename in reorder save handler. Storage cleanup in delete handler.
10. Update `docs/USER-TODO.md` §6 + `CLAUDE.md` (catalog + storage layer + make targets) + `automation/README.md`.
11. Smoke-test in browser:
    - Open existing recipe in `/admin/recipe.html` — hero + steps render from Storage.
    - Replace hero — preview updates; reload; new image persists.
    - Add step image — preview, save, reload.
    - Reorder steps with images — verify Storage filenames match new sort order.
    - Delete a recipe — verify Storage folder removed.
12. Smoke-test the CLI:
    - `make sync-images` (pick `pull`) — no-op if nothing changed.
    - `make sync-recipes DIRECTION=pull` — `recipe.json` round-trips losslessly.
    - Edit a recipe in browser → `make sync-recipes DIRECTION=pull` → change appears in local `recipe.json`.

### Pre-implementation prerequisite

- Supabase MCP authenticated from #1 (project `fqjzhntqppbcwvqtjscb`). Re-confirm before destructive calls.
- No new env vars; `SUPABASE_URL` and `SUPABASE_SECRET_KEY` already in `automation/.env`.

## Out of scope (decomposition reminder)

- Recipe ownership / chef workspace UI / chef-write Storage RLS → **#2**.
- Ownership transfer with admin approval → **#3**.
- Global freeze switch → **#4**.
- Server-side image transformations (CDN, on-demand resize, format negotiation) — Supabase Storage doesn't transform; future spec if egress or quality demands it.
- `mfc gc-images` orphan cleanup — deferred until orphans appear.
- Storage usage / egress alerts — eyeball Supabase project page for now.
- Bundle JSON schema migration — not needed; `pull_bundles` writes the same shape `push_bundles` reads.
