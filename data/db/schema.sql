-- =============================================================================
-- MyFoodCraving — Supabase schema
-- =============================================================================
-- Apply this in Supabase Studio → SQL Editor (or psql).
-- Idempotent: safe to re-run; uses CREATE TABLE IF NOT EXISTS and policy drops.
-- After applying, also run data/db/seed_metrics.sql for the health-marker catalog.
--
-- Schema layout:
--   1. Catalog          — recipes + their parts (admin-writable, public read)
--   2. Health markers   — definition catalog + per-user values
--   3. Recommendations  — per-user, per-meal-type recipe suggestions
--                         (written by an offline data pipeline; users only read)
--   4. User-owned       — saved recipes, cooking sessions, prefs, meal logs
--   5. Triggers         — auto-bump updated_at
--   6. Row Level Security
-- =============================================================================


-- =============================================================================
-- 1. CATALOG
-- Admin (service-role) writes; everyone reads. The site renders these tables
-- directly — there is no static JSON fallback in production.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.recipes (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  tagline         text,
  short_tagline   text,
  cuisine         text NOT NULL,
  difficulty      text NOT NULL,
  servings        int  NOT NULL,
  total_minutes   int  NOT NULL,
  media           jsonb NOT NULL DEFAULT '{}'::jsonb,
  color           text,
  color_soft      text,
  featured        boolean NOT NULL DEFAULT false,
  highlight       text,
  meal_types      text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.recipes              IS 'One row per recipe. Edited by admin via Supabase Studio. Slugs are stable URL ids.';
COMMENT ON COLUMN public.recipes.id           IS 'URL slug (e.g. "paneer-butter-masala"). Stable; never reuse.';
COMMENT ON COLUMN public.recipes.name         IS 'Display title (e.g. "Paneer Butter Masala").';
COMMENT ON COLUMN public.recipes.tagline      IS 'Marketing tagline used on listing/cards (e.g. "Silky tomato-cashew gravy, restaurant-style at home").';
COMMENT ON COLUMN public.recipes.short_tagline IS 'Compact tagline used on the detail page hero (e.g. "creamy · tomato · 35 min").';
COMMENT ON COLUMN public.recipes.cuisine      IS 'Cuisine label (e.g. "North Indian"). Free text; used for filtering on the search page.';
COMMENT ON COLUMN public.recipes.difficulty   IS 'One of "Easy" | "Medium" | "Hard". Free text on purpose so admin can extend.';
COMMENT ON COLUMN public.recipes.servings     IS 'Default serving count this recipe yields. Frontend scales ingredients off this.';
COMMENT ON COLUMN public.recipes.total_minutes IS 'Total active + passive cook time in minutes (rough estimate).';
COMMENT ON COLUMN public.recipes.media        IS 'JSONB { emoji, image, hero: { palette[], alt, caption } }. Image is a relative URL like data/recipe-bundles/{id}/hero.jpg.';
COMMENT ON COLUMN public.recipes.color        IS 'Brand accent hex for this recipe card (e.g. "#FF6D2E"). Used for the card-left tile and chip accents.';
COMMENT ON COLUMN public.recipes.color_soft   IS 'Translucent variant of color (rgba) used as the soft card-tile background.';
COMMENT ON COLUMN public.recipes.featured     IS 'When true, the recipe appears in the featured section on the search page.';
COMMENT ON COLUMN public.recipes.highlight    IS 'One-liner highlight callout (e.g. "14g protein per serving from paneer").';
COMMENT ON COLUMN public.recipes.meal_types   IS 'Array of meal types this recipe is appropriate for. Used to scope per-meal-type recommendations. Values: breakfast | lunch | dinner | snack.';
COMMENT ON COLUMN public.recipes.created_at   IS 'Row creation timestamp.';
COMMENT ON COLUMN public.recipes.updated_at   IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  recipe_id   text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  sort_order  int  NOT NULL,
  group_name  text,
  ingredient  text NOT NULL,
  amount      text,
  PRIMARY KEY (recipe_id, sort_order)
);

COMMENT ON TABLE  public.recipe_ingredients             IS 'Ordered ingredient list per recipe. Cascade-deletes with the parent recipe.';
COMMENT ON COLUMN public.recipe_ingredients.recipe_id   IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_ingredients.sort_order  IS 'Display order (0-based). Determines rendering sequence.';
COMMENT ON COLUMN public.recipe_ingredients.group_name  IS 'Optional grouping label ("main", "spice", "aromatics") for sectioning the list. Nullable.';
COMMENT ON COLUMN public.recipe_ingredients.ingredient  IS 'Ingredient name as displayed (e.g. "Paneer", "Ginger-garlic paste"). Free text; admin keeps casing/wording consistent.';
COMMENT ON COLUMN public.recipe_ingredients.amount      IS 'Quantity as a free-text string (e.g. "300g", "1.5 tbsp", "to taste"). Frontend may scale numeric prefixes against the active serving size.';


CREATE TABLE IF NOT EXISTS public.recipe_steps (
  recipe_id        text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  sort_order       int  NOT NULL,
  title            text NOT NULL,
  detail           text NOT NULL,
  duration_seconds int,
  tip              text,
  media_caption    text,
  PRIMARY KEY (recipe_id, sort_order)
);

COMMENT ON TABLE  public.recipe_steps                  IS 'Ordered cooking steps per recipe. The frontend timer runs against duration_seconds.';
COMMENT ON COLUMN public.recipe_steps.recipe_id        IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_steps.sort_order       IS 'Step number (1-based by convention). Determines rendering and timer sequence.';
COMMENT ON COLUMN public.recipe_steps.title            IS 'Short step heading (e.g. "Bloom the spices").';
COMMENT ON COLUMN public.recipe_steps.detail           IS 'Full step instructions (paragraph form). Markdown-safe but rendered as plain text today.';
COMMENT ON COLUMN public.recipe_steps.duration_seconds IS 'Step timer length in seconds. Nullable for steps that have no countdown.';
COMMENT ON COLUMN public.recipe_steps.tip              IS 'Optional pro-tip shown below the step detail. Nullable.';
COMMENT ON COLUMN public.recipe_steps.media_caption    IS 'Caption text for the step reference image (image file lives at data/recipe-bundles/{recipe_id}/step-{sort_order}.jpg). Nullable.';


CREATE TABLE IF NOT EXISTS public.recipe_utensils (
  recipe_id text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  name      text NOT NULL,
  essential boolean NOT NULL DEFAULT true,
  PRIMARY KEY (recipe_id, name)
);

COMMENT ON TABLE  public.recipe_utensils           IS 'Tools/equipment the recipe needs. The frontend separates essential vs. nice-to-have.';
COMMENT ON COLUMN public.recipe_utensils.recipe_id IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_utensils.name      IS 'Utensil display name (e.g. "Heavy-bottomed pan / kadhai"). Free text.';
COMMENT ON COLUMN public.recipe_utensils.essential IS 'True = required to make the recipe. False = optional / nice to have.';


CREATE TABLE IF NOT EXISTS public.recipe_tags (
  recipe_id text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  tag       text NOT NULL,
  PRIMARY KEY (recipe_id, tag)
);

COMMENT ON TABLE  public.recipe_tags           IS 'Free-form labels attached to a recipe ("vegetarian", "gluten-free", "high-protein"). Powers the filter chips on the search page.';
COMMENT ON COLUMN public.recipe_tags.recipe_id IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_tags.tag       IS 'Tag string. Lowercase by convention; admin keeps the vocabulary consistent.';


CREATE TABLE IF NOT EXISTS public.recipe_health_facts (
  recipe_id  text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  sort_order int  NOT NULL,
  fact       text NOT NULL,
  PRIMARY KEY (recipe_id, sort_order)
);

COMMENT ON TABLE  public.recipe_health_facts             IS 'Ordered list of nutrition / health facts displayed in the marquee on the recipe page.';
COMMENT ON COLUMN public.recipe_health_facts.recipe_id   IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_health_facts.sort_order  IS 'Display order (0-based).';
COMMENT ON COLUMN public.recipe_health_facts.fact        IS 'One sentence of nutrition/health context (e.g. "Paneer adds ~14g protein per 100g — a near-complete source for vegetarians.").';


-- =============================================================================
-- 2. HEALTH MARKERS
-- A reference catalog (metric_definitions) keyed by stable string ids the
-- offline pipeline can rely on, plus per-user values keyed by (user, marker,
-- date) so a user can record a history of lab results.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.metric_definitions (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  unit        text NOT NULL,
  normal_min  numeric,
  normal_max  numeric,
  category    text,
  sort_order  int NOT NULL DEFAULT 0
);

COMMENT ON TABLE  public.metric_definitions             IS 'Catalog of recordable health markers (iron, b12, d3, ldl, etc.). Reference data; seeded by data/db/seed_metrics.sql; admin can extend via Studio.';
COMMENT ON COLUMN public.metric_definitions.id          IS 'Stable string id (e.g. "iron", "b12", "d3", "ldl"). Used by both the UI and the offline data pipeline as a join key.';
COMMENT ON COLUMN public.metric_definitions.name        IS 'Display name (e.g. "Vitamin D (25-OH)").';
COMMENT ON COLUMN public.metric_definitions.unit        IS 'Canonical unit for this marker (e.g. "ng/mL", "mg/dL"). User-entered values default to this unit.';
COMMENT ON COLUMN public.metric_definitions.normal_min  IS 'Lower bound of the typical adult reference range. Nullable when only an upper bound is meaningful (e.g. LDL).';
COMMENT ON COLUMN public.metric_definitions.normal_max  IS 'Upper bound of the typical adult reference range. Nullable when only a lower bound is meaningful (e.g. HDL).';
COMMENT ON COLUMN public.metric_definitions.category    IS 'UI grouping label (e.g. "mineral", "vitamin", "lipid", "metabolic", "thyroid", "kidney", "blood"). Drives section headers in the markers panel.';
COMMENT ON COLUMN public.metric_definitions.sort_order  IS 'Display order within the markers panel. Lower values appear first.';


CREATE TABLE IF NOT EXISTS public.user_health_markers (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_id    text NOT NULL REFERENCES public.metric_definitions(id),
  value        numeric NOT NULL,
  unit         text NOT NULL,
  measured_at  date NOT NULL,
  source       text NOT NULL DEFAULT 'manual',
  note         text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, metric_id, measured_at)
);

COMMENT ON TABLE  public.user_health_markers              IS 'A user''s recorded health-marker values. Composite PK (user, marker, date) preserves history — re-entering the same marker on a new date adds a row; re-entering on the same date overwrites.';
COMMENT ON COLUMN public.user_health_markers.user_id      IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.user_health_markers.metric_id    IS 'FK → metric_definitions.id (e.g. "iron", "b12").';
COMMENT ON COLUMN public.user_health_markers.value        IS 'Numeric reading entered by the user.';
COMMENT ON COLUMN public.user_health_markers.unit         IS 'Unit the value was recorded in. Stored alongside value so we can interpret old rows even if metric_definitions.unit later changes.';
COMMENT ON COLUMN public.user_health_markers.measured_at  IS 'Date the lab test was taken (or when the user reports the value). NOT the row insert time.';
COMMENT ON COLUMN public.user_health_markers.source       IS 'Provenance label: "manual" | "lab_upload" | "apple_health" | etc. Free text; used by the data pipeline for trust scoring.';
COMMENT ON COLUMN public.user_health_markers.note         IS 'Optional free-text note from the user (e.g. "fasting", "post-supplementation"). Nullable.';
COMMENT ON COLUMN public.user_health_markers.updated_at   IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


-- =============================================================================
-- 3. RECOMMENDATIONS
-- Written by the offline data pipeline using the service-role key
-- (RLS bypass). Users only read their own rows.
-- The pipeline is responsible for refreshing rows whenever user health markers
-- change or the recipe catalog changes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.recommendations (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_type    text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  recipe_id    text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  rank         int  NOT NULL,
  reason       text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, meal_type, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_recommendations_user_meal_rank
  ON public.recommendations (user_id, meal_type, rank);

COMMENT ON TABLE  public.recommendations              IS 'Per-user, per-meal-type recipe suggestions. Populated by the offline data pipeline (NOT the website). Users see their own rows ordered by rank.';
COMMENT ON COLUMN public.recommendations.user_id      IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.recommendations.meal_type    IS 'Meal slot: breakfast | lunch | dinner | snack. Constrained by CHECK; pipeline must use these exact values.';
COMMENT ON COLUMN public.recommendations.recipe_id    IS 'FK → recipes.id. The suggested recipe.';
COMMENT ON COLUMN public.recommendations.rank         IS 'Suggestion priority within (user_id, meal_type). 1 = top pick. Lower number = better match.';
COMMENT ON COLUMN public.recommendations.reason       IS 'Optional human-readable explanation of why this recipe was picked (e.g. "Boosts iron — your last reading was 95 µg/dL, below your target."). Surfaced in the UI under each suggestion.';
COMMENT ON COLUMN public.recommendations.generated_at IS 'When the pipeline produced this row. UI may show staleness; pipeline can use this to skip refresh if recent.';


-- =============================================================================
-- 4. USER-OWNED
-- Per-user state: bookmarks, in-progress cooking sessions, preferences,
-- and a meal-log diary.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.saved_recipes (
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  note      text,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id)
);

COMMENT ON TABLE  public.saved_recipes           IS 'User bookmarks. Toggled by the heart icon on recipe cards.';
COMMENT ON COLUMN public.saved_recipes.user_id   IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.saved_recipes.recipe_id IS 'FK → recipes.id.';
COMMENT ON COLUMN public.saved_recipes.note      IS 'Optional personal note (e.g. "make for Sunday dinner"). Nullable.';
COMMENT ON COLUMN public.saved_recipes.saved_at  IS 'When the user saved it. Used for sort order on a future "Saved" page.';


CREATE TABLE IF NOT EXISTS public.cooking_sessions (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id    text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  current_step int  NOT NULL DEFAULT 0,
  servings     int,
  started_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, recipe_id)
);

COMMENT ON TABLE  public.cooking_sessions              IS 'In-progress / completed cooking sessions, one row per (user, recipe). Lets users resume cooking on another device.';
COMMENT ON COLUMN public.cooking_sessions.user_id      IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.cooking_sessions.recipe_id    IS 'FK → recipes.id.';
COMMENT ON COLUMN public.cooking_sessions.current_step IS '0-based index into recipe_steps.sort_order (after sorting). The step the user was last on.';
COMMENT ON COLUMN public.cooking_sessions.servings     IS 'Servings the user is cooking (may differ from recipe default). Nullable = use recipe default.';
COMMENT ON COLUMN public.cooking_sessions.started_at   IS 'When the user first opened this recipe with the intent to cook.';
COMMENT ON COLUMN public.cooking_sessions.updated_at   IS 'Auto-updated via touch_updated_at trigger on UPDATE.';
COMMENT ON COLUMN public.cooking_sessions.completed_at IS 'Set when the user completes all steps. NULL = still in progress.';


CREATE TABLE IF NOT EXISTS public.user_prefs (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

COMMENT ON TABLE  public.user_prefs             IS 'Generic per-user key/value preference store. Use sparingly — promote a pref to its own column once it has UI affordances.';
COMMENT ON COLUMN public.user_prefs.user_id     IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.user_prefs.key         IS 'Pref name. Conventions: "tweaks" (palette/intervals from the dev tweak panel), "default_servings" (int), "voiceover_voice" (string).';
COMMENT ON COLUMN public.user_prefs.value       IS 'JSONB blob — shape is owned by the consumer code, not enforced here.';
COMMENT ON COLUMN public.user_prefs.updated_at  IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


CREATE TABLE IF NOT EXISTS public.meal_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id  text REFERENCES public.recipes(id) ON DELETE SET NULL,
  meal_type  text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  servings   numeric,
  logged_at  timestamptz NOT NULL DEFAULT now(),
  note       text,
  source     text NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user_logged_at
  ON public.meal_logs (user_id, logged_at DESC);

COMMENT ON TABLE  public.meal_logs            IS 'A user''s eating diary — one row per meal eaten. Fed by the "Log this meal" CTA after cooking and by manual entry. The data pipeline may join this against user_health_markers when generating recommendations.';
COMMENT ON COLUMN public.meal_logs.id         IS 'Synthetic PK so a user can log the same recipe multiple times.';
COMMENT ON COLUMN public.meal_logs.user_id    IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.meal_logs.recipe_id  IS 'FK → recipes.id. NULL when the user logs a non-recipe meal (free-text only).';
COMMENT ON COLUMN public.meal_logs.meal_type  IS 'Meal slot: breakfast | lunch | dinner | snack. CHECK-constrained.';
COMMENT ON COLUMN public.meal_logs.servings   IS 'How much the user ate, in recipe-defined serving units. Nullable.';
COMMENT ON COLUMN public.meal_logs.logged_at  IS 'When the meal was eaten (user-editable; defaults to insert time).';
COMMENT ON COLUMN public.meal_logs.note       IS 'Optional note (e.g. "skipped the cream", "post-workout"). Nullable.';
COMMENT ON COLUMN public.meal_logs.source     IS 'Provenance label: "manual" | "cooking_session_complete" — lets analytics distinguish guided vs. ad-hoc logs.';


-- =============================================================================
-- 5. TRIGGERS — keep updated_at columns fresh
-- =============================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.touch_updated_at() IS 'BEFORE UPDATE trigger function — sets NEW.updated_at to now(). Attached to recipes, user_health_markers, cooking_sessions, user_prefs.';

DROP TRIGGER IF EXISTS trg_recipes_updated_at ON public.recipes;
CREATE TRIGGER trg_recipes_updated_at BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_user_health_markers_updated_at ON public.user_health_markers;
CREATE TRIGGER trg_user_health_markers_updated_at BEFORE UPDATE ON public.user_health_markers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_cooking_sessions_updated_at ON public.cooking_sessions;
CREATE TRIGGER trg_cooking_sessions_updated_at BEFORE UPDATE ON public.cooking_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_user_prefs_updated_at ON public.user_prefs;
CREATE TRIGGER trg_user_prefs_updated_at BEFORE UPDATE ON public.user_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- Catalog + metric_definitions  → public read; only service-role writes
-- User-owned tables             → owner has full CRUD via auth.uid()
-- Recommendations               → owner reads; only service-role writes
-- =============================================================================

ALTER TABLE public.recipes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_utensils      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_tags          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_health_facts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_definitions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recipes_public_read"             ON public.recipes;
DROP POLICY IF EXISTS "recipe_ingredients_public_read"  ON public.recipe_ingredients;
DROP POLICY IF EXISTS "recipe_steps_public_read"        ON public.recipe_steps;
DROP POLICY IF EXISTS "recipe_utensils_public_read"     ON public.recipe_utensils;
DROP POLICY IF EXISTS "recipe_tags_public_read"         ON public.recipe_tags;
DROP POLICY IF EXISTS "recipe_health_facts_public_read" ON public.recipe_health_facts;
DROP POLICY IF EXISTS "metric_definitions_public_read"  ON public.metric_definitions;

CREATE POLICY "recipes_public_read"             ON public.recipes              FOR SELECT USING (true);
CREATE POLICY "recipe_ingredients_public_read"  ON public.recipe_ingredients   FOR SELECT USING (true);
CREATE POLICY "recipe_steps_public_read"        ON public.recipe_steps         FOR SELECT USING (true);
CREATE POLICY "recipe_utensils_public_read"     ON public.recipe_utensils      FOR SELECT USING (true);
CREATE POLICY "recipe_tags_public_read"         ON public.recipe_tags          FOR SELECT USING (true);
CREATE POLICY "recipe_health_facts_public_read" ON public.recipe_health_facts  FOR SELECT USING (true);
CREATE POLICY "metric_definitions_public_read"  ON public.metric_definitions   FOR SELECT USING (true);

ALTER TABLE public.user_health_markers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_recipes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooking_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_prefs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_logs            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_health_markers_owner_all" ON public.user_health_markers;
DROP POLICY IF EXISTS "saved_recipes_owner_all"       ON public.saved_recipes;
DROP POLICY IF EXISTS "cooking_sessions_owner_all"    ON public.cooking_sessions;
DROP POLICY IF EXISTS "user_prefs_owner_all"          ON public.user_prefs;
DROP POLICY IF EXISTS "meal_logs_owner_all"           ON public.meal_logs;

CREATE POLICY "user_health_markers_owner_all" ON public.user_health_markers
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_recipes_owner_all"       ON public.saved_recipes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cooking_sessions_owner_all"    ON public.cooking_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_prefs_owner_all"          ON public.user_prefs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "meal_logs_owner_all"           ON public.meal_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recommendations_owner_read" ON public.recommendations;
CREATE POLICY "recommendations_owner_read" ON public.recommendations
  FOR SELECT USING (auth.uid() = user_id);
