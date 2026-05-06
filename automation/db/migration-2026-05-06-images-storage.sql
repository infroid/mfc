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
