# Recipe Ownership + Chef Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce per-recipe ownership via a `recipe_owners` join table, build a chef portal at `/chef/`, drop `featured` + `highlight` columns + their consumers, move recipe management out of `/admin/`, and add Admin/Chef portal links to the navbar.

**Architecture:** Single source of truth for ownership is `public.recipe_owners (recipe_id, user_id)`. A trigger ensures every newly-inserted recipe gets two rows: the creator + the first admin. RLS on the catalog and on `storage.objects` checks `public.recipe_owned_by_caller(text)` against that table; admin retains blanket access via `is_admin()`. The chef portal is a clone of today's admin recipe pages with `featured`/`highlight` removed, gated by `chef-gate.js` (accepts `role ∈ {chef, admin}`). Admin uses the same chef portal — chef sees only their owned rows; admin sees all.

**Tech Stack:** Python 3.10+ (psycopg, supabase-py via uv), PL/pgSQL (migration + trigger + helpers), vanilla React via Babel-standalone (chef portal pages), Supabase MCP for the live migration.

**Spec:** [`docs/superpowers/specs/2026-05-07-recipe-ownership-design.md`](../specs/2026-05-07-recipe-ownership-design.md)

**Verification approach:** No pytest (matches the existing repo convention; see `mfc.commands.*`, `apply_schema`, `status` — none have unit tests). Each task ends with a concrete smoke check via `make`/`mfc`, the Supabase MCP `execute_sql` tool, or a browser load. Project URL: `https://fqjzhntqppbcwvqtjscb.supabase.co` (`automation/.env`); re-confirm before destructive calls.

**Pre-flight venv refresh** before starting (one-time, since iCloud Documents folder corrupts files between sessions):

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && rm -rf automation/.venv && make sync
```

If `make sync` fails with `ModuleNotFoundError: mfc`, re-run after `chflags -R nohidden automation/.venv`.

---

## Task 1: Schema migration — created_by NOT NULL, recipe_owners, trigger, RLS, drop featured/highlight

**Files:**
- Create: `automation/db/migration-2026-05-07-recipe-ownership.sql`
- Modify: `automation/db/schema.sql` (drop two columns from recipes CREATE TABLE; recipe_steps stays as-is; add recipe_owners + trigger + new helper + chef policies)

- [ ] **Step 1: Write the migration SQL**

Create `automation/db/migration-2026-05-07-recipe-ownership.sql`:

```sql
-- Migration: recipe ownership + chef portal foundation (sub-project #2)
-- Adds:
--   1. recipes.created_by → backfilled to first-admin + NOT NULL + indexed
--   2. recipe_owners (recipe_id, user_id) join table
--   3. trigger to auto-add creator + first-admin on INSERT
--   4. backfill recipe_owners for existing 154 rows
--   5. drop recipes.featured, recipes.highlight
--   6. recipe_owned_by_caller() helper (reads recipe_owners)
--   7. chef-write RLS on recipes + 5 child tables
--   8. recipe_owners RLS
--   9. Storage RLS — chef can write owned-recipe folders
--
-- Idempotent. Folded into schema.sql.

-- ── 1. recipes.created_by — backfill + NOT NULL ───────────────────────
UPDATE public.recipes
SET created_by = (
  SELECT id FROM auth.users
  WHERE raw_app_meta_data->>'role' = 'admin'
  ORDER BY created_at LIMIT 1
)
WHERE created_by IS NULL;

ALTER TABLE public.recipes ALTER COLUMN created_by SET NOT NULL;
CREATE INDEX IF NOT EXISTS recipes_created_by_idx ON public.recipes(created_by);

COMMENT ON COLUMN public.recipes.created_by IS
  'FK → auth.users.id of the row creator. Audit only. Edit-permission is in recipe_owners.';

-- ── 2. recipe_owners join table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recipe_owners (
  recipe_id  text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, user_id)
);

COMMENT ON TABLE public.recipe_owners IS
  'Per-recipe ownership ledger (single source of truth). The trigger recipes_after_insert_set_owners adds (recipe.id, recipe.created_by) and (recipe.id, first_admin) on every INSERT.';

CREATE INDEX IF NOT EXISTS recipe_owners_user_id_idx ON public.recipe_owners(user_id);

-- ── 3. Trigger: ensure creator + first-admin in recipe_owners on INSERT
CREATE OR REPLACE FUNCTION public.recipes_after_insert_set_owners()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first_admin uuid;
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.recipe_owners (recipe_id, user_id)
      VALUES (NEW.id, NEW.created_by) ON CONFLICT DO NOTHING;
  END IF;

  SELECT id INTO v_first_admin
    FROM auth.users
    WHERE raw_app_meta_data->>'role' = 'admin'
    ORDER BY created_at LIMIT 1;

  IF v_first_admin IS NOT NULL THEN
    INSERT INTO public.recipe_owners (recipe_id, user_id)
      VALUES (NEW.id, v_first_admin) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recipes_after_insert_set_owners ON public.recipes;
CREATE TRIGGER recipes_after_insert_set_owners
  AFTER INSERT ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.recipes_after_insert_set_owners();

-- ── 4. Backfill recipe_owners for existing 154 recipes ────────────────
INSERT INTO public.recipe_owners (recipe_id, user_id)
SELECT r.id, r.created_by FROM public.recipes r
ON CONFLICT DO NOTHING;

-- ── 5. Drop featured + highlight ──────────────────────────────────────
ALTER TABLE public.recipes DROP COLUMN IF EXISTS featured;
ALTER TABLE public.recipes DROP COLUMN IF EXISTS highlight;

-- ── 6. recipe_owned_by_caller — reads recipe_owners ──────────────────
CREATE OR REPLACE FUNCTION public.recipe_owned_by_caller(p_recipe_id text)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recipe_owners
    WHERE recipe_id = p_recipe_id AND user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.recipe_owned_by_caller(text) IS
  'Returns true when the calling user is in recipe_owners for the given recipe. Used by chef-write RLS on recipes + child tables and Storage RLS on recipe-images.';

-- ── 7. Chef-write RLS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "recipes_chef_write" ON public.recipes;
CREATE POLICY "recipes_chef_write" ON public.recipes FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(id))
  WITH CHECK (public.is_chef() AND (
                public.recipe_owned_by_caller(id)
                OR created_by = auth.uid()
             ));

DROP POLICY IF EXISTS "recipe_ingredients_chef_write"  ON public.recipe_ingredients;
DROP POLICY IF EXISTS "recipe_steps_chef_write"        ON public.recipe_steps;
DROP POLICY IF EXISTS "recipe_utensils_chef_write"     ON public.recipe_utensils;
DROP POLICY IF EXISTS "recipe_tags_chef_write"         ON public.recipe_tags;
DROP POLICY IF EXISTS "recipe_health_facts_chef_write" ON public.recipe_health_facts;

CREATE POLICY "recipe_ingredients_chef_write"  ON public.recipe_ingredients  FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_steps_chef_write"        ON public.recipe_steps        FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_utensils_chef_write"     ON public.recipe_utensils     FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_tags_chef_write"         ON public.recipe_tags         FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_health_facts_chef_write" ON public.recipe_health_facts FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

-- ── 8. recipe_owners RLS ──────────────────────────────────────────────
ALTER TABLE public.recipe_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recipe_owners_authenticated_read" ON public.recipe_owners;
DROP POLICY IF EXISTS "recipe_owners_admin_write"        ON public.recipe_owners;

CREATE POLICY "recipe_owners_authenticated_read"
  ON public.recipe_owners FOR SELECT TO authenticated USING (true);

CREATE POLICY "recipe_owners_admin_write"
  ON public.recipe_owners FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 9. Storage RLS — chef can write owned-recipe folders ─────────────
CREATE OR REPLACE FUNCTION public.can_write_recipe_image(path text)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR (
        public.is_chef()
        AND public.recipe_owned_by_caller(split_part(path, '/', 1))
      );
$$;

COMMENT ON FUNCTION public.can_write_recipe_image(text) IS
  'Returns true when caller is admin OR is chef and owns the recipe whose id is the first path segment. Used by storage.objects RLS for the recipe-images bucket.';

DROP POLICY IF EXISTS "recipe_images_admin_write"          ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_update"         ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_delete"         ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_owner_or_admin_write"  ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_owner_or_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_owner_or_admin_delete" ON storage.objects;

CREATE POLICY "recipe_images_owner_or_admin_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name));

CREATE POLICY "recipe_images_owner_or_admin_update"
  ON storage.objects FOR UPDATE
  USING      (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name))
  WITH CHECK (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name));

CREATE POLICY "recipe_images_owner_or_admin_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name));
```

- [ ] **Step 2: Apply the migration to the live Supabase project via MCP**

If the Supabase MCP tools aren't loaded yet:

```
ToolSearch: select:mcp__plugin_supabase_supabase__apply_migration,mcp__plugin_supabase_supabase__execute_sql,mcp__plugin_supabase_supabase__list_projects
```

Confirm the project (expected: `MyFoodCraving` at `fqjzhntqppbcwvqtjscb`):

```
mcp__plugin_supabase_supabase__list_projects
```

Apply (paste the entire contents of the migration file as the `query`):

```
mcp__plugin_supabase_supabase__apply_migration
  project_id: fqjzhntqppbcwvqtjscb
  name: recipe_ownership_2026_05_07
  query: <contents of automation/db/migration-2026-05-07-recipe-ownership.sql>
```

- [ ] **Step 3: Verify the schema state via `execute_sql`**

```sql
-- created_by is NOT NULL
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='recipes' AND column_name='created_by';

-- featured + highlight are gone
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='recipes' AND column_name IN ('featured','highlight');

-- recipe_owners table exists with RLS
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'recipe_owners' AND relnamespace = 'public'::regnamespace;

-- 154 backfilled rows
SELECT count(*) FROM public.recipe_owners;

-- Trigger registered
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.recipes'::regclass
  AND tgname = 'recipes_after_insert_set_owners';

-- Helper functions present
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_schema='public'
  AND routine_name IN ('recipe_owned_by_caller','can_write_recipe_image','recipes_after_insert_set_owners')
ORDER BY routine_name;

-- Storage policies refreshed
SELECT policyname FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'recipe_images%'
ORDER BY policyname;
```

Expected:
- `created_by` row with `is_nullable = NO`.
- Empty result for the featured/highlight query.
- One row with `relrowsecurity = true`.
- `count = 154`.
- Trigger row present.
- Three function rows: `can_write_recipe_image (DEFINER)`, `recipe_owned_by_caller (DEFINER)`, `recipes_after_insert_set_owners (DEFINER)`.
- Four storage policies: `recipe_images_owner_or_admin_delete/update/write` + `recipe_images_public_read` (latter from #2.5).

- [ ] **Step 4: Fold the changes into `automation/db/schema.sql`**

The canonical `schema.sql` needs to reflect the new shape. Three edits.

**4a — `recipes` table block: remove `featured` + `highlight`:**

```bash
grep -n "featured\|highlight" /Users/amanrai/Documents/Code/mfc-landing/automation/db/schema.sql | head
```

Find the `CREATE TABLE IF NOT EXISTS public.recipes` block. Remove these lines (column declarations):
- `featured     boolean DEFAULT false,` (or similar — the line with `featured`)
- `highlight    text,`

Find the corresponding `COMMENT ON COLUMN public.recipes.featured` and `.highlight` lines. Delete both.

Update the existing `created_by` column declaration to `NOT NULL` if it isn't already; if NOT NULL would break a fresh apply on an empty database (no rows to set the value), keep the column nullable in the CREATE TABLE and rely on the migration to enforce NOT NULL after backfill on first run. Going with the latter — schema.sql leaves `created_by` nullable; migration's `ALTER COLUMN ... SET NOT NULL` enforces it post-backfill.

Update the `created_by` COMMENT to match the migration:

```sql
COMMENT ON COLUMN public.recipes.created_by IS
  'FK → auth.users.id of the row creator. Audit only. Edit-permission is in recipe_owners.';
```

**4b — Insert `recipe_owners` table + trigger + RLS** in the appropriate section. Place after the existing recipe child tables but before §8 (admin section), around the section header for catalog tables. The block to insert:

```sql
-- ── recipe_owners — permission ledger (sub-project #2) ────────────────
CREATE TABLE IF NOT EXISTS public.recipe_owners (
  recipe_id  text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, user_id)
);

COMMENT ON TABLE public.recipe_owners IS
  'Per-recipe ownership ledger (single source of truth). Trigger recipes_after_insert_set_owners adds (recipe.id, recipe.created_by) and (recipe.id, first_admin) on every INSERT.';

CREATE INDEX IF NOT EXISTS recipe_owners_user_id_idx ON public.recipe_owners(user_id);

ALTER TABLE public.recipe_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recipe_owners_authenticated_read" ON public.recipe_owners;
DROP POLICY IF EXISTS "recipe_owners_admin_write"        ON public.recipe_owners;

CREATE POLICY "recipe_owners_authenticated_read"
  ON public.recipe_owners FOR SELECT TO authenticated USING (true);

CREATE POLICY "recipe_owners_admin_write"
  ON public.recipe_owners FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── trigger: auto-add creator + first-admin on recipes INSERT ─────────
CREATE OR REPLACE FUNCTION public.recipes_after_insert_set_owners()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first_admin uuid;
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.recipe_owners (recipe_id, user_id)
      VALUES (NEW.id, NEW.created_by) ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_first_admin
    FROM auth.users
    WHERE raw_app_meta_data->>'role' = 'admin'
    ORDER BY created_at LIMIT 1;
  IF v_first_admin IS NOT NULL THEN
    INSERT INTO public.recipe_owners (recipe_id, user_id)
      VALUES (NEW.id, v_first_admin) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recipes_after_insert_set_owners ON public.recipes;
CREATE TRIGGER recipes_after_insert_set_owners
  AFTER INSERT ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.recipes_after_insert_set_owners();
```

**4c — Update §8 (admin) to add `recipe_owned_by_caller` + chef policies + updated `can_write_recipe_image`.**

Find the existing block in §8 that defines `is_admin()`, `is_chef()`, `list_app_users()`. Below the `recipe_health_facts_admin_write` policy creation and the `recipe_images_*` storage policies (added in #2.5), insert:

```sql
-- ── chef-write helpers (sub-project #2) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.recipe_owned_by_caller(p_recipe_id text)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.recipe_owners
    WHERE recipe_id = p_recipe_id AND user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.recipe_owned_by_caller(text) IS
  'Returns true when the calling user is in recipe_owners for the given recipe. Used by chef-write RLS on recipes + child tables and Storage RLS on recipe-images.';

DROP POLICY IF EXISTS "recipes_chef_write"                ON public.recipes;
DROP POLICY IF EXISTS "recipe_ingredients_chef_write"     ON public.recipe_ingredients;
DROP POLICY IF EXISTS "recipe_steps_chef_write"           ON public.recipe_steps;
DROP POLICY IF EXISTS "recipe_utensils_chef_write"        ON public.recipe_utensils;
DROP POLICY IF EXISTS "recipe_tags_chef_write"            ON public.recipe_tags;
DROP POLICY IF EXISTS "recipe_health_facts_chef_write"    ON public.recipe_health_facts;

CREATE POLICY "recipes_chef_write" ON public.recipes FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(id))
  WITH CHECK (public.is_chef() AND (
                public.recipe_owned_by_caller(id)
                OR created_by = auth.uid()
             ));

CREATE POLICY "recipe_ingredients_chef_write"  ON public.recipe_ingredients  FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_steps_chef_write"        ON public.recipe_steps        FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_utensils_chef_write"     ON public.recipe_utensils     FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_tags_chef_write"         ON public.recipe_tags         FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));

CREATE POLICY "recipe_health_facts_chef_write" ON public.recipe_health_facts FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));
```

Find the existing `recipe_images_admin_*` Storage policies in §9 (added in #2.5). Replace the three (write/update/delete) with the owner-or-admin version. The replacement block:

```sql
-- ── Storage RLS — owner-or-admin writes (sub-project #2) ──────────────
CREATE OR REPLACE FUNCTION public.can_write_recipe_image(path text)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR (
        public.is_chef()
        AND public.recipe_owned_by_caller(split_part(path, '/', 1))
      );
$$;

COMMENT ON FUNCTION public.can_write_recipe_image(text) IS
  'Returns true when caller is admin OR is chef and owns the recipe whose id is the first path segment. Used by storage.objects RLS for the recipe-images bucket.';

DROP POLICY IF EXISTS "recipe_images_admin_write"           ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_update"          ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_delete"          ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_owner_or_admin_write"  ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_owner_or_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_owner_or_admin_delete" ON storage.objects;

CREATE POLICY "recipe_images_owner_or_admin_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name));

CREATE POLICY "recipe_images_owner_or_admin_update"
  ON storage.objects FOR UPDATE
  USING      (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name))
  WITH CHECK (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name));

CREATE POLICY "recipe_images_owner_or_admin_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'recipe-images' AND public.can_write_recipe_image(name));
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add automation/db/migration-2026-05-07-recipe-ownership.sql automation/db/schema.sql
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(db): recipe ownership — recipe_owners + trigger + chef-write RLS

Single-source-of-truth permission ledger via public.recipe_owners. Every
recipe row triggers the auto-add of (id, creator) and (id, first_admin).
Chef-write RLS on catalog tables and storage.objects checks
recipe_owned_by_caller(); admin retains is_admin() bypass. Drops
recipes.featured + recipes.highlight columns. Folded into schema.sql §8/§9."
```

---

## Task 2: ops/recipes.py — drop featured/highlight, round-trip createdBy, bulk-upsert recipe_owners

**Files:**
- Modify: `automation/mfc/ops/recipes.py`

- [ ] **Step 1: Edit `_build_recipe_row`**

Open `automation/mfc/ops/recipes.py`. Find `_build_recipe_row`. Apply this diff (drop featured/highlight, add `created_by` only when bundle has it):

```python
def _build_recipe_row(config: Config, detail: dict) -> dict:
    rid = detail["id"]
    media = dict(detail.get("media") or {})

    # Normalize image fields so legacy 'assets/...' paths upgrade to Storage URLs.
    if "image" in media:
        media["image"] = images_ops.normalize_image_value(
            config, recipe_id=rid, value=media.get("image")
        )
    hero = media.get("hero")
    if isinstance(hero, dict):
        new_hero = dict(hero)
        if "src" in new_hero:
            new_hero["src"] = images_ops.normalize_image_value(
                config, recipe_id=rid, value=new_hero.get("src")
            )
        media["hero"] = new_hero

    row = {
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
        "meal_types": [],
    }
    if detail.get("createdBy"):
        row["created_by"] = detail["createdBy"]
    return row
```

(Drops the two lines `"featured": bool(detail.get("featured")),` and `"highlight": detail.get("highlight"),`. Adds the `if detail.get("createdBy"):` at the end.)

- [ ] **Step 2: Edit `_build_bundle` (the pull-side dumper)**

Find `_build_bundle`. Replace the `featured` / `highlight` lines:

```python
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
        "createdBy": recipe_row.get("created_by"),
        "ingredients": [
            ...
```

(Removes `"featured": bool(recipe_row.get("featured")),` and `"highlight": recipe_row.get("highlight"),`. Adds `"createdBy"` from `created_by` column.)

In the strip-Nones cleanup (a few lines down) update the optional-strip list:

```python
    for k in ("tagline", "shortTagline", "color", "colorSoft", "createdBy"):
        if bundle.get(k) is None:
            del bundle[k]
```

(Drop `highlight` from the list; add `createdBy`.)

- [ ] **Step 3: Edit `push_bundles` to bulk-upsert `recipe_owners`**

Find `push_bundles`. After the `child_tables` loop (the `for table in ("recipe_tags", ...): _bulk_replace_children(...)` block), insert:

```python
    # Reconcile recipe_owners. Trigger handles the INSERT path (new rows);
    # this upsert handles UPDATE-path bundles where the trigger doesn't fire.
    owners_rows = [
        {"recipe_id": d["id"], "user_id": d["createdBy"]}
        for d in valid if d.get("createdBy")
    ]
    if owners_rows:
        sb.table("recipe_owners").upsert(
            owners_rows, on_conflict="recipe_id,user_id"
        ).execute()
        log.ok(f"recipe_owners: {len(owners_rows)} row(s) reconciled")
```

- [ ] **Step 4: Verify imports + module health**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && uv --project automation run python -c "
from mfc.ops import recipes
print('push_bundles:', recipes.push_bundles)
print('pull_bundles:', recipes.pull_bundles)
print('sync:', recipes.sync)
"
```

Expected: three function references print without exceptions. If `ModuleNotFoundError: mfc`, run `make sync` first.

- [ ] **Step 5: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add automation/mfc/ops/recipes.py
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(cli): sync — drop featured/highlight, round-trip createdBy, reconcile recipe_owners

Push: omits featured/highlight columns; sets recipes.created_by from bundle's
createdBy when present; bulk-upserts recipe_owners after the recipes upsert
to handle UPDATE-path bundles (trigger only fires on INSERT).

Pull: writes createdBy from recipes.created_by; strips featured/highlight
keys from the produced bundle JSON."
```

---

## Task 3: Live sync — populate recipe_owners + verify

**Files:**
- (No code changes; runs live commands.)

- [ ] **Step 1: Push current bundle state to refresh DB rows + recipe_owners**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-recipes DIRECTION=push 2>&1 | tail -15
```

Expected: a `recipes: 154` log line, child-table counts, and `recipe_owners: <N> row(s) reconciled` (N may be 0 if no bundle has `createdBy` yet — bundles weren't carrying that field before this task).

- [ ] **Step 2: Confirm recipe_owners is populated for every recipe**

Via Supabase MCP `execute_sql`:

```sql
SELECT
  (SELECT count(*) FROM public.recipes)            AS total_recipes,
  (SELECT count(DISTINCT recipe_id) FROM public.recipe_owners) AS distinct_owned;
```

Expected: both equal (154 = 154). Every recipe has at least one row in `recipe_owners` (the first-admin co-ownership from the backfill in Task 1).

- [ ] **Step 3: Round-trip pull → push to confirm createdBy propagates**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-recipes DIRECTION=pull 2>&1 | tail -3
```

Expected: 154 recipes pulled. The bundle JSON files now have `"createdBy": "<uuid>"`.

```bash
python3 -c "
import json
b = json.load(open('/Users/amanrai/Documents/Code/mfc-landing/web/assets/recipes/butter-chicken/recipe.json'))
print('createdBy:', b.get('createdBy'))
print('featured:' , b.get('featured', '<absent>'))
print('highlight:', b.get('highlight', '<absent>'))
"
```

Expected: `createdBy: <uuid>`, `featured: <absent>`, `highlight: <absent>`.

- [ ] **Step 4: Restore bundle files (pull rewrote them)**

The pull wrote ordered/dropped-keys versions of every bundle. Restore so the change tree stays clean:

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing checkout -- web/assets/recipes/
```

(In normal operation an admin would commit those changes as documentation of the DB state, but for this task it's verification only.)

- [ ] **Step 5: No commit (verification-only task)**

---

## Task 4: Public DB layer + recipe-search cleanup

**Files:**
- Modify: `web/assets/js/lib/db.js`
- Modify: `web/recipe-search.html`

- [ ] **Step 1: Edit `db.js` to drop columns + change ordering**

Find the recipe SELECT in `web/assets/js/lib/db.js`:

```bash
grep -n "featured\|highlight" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/lib/db.js
```

Apply the diff. The expected lines are:

```diff
- .select('id,name,tagline,cuisine,difficulty,total_minutes,servings,media,color,color_soft,featured,highlight,recipe_tags(tag)')
- .order('featured', { ascending: false })
+ .select('id,name,tagline,cuisine,difficulty,total_minutes,servings,media,color,color_soft,recipe_tags(tag)')
+ .order('updated_at', { ascending: false })
```

Then in the mapper a few lines below (the place that builds the JS recipe object), remove the `featured: !!r.featured,` and `highlight: r.highlight,` lines.

- [ ] **Step 2: Edit `recipe-search.html` — remove the Featured-picks section**

```bash
grep -n "featured" /Users/amanrai/Documents/Code/mfc-landing/web/recipe-search.html | head -30
```

Three categories of edit:

**2a — Remove the FeaturedCard component** (lines ~470–516, search for `function FeaturedCard`). Delete the entire function declaration.

**2b — Remove the `featured` `useMemo` and the section JSX**:

Find:

```js
const featured = useMemo(() => sortByPrefs(recipes.filter(r => r.featured)), [recipes, profile, respect, classifyMap]);
```

Delete that line.

Then find the JSX section (around line 821):

```jsx
            <div className="section-label">// featured picks</div>
            ...
            <div className="featured-grid">
              {featured.map(r => ( ... ))}
            </div>
```

Delete the entire `<section>` (or wrapping div) containing those — find the enclosing tag boundary and remove from `<section>` to `</section>`.

**2c — Remove featured-related CSS** from the inline `<style>` (around lines 214–258 + 366 + 371). Find every selector starting with `.featured-` and delete it. Including:

- `.featured-card { ... }`
- `.featured-card .match-badge`, `.featured-card .avoid-badge`
- `.featured-card.avoid`, `.featured-card.avoid:hover`
- `.featured-grid`, `.featured-grid` inside the responsive breakpoints
- `.featured-card:hover`, `.featured-card:hover .fc-img`

- [ ] **Step 3: Smoke-test the public site**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "recipe-search.html: %{http_code}\n" http://localhost:8080/recipe-search.html
curl -s -o /dev/null -w "db.js: %{http_code}\n" http://localhost:8080/assets/js/lib/db.js
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected: both 200. (Visual confirmation — page renders with one fewer section — is operator-eyeball; flagged in Task 13 smoke.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add web/assets/js/lib/db.js web/recipe-search.html
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(public): drop featured/highlight; new default ordering by updated_at desc

db.js: select list no longer pulls featured/highlight; ORDER BY changes
to updated_at desc (newest first; replaces curated featured ordering).

recipe-search.html: remove the Featured-picks <section>, FeaturedCard
component, and all .featured-* CSS rules. The all-recipes grid stays
unchanged."
```

---

## Task 5: Admin DB helpers + dashboard cleanup

**Files:**
- Modify: `web/assets/js/lib/admin-db.js`
- Modify: `web/assets/js/app/admin-dashboard-app.jsx`

- [ ] **Step 1: Drop featured/highlight from `admin-db.js` SELECT lists**

```bash
grep -n "featured\|highlight" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/lib/admin-db.js
```

Three SELECT strings to update:

```diff
- .select('id,name,tagline,short_tagline,cuisine,difficulty,servings,total_minutes,featured,updated_at,recipe_steps(count),recipe_ingredients(count)')
+ .select('id,name,tagline,short_tagline,cuisine,difficulty,servings,total_minutes,created_by,updated_at,recipe_steps(count),recipe_ingredients(count)')
```

```diff
-        id, name, tagline, short_tagline, cuisine, difficulty, servings, total_minutes, media, color, color_soft, featured, highlight, meal_types,
+        id, name, tagline, short_tagline, cuisine, difficulty, servings, total_minutes, media, color, color_soft, created_by, meal_types,
```

```diff
-        'id,name,cuisine,difficulty,total_minutes,featured,meal_types,media,highlight,created_at,updated_at,' +
+        'id,name,cuisine,difficulty,total_minutes,meal_types,media,created_by,created_at,updated_at,' +
```

(Note: also adds `created_by` to each so the admin list rendering can show it. Existing `created_at` references stay — that's the row's create timestamp, not the FK.)

- [ ] **Step 2: Add `listOwnedRecipes(userId)` helper**

In `admin-db.js`, find the existing `listRecipes()` definition. Immediately after it, add:

```javascript
  // Same shape as listRecipes() but inner-joins on recipe_owners to scope
  // to recipes where the given userId appears as an owner. Used by the
  // chef portal's list page so chefs see only what they own and admins
  // (when scoped) see only their own subset.
  async function listOwnedRecipes(userId) {
    const { data, error } = await sb()
      .from('recipes')
      .select('id,name,tagline,short_tagline,cuisine,difficulty,servings,total_minutes,created_by,updated_at,recipe_steps(count),recipe_ingredients(count),recipe_owners!inner(user_id)')
      .eq('recipe_owners.user_id', userId)
      .order('updated_at', { ascending: false });
    check(error, 'listOwnedRecipes');
    return (data || []).map((r) => ({
      ...r,
      stepCount: r.recipe_steps?.[0]?.count ?? 0,
      ingredientCount: r.recipe_ingredients?.[0]?.count ?? 0,
    }));
  }
```

- [ ] **Step 3: Add `createOwnedRecipe(payload, userId)` helper**

Add after the existing `saveRecipe(payload)` function:

```javascript
  // Like saveRecipe but stamps recipe.created_by = userId before the
  // upsert. Used by the chef portal editor when saving a new recipe.
  // The DB trigger handles populating recipe_owners after the INSERT.
  async function createOwnedRecipe(payload, userId) {
    const stamped = {
      ...payload,
      recipe: { ...payload.recipe, created_by: userId },
    };
    return saveRecipe(stamped);
  }
```

Find the existing module exports near the bottom of the file (something like `return { listRecipes, getRecipe, saveRecipe, deleteRecipe, ... };`). Add `listOwnedRecipes` and `createOwnedRecipe` to the returned object.

- [ ] **Step 4: Drop featured/noHighlight stats from `admin-dashboard-app.jsx`**

```bash
grep -n "featured\|noHighlight\|highlight" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/app/admin-dashboard-app.jsx
```

Find and remove:

- The line `const featured = recipes.filter((r) => r.featured).length;`
- The line `const noHighlight = recipes.filter((r) => !r.highlight).length;`
- `featured` and `noHighlight` keys in the `setStats({ featured, ..., noHighlight, ... })` call (delete those keys from the object literal)
- Any rendering that uses `stats.featured` (e.g. `<span className="delta">{stats.featured} ★ featured</span>` — delete the whole `<span>`)
- Any rendering that uses `stats.noHighlight` (e.g. `<QRow ... value={stats.noHighlight} ... label="recipes without a highlight one-liner" />` — delete the whole row)

- [ ] **Step 5: Smoke-test admin pages still load**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "admin/index.html: %{http_code}\n" http://localhost:8080/admin/index.html
curl -s -o /dev/null -w "admin-dashboard-app.jsx: %{http_code}\n" http://localhost:8080/assets/js/app/admin-dashboard-app.jsx
curl -s -o /dev/null -w "admin-db.js: %{http_code}\n" http://localhost:8080/assets/js/lib/admin-db.js
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected: all 200.

- [ ] **Step 6: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add web/assets/js/lib/admin-db.js web/assets/js/app/admin-dashboard-app.jsx
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(admin): drop featured/highlight from DB layer + dashboard; add chef helpers

admin-db.js: SELECT lists drop featured/highlight, add created_by. Two new
helpers: listOwnedRecipes(userId) (inner-joins recipe_owners) and
createOwnedRecipe(payload, userId) (stamps created_by before upsert).

admin-dashboard-app.jsx: featured KPI and noHighlight quality row removed."
```

---

## Task 6: chef-gate.js + admin-gate.js polish

**Files:**
- Create: `web/assets/js/lib/chef-gate.js`
- Modify: `web/assets/js/lib/admin-gate.js`

- [ ] **Step 1: Read `admin-gate.js` to understand its shape**

```bash
cat /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/lib/admin-gate.js
```

Note the shape — it returns a Promise that resolves true/false, and on false renders a not-authorized panel into the page. The chef gate mirrors this.

- [ ] **Step 2: Create `chef-gate.js`**

Create `web/assets/js/lib/chef-gate.js`:

```javascript
// MFC.chefGate — gate for the chef portal.
//
// guard() resolves true when the signed-in user has app_metadata.role
// in {chef, admin}. Otherwise renders an inline panel into <body> and
// resolves false.

(function () {
  function panelHTML(reason) {
    return `
      <div class="admin-gate-panel">
        <div class="admin-gate-mark">m</div>
        <h1>Chef portal</h1>
        <p>${reason}</p>
        <a class="admin-gate-link" href="../index.html">← Back to site</a>
      </div>
    `;
  }

  async function guard() {
    if (!window.MFC?.supabase) {
      document.body.innerHTML = panelHTML(
        'Supabase client not initialised. Check the meta tags in this page&rsquo;s &lt;head&gt;.'
      );
      return false;
    }
    const { data: { session } } = await window.MFC.supabase.auth.getSession();
    if (!session) {
      document.body.innerHTML = panelHTML(
        'You need to sign in. <a href="../index.html#sign-in">Sign in</a>.'
      );
      return false;
    }
    const role = session.user?.app_metadata?.role || null;
    if (role !== 'chef' && role !== 'admin') {
      document.body.innerHTML = panelHTML(
        'You need chef access. Ask an admin.'
      );
      return false;
    }
    return true;
  }

  window.MFC = window.MFC || {};
  window.MFC.chefGate = { guard };
})();
```

- [ ] **Step 3: Update `admin-gate.js` not-authorized panel — chef gets a portal link**

Open `web/assets/js/lib/admin-gate.js`. Find the place where the not-authorized message is rendered. Modify the panel HTML so when role === 'chef', a link to the chef portal is shown.

Concretely — locate the section that renders the message based on user state. Add a chef-aware branch. The exact code will look something like:

```javascript
const role = session.user?.app_metadata?.role || null;
if (role !== 'admin') {
  let extra = '';
  if (role === 'chef') {
    extra = '<p class="admin-gate-link-row">Looking for the chef portal? → <a href="../chef/recipes.html">/chef/recipes.html</a></p>';
  }
  document.body.innerHTML = panelHTML(
    'You need admin access.' + extra
  );
  return false;
}
```

(The exact existing structure may differ; the goal is: when the gate denies and the user is chef-role, the panel additionally shows the chef-portal link.)

- [ ] **Step 4: Smoke-test the new gate file serves**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "chef-gate.js: %{http_code}\n" http://localhost:8080/assets/js/lib/chef-gate.js
curl -s -o /dev/null -w "admin-gate.js: %{http_code}\n" http://localhost:8080/assets/js/lib/admin-gate.js
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected: both 200.

- [ ] **Step 5: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add web/assets/js/lib/chef-gate.js web/assets/js/lib/admin-gate.js
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(gates): add chef-gate.js; admin-gate not-authorized links chef to chef portal

chef-gate.js: MFC.chefGate.guard() — resolves true for role ∈ {chef, admin};
otherwise renders 'You need chef access. Ask an admin.' panel.

admin-gate.js: when caller is role='chef', the not-authorized panel now
includes a 'Looking for the chef portal? →' link to /chef/recipes.html."
```

---

## Task 7: AdminSidebar + ChefSidebar in admin-shared.jsx

**Files:**
- Modify: `web/assets/js/lib/admin-shared.jsx`

- [ ] **Step 1: Inspect AdminSidebar's current structure**

```bash
grep -nE "AdminSidebar|nav-item|items =|group:" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/lib/admin-shared.jsx | head -20
```

- [ ] **Step 2: Drop "Recipes" entry from AdminSidebar's items array**

Find the items array in `AdminSidebar`. The existing Library group is:

```javascript
    { group: "Library", entries: [
      { id: "recipes",     icon: "✦", label: "Recipes",     href: "recipes.html",     count: counts.recipes },
      { id: "ingredients", icon: "◐", label: "Ingredients", href: "ingredients.html", count: counts.ingredients },
      { id: "utensils",    icon: "▣", label: "Utensils",    href: "utensils.html",    count: counts.utensils },
    ]},
```

Delete the `recipes` entry. Result:

```javascript
    { group: "Library", entries: [
      { id: "ingredients", icon: "◐", label: "Ingredients", href: "ingredients.html", count: counts.ingredients },
      { id: "utensils",    icon: "▣", label: "Utensils",    href: "utensils.html",    count: counts.utensils },
    ]},
```

- [ ] **Step 3: Add a "Workspaces" group to AdminSidebar with Chef portal entry**

In the same items array, add a new group between "People" and "Site":

```javascript
    { group: "People", entries: [
      { id: "users", icon: "◉", label: "Users", href: "users.html", count: counts.users },
    ]},
    { group: "Workspaces", entries: [
      { id: "chef", icon: "✦", label: "Chef portal", href: "../chef/recipes.html" },
    ]},
    { group: "Site", entries: [
      { id: "view-site", icon: "↗", label: "View site",  href: "../index.html" },
      { id: "search",    icon: "⌕", label: "Recipe search", href: "../recipe-search.html" },
    ]},
```

- [ ] **Step 4: Add a `ChefSidebar` component to admin-shared.jsx**

Below `AdminSidebar`'s definition (and its export), add:

```jsx
function ChefSidebar({ active, role, counts = {} }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.body.classList.add("admin-drawer-open");
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("admin-drawer-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { group: "Library", entries: [
      { id: "recipes", icon: "✦", label: "Recipes", href: "recipes.html", count: counts.recipes },
    ]},
    { group: "Workspaces", entries: (role === "admin"
        ? [{ id: "admin", icon: "⚙", label: "Admin portal", href: "../admin/index.html" }]
        : []) },
    { group: "Site", entries: [
      { id: "view-site", icon: "↗", label: "View site",     href: "../index.html" },
      { id: "search",    icon: "⌕", label: "Recipe search", href: "../recipe-search.html" },
    ]},
  ];

  async function signOut() {
    if (window.MFC?.supabase) await window.MFC.supabase.auth.signOut();
    location.href = "../index.html";
  }

  return (
    <React.Fragment>
      <header className="admin-mobile-bar">
        <button
          type="button"
          className="admin-burger"
          aria-label="Open chef menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span /><span /><span />
        </button>
        <div className="admin-brand admin-brand-mobile" role="img" aria-label="MyFoodCraving chef">
          <span className="brand-mark">m</span>
          <span className="brand-name">my<em>food</em>craving</span>
          <span className="admin-tag">chef</span>
        </div>
      </header>

      {open && <div className="admin-drawer-backdrop" onClick={() => setOpen(false)} />}

      <aside className={"admin-side" + (open ? " open" : "")} aria-hidden={!open && undefined}>
        <div className="admin-brand">
          <span className="brand-mark">m</span>
          <span className="brand-name">my<em>food</em>craving</span>
          <span className="admin-tag">chef</span>
          <button
            type="button"
            className="admin-side-close"
            aria-label="Close chef menu"
            onClick={() => setOpen(false)}
          >×</button>
        </div>
        {items.map((g) => (
          <div key={g.group} className="admin-nav-group">
            <div className="admin-nav-label">{g.group}</div>
            {g.entries.map((e) => (
              <a key={e.id} href={e.href} className={"admin-nav-item" + (active === e.id ? " active" : "")}>
                <span className="ic">{e.icon}</span>
                <span>{e.label}</span>
                {e.count !== undefined && <span className="count">{e.count}</span>}
              </a>
            ))}
          </div>
        ))}
        <div className="admin-side-foot">
          <div className="admin-avatar">{role === "admin" ? "A" : "C"}</div>
          <div className="who"><b>{role === "admin" ? "Admin" : "Chef"}</b><span>signed in</span></div>
          <button
            onClick={signOut}
            style={{ marginLeft: "auto", background: "transparent", border: "1px solid rgba(255,252,243,0.18)", color: "var(--cream-deep)", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}
          >sign out</button>
        </div>
      </aside>
    </React.Fragment>
  );
}
```

- [ ] **Step 5: Export `ChefSidebar`**

Find the existing exports near the bottom of `admin-shared.jsx`:

```javascript
window.AdminSidebar = AdminSidebar;
window.AdminTopbar  = AdminTopbar;
// ... other exports ...
```

Add:

```javascript
window.ChefSidebar = ChefSidebar;
```

- [ ] **Step 6: Smoke-test the file parses**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "admin-shared.jsx: %{http_code}\n" http://localhost:8080/assets/js/lib/admin-shared.jsx
curl -s -o /dev/null -w "admin/index.html: %{http_code}\n" http://localhost:8080/admin/index.html
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected: both 200.

- [ ] **Step 7: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add web/assets/js/lib/admin-shared.jsx
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(shell): admin sidebar drops Recipes; new ChefSidebar component

AdminSidebar: 'Recipes' entry removed from Library; new Workspaces group
with 'Chef portal' link to /chef/recipes.html.

ChefSidebar (new): mirror of AdminSidebar — Library/Recipes,
Workspaces/Admin portal (visible only when role=admin), Site/View site +
Recipe search. Same drawer behaviour and sign-out treatment."
```

---

## Task 8: auth.js role exposure + user-menu portal items

**Files:**
- Modify: `web/assets/js/lib/auth.js`
- Modify: `web/assets/js/lib/user-menu.jsx`

- [ ] **Step 1: Expose `role` from `userFromSession` in `auth.js`**

```bash
grep -n "userFromSession\|app_metadata\|provider:" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/lib/auth.js | head
```

Find the `userFromSession` function. The current return shape is something like:

```javascript
return {
  id: u.id,
  name: ...,
  email: ...,
  avatar: ...,
  provider: u.app_metadata?.provider || 'email',
  biologicalSex: m.biological_sex || null,
};
```

Add a `role` line:

```javascript
return {
  id: u.id,
  name: ...,
  email: ...,
  avatar: ...,
  provider: u.app_metadata?.provider || 'email',
  role: u.app_metadata?.role || null,
  biologicalSex: m.biological_sex || null,
};
```

- [ ] **Step 2: Add Admin/Chef portal items to `user-menu.jsx`**

```bash
grep -n "menu-item\|profileHref\|accountHref\|Sign out" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/lib/user-menu.jsx | head
```

Find the dropdown render (the JSX block returning the dropdown ul/div with menu items). Add the role-conditional portal items above the existing Profile/Account entries:

```jsx
const role = user?.role || null;
const isAdmin = role === 'admin';
const isChef  = role === 'chef' || role === 'admin';

// Inside the dropdown render, before the Profile/Account block:
{(isAdmin || isChef) && (
  <>
    {isAdmin && (
      <a className="user-menu-item" href={`${base}admin/index.html`} role="menuitem">
        <span className="user-menu-icon">⚙</span>
        Admin portal
      </a>
    )}
    {isChef && (
      <a className="user-menu-item" href={`${base}chef/recipes.html`} role="menuitem">
        <span className="user-menu-icon">✦</span>
        Chef portal
      </a>
    )}
    <div className="user-menu-divider" />
  </>
)}
```

(`base` is the existing prop the user-menu accepts for path-prefix handling. If the menu doesn't currently accept `base` directly, it should be readable from the same place the existing `accountHref` and `profileHref` flow through.)

If the user-menu doesn't currently have `.user-menu-divider` and `.user-menu-icon` styles, add them in the inline style block (or in `admin-styles.css` if that's where the other user-menu styles live):

```css
.user-menu-divider { height: 1px; background: rgba(255,252,243,0.12); margin: 6px 0; }
.user-menu-icon { display: inline-block; width: 18px; text-align: center; }
```

- [ ] **Step 3: Smoke-test**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "auth.js: %{http_code}\n" http://localhost:8080/assets/js/lib/auth.js
curl -s -o /dev/null -w "user-menu.jsx: %{http_code}\n" http://localhost:8080/assets/js/lib/user-menu.jsx
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected: both 200. Visual confirmation in browser is in Task 13's smoke.

- [ ] **Step 4: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add web/assets/js/lib/auth.js web/assets/js/lib/user-menu.jsx
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(navbar): user-menu adds Admin/Chef portal items; auth.js exposes role

auth.js: userFromSession now returns role (from app_metadata.role).

user-menu.jsx: dropdown shows 'Admin portal' (role=admin) and 'Chef
portal' (role ∈ {chef, admin}) above the existing Profile/Account/Sign
out items, in their own divider section."
```

---

## Task 9: Chef portal list page

**Files:**
- Create: `web/chef/recipes.html`
- Create: `web/assets/js/app/chef-recipes-app.jsx`

- [ ] **Step 1: Create the chef list HTML shell**

Mirror `web/admin/recipes.html`. Create `web/chef/recipes.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Recipes — MyFoodCraving Chef</title>

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&family=Caveat:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

<link rel="stylesheet" href="../assets/css/recipe-base.css" />
<link rel="stylesheet" href="../assets/css/admin-styles.css" />
<link rel="stylesheet" href="../assets/css/admin-simple.css" />

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='15' fill='%23FF6D2E'/><text x='50%25' y='62%25' text-anchor='middle' fill='%23FFFCF3' font-family='Georgia,serif' font-style='italic' font-weight='400' font-size='22'>m</text></svg>" />

<meta name="mfc-supabase-url" content="https://fqjzhntqppbcwvqtjscb.supabase.co" />
<meta name="mfc-supabase-publishable-key" content="sb_publishable_zuFopkEX_3zj-Gr7dJErtg_FBwMHiZL" />
</head>

<body class="admin-body">

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../assets/js/lib/supabase.js"></script>
<script src="../assets/js/lib/auth.js"></script>
<script src="../assets/js/lib/admin-db.js"></script>
<script src="../assets/js/lib/chef-gate.js"></script>

<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" crossorigin="anonymous"></script>

<div id="root"></div>

<script type="text/babel" src="../assets/js/lib/admin-shared.jsx"></script>
<script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
<script src="../assets/js/lib/image-upload.js"></script>
<script type="text/babel" src="../assets/js/app/chef-recipes-app.jsx"></script>

</body>
</html>
```

- [ ] **Step 2: Create the chef list app**

Create `web/assets/js/app/chef-recipes-app.jsx`:

```jsx
// Chef portal — recipes list. Used by both chef and admin.
// Chef sees recipes where they're in recipe_owners (creator OR co-owner).
// Admin sees ALL recipes.
const { useState, useEffect, useMemo } = React;

function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function ChefRecipesApp({ user }) {
  const role = user?.role || 'chef';
  const isAdmin = role === 'admin';

  const [rows, setRows] = useState(null);
  const [creators, setCreators] = useState({}); // userId -> email
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);

  async function refresh() {
    try {
      const list = isAdmin
        ? await window.MFC.adminDb.listRecipes()
        : await window.MFC.adminDb.listOwnedRecipes(user.id);
      setRows(list);
    } catch (e) { setErr(e.message || String(e)); }
  }

  useEffect(() => { refresh(); }, []);

  // Fetch creator emails for any unique created_by we don't have yet.
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const wanted = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
    const missing = wanted.filter((id) => !(id in creators) && id !== user.id);
    if (missing.length === 0) return;
    // For now: we can't list auth.users from the client without admin RPC.
    // Show "You" for own; otherwise show truncated UUID. Admin who needs full
    // emails can use /admin/users.html.
    const next = { ...creators };
    missing.forEach((id) => { next[id] = id.slice(0, 8) + "…"; });
    setCreators(next);
  }, [rows, user.id]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const qq = q.toLowerCase().trim();
    if (!qq) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(qq) ||
      (r.cuisine || "").toLowerCase().includes(qq) ||
      r.id.toLowerCase().includes(qq)
    );
  }, [rows, q]);

  async function onDelete(r) {
    if (!confirm(`Delete recipe "${r.name}"?\n\nThis removes all steps, ingredients, utensils, tags, and health facts, plus its hero + step images from Supabase Storage. Cannot be undone.`)) return;
    try {
      await window.MFC.adminDb.deleteRecipe(r.id);
      try { await window.MFC.imageUpload.removeFolder(r.id); }
      catch (e) { console.warn("[chef] storage cleanup failed (orphans may remain)", e); }
      refresh();
    } catch (e) { alert("Delete failed: " + e.message); }
  }

  function creatorLabel(r) {
    if (r.created_by === user.id) return "You";
    return creators[r.created_by] || "—";
  }

  return (
    <div className="admin-shell">
      <ChefSidebar active="recipes" role={role} counts={rows ? { recipes: rows.length } : undefined} />
      <div className="admin-main">
        <AdminTopbar crumb={[{ label: "Recipes" }]} />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>Recipes</h1>
              <p className="lede">
                {isAdmin
                  ? "All recipes. New recipes you create will be marked with you as creator."
                  : "Your authored recipes. Pick one to edit, or start a new one."}
              </p>
            </div>
            <div className="admin-page-meta">
              <span><b>{rows?.length ?? "—"}</b> total</span>
            </div>
          </div>

          {isAdmin && (
            <div className="admin-banner">
              Viewing all recipes as admin. New recipes you create will be marked with you as creator.
              User and library management lives in the Admin portal.
            </div>
          )}

          <div className="list-toolbar">
            <div className="list-search">
              <span className="glass">⌕</span>
              <input
                placeholder="Search by name, cuisine, or id…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {filtered && <span className="list-count">{filtered.length} of {rows.length}</span>}
            </div>
            <a href="recipe.html?new=1" className="btn-sm primary" style={{ textDecoration: "none" }}>+ New recipe</a>
          </div>

          {err && (
            <div className="form-card" style={{ borderColor: "var(--berry)" }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>
                Failed to load: {err}
              </div>
            </div>
          )}

          {!err && (
            <div className="list-table">
              <div className="list-row head">
                <div />
                <div>Recipe</div>
                <div className="col-meta">Cuisine · difficulty</div>
                <div>Steps</div>
                <div className="col-meta">Creator</div>
                <div className="col-time">Updated</div>
                <div>Actions</div>
              </div>
              {!rows && <div className="list-empty"><h3>Loading…</h3></div>}
              {rows && filtered.length === 0 && (
                <div className="list-empty">
                  <h3>{q ? "Nothing matches" : (isAdmin ? "No recipes match." : "You haven't authored any recipes yet.")}</h3>
                  {!q && <a href="recipe.html?new=1" className="btn-sm primary" style={{ textDecoration: "none" }}>+ {isAdmin ? "New recipe" : "Create your first recipe"}</a>}
                </div>
              )}
              {rows && filtered.map((r) => (
                <div key={r.id} className="list-row" onClick={() => { location.href = `recipe.html?id=${encodeURIComponent(r.id)}`; }}>
                  <div className="lib-thumb" />
                  <div>
                    <div className="name">{r.name}</div>
                    <div className="id">{r.id}</div>
                  </div>
                  <div className="col-meta">{r.cuisine} · {r.difficulty}</div>
                  <div className="col-meta">{r.stepCount}</div>
                  <div className="col-meta">{creatorLabel(r)}</div>
                  <div className="col-time">{fmtAgo(r.updated_at)}</div>
                  <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn danger" title="Delete" onClick={() => onDelete(r)}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.MFC.chefGate.guard().then((ok) => {
  if (!ok) return;
  // The MfcUserMenu doesn't render here, but the guard already verified role.
  // Resolve the current session to pass user to the app.
  window.MFC.supabase.auth.getSession().then(({ data: { session } }) => {
    const u = session?.user;
    const user = u ? {
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role || 'chef',
    } : null;
    if (!user) { document.body.innerHTML = '<p>Session lost.</p>'; return; }
    ReactDOM.createRoot(document.getElementById("root")).render(<ChefRecipesApp user={user} />);
  });
});
```

- [ ] **Step 3: Add `.admin-banner` style if not present**

```bash
grep -n "admin-banner" /Users/amanrai/Documents/Code/mfc-landing/web/assets/css/admin-styles.css
```

If the class doesn't exist, append to `admin-styles.css`:

```css
/* ── chef portal admin banner ─────────────────────────────────────── */
.admin-banner {
  margin: 14px 0 18px;
  padding: 12px 16px;
  background: var(--cream-soft);
  border-left: 3px solid var(--orange);
  border-radius: 6px;
  font-size: 13px;
  color: var(--ink-soft);
}
```

- [ ] **Step 4: Smoke-test**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "chef/recipes.html: %{http_code}\n" http://localhost:8080/chef/recipes.html
curl -s -o /dev/null -w "chef-recipes-app.jsx: %{http_code}\n" http://localhost:8080/assets/js/app/chef-recipes-app.jsx
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected: both 200.

- [ ] **Step 5: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add web/chef/recipes.html web/assets/js/app/chef-recipes-app.jsx web/assets/css/admin-styles.css
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(chef): chef portal recipes list page

Lists recipes the chef owns (via recipe_owners inner-join) or all recipes
when the caller is admin. Creator column shows 'You' for self or the
truncated user id otherwise. Search + delete work the same as the
previous /admin/recipes.html. Banner shows when role=admin to flag the
admin-in-chef-portal scoping."
```

---

## Task 10: Chef portal editor page

**Files:**
- Create: `web/chef/recipe.html`
- Create: `web/assets/js/app/chef-recipe-app.jsx`

- [ ] **Step 1: Create the chef editor HTML shell**

Create `web/chef/recipe.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Edit Recipe — MyFoodCraving Chef</title>

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&family=Caveat:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

<link rel="stylesheet" href="../assets/css/recipe-base.css" />
<link rel="stylesheet" href="../assets/css/admin-styles.css" />
<link rel="stylesheet" href="../assets/css/admin-simple.css" />

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='15' fill='%23FF6D2E'/><text x='50%25' y='62%25' text-anchor='middle' fill='%23FFFCF3' font-family='Georgia,serif' font-style='italic' font-weight='400' font-size='22'>m</text></svg>" />

<meta name="mfc-supabase-url" content="https://fqjzhntqppbcwvqtjscb.supabase.co" />
<meta name="mfc-supabase-publishable-key" content="sb_publishable_zuFopkEX_3zj-Gr7dJErtg_FBwMHiZL" />
</head>

<body class="admin-body">

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../assets/js/lib/supabase.js"></script>
<script src="../assets/js/lib/auth.js"></script>
<script src="../assets/js/lib/admin-db.js"></script>
<script src="../assets/js/lib/chef-gate.js"></script>

<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" crossorigin="anonymous"></script>

<div id="root"></div>

<script type="text/babel" src="../assets/js/lib/admin-shared.jsx"></script>
<script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
<script src="../assets/js/lib/image-upload.js"></script>
<script type="text/babel" src="../assets/js/app/chef-recipe-app.jsx"></script>

</body>
</html>
```

- [ ] **Step 2: Create the chef editor app — duplicate `admin-recipe-app.jsx`**

The editor logic is large (~600 LOC). Strategy: copy `web/assets/js/app/admin-recipe-app.jsx` to `web/assets/js/app/chef-recipe-app.jsx`, then make these targeted edits:

```bash
cp /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/app/admin-recipe-app.jsx \
   /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/app/chef-recipe-app.jsx
```

- [ ] **Step 3: Edit the new file — remove featured/highlight; rename component; add slug-collision check; createOwnedRecipe on new**

In `web/assets/js/app/chef-recipe-app.jsx`:

**3a — Rename the top-level component:**

Find `function RecipeAdminApp() {` and rename to `function ChefRecipeApp({ user }) {`.

**3b — Remove featured/highlight from BLANK + fromDb + toDb:**

In the `BLANK` constant, remove the `featured: false,` and `highlight: "",` lines.

In `fromDb(row)`, remove these lines from the returned object:
- `featured: !!row.featured,`
- `highlight: row.highlight || "",`

In `toDb(r)`, remove these lines from the `recipe` object:
- `featured: !!r.featured,`
- `highlight: r.highlight || null,`

**3c — Add `created_by` propagation:**

In `fromDb(row)`, add `created_by: row.created_by || null,` to the returned object.

In `toDb(r)`, the `recipe` object should NOT carry `created_by` — that's set explicitly by `createOwnedRecipe` for new rows, and preserved by `saveRecipe` for existing rows. Don't include it in `toDb`.

**3d — Remove the featured Toggle and the highlight input from the rendered form:**

```bash
grep -n "featured\|highlight" /Users/amanrai/Documents/Code/mfc-landing/web/assets/js/app/chef-recipe-app.jsx
```

Find the JSX block rendering `<Toggle value={r.featured}` and the surrounding `<Field label="...">` wrapper. Delete the field.

Find `<Field label="Highlight" ...>` and the input inside (`r.highlight`). Delete the field.

**3e — Add a "Created by" read-only display near the top of the form:**

Find the form's first `FormCard` (likely the basics tab — title/cuisine/etc.). Above it, add:

```jsx
<div className="created-by-line">
  Created by: <strong>{r.created_by === user.id ? "You" : (r.created_by || "—")}</strong>
</div>
```

In `admin-styles.css`, append:

```css
.created-by-line {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-muted);
  margin: 8px 0 12px;
}
```

**3f — Add slug-collision live check:**

In the editor component, add state + effect:

```jsx
const [slugTaken, setSlugTaken] = useState(false);

useEffect(() => {
  if (!isNew) return;
  const wantSlug = window.slugify(r.name);
  if (!wantSlug) { setSlugTaken(false); return; }
  const t = setTimeout(async () => {
    const { data } = await window.MFC.supabase
      .from('recipes').select('id').eq('id', wantSlug).maybeSingle();
    setSlugTaken(!!data);
  }, 400);
  return () => clearTimeout(t);
}, [r.name, isNew]);
```

Below the Name field input, add (when slugTaken):

```jsx
{slugTaken && (
  <div className="slug-warning">
    A recipe with the slug <code>{window.slugify(r.name)}</code> already exists. Choose a different name.
  </div>
)}
```

CSS in `admin-styles.css`:

```css
.slug-warning {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(200, 75, 90, 0.08);
  border-left: 3px solid var(--berry);
  border-radius: 4px;
  font-size: 12px;
  color: var(--berry);
}
.slug-warning code { font-family: var(--mono); background: rgba(200, 75, 90, 0.15); padding: 1px 4px; border-radius: 3px; }
```

**3g — Wire up `createOwnedRecipe` on new + `saveRecipe` on edit:**

Find the `onPublish()` function. It currently calls `MFC.adminDb.saveRecipe(payload)` regardless of `isNew`. Update to:

```javascript
async function onPublish() {
  setErr(null); setBusy(true);
  try {
    let id = r.id;
    if (isNew || !id) {
      id = window.slugify(r.name);
      if (!id) throw new Error("Recipe needs a name before saving.");
    }
    const payload = toDb({ ...r, id });
    if (isNew) {
      await window.MFC.adminDb.createOwnedRecipe(payload, user.id);
    } else {
      await window.MFC.adminDb.saveRecipe(payload);
    }
    setDirty(false);
    setSavedAgo("just now");
    if (isNew) { location.href = `recipe.html?id=${encodeURIComponent(id)}`; return; }
  } catch (e) {
    if (e.message && e.message.includes('23505')) {
      setErr(`A recipe with this id already exists. Choose a different name.`);
    } else {
      setErr(e.message || String(e));
    }
  }
  finally { setBusy(false); }
}
```

**3h — Replace the AdminSidebar usage with ChefSidebar:**

Find `<AdminSidebar active="recipes" .../>` (or similar). Replace with:

```jsx
<ChefSidebar active="recipes" role={user.role} />
```

**3i — Update the gate + render at the bottom:**

The existing file ends with something like:

```javascript
window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<RecipeAdminApp />);
});
```

Replace with:

```javascript
window.MFC.chefGate.guard().then((ok) => {
  if (!ok) return;
  window.MFC.supabase.auth.getSession().then(({ data: { session } }) => {
    const u = session?.user;
    const user = u ? {
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role || 'chef',
    } : null;
    if (!user) { document.body.innerHTML = '<p>Session lost.</p>'; return; }
    ReactDOM.createRoot(document.getElementById("root")).render(<ChefRecipeApp user={user} />);
  });
});
```

- [ ] **Step 4: Smoke-test**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s -o /dev/null -w "chef/recipe.html: %{http_code}\n" http://localhost:8080/chef/recipe.html
curl -s -o /dev/null -w "chef-recipe-app.jsx: %{http_code}\n" http://localhost:8080/assets/js/app/chef-recipe-app.jsx
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected: both 200. Visual confirmation in Task 13's smoke (the editor renders, image controls work, save works).

- [ ] **Step 5: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add web/chef/recipe.html web/assets/js/app/chef-recipe-app.jsx web/assets/css/admin-styles.css
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "feat(chef): chef portal recipe editor page

Clone of the old admin recipe editor minus featured/highlight (columns
dropped) and minus the new-ingredient/utensil shortcut buttons (chef
library inserts not in scope).

Adds: Created by read-only line, live slug-collision check on ?new=1
(debounced 400ms), and createOwnedRecipe path for new recipes that
stamps created_by = current user (DB trigger handles recipe_owners).
Friendly 23505 error message on slug collision at save time."
```

---

## Task 11: Delete the moved-out admin recipe pages

**Files:**
- Delete: `web/admin/recipes.html`
- Delete: `web/admin/recipe.html`
- Delete: `web/assets/js/app/admin-recipes-app.jsx`
- Delete: `web/assets/js/app/admin-recipe-app.jsx`

- [ ] **Step 1: Delete the four files**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing rm web/admin/recipes.html web/admin/recipe.html web/assets/js/app/admin-recipes-app.jsx web/assets/js/app/admin-recipe-app.jsx
```

- [ ] **Step 2: Verify the deletion**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing status --short
```

Expected: four `D` lines for the deleted files. No remaining references in active code:

```bash
grep -rnE "admin-recipes-app|admin-recipe-app" /Users/amanrai/Documents/Code/mfc-landing/web 2>/dev/null
```

Expected: no matches. (The sidebar's "Recipes" entry was already removed in Task 7.)

- [ ] **Step 3: Smoke-test that admin pages still load + chef pages exist**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
echo "should be 200:"
curl -s -o /dev/null -w "admin/index.html:    %{http_code}\n" http://localhost:8080/admin/index.html
curl -s -o /dev/null -w "admin/users.html:    %{http_code}\n" http://localhost:8080/admin/users.html
curl -s -o /dev/null -w "chef/recipes.html:   %{http_code}\n" http://localhost:8080/chef/recipes.html
echo "should be 404:"
curl -s -o /dev/null -w "admin/recipes.html:  %{http_code}\n" http://localhost:8080/admin/recipes.html
curl -s -o /dev/null -w "admin/recipe.html:   %{http_code}\n" http://localhost:8080/admin/recipe.html
lsof -ti :8080 | xargs kill -9 2>/dev/null
echo done
```

Expected first three: 200. Last two: 404.

- [ ] **Step 4: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "chore(admin): delete moved-out recipe pages

Recipe management lives at /chef/recipes.html and /chef/recipe.html now.
Removes web/admin/recipes.html, web/admin/recipe.html, and the two
matching JSX apps."
```

---

## Task 12: Documentation updates

**Files:**
- Modify: `docs/USER-TODO.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md schema layers — add recipe_owners + creator note**

Find the catalog bullet:

```
- **Catalog** — `recipes`, `recipe_ingredients`, `recipe_steps` (with
  `media_src` for the full Supabase Storage URL of the step image),
  `recipe_utensils`, `recipe_tags`, `recipe_health_facts`. ...
```

Replace with:

```
- **Catalog** — `recipes` (with `created_by` audit FK to auth.users,
  NOT NULL after sub-project #2), `recipe_ingredients`, `recipe_steps`
  (with `media_src` for the full Supabase Storage URL of the step
  image), `recipe_utensils`, `recipe_tags`, `recipe_health_facts`.
  Public read, admin writes via secret key or signed-in admin user
  (RLS via `public.is_admin()`); chef writes via
  `public.recipe_owned_by_caller()` checking `recipe_owners`.
- **Recipe ownership** — `recipe_owners (recipe_id, user_id)` join
  table is the single source of truth for who-can-edit. Trigger
  `recipes_after_insert_set_owners` adds (id, creator) and
  (id, first-admin) on every recipes INSERT.
```

Find the existing "Storage" bullet (added in #2.5). Update it to mention the chef-write tightening:

```
- **Storage** — `recipe-images` bucket (public read; admin or
  recipe-owning-chef write via RLS). Hero at `<recipe_id>/hero.jpg`,
  step images at `<recipe_id>/step-<sort_order>.jpg`. Full Storage
  URLs are stored on `recipes.media.image`, `recipes.media.hero.src`,
  and `recipe_steps.media_src`. Helper:
  `public.can_write_recipe_image(text)`.
```

- [ ] **Step 2: Update CLAUDE.md pages list — chef portal exists; admin no longer manages recipes**

Find the existing pages section (around the top, listing the public + admin pages). Add the chef pages and remove `admin/recipes.html` + `admin/recipe.html`. Concretely:

Find the existing list of admin pages and replace `recipes.html` + `recipe.html` references with `chef/recipes.html` + `chef/recipe.html` references in the appropriate paragraph. The exact wording depends on the current paragraph; the goal is "recipe management lives at /chef/, admin shell handles users + library + dashboard only."

- [ ] **Step 3: Update USER-TODO.md §6 — note the chef portal**

Open `docs/USER-TODO.md`. Find §6 (the sync-recipes section, rewritten in #2.5). Add a paragraph at the end:

```markdown
### Chef portal (sub-project #2)

After #2 ships, recipe authoring + editing lives at `/chef/recipes.html`
and `/chef/recipe.html`. The old `/admin/recipes.html` is gone. Both
chef and admin use the chef portal for recipe management; admin
continues to use `/admin/...` for user, ingredient, and utensil
management. Permissions:

- **Chef** can create new recipes (becomes the creator + an owner via
  `recipe_owners`); can edit + delete recipes they own.
- **Admin** can edit + delete any recipe. Bypass via `is_admin()`.
- **First admin** is auto-added as a co-owner of every recipe by a DB
  trigger — a "lifeboat" so the first admin retains write access even
  if their role is later changed.
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing add CLAUDE.md docs/USER-TODO.md
git -C /Users/amanrai/Documents/Code/mfc-landing commit -m "docs: recipe ownership + chef portal — CLAUDE.md schema layers, USER-TODO §6

CLAUDE.md: catalog bullet calls out recipes.created_by NOT NULL; new
'Recipe ownership' bullet describes recipe_owners + the trigger.
Storage bullet updated to mention chef-write tightening.

USER-TODO §6: new chef-portal paragraph describing the recipe
management split between /chef/ (recipes) and /admin/ (users,
ingredients, utensils, dashboard)."
```

---

## Task 13: End-to-end smoke verification

**Files:**
- (No code changes; live verification.)

- [ ] **Step 1: CLI regression — list-users + sync-recipes still work**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make list-users 2>&1 | tail -5
echo "---"
make sync-recipes DIRECTION=push 2>&1 | tail -8
```

Expected: list-users shows the operator + chef + any other users (sub-project #1's smoke baseline). sync-recipes push completes; `recipe_owners: <N> reconciled` line appears (N = number of bundles with `createdBy`, currently 0 since bundles haven't been pulled yet to populate the field).

- [ ] **Step 2: Recipe-page reload — public site still works**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make serve >/dev/null 2>&1 &
sleep 2
curl -s "http://localhost:8080/recipe.html?id=butter-chicken" \
  | grep -oE 'src="[^"]*hero[^"]*"' | head -2
echo "---"
curl -s -o /dev/null -w "recipe-search.html: %{http_code}\n" http://localhost:8080/recipe-search.html
lsof -ti :8080 | xargs kill -9 2>/dev/null
```

Expected: the recipe page references a Supabase Storage URL for the hero. recipe-search.html returns 200.

- [ ] **Step 3: Browser smoke as admin (`raiaman15@gmail.com`)**

Operator action — open browser:

1. Visit `http://localhost:8080/`. User-menu dropdown shows: Admin portal + Chef portal + Profile + Account + Sign out.
2. Click "Admin portal" → lands on `/admin/index.html`. Sidebar shows Insights/Library (Ingredients + Utensils only) / People / **Workspaces > Chef portal** / Site. No Recipes entry under Library.
3. Click "Chef portal" sidebar entry → lands on `/chef/recipes.html`. Banner: "Viewing all recipes as admin…". Table shows all 154 recipes. Creator column shows "You" for whichever ones you authored (none initially) or truncated UUID otherwise.
4. Click `+ New recipe` → fill name `Test Recipe` → see no "slug taken" warning (slug is `test-recipe`). Cancel out (close tab).
5. Click any existing recipe row → editor loads. "Created by: <truncated UUID>" line at top. Featured + highlight controls absent. Step image controls present (from #2.5). Cancel out.
6. From the chef sidebar, click "Workspaces > Admin portal" → bounces back to `/admin/index.html`.

- [ ] **Step 4: Browser smoke as chef (`rashmi.15ds@gmail.com`)**

Operator action:

1. Sign in as `rashmi.15ds@gmail.com` (currently chef role, per #1's smoke).
2. User-menu shows: Chef portal + Profile + Account + Sign out (no Admin portal entry).
3. Visit `/admin/recipes.html` → 404 (file deleted). Visit `/admin/index.html` → admin-gate "Not authorized" panel shows, with the "Looking for the chef portal? →" link.
4. Click the chef-portal link → lands on `/chef/recipes.html`. Empty list (rashmi hasn't authored anything). Banner does NOT appear.
5. Click `+ New recipe` → editor loads. Fill name `Rashmi's First Recipe`. Verify the slug-taken warning does NOT appear (no `rashmis-first-recipe` exists yet). Save → redirect to `?id=rashmis-first-recipe`. Editor reloads with the recipe.
6. Verify in Supabase Studio (or via `mcp__execute_sql`):

   ```sql
   SELECT id, created_by FROM public.recipes WHERE id = 'rashmis-first-recipe';
   SELECT recipe_id, user_id FROM public.recipe_owners WHERE recipe_id = 'rashmis-first-recipe';
   ```

   Expected: one recipe row with `created_by = rashmi's uuid`. Two `recipe_owners` rows: (recipe, rashmi's uuid) and (recipe, raiaman15's uuid). The trigger fired correctly.

7. Edit the recipe (e.g. change tagline). Save → succeeds (chef is in `recipe_owners`).
8. Upload a hero image via the existing image control. Confirm upload succeeds (RLS now permits chef writes for owned recipes).
9. Sign out as rashmi.

- [ ] **Step 5: Browser smoke as user (sign in as the third test user)**

Operator action:

1. Sign in as `shubham1993.sri@gmail.com` (role = user).
2. User-menu shows Profile + Account + Sign out only — no portal entries.
3. Visit `/chef/recipes.html` → "You need chef access. Ask an admin." panel.
4. Visit `/admin/recipes.html` → 404 (file deleted).
5. Visit `/admin/index.html` → admin-gate panel; no chef portal link this time (role is `user`, not `chef`).

- [ ] **Step 6: Round-trip the new chef recipe via sync**

Sign in as admin to verify the chef-created recipe round-trips through sync:

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make sync-recipes DIRECTION=pull 2>&1 | tail -3
```

Expected: pull succeeds; `web/assets/recipes/rashmis-first-recipe/recipe.json` now exists with `"createdBy": "<rashmi's uuid>"` in the bundle.

```bash
python3 -c "
import json
b = json.load(open('/Users/amanrai/Documents/Code/mfc-landing/web/assets/recipes/rashmis-first-recipe/recipe.json'))
print('id:', b.get('id'))
print('createdBy:', b.get('createdBy'))
"
```

Expected: id matches, createdBy is a UUID string.

```bash
git -C /Users/amanrai/Documents/Code/mfc-landing checkout -- web/assets/recipes/
```

(Restore — pull rewrote everything.)

- [ ] **Step 7: Cleanup test data**

Remove the test recipes created during smoke:

```bash
cd /Users/amanrai/Documents/Code/mfc-landing && make set-role USER=raiaman15@gmail.com ROLE=admin
# (idempotent; ensures admin role)
```

Then either delete the test recipe via the chef portal UI (admin can delete any), or via SQL:

```sql
DELETE FROM public.recipes WHERE id = 'rashmis-first-recipe';
```

(`recipe_owners` rows + Storage objects + child rows cascade. Storage cleanup requires the UI; if SQL-only, orphaned objects remain — out of scope for this smoke.)

- [ ] **Step 8: Tag the milestone (optional)**

```bash
cd /Users/amanrai/Documents/Code/mfc-landing
git tag -a recipe-ownership -m "Sub-project #2: recipe ownership + chef portal complete"
```

(No push; operator may want to review before publishing the tag.)

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task(s) |
|---|---|
| Schema (created_by, recipe_owners, trigger, RLS, drop columns, can_write_recipe_image) | Task 1 |
| `mfc.ops.recipes` push/pull/createdBy/owners-upsert | Task 2 |
| Live migration sync push | Task 3 |
| Public DB layer + recipe-search Featured-picks removal | Task 4 |
| Admin DB helpers + dashboard cleanup | Task 5 |
| chef-gate.js + admin-gate.js polish | Task 6 |
| AdminSidebar revisions + ChefSidebar | Task 7 |
| auth.js role + user-menu portal items | Task 8 |
| `/chef/recipes.html` + chef-recipes-app.jsx | Task 9 |
| `/chef/recipe.html` + chef-recipe-app.jsx | Task 10 |
| Delete /admin/recipes pages | Task 11 |
| CLAUDE.md + USER-TODO.md updates | Task 12 |
| End-to-end smoke | Task 13 |

All spec sections covered.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / vague phrases. Each step shows actual content.

**Type / signature consistency:**

- `MFC.adminDb.listOwnedRecipes(userId)` and `MFC.adminDb.createOwnedRecipe(payload, userId)` defined in Task 5 step 2/3, used in Task 9 (list page) and Task 10 (editor `onPublish`).
- `MFC.chefGate.guard()` defined in Task 6, used in Task 9 + Task 10.
- `ChefSidebar` defined in Task 7 step 4, used in Task 9 + Task 10.
- `recipe_owned_by_caller(text)` defined in Task 1; consumed by all chef-write RLS in same task and by `can_write_recipe_image` in same task.
- `createdBy` (camelCase, in bundle JSON) and `created_by` (snake_case, in DB column) — mappings consistent in Task 2.
- User shape passed to chef apps: `{ id, email, role }` — same in Tasks 9 and 10.

**Known caveats:**

- The `creators[]` lookup in Task 9 step 2 currently shows truncated UUIDs for non-self creators. Showing full emails would require either an admin RPC (chef can't call `list_app_users`) or a public-readable `creators` view. Acceptable for #2; flag for follow-up if it becomes confusing. Admin who wants to know which user a UUID belongs to can use `/admin/users.html`.
- The slug-collision live check (Task 10 step 3f) uses public `recipes.id` SELECT; works for any signed-in user since reads are public.
- Trigger uses `auth.users.created_at` to find first admin; stable for current project (one admin). If multiple admins ever exist, the oldest by `created_at` wins.
- iCloud Documents folder corruption warning at the top of the plan stays — every `make sync` strips hidden flags from the venv tree.
