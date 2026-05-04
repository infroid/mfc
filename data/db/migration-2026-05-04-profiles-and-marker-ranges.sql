-- =============================================================================
-- Migration: 2026-05-04 — user_profiles + comprehensive marker catalog
-- =============================================================================
-- Apply in Supabase Studio → SQL Editor on top of the existing schema.
-- Idempotent. Safe to re-run.
--
-- After applying this delta, also re-run data/db/seed_metrics.sql to load the
-- expanded 54-marker catalog (with descriptions and new categories: liver,
-- inflammation, iron-panel). Existing IDs are preserved — your users' health
-- readings stay attached.
-- =============================================================================


-- 1. metric_definitions: add description + reaffirm sex-specific range columns.
ALTER TABLE public.metric_definitions
  ADD COLUMN IF NOT EXISTS normal_min_female numeric,
  ADD COLUMN IF NOT EXISTS normal_max_female numeric,
  ADD COLUMN IF NOT EXISTS normal_min_male   numeric,
  ADD COLUMN IF NOT EXISTS normal_max_male   numeric,
  ADD COLUMN IF NOT EXISTS description       text;

COMMENT ON COLUMN public.metric_definitions.normal_min_female IS 'Lower bound for female biological sex. Used when set; otherwise normal_min.';
COMMENT ON COLUMN public.metric_definitions.normal_max_female IS 'Upper bound for female biological sex. Used when set; otherwise normal_max.';
COMMENT ON COLUMN public.metric_definitions.normal_min_male   IS 'Lower bound for male biological sex. Used when set; otherwise normal_min.';
COMMENT ON COLUMN public.metric_definitions.normal_max_male   IS 'Upper bound for male biological sex. Used when set; otherwise normal_max.';
COMMENT ON COLUMN public.metric_definitions.category          IS 'UI grouping: lipid | metabolic | iron-panel | inflammation | liver | kidney | vitamin | mineral | thyroid | other.';
COMMENT ON COLUMN public.metric_definitions.description       IS 'One-liner explaining what the marker measures and how diet affects it. Surfaced on the marker card''s expanded view.';


-- 2. user_profiles: per-user food/health profile.
--    Display name and biological sex live on auth.users.user_metadata
--    (set via account/markers UI; biological sex is permanent).
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  date_of_birth date,
  diet_tags     text[] NOT NULL DEFAULT '{}',
  allergies     text[] NOT NULL DEFAULT '{}',
  goals         text[] NOT NULL DEFAULT '{}',
  units         text   NOT NULL DEFAULT 'metric'
                       CHECK (units IN ('metric','imperial')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.user_profiles               IS 'Per-user food/health profile: dietary identity, allergies, goals, units. Display name and biological sex live on auth.users.user_metadata (set via account/markers UI; permanent for biological sex).';
COMMENT ON COLUMN public.user_profiles.user_id       IS 'PK + FK → auth.users.id. One row per user.';
COMMENT ON COLUMN public.user_profiles.date_of_birth IS 'Optional. Used by the recommender pipeline for age-aware ranges and recommendations.';
COMMENT ON COLUMN public.user_profiles.diet_tags     IS 'Diet style + soft-pref tags (e.g. {"vegetarian","high-protein","mediterranean"}). Drawn from a shared taxonomy aligned with recipe_tags.tag.';
COMMENT ON COLUMN public.user_profiles.allergies     IS 'Hard exclusions (e.g. {"nut-free","egg-free"}). Always enforced — recipes that violate are demoted regardless of master toggle.';
COMMENT ON COLUMN public.user_profiles.goals         IS 'Health goals (e.g. {"weight-loss","heart-health"}).';
COMMENT ON COLUMN public.user_profiles.units         IS '"metric" | "imperial". Controls unit rendering across the app.';
COMMENT ON COLUMN public.user_profiles.updated_at    IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


-- 3. user_profiles trigger (reuses public.touch_updated_at function).
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- 4. user_profiles RLS: owner-only (same pattern as user_health_markers).
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_profiles_owner_all" ON public.user_profiles;
CREATE POLICY "user_profiles_owner_all" ON public.user_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- =============================================================================
-- Next step (manual): re-run data/db/seed_metrics.sql to load the 54-marker
-- catalog. Existing user readings remain attached via preserved metric IDs.
-- =============================================================================
