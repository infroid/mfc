# Recipe Ownership + Chef Portal — Design

- **Date:** 2026-05-07
- **Status:** Approved (brainstorm). Ready for implementation plan.
- **Sub-project:** #2 of the broader role/ownership/transfer/freeze rollout.

## Context

Sub-projects #1 (roles foundation) and #2.5 (images on Storage + bidirectional sync) are shipped. This spec introduces recipe ownership, a chef workspace, and finishes consolidating recipe management out of the admin shell. Three user directives were folded in during brainstorming:

1. Drop `featured` and `highlight` columns entirely (not used by `myfoodcraving.com` going forward).
2. Recipe management moves entirely to the chef section (no separate "recipes admin" surface). Admin uses the chef portal too.
3. Add an "Admin portal" link in the navbar dropdown for admins, symmetric with "Chef portal" for chefs/admins.

Decomposition order: ✅ #1 → ✅ #2.5 → **#2 (this spec)** → #3 (transfer with admin approval) → #4 (freeze switch).

## Goals

- Add a multi-owner permission ledger (`recipe_owners`) as the single source of truth for who-can-edit a recipe. The first admin is always an owner of every recipe; chef-creators are owners of their own recipes.
- Provide a chef portal under `/chef/` with two pages (list, editor). Chef sees only their owned recipes; admin sees all recipes.
- Drop `featured` and `highlight` columns + all front-end consumers.
- Move recipe management out of `/admin/`. Delete `/admin/recipes.html` and `/admin/recipe.html`.
- Add Admin portal + Chef portal links to the navbar's user-menu, conditional on role.
- Tighten Storage RLS so chef can write to `<recipe_id>/*` for owned recipes (was admin-only after #2.5).

## Non-goals (deferred)

- **Ownership transfer with admin approval** → #3. The `recipe_owners` table is built so #3 transfers are a single insert/delete pair.
- **Global freeze switch** → #4.
- **Chef-side library writes** (creating new ingredients/utensils inline). Chef picks from the existing library only.
- **Co-owner UI** (add/remove co-owners on a recipe). Schema supports multi-row owners; UI does not surface this in #2.
- **Draft / publish state**, moderation queue, recipe duplication, recipe categorisation that doesn't already exist.
- **First-admin re-seeding** if you ever promote a new "first admin." A one-shot reseeding command is doable later.

## Decisions captured

1. **Workspace location** — separate `/chef/` shell. Same files used by chef and admin (one set of recipe-management UI). `/admin/` keeps user, ingredient, utensil, dashboard pages only.
2. **Library access for chef** — read existing only. New ingredients/utensils require admin pre-population. RLS on `ingredients` / `utensils` stays admin-only writable.
3. **`featured` / `highlight` removal** — DROP COLUMN, plus front-end / sync / dashboard cleanup.
4. **Backfill default** — set `recipes.created_by` (existing column, currently NULL) to first-admin (oldest by `auth.users.created_at`); enforce NOT NULL going forward. Insert one row per recipe into `recipe_owners` with the same first-admin user_id.
5. **Storage RLS** — replace admin-only writes (#2.5) with admin-or-owner writes via `recipe_owned_by_caller`.
6. **Chef can delete their own recipes**. Cascades to children + Storage folder, same as admin's behaviour today.
7. **Login landing unchanged** (`/my/dashboard.html`). Chef navigates to `/chef/...` via the user-menu link.
8. **Discovery via user-menu**. Admin sees both Admin portal + Chef portal items; chef sees Chef portal only; user sees neither.
9. **Chef portal home** = `/chef/recipes.html` (no separate dashboard).
10. **Single source of truth for ownership** = `recipe_owners` join table. `recipes.owner_id` column is **not added**. `recipes.created_by` (existing) is the audit-only "creator" column; permissions read `recipe_owners`.
11. **First admin is always a co-owner** of every recipe. Trigger ensures this on every recipes INSERT.
12. **Chef list filter via inner join** on `recipe_owners` (not `created_by`). Future-proofs for #3 transfers (transferred chef shows up in their owned-list automatically).
13. **Slug collision** — live check on `?new=1` (debounced 400ms) plus the existing 23505 catch on save. Slugs stay auto-generated from name; no manual override.
14. **Owner / Creator UI** — single column "Creator" on the chef list page, showing `recipes.created_by`'s email or "You" when self. Multi-owner display deferred.
15. **Admin in chef portal sees all recipes** (`listRecipes` no-filter); chef sees only owned (`listOwnedRecipes` inner-join filter).
16. **Bundle JSON carries `createdBy`** (singular). Push reconciles `recipe_owners` with a bulk-upsert; trigger handles first-admin row on INSERT.

## Architecture

```
        ┌────────────────────────────────────────────────────────────┐
        │  Supabase                                                   │
        │                                                             │
        │  recipes.created_by NOT NULL  (audit only)                  │
        │  recipe_owners (recipe_id, user_id) PK   ── permission ledger
        │  Trigger AFTER INSERT on recipes:                            │
        │    add (recipe.id, recipe.created_by) and                    │
        │        (recipe.id, first_admin) into recipe_owners           │
        │                                                             │
        │  RLS recipes + 5 child tables:                              │
        │    chef writes iff recipe_owned_by_caller(id) (in owners)   │
        │    chef inserts iff created_by = auth.uid()                 │
        │    admin writes anything                                    │
        │    public reads anything                                    │
        │                                                             │
        │  Storage (recipe-images bucket):                            │
        │    can_write_recipe_image(path) = is_admin OR               │
        │      (is_chef AND recipe_owned_by_caller(<first-segment>))  │
        └───────────┬────────────────────────────────────────┬────────┘
                    │ supabase-js (RLS-enforced)              │
        ┌───────────┴──────────────┐         ┌────────────────┴───────┐
        │  Chef portal             │         │  Admin shell           │
        │   /chef/recipes.html     │         │   /admin/index.html    │
        │   /chef/recipe.html      │         │   /admin/users.html    │
        │                          │         │   /admin/ingredients.* │
        │  Used by chef AND admin. │         │   /admin/utensils.*    │
        │  Chef sees own; admin    │         │  Recipe pages REMOVED. │
        │  sees all. Same files.   │         │                        │
        └──────────────────────────┘         └────────────────────────┘
                    │                                    │
                    └─────── user-menu ──────────────────┘
                       Admin portal (admin only)
                       Chef portal  (chef + admin)
```

Three components, each with one purpose:

1. **Schema + RLS** — `recipes.created_by` made NOT NULL with first-admin backfill, `recipe_owners` join table created with RLS + trigger, `featured`/`highlight` dropped. Helper `recipe_owned_by_caller(text)` reads `recipe_owners`. Used by all chef-write policies on the catalog and by `can_write_recipe_image` on Storage.
2. **Chef portal** — `/chef/recipes.html` (list, role-aware filter, Creator column) and `/chef/recipe.html` (editor, no featured/highlight, live slug-collision check on new). Gated by `chef-gate.js` accepting `role ∈ {chef, admin}`. Reuses `MFC.imageUpload` from #2.5 unchanged.
3. **Cleanup** — delete `/admin/recipes.html`, `/admin/recipe.html`, related JSX. Update `AdminSidebar` (drop Recipes, add Workspaces/Chef portal link). Update `db.js` and `admin-db.js` SELECT lists. Update `user-menu.jsx` for portal links. Drop the Featured-picks section from `/recipe-search.html`. Drop `featured`/`highlight` from sync push/pull.

## Schema changes

Delivered as `automation/db/migration-2026-05-07-recipe-ownership.sql`. Idempotent. Folded into `schema.sql`.

```sql
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

-- ── 2. recipe_owners join table — the permission ledger ──────────────
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

-- ── 4. Backfill recipe_owners for the 154 existing recipes ───────────
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

-- Same shape on the 5 child tables:
DROP POLICY IF EXISTS "recipe_ingredients_chef_write"  ON public.recipe_ingredients;
DROP POLICY IF EXISTS "recipe_steps_chef_write"        ON public.recipe_steps;
DROP POLICY IF EXISTS "recipe_utensils_chef_write"     ON public.recipe_utensils;
DROP POLICY IF EXISTS "recipe_tags_chef_write"         ON public.recipe_tags;
DROP POLICY IF EXISTS "recipe_health_facts_chef_write" ON public.recipe_health_facts;

CREATE POLICY "recipe_ingredients_chef_write"  ON public.recipe_ingredients  FOR ALL
  USING      (public.is_chef() AND public.recipe_owned_by_caller(recipe_id))
  WITH CHECK (public.is_chef() AND public.recipe_owned_by_caller(recipe_id));
-- (Identical shape for recipe_steps, recipe_utensils, recipe_tags, recipe_health_facts.)

-- ── 8. recipe_owners RLS ──────────────────────────────────────────────
ALTER TABLE public.recipe_owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipe_owners_authenticated_read"
  ON public.recipe_owners FOR SELECT TO authenticated USING (true);

CREATE POLICY "recipe_owners_admin_write"
  ON public.recipe_owners FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 9. Storage RLS — chef can write owned recipes' folders ───────────
-- Replaces #2.5's admin-only write policies.
CREATE OR REPLACE FUNCTION public.can_write_recipe_image(path text)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR (
        public.is_chef()
        AND public.recipe_owned_by_caller(split_part(path, '/', 1))
      );
$$;

DROP POLICY IF EXISTS "recipe_images_admin_write"   ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_update"  ON storage.objects;
DROP POLICY IF EXISTS "recipe_images_admin_delete"  ON storage.objects;

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

`schema.sql` itself loses the `featured boolean DEFAULT false` and `highlight text` lines from the `CREATE TABLE public.recipes` block, plus their `COMMENT ON COLUMN` lines. `created_by` becomes `NOT NULL` in the canonical CREATE TABLE.

## Chef portal pages

### Layout

```
web/
  chef/
    recipes.html               (new — list shell)
    recipe.html                (new — editor shell)
  assets/js/
    app/
      chef-recipes-app.jsx     (new — list app, role-aware filter)
      chef-recipe-app.jsx      (new — editor app)
    lib/
      chef-gate.js             (new — accepts role ∈ {chef, admin})
```

### `chef-gate.js`

`MFC.chefGate.guard()` resolves true when role ∈ `{'chef','admin'}`. Otherwise renders a not-authorized panel: "You need chef access. Ask an admin." Mirrors `admin-gate.js` shape.

### `/chef/recipes.html` + `chef-recipes-app.jsx`

- Header / topbar: "Recipes".
- Filter row: search input + `+ New recipe` button → `/chef/recipe.html?new=1`.
- **Role-aware list query**:
  - Chef: `MFC.adminDb.listOwnedRecipes(userId)` — inner-join filter on `recipe_owners.user_id`. Returns recipes where the user is in `recipe_owners`.
  - Admin: existing `MFC.adminDb.listRecipes()` — no filter.
- **Banner above table** (admin only): "Viewing all recipes as admin. New recipes you create will be marked with you as creator. User and library management lives in the Admin portal."
- **Table columns**: thumbnail, name, cuisine·difficulty, step count, **Creator** (email or "You"), updated, delete `×`.
- **Empty state**:
  - Chef: "You haven't authored any recipes yet. + Create your first recipe."
  - Admin: "No recipes match."

### `ChefSidebar` (in `admin-shared.jsx`)

Mirror of `AdminSidebar`. Items:

```js
[
  { group: "Library",    entries: [{ id: "recipes", icon: "✦", label: "Recipes", href: "recipes.html" }] },
  { group: "Workspaces", entries: [
      ...(role === 'admin' ? [{ id: "admin", icon: "⚙", label: "Admin portal", href: "../admin/index.html" }] : []),
  ]},
  { group: "Site",       entries: [
      { id: "view-site", icon: "↗", label: "View site",     href: "../index.html" },
      { id: "search",    icon: "⌕", label: "Recipe search", href: "../recipe-search.html" },
  ]},
]
```

### `/chef/recipe.html` + `chef-recipe-app.jsx`

A clone of today's `admin-recipe-app.jsx` minus:

- `featured` Toggle and `highlight` text input (columns dropped; nothing to bind).
- The `+ New ingredient` / `+ New utensil` shortcut buttons in the library picker (chef library inserts not in scope).

Plus:

- A read-only "Created by" line near the top of the form. Renders the email of `recipes.created_by` or "You" when `created_by === currentUser.id`.
- Live slug-collision check on `?new=1` only. Editor watches the `name` field; on change, debounce 400ms, slugify, run `SELECT id FROM recipes WHERE id = <slug>`. If it exists, render an inline warning: "A recipe with the slug `<slug>` already exists. Choose a different name." Save is still attempted; Postgres 23505 surfaces the same friendly message. Slug stays auto-generated from name.

**Save flow:**
1. **New** (`?new=1`): chef fills form → save → `MFC.adminDb.createOwnedRecipe(payload, currentUser.id)` — INSERT with `created_by = currentUser.id`. RLS WITH CHECK passes via `created_by = auth.uid()`. Trigger fires AFTER INSERT, adds (recipe.id, chef.id) and (recipe.id, first-admin.id) to `recipe_owners`. Subsequent updates allowed — chef is now in owners.
2. **Edit** (`?id=...`): editor loads existing recipe → modifies → save via `MFC.adminDb.saveRecipe(payload)` — standard upsert. RLS USING + WITH CHECK pass via `recipe_owned_by_caller`.

**Image upload + delete cascade**: identical to today's admin recipe editor. Storage RLS now permits chef writes for owned recipes via `can_write_recipe_image` (Section 9).

### New `MFC.adminDb` helpers

- `listOwnedRecipes(userId)` — inner-join filter on `recipe_owners.user_id = userId`.
- `createOwnedRecipe(payload, userId)` — sets `created_by: userId` in the recipe row, otherwise identical to existing `saveRecipe`.

## Admin shell adjustments

### Files deleted

- `web/admin/recipes.html`
- `web/admin/recipe.html`
- `web/assets/js/app/admin-recipes-app.jsx`
- `web/assets/js/app/admin-recipe-app.jsx`

### `admin-shared.jsx` — `AdminSidebar` items revised

Drop the "Recipes" entry from the `Library` group. Add a new `Workspaces` group with a "Chef portal" entry:

```js
[
  { group: "Insights",   entries: [{ id: "dashboard", ... }] },
  { group: "Library",    entries: [
      // recipes entry removed
      { id: "ingredients", ... },
      { id: "utensils",    ... },
  ]},
  { group: "People",     entries: [{ id: "users", ... }] },
  { group: "Workspaces", entries: [
      { id: "chef", icon: "✦", label: "Chef portal", href: "../chef/recipes.html" },
  ]},
  { group: "Site",       entries: [...] },
]
```

### `admin-dashboard-app.jsx`

Two stat lines removed:
- `featured` count (KPI "★ N featured") — gone.
- `noHighlight` quality row ("recipes without a highlight one-liner") — gone.

Remaining stats unchanged.

### `admin-db.js`

Three SELECT queries drop `featured` / `highlight` columns. Two new helpers added: `listOwnedRecipes(userId)` and `createOwnedRecipe(payload, userId)`. Existing `saveRecipe(payload)` is unchanged in shape — payload no longer carries `featured`/`highlight` but everything else is identical.

### Admin pages that DON'T change

`/admin/index.html`, `/admin/users.html`, `/admin/user.html`, `/admin/ingredients.html`, `/admin/ingredient.html`, `/admin/utensils.html`, `/admin/utensil.html`. The admin-gate (`role === 'admin'`) on these pages is unchanged. The "Looking for the chef portal?" link in the not-authorized panel (when caller is `'chef'`) is added — chef who hits any admin page sees a one-line link to `/chef/recipes.html`.

## Navbar / user-menu

`web/assets/js/lib/user-menu.jsx` gains two role-conditional items in the dropdown:

```
┌─────────────────────────────┐
│ <name>                      │
│ <email>                     │
├─────────────────────────────┤
│ Admin portal           ⚙    │  (when role === 'admin')
│ Chef portal            ✦    │  (when role ∈ {chef, admin})
├─────────────────────────────┤
│ Profile                     │
│ Account                     │
├─────────────────────────────┤
│ Sign out                    │
└─────────────────────────────┘
```

`MfcUserMenu` reads role from `user.app_metadata?.role`. The component already takes `user`. Item visibility:

- `Admin portal` — `role === 'admin'`.
- `Chef portal` — `role === 'chef' || role === 'admin'`.

`base` prop already provided so the links resolve correctly from any depth (`/recipe.html`, `/my/dashboard.html`, etc.).

### `auth.js` change

`userFromSession` mapper currently exposes `provider` from `app_metadata` but not `role`. Add `role: u.app_metadata?.role || null` to the returned shape so the user-menu and nav components can read it.

## Public site + DB layer + sync cleanup

### `web/recipe-search.html`

Remove the entire `<section>` block for the "Featured picks" grid (~50 LOC of `FeaturedCard` + grid + CSS), the `featured` `useMemo` declaration, and the `FeaturedCard` component. Remove `.featured-card`, `.featured-card.avoid`, `.featured-grid` rules + responsive breakpoints from the page's inline `<style>`.

### `web/assets/js/lib/db.js`

```diff
- .select('id,name,...,featured,highlight,recipe_tags(tag)')
- .order('featured', { ascending: false })
+ .select('id,name,...,recipe_tags(tag)')
+ .order('updated_at', { ascending: false })
```

Mapper drops the `featured` / `highlight` properties from the returned shape.

### `automation/mfc/ops/recipes.py`

`_build_recipe_row`:

```diff
   "media": media,
   "color": detail.get("color"),
   "color_soft": detail.get("colorSoft"),
-  "featured": bool(detail.get("featured")),
-  "highlight": detail.get("highlight"),
   "meal_types": [],
 }
+ if detail.get("createdBy"):
+     row["created_by"] = detail["createdBy"]
+ return row
```

`_build_bundle` (pull):

```diff
-  "featured": bool(recipe_row.get("featured")),
-  "highlight": recipe_row.get("highlight"),
+  "createdBy": recipe_row.get("created_by"),
```

Strip-Nones cleanup: drop `featured` / `highlight` from the optional list, add `createdBy`.

`push_bundles`: after the recipes upsert, bulk-upsert `recipe_owners`:

```python
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

This handles the UPDATE path where the trigger doesn't fire.

### `admin-dashboard-app.jsx`

Featured / noHighlight stats removed (same change as listed under Admin shell adjustments).

## Build sequence

All steps performed by the assistant; no operator handoff.

1. Write `automation/db/migration-2026-05-07-recipe-ownership.sql`. Fold into `automation/db/schema.sql`.
2. Apply migration to live Supabase via the Supabase MCP. Verify schema state.
3. Update `automation/mfc/ops/recipes.py` — drop `featured`/`highlight`, round-trip `createdBy`, bulk-upsert `recipe_owners` after recipes upsert.
4. Run live: `make sync-recipes DIRECTION=push` to refresh DB rows + `recipe_owners`.
5. Update `web/assets/js/lib/db.js`.
6. Update `web/assets/js/lib/admin-db.js`.
7. Update `web/assets/js/app/admin-dashboard-app.jsx`.
8. Update `web/recipe-search.html`.
9. Build `web/assets/js/lib/chef-gate.js`.
10. Update `web/assets/js/lib/admin-shared.jsx` — sidebar revisions + new `ChefSidebar`.
11. Update `web/assets/js/lib/user-menu.jsx`.
12. Update `web/assets/js/lib/auth.js` — expose `role` on user object.
13. Update `web/assets/js/lib/admin-gate.js` — chef-empty-state polish.
14. Build `web/chef/recipes.html` + `chef-recipes-app.jsx`.
15. Build `web/chef/recipe.html` + `chef-recipe-app.jsx`.
16. Delete the four moved-out admin recipe files.
17. Update docs — `docs/USER-TODO.md`, `CLAUDE.md`.
18. Smoke verification (CLI + browser as admin, chef, user).

### Pre-implementation prerequisite

- Supabase MCP authenticated. Re-confirm before destructive calls.
- No new env vars; existing `automation/.env` is sufficient.

## Out of scope (decomposition reminder)

Explicitly NOT in #2:

- Ownership transfer with admin approval → **#3**.
- Global freeze switch → **#4**.
- Chef-side library writes (creating new ingredients/utensils inline).
- Co-owner add/remove UI; multi-owner display.
- First-admin re-seeding command.
- Recipe duplication / fork-from-template.
- Draft / publish state, moderation queue.
- Editorial curation (replacement for `featured`).
