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
