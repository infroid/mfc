# Recommendation Engine — Schema Gap Plan

Roadmap to take MyFoodCraving's recommender from "diet-tag matching" to
"dietitian-grade nutritional guidance". Items ordered by **leverage × ease**:
top items unlock the most clinical value for the least schema/UX work.

Effort scale: **S** = ≤1 day · **M** = 2–5 days · **L** = >1 week (incl. UI).

---

## P0 — unblock TDEE, BMI, and BP-driven advice

### 1. Anthropometry history table  **(S)**
- New `user_body_measurements (user_id, measured_at, height_cm, weight_kg,
  waist_cm, hip_cm, body_fat_pct, lean_mass_kg, source)` — composite PK
  `(user_id, measured_at)`; mirrors `user_health_markers` pattern.
- Add `activity_level` enum on `user_profiles`
  (`sedentary | light | moderate | very_active | athlete`).
- **Benefit:** unlocks BMR (Mifflin–St Jeor), TDEE, BMI, waist-hip ratio,
  protein g/kg targets. Without this, every calorie/macro recommendation is
  a guess. Weight trend is the single highest-signal feedback loop the app
  can have.

### 2. Vital-sign metrics  **(S)**
- Add to `seed_metrics.sql`: `blood_pressure_systolic`, `blood_pressure_diastolic`,
  `resting_heart_rate`, `hrv`. Already fits `user_health_markers` shape — no
  schema change.
- **Benefit:** BP is *the* diet-modifiable cardiovascular signal. Drives
  sodium/potassium ceilings, DASH-style suggestions, and the gating between
  "heart-health" and "general wellness" recipe sets.

### 3. Per-serving nutrition rollup on recipes  **(M)**
- New materialized view `recipe_nutrition_per_serving` joining
  `recipe_ingredients × ingredient_details ÷ servings`. Columns: `kcal,
  protein_g, carbs_g, fat_g, sat_fat_g, fiber_g, sugars_g, sugars_added_g,
  sodium_mg, potassium_mg, omega3_g, vitamin_d_iu, iron_mg, calcium_mg,
  b12_mcg` (start short; widen later).
- Refresh on recipe/ingredient write via trigger or `mfc sync-recipes`.
- Persist `serving_size_g` on `recipes` (currently only `servings: int`).
- **Benefit:** every filter/rank the recommender wants ("high-protein dinner
  ≤600 kcal", "low-sodium for hypertensives") becomes a single indexed query
  instead of an in-process recompute. This is the single biggest performance
  + correctness win on the recipe side.

---

## P1 — medical safety & drug–food interaction

### 4. User medical conditions  **(M)**
- New `user_medical_conditions (user_id, condition_id, diagnosed_at, status,
  notes)` + a canonical `condition_definitions` lookup
  (`diabetes_t2, hypertension, pcos, ibs, ibd, gerd, gout, nafld, ckd_stage_X,
  hypothyroid, celiac, ...`).
- Each `condition_definitions` row carries dietary implication tags
  (`avoid_high_purine`, `low_sodium`, `low_fodmap`, `low_oxalate`,
  `gluten_free_strict`, ...).
- **Benefit:** the recommender can apply hard exclusions + soft preferences
  based on diagnosed conditions, not on the user remembering to tag
  themselves. Removes the largest class of "technically correct but
  clinically wrong" recommendations.

### 5. Medications  **(M)**
- New `user_medications (user_id, drug_id, started_at, stopped_at, dose,
  notes)` + `drug_definitions` lookup with **food-interaction tags** per
  drug (`avoid_high_vitamin_k` for warfarin, `space_from_calcium_4h` for
  levothyroxine, `avoid_tyramine` for MAOIs, `avoid_grapefruit` for statins,
  `avoid_high_potassium` for ACE-inhibitors, ...).
- **Benefit:** prevents actively dangerous recommendations. A dietitian
  cannot legally hand a meal plan without seeing the med list; the app
  shouldn't either.

### 6. Pregnancy / lactation / menopause status  **(S)**
- Three booleans + `pregnancy_due_date` on `user_profiles` (or a tiny
  `user_life_stage` table for history).
- **Benefit:** pregnancy alone reshuffles folate, iron, DHA, calcium,
  iodine, caffeine, and "avoid raw" rules — getting this wrong is the most
  visible failure mode for a nutrition app.

---

## P2 — richer signal for the recommender

### 7. Lifestyle facts  **(S)**
- Add to `user_profiles`: `smoking_status`, `alcohol_units_per_week`,
  `sleep_hours_avg`, `stress_level_1_5`.
- **Benefit:** alcohol intake alone changes B1/B12/folate/liver targets and
  the upper bound on dinner-with-wine recommendations. Sleep/stress modulate
  caffeine and evening-carb advice.

### 8. Intake logging upgrade  **(M)**
- Extend `meal_logs`: `portion_grams numeric`, `free_food_text`
  (non-recipe intake), `fluid_ml`, `fluid_kind` (`water | coffee | tea |
  alcohol | other`).
- Optional: `eating_window_start/end` per day on `user_profiles` for IF/TRE.
- **Benefit:** today the diary only captures recipes the user cooked — a
  minority of real intake. With free-food + fluids you can sum a daily
  micronutrient panel and compare against RDA/DRI. That comparison is the
  whole point of "personalized" recommendations.

### 9. Numeric goal targets  **(S)**
- New `user_goal_targets (id, user_id, kind, target_value, unit, deadline,
  baseline_value, baseline_at)`. `kind ∈ {marker_id, weight_kg, kcal_day,
  protein_g_kg, sodium_mg_day, fiber_g_day, ...}`.
- Replace free-text `user_profiles.goals` (keep as soft tags) with this for
  anything numeric.
- **Benefit:** the recommender can rank against the *delta* to a target
  ("you're 18 g short on protein today") and the `recommendations.reason`
  string can cite a real target ID. Makes the dashboard meaningfully
  comparable across weeks.

### 10. Recommender feedback loop  **(S)**
- Extend `recommendations`: `served_at`, `feedback`
  (`liked | disliked | cooked | skipped | would_not_repeat`),
  `feedback_at`. Or a sibling `recommendation_events` ledger.
- **Benefit:** without this, the model repeats recipes and can't learn.
  This is small to add and disproportionately improves perceived quality.

---

## P3 — polish, safety hardening, completeness

### 11. Controlled-vocabulary tables  **(M)**
- Promote `diet_tags`, `allergies`, `goals`, `recipe_tags` from free
  `text[]` to lookup-backed IDs. Synonym table (`allergen_synonyms`) maps
  user-typed strings to canonical IDs.
- **Benefit:** today "nut-free" vs "nuts" vs "tree-nuts" silently breaks the
  allergy safety filter. After this, the filter is provably exhaustive.

### 12. Recipe-side metadata  **(M)**
- On `recipes`: `prep_minutes`, `active_cook_minutes`, `passive_minutes`
  (split `total_minutes`); `spice_level`, `glycemic_load_estimate`,
  `nova_processing_level`, `sodium_potassium_ratio` (derived).
- **Benefit:** enables time-of-day suggestions ("you have 15 min, make
  this") and processing-aware ranking (NOVA-4 demotion) which the WHO
  + most modern dietitians now use.

### 13. Constraints on `user_profiles`  **(S)**
- `equipment_available text[]` (`oven, blender, pressure_cooker, ...`),
  `cooking_skill`, `time_budget_per_meal_min`, `budget_tier`,
  `household_size int`.
- **Benefit:** removes recommendations the user *cannot* execute. A 90-min
  braise is noise if they have no oven; halves the cognitive load on the
  search/dashboard surfaces.

### 14. Wearable / CGM integration table  **(L)**
- Generic `device_observations (user_id, kind, measured_at, value, unit,
  source)` covering steps, HR, sleep stages, CGM glucose, VO2max.
- **Benefit:** continuous-glucose data is the single best validation signal
  for whether a recommended meal actually behaves the way the model claims.
  Lower priority because it's gated on user devices, not on app capability.

---

## Suggested execution order

1. **Week 1:** items 1, 2, 6 → profile gains the missing demographic +
   anthropometric backbone; lab catalog adds BP.
2. **Week 2–3:** item 3 → per-serving nutrition rollup. This is the single
   highest-leverage *recipe-side* change and unlocks most filters.
3. **Week 4–5:** items 4 + 5 → medical-safety layer. Ship these together
   with the condition/drug → tag mapping; otherwise the data sits dormant.
4. **Week 6:** items 7, 9, 10 → small but compounding wins.
5. **Later:** items 8, 11, 12, 13, 14 once the core works end-to-end.

After step 3 the app can credibly claim "nutrition-aware". After step 4 it
behaves like a junior dietitian. Items 11+ are hardening, not new
capability.

---

## Out of scope (deliberately)

- AI / LLM-driven meal planning. Bigger and orthogonal to the schema gaps
  above; the schema upgrades here are what *any* recommender (rule-based or
  ML) would need.
- Practitioner integration (a real RD reviewing plans). Worth doing once
  items 1–6 land, not before.
- Regulatory (HIPAA / GDPR special-category data). Conditions + medications
  are health data; treat the work in items 4–5 as the moment to revisit
  retention, export, and consent UX.
