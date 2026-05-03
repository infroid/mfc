-- =============================================================================
-- MyFoodCraving — Supabase schema
-- =============================================================================
-- Apply in Supabase Studio → SQL Editor (or psql).
-- Idempotent: safe to re-run; uses CREATE TABLE IF NOT EXISTS and policy drops.
-- After applying, also run data/db/seed_metrics.sql for the health-marker catalog.
--
-- Schema layout:
--   1. Library           — ingredients, utensils, utensil_buy_links
--   2. Catalog           — recipes + their parts (admin-writable, public read)
--   3. Health markers    — definition catalog + per-user values
--   4. Recommendations   — per-user, per-meal-type (offline pipeline writes; users read)
--   5. User-owned        — saved recipes, cooking sessions, prefs, meal logs
--   6. Triggers          — auto-bump updated_at
--   7. Row Level Security
--   8. Admin             — is_admin() + admin write policies
-- =============================================================================


-- =============================================================================
-- DESTRUCTIVE: uncomment to wipe everything before re-applying the schema.
-- DROP TABLE IF EXISTS public.meal_logs, public.cooking_sessions, public.saved_recipes,
--   public.recommendations, public.user_health_markers, public.user_prefs,
--   public.recipe_health_facts, public.recipe_tags, public.recipe_utensils,
--   public.recipe_steps, public.recipe_ingredients, public.utensil_buy_links,
--   public.recipes, public.utensils, public.ingredients, public.metric_definitions
--   CASCADE;
-- DROP FUNCTION IF EXISTS public.touch_updated_at, public.is_admin CASCADE;
-- =============================================================================


-- =============================================================================
-- 1. LIBRARY
-- Master ingredient and utensil tables. Recipes reference these via FKs.
-- Admin writes; everyone reads.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ingredients (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  tagline      text,
  category     text,
  default_unit text NOT NULL DEFAULT 'g',
  photo        text,
  nutrition    jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_fact  text,
  storage      text,
  substitutes  text[] NOT NULL DEFAULT '{}',
  show         jsonb NOT NULL DEFAULT '{"nutrition":true,"healthFact":true,"storage":false,"substitutes":false}'::jsonb,
  ai_filled_at timestamptz,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.ingredients              IS 'Master library of ingredients. Recipes reference these via FK — inline ingredient names are not supported. Edited via admin-ingredient.html.';
COMMENT ON COLUMN public.ingredients.id           IS 'Stable URL slug (e.g. "paneer", "kasuri-methi"). Referenced by recipe_ingredients.ingredient_id.';
COMMENT ON COLUMN public.ingredients.name         IS 'Display name (e.g. "Paneer", "Ginger-garlic paste").';
COMMENT ON COLUMN public.ingredients.tagline      IS 'One-line description shown on the ingredient card (e.g. "fresh, milky, holds shape under heat").';
COMMENT ON COLUMN public.ingredients.category     IS 'Free text: "Dairy", "Vegetable", "Spice", "Herb", "Protein", "Oil & Fat", "Nut & Seed", "Aromatic", "Seasoning", etc.';
COMMENT ON COLUMN public.ingredients.default_unit IS 'Default unit pre-filled when a recipe picks this ingredient (g, ml, tsp, tbsp, cup, medium, large, whole, pinch).';
COMMENT ON COLUMN public.ingredients.photo        IS 'Relative path to the ingredient photo (e.g. "data/ingredient-photos/paneer.jpg"). Nullable.';
COMMENT ON COLUMN public.ingredients.nutrition    IS 'Per-100g macros: { calories, protein, fat, carbs }. Numbers; the four macros surface in the UI.';
COMMENT ON COLUMN public.ingredients.health_fact  IS 'One-liner surfaced in the recipe page health-fact rotator (60–110 chars).';
COMMENT ON COLUMN public.ingredients.storage      IS 'Storage tip shown on the ingredient page only.';
COMMENT ON COLUMN public.ingredients.substitutes  IS 'Free-text substitute names (e.g. {"tofu (firm)","halloumi"}).';
COMMENT ON COLUMN public.ingredients.show         IS 'Per-field visibility toggles { nutrition, healthFact, storage, substitutes }.';
COMMENT ON COLUMN public.ingredients.ai_filled_at IS 'When the AI auto-fill last ran. NULL if entered manually.';
COMMENT ON COLUMN public.ingredients.created_by   IS 'FK → auth.users.id of the admin who created this row.';
COMMENT ON COLUMN public.ingredients.created_at   IS 'Row creation timestamp.';
COMMENT ON COLUMN public.ingredients.updated_at   IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


CREATE TABLE IF NOT EXISTS public.utensils (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  tagline      text,
  category     text,
  photo        text,
  care_tip     text,
  specs        jsonb NOT NULL DEFAULT '{}'::jsonb,
  show         jsonb NOT NULL DEFAULT '{"careTip":true,"specs":false}'::jsonb,
  ai_filled_at timestamptz,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.utensils              IS 'Master library of utensils. Recipes reference these via FK. Edited via admin-utensil.html.';
COMMENT ON COLUMN public.utensils.id           IS 'Stable URL slug (e.g. "kadhai-cast-iron-9", "chefs-knife-8").';
COMMENT ON COLUMN public.utensils.name         IS 'Display name (e.g. "Cast-iron kadhai").';
COMMENT ON COLUMN public.utensils.tagline      IS 'One-line description (e.g. "deep, broad, hot — the workhorse pan").';
COMMENT ON COLUMN public.utensils.category     IS 'Free text: "Cookware", "Bakeware", "Cutlery", "Small appliance", "Utensil", "Measuring".';
COMMENT ON COLUMN public.utensils.photo        IS 'Relative path to the utensil photo. Nullable.';
COMMENT ON COLUMN public.utensils.care_tip     IS 'One-liner care tip (utensil page only).';
COMMENT ON COLUMN public.utensils.specs        IS 'Optional specs blob: { material, size, weight }.';
COMMENT ON COLUMN public.utensils.show         IS 'Per-field visibility toggles { careTip, specs }.';
COMMENT ON COLUMN public.utensils.ai_filled_at IS 'When the AI auto-fill last ran. NULL if entered manually.';
COMMENT ON COLUMN public.utensils.created_by   IS 'FK → auth.users.id of the admin who created this row.';
COMMENT ON COLUMN public.utensils.created_at   IS 'Row creation timestamp.';
COMMENT ON COLUMN public.utensils.updated_at   IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


CREATE TABLE IF NOT EXISTS public.utensil_buy_links (
  utensil_id    text NOT NULL REFERENCES public.utensils(id) ON DELETE CASCADE,
  sort_order    int  NOT NULL,
  store         text,
  url           text,
  price         text,
  affiliate_tag text,
  PRIMARY KEY (utensil_id, sort_order)
);

COMMENT ON TABLE  public.utensil_buy_links               IS 'One-to-many buy links per utensil. Replaces the old utensils.buy_link jsonb column.';
COMMENT ON COLUMN public.utensil_buy_links.utensil_id    IS 'FK → utensils.id. Cascade-deletes with the parent utensil.';
COMMENT ON COLUMN public.utensil_buy_links.sort_order    IS 'Display order; lower = first.';
COMMENT ON COLUMN public.utensil_buy_links.store         IS 'Store name (e.g. "Amazon", "iHerb"). Nullable.';
COMMENT ON COLUMN public.utensil_buy_links.url           IS 'Full buy URL. Nullable.';
COMMENT ON COLUMN public.utensil_buy_links.price         IS 'Price as a free-text string (e.g. "₹1,299"). Nullable.';
COMMENT ON COLUMN public.utensil_buy_links.affiliate_tag IS 'Affiliate tag appended at render time (e.g. "mfc-20"). Nullable.';


-- =============================================================================
-- 2. CATALOG
-- Admin writes; everyone reads. The site renders these tables directly —
-- there is no static JSON fallback in production.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.recipes (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  tagline       text,
  short_tagline text,
  cuisine       text NOT NULL,
  difficulty    text NOT NULL,
  servings      int  NOT NULL,
  total_minutes int  NOT NULL,
  media         jsonb NOT NULL DEFAULT '{}'::jsonb,
  color         text,
  color_soft    text,
  featured      boolean NOT NULL DEFAULT false,
  highlight     text,
  meal_types    text[] NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.recipes               IS 'One row per recipe. Edited by admin via Supabase Studio. Slugs are stable URL ids.';
COMMENT ON COLUMN public.recipes.id            IS 'URL slug (e.g. "paneer-butter-masala"). Stable; never reuse.';
COMMENT ON COLUMN public.recipes.name          IS 'Display title (e.g. "Paneer Butter Masala").';
COMMENT ON COLUMN public.recipes.tagline       IS 'Marketing tagline used on listing/cards.';
COMMENT ON COLUMN public.recipes.short_tagline IS 'Compact tagline used on the detail page hero (e.g. "creamy · tomato · 35 min").';
COMMENT ON COLUMN public.recipes.cuisine       IS 'Cuisine label (e.g. "North Indian"). Free text; used for filtering.';
COMMENT ON COLUMN public.recipes.difficulty    IS 'One of "Easy" | "Medium" | "Hard". Free text so admin can extend.';
COMMENT ON COLUMN public.recipes.servings      IS 'Default serving count this recipe yields. Frontend scales ingredients off this.';
COMMENT ON COLUMN public.recipes.total_minutes IS 'Total active + passive cook time in minutes (rough estimate).';
COMMENT ON COLUMN public.recipes.media         IS 'JSONB { emoji, image, hero: { palette[], alt, caption } }. Image is a relative URL like data/recipe-bundles/{id}/hero.jpg.';
COMMENT ON COLUMN public.recipes.color         IS 'Brand accent hex for this recipe card (e.g. "#FF6D2E").';
COMMENT ON COLUMN public.recipes.color_soft    IS 'Translucent variant of color (rgba) used as the soft card-tile background.';
COMMENT ON COLUMN public.recipes.featured      IS 'When true, the recipe appears in the featured section on the search page.';
COMMENT ON COLUMN public.recipes.highlight     IS 'One-liner highlight callout (e.g. "14g protein per serving from paneer").';
COMMENT ON COLUMN public.recipes.meal_types    IS 'Array of meal types: breakfast | lunch | dinner | snack. Scopes per-meal-type recommendations.';
COMMENT ON COLUMN public.recipes.created_by    IS 'FK → auth.users.id of the admin who created this row.';
COMMENT ON COLUMN public.recipes.created_at    IS 'Row creation timestamp.';
COMMENT ON COLUMN public.recipes.updated_at    IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  recipe_id     text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  sort_order    int  NOT NULL,
  ingredient_id text NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  group_name    text,
  amount        text,
  unit          text,
  PRIMARY KEY (recipe_id, sort_order)
);

COMMENT ON TABLE  public.recipe_ingredients               IS 'Ordered ingredient list per recipe. Cascade-deletes with the parent recipe. ingredient_id is RESTRICT-protected.';
COMMENT ON COLUMN public.recipe_ingredients.recipe_id     IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_ingredients.sort_order    IS 'Display order (0-based).';
COMMENT ON COLUMN public.recipe_ingredients.ingredient_id IS 'FK → ingredients.id. ON DELETE RESTRICT: deleting a referenced ingredient is rejected.';
COMMENT ON COLUMN public.recipe_ingredients.group_name    IS 'Optional grouping label ("main", "spice", "aromatics"). Nullable.';
COMMENT ON COLUMN public.recipe_ingredients.amount        IS 'Quantity as a free-text string (e.g. "300g", "1.5 tbsp", "to taste").';
COMMENT ON COLUMN public.recipe_ingredients.unit          IS 'Unit for this row (g, ml, tsp, tbsp, cup, medium, large, whole, pinch). Defaults from ingredients.default_unit; admin can override per recipe.';


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
COMMENT ON COLUMN public.recipe_steps.sort_order       IS 'Step number (1-based by convention).';
COMMENT ON COLUMN public.recipe_steps.title            IS 'Short step heading (e.g. "Bloom the spices").';
COMMENT ON COLUMN public.recipe_steps.detail           IS 'Full step instructions (paragraph form).';
COMMENT ON COLUMN public.recipe_steps.duration_seconds IS 'Step timer length in seconds. Nullable for steps with no countdown.';
COMMENT ON COLUMN public.recipe_steps.tip              IS 'Optional pro-tip shown below the step detail. Nullable.';
COMMENT ON COLUMN public.recipe_steps.media_caption    IS 'Caption for the step image at data/recipe-bundles/{recipe_id}/step-{sort_order}.jpg. Nullable.';


CREATE TABLE IF NOT EXISTS public.recipe_utensils (
  recipe_id  text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  sort_order int  NOT NULL,
  utensil_id text NOT NULL REFERENCES public.utensils(id) ON DELETE RESTRICT,
  essential  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (recipe_id, sort_order)
);

COMMENT ON TABLE  public.recipe_utensils            IS 'Ordered utensil list per recipe. Cascade-deletes with the parent recipe. utensil_id is RESTRICT-protected.';
COMMENT ON COLUMN public.recipe_utensils.recipe_id  IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_utensils.sort_order IS 'Display order (0-based).';
COMMENT ON COLUMN public.recipe_utensils.utensil_id IS 'FK → utensils.id. ON DELETE RESTRICT: deleting a referenced utensil is rejected.';
COMMENT ON COLUMN public.recipe_utensils.essential  IS 'True = required to make the recipe. False = optional / nice to have.';


CREATE TABLE IF NOT EXISTS public.recipe_tags (
  recipe_id text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  tag       text NOT NULL,
  PRIMARY KEY (recipe_id, tag)
);

COMMENT ON TABLE  public.recipe_tags           IS 'Free-form labels attached to a recipe ("vegetarian", "gluten-free", "high-protein"). Powers filter chips on the search page.';
COMMENT ON COLUMN public.recipe_tags.recipe_id IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_tags.tag       IS 'Tag string. Lowercase by convention.';


CREATE TABLE IF NOT EXISTS public.recipe_health_facts (
  recipe_id  text NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  sort_order int  NOT NULL,
  fact       text NOT NULL,
  PRIMARY KEY (recipe_id, sort_order)
);

COMMENT ON TABLE  public.recipe_health_facts            IS 'Ordered list of nutrition/health facts displayed in the marquee on the recipe page.';
COMMENT ON COLUMN public.recipe_health_facts.recipe_id  IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recipe_health_facts.sort_order IS 'Display order (0-based).';
COMMENT ON COLUMN public.recipe_health_facts.fact       IS 'One sentence of nutrition/health context.';


-- =============================================================================
-- 3. HEALTH MARKERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.metric_definitions (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  unit       text NOT NULL,
  normal_min numeric,
  normal_max numeric,
  category   text,
  sort_order int NOT NULL DEFAULT 0
);

COMMENT ON TABLE  public.metric_definitions            IS 'Catalog of recordable health markers (iron, b12, d3, ldl, etc.). Seeded by data/db/seed_metrics.sql.';
COMMENT ON COLUMN public.metric_definitions.id         IS 'Stable string id (e.g. "iron", "b12", "d3", "ldl"). Join key for the data pipeline.';
COMMENT ON COLUMN public.metric_definitions.name       IS 'Display name (e.g. "Vitamin D (25-OH)").';
COMMENT ON COLUMN public.metric_definitions.unit       IS 'Canonical unit (e.g. "ng/mL", "mg/dL").';
COMMENT ON COLUMN public.metric_definitions.normal_min IS 'Lower bound of typical adult reference range. Nullable.';
COMMENT ON COLUMN public.metric_definitions.normal_max IS 'Upper bound of typical adult reference range. Nullable.';
COMMENT ON COLUMN public.metric_definitions.category   IS 'UI grouping: "mineral", "vitamin", "lipid", "metabolic", "thyroid", "kidney", "blood".';
COMMENT ON COLUMN public.metric_definitions.sort_order IS 'Display order within the markers panel.';


CREATE TABLE IF NOT EXISTS public.user_health_markers (
  user_id     uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_id   text    NOT NULL REFERENCES public.metric_definitions(id),
  value       numeric NOT NULL,
  unit        text    NOT NULL,
  measured_at date    NOT NULL,
  source      text    NOT NULL DEFAULT 'manual',
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, metric_id, measured_at)
);

COMMENT ON TABLE  public.user_health_markers             IS 'A user''s recorded health-marker values. Composite PK (user, marker, date) preserves history.';
COMMENT ON COLUMN public.user_health_markers.user_id     IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.user_health_markers.metric_id   IS 'FK → metric_definitions.id.';
COMMENT ON COLUMN public.user_health_markers.value       IS 'Numeric reading entered by the user.';
COMMENT ON COLUMN public.user_health_markers.unit        IS 'Unit the value was recorded in.';
COMMENT ON COLUMN public.user_health_markers.measured_at IS 'Date the lab test was taken.';
COMMENT ON COLUMN public.user_health_markers.source      IS '"manual" | "lab_upload" | "apple_health" | etc.';
COMMENT ON COLUMN public.user_health_markers.note        IS 'Optional free-text note (e.g. "fasting"). Nullable.';
COMMENT ON COLUMN public.user_health_markers.updated_at  IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


-- =============================================================================
-- 4. RECOMMENDATIONS
-- Written by the offline data pipeline (service-role). Users only read their own.
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

COMMENT ON TABLE  public.recommendations             IS 'Per-user, per-meal-type recipe suggestions. Populated by the offline data pipeline. Users see their own rows ordered by rank.';
COMMENT ON COLUMN public.recommendations.user_id     IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.recommendations.meal_type   IS 'Meal slot: breakfast | lunch | dinner | snack.';
COMMENT ON COLUMN public.recommendations.recipe_id   IS 'FK → recipes.id.';
COMMENT ON COLUMN public.recommendations.rank        IS '1 = top pick. Lower = better match.';
COMMENT ON COLUMN public.recommendations.reason      IS 'Human-readable explanation (e.g. "Boosts iron — your last reading was below target."). Nullable.';
COMMENT ON COLUMN public.recommendations.generated_at IS 'When the pipeline produced this row.';


-- =============================================================================
-- 5. USER-OWNED
-- Per-user state: bookmarks, in-progress cooking sessions, preferences, diary.
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
COMMENT ON COLUMN public.saved_recipes.note      IS 'Optional personal note. Nullable.';
COMMENT ON COLUMN public.saved_recipes.saved_at  IS 'When the user saved it.';


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

COMMENT ON TABLE  public.cooking_sessions             IS 'In-progress / completed cooking sessions, one row per (user, recipe).';
COMMENT ON COLUMN public.cooking_sessions.user_id     IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.cooking_sessions.recipe_id   IS 'FK → recipes.id.';
COMMENT ON COLUMN public.cooking_sessions.current_step IS '0-based index into recipe_steps.sort_order. The step the user was last on.';
COMMENT ON COLUMN public.cooking_sessions.servings    IS 'Servings the user is cooking. Nullable = use recipe default.';
COMMENT ON COLUMN public.cooking_sessions.started_at  IS 'When the user first opened this recipe with intent to cook.';
COMMENT ON COLUMN public.cooking_sessions.updated_at  IS 'Auto-updated via touch_updated_at trigger on UPDATE.';
COMMENT ON COLUMN public.cooking_sessions.completed_at IS 'Set when the user completes all steps. NULL = still in progress.';


CREATE TABLE IF NOT EXISTS public.user_prefs (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

COMMENT ON TABLE  public.user_prefs            IS 'Generic per-user key/value preference store.';
COMMENT ON COLUMN public.user_prefs.user_id    IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.user_prefs.key        IS 'Pref name: "tweaks", "default_servings", "voiceover_voice".';
COMMENT ON COLUMN public.user_prefs.value      IS 'JSONB blob — shape owned by consumer code.';
COMMENT ON COLUMN public.user_prefs.updated_at IS 'Auto-updated via touch_updated_at trigger on UPDATE.';


CREATE TABLE IF NOT EXISTS public.meal_logs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id text REFERENCES public.recipes(id) ON DELETE SET NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  servings  numeric,
  logged_at timestamptz NOT NULL DEFAULT now(),
  note      text,
  source    text NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user_logged_at
  ON public.meal_logs (user_id, logged_at DESC);

COMMENT ON TABLE  public.meal_logs           IS 'A user''s eating diary — one row per meal eaten.';
COMMENT ON COLUMN public.meal_logs.id        IS 'Synthetic PK so a user can log the same recipe multiple times.';
COMMENT ON COLUMN public.meal_logs.user_id   IS 'FK → auth.users.id.';
COMMENT ON COLUMN public.meal_logs.recipe_id IS 'FK → recipes.id. NULL for non-recipe meals.';
COMMENT ON COLUMN public.meal_logs.meal_type IS 'Meal slot: breakfast | lunch | dinner | snack.';
COMMENT ON COLUMN public.meal_logs.servings  IS 'How much the user ate, in recipe-defined serving units. Nullable.';
COMMENT ON COLUMN public.meal_logs.logged_at IS 'When the meal was eaten (user-editable; defaults to insert time).';
COMMENT ON COLUMN public.meal_logs.note      IS 'Optional note. Nullable.';
COMMENT ON COLUMN public.meal_logs.source    IS '"manual" | "cooking_session_complete".';


-- =============================================================================
-- 6. TRIGGERS — keep updated_at columns fresh
-- =============================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.touch_updated_at() IS 'BEFORE UPDATE trigger — sets NEW.updated_at to now(). Attached to all tables with an updated_at column.';

DROP TRIGGER IF EXISTS trg_ingredients_updated_at         ON public.ingredients;
DROP TRIGGER IF EXISTS trg_utensils_updated_at            ON public.utensils;
DROP TRIGGER IF EXISTS trg_recipes_updated_at             ON public.recipes;
DROP TRIGGER IF EXISTS trg_user_health_markers_updated_at ON public.user_health_markers;
DROP TRIGGER IF EXISTS trg_cooking_sessions_updated_at    ON public.cooking_sessions;
DROP TRIGGER IF EXISTS trg_user_prefs_updated_at          ON public.user_prefs;

CREATE TRIGGER trg_ingredients_updated_at
  BEFORE UPDATE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_utensils_updated_at
  BEFORE UPDATE ON public.utensils
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_recipes_updated_at
  BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_user_health_markers_updated_at
  BEFORE UPDATE ON public.user_health_markers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_cooking_sessions_updated_at
  BEFORE UPDATE ON public.cooking_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_user_prefs_updated_at
  BEFORE UPDATE ON public.user_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =============================================================================
-- 7. ROW LEVEL SECURITY
-- =============================================================================

-- Library + Catalog + metric_definitions: public read
ALTER TABLE public.ingredients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utensils           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utensil_buy_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_utensils    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_health_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_definitions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ingredients_public_read"         ON public.ingredients;
DROP POLICY IF EXISTS "utensils_public_read"            ON public.utensils;
DROP POLICY IF EXISTS "utensil_buy_links_public_read"   ON public.utensil_buy_links;
DROP POLICY IF EXISTS "recipes_public_read"             ON public.recipes;
DROP POLICY IF EXISTS "recipe_ingredients_public_read"  ON public.recipe_ingredients;
DROP POLICY IF EXISTS "recipe_steps_public_read"        ON public.recipe_steps;
DROP POLICY IF EXISTS "recipe_utensils_public_read"     ON public.recipe_utensils;
DROP POLICY IF EXISTS "recipe_tags_public_read"         ON public.recipe_tags;
DROP POLICY IF EXISTS "recipe_health_facts_public_read" ON public.recipe_health_facts;
DROP POLICY IF EXISTS "metric_definitions_public_read"  ON public.metric_definitions;

CREATE POLICY "ingredients_public_read"         ON public.ingredients         FOR SELECT USING (true);
CREATE POLICY "utensils_public_read"            ON public.utensils            FOR SELECT USING (true);
CREATE POLICY "utensil_buy_links_public_read"   ON public.utensil_buy_links   FOR SELECT USING (true);
CREATE POLICY "recipes_public_read"             ON public.recipes             FOR SELECT USING (true);
CREATE POLICY "recipe_ingredients_public_read"  ON public.recipe_ingredients  FOR SELECT USING (true);
CREATE POLICY "recipe_steps_public_read"        ON public.recipe_steps        FOR SELECT USING (true);
CREATE POLICY "recipe_utensils_public_read"     ON public.recipe_utensils     FOR SELECT USING (true);
CREATE POLICY "recipe_tags_public_read"         ON public.recipe_tags         FOR SELECT USING (true);
CREATE POLICY "recipe_health_facts_public_read" ON public.recipe_health_facts FOR SELECT USING (true);
CREATE POLICY "metric_definitions_public_read"  ON public.metric_definitions  FOR SELECT USING (true);

-- User-owned tables: owner has full CRUD
ALTER TABLE public.user_health_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_recipes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooking_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_prefs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_logs           ENABLE ROW LEVEL SECURITY;

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

-- Recommendations: owner reads; pipeline (service-role) writes
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recommendations_owner_read" ON public.recommendations;
CREATE POLICY "recommendations_owner_read" ON public.recommendations
  FOR SELECT USING (auth.uid() = user_id);


-- =============================================================================
-- 8. ADMIN — role gate + write policies for catalog and library
-- JWT app_metadata.role = 'admin' grants write access.
-- See USER-TODO.md §4 for how to grant the admin role.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.is_admin() IS
  'Returns true when the calling JWT has app_metadata.role = "admin". Used by admin RLS policies.';

DROP POLICY IF EXISTS "ingredients_admin_write"         ON public.ingredients;
DROP POLICY IF EXISTS "utensils_admin_write"            ON public.utensils;
DROP POLICY IF EXISTS "utensil_buy_links_admin_write"   ON public.utensil_buy_links;
DROP POLICY IF EXISTS "recipes_admin_write"             ON public.recipes;
DROP POLICY IF EXISTS "recipe_ingredients_admin_write"  ON public.recipe_ingredients;
DROP POLICY IF EXISTS "recipe_steps_admin_write"        ON public.recipe_steps;
DROP POLICY IF EXISTS "recipe_utensils_admin_write"     ON public.recipe_utensils;
DROP POLICY IF EXISTS "recipe_tags_admin_write"         ON public.recipe_tags;
DROP POLICY IF EXISTS "recipe_health_facts_admin_write" ON public.recipe_health_facts;

CREATE POLICY "ingredients_admin_write"         ON public.ingredients         FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "utensils_admin_write"            ON public.utensils            FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "utensil_buy_links_admin_write"   ON public.utensil_buy_links   FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "recipes_admin_write"             ON public.recipes             FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "recipe_ingredients_admin_write"  ON public.recipe_ingredients  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "recipe_steps_admin_write"        ON public.recipe_steps        FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "recipe_utensils_admin_write"     ON public.recipe_utensils     FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "recipe_tags_admin_write"         ON public.recipe_tags         FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "recipe_health_facts_admin_write" ON public.recipe_health_facts FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
