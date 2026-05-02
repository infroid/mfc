# Personalization Engine

> Replaces the hardcoded `PERSONA_MEALS` lookup table and `microTargets()` function in [index.html](../index.html) with a data-driven scoring engine over the recipe catalog.

---

## Goals

1. **Reproduce today's experience** for the four seed metrics (Iron, B12, Sodium, Fiber). The recommendation, micro-targets, and explanation strings must feel at least as personal as the static demo.
2. **Scale to new metrics** without code or frontend deploy — adding a metric is `INSERT INTO metric_definitions ...; INSERT INTO nutrient_mappings ...;`.
3. **Be deterministic and explainable** — every recommendation has a derivable "why this meal" string traceable to specific mappings.
4. **Be cheap** — scoring runs in ≤ 100 ms p95 for the full catalog of ≤ 1000 recipes (in-memory).

---

## Inputs

| Input | Source |
|-------|--------|
| Active flags `F` | `health_metrics WHERE profile_id = active AND is_active = TRUE` |
| Metric definitions | `metric_definitions` (with `direction` ∈ `increase`/`decrease`/`maintain`) |
| Recipe catalog | `recipes` joined with `recipe_ingredients`, `recipe_tags`, `recipe_health_facts` |
| Nutrient mappings | `nutrient_mappings (metric_id, target_kind, target_value, affinity)` |
| Recipe popularity | `recipe_views` rolled-up daily (tie-breaker only) |
| Recent cooks | `cooking_sessions WHERE user_id = ? AND status = 'completed' AND started_at > now() - 30d` (used to penalize repeats) |

---

## Scoring Algorithm

For each recipe `R` in the published catalog:

```
score(R, F) = Σ over m ∈ F:
                Σ over mapping ∈ nutrient_mappings WHERE metric_id = m:
                    affinity(mapping) * matches(R, mapping) * direction_sign(m)

         + popularity_bonus(R)         # log(views_30d + 1) * 0.05
         - recent_cook_penalty(R)      # if cooked in last 30d: -1.0 per cook
```

Where:

- `matches(R, mapping)` is `1` if `R` has the targeted ingredient/tag/cuisine, else `0`. (We could weight by ingredient amount in future; V1 is binary.)
- `direction_sign(m)` is `+1` for `increase`/`maintain`, `-1` for `decrease` — so a `sodium decrease` flag with a `low-sodium` tag affinity `+3` and a `soy-sauce` ingredient affinity `-2` correctly favors low-sodium recipes.
- `popularity_bonus` keeps the engine from showing only obscure picks when the score field is flat.
- `recent_cook_penalty` adds variety; users want suggestions, not the same dish.

The engine returns the top recipe by `score`. Ties broken by `popularity_bonus` then alphabetic id.

### Reference SQL

```sql
WITH active_flags AS (
  SELECT hm.metric_id, md.direction
  FROM mfc.health_metrics hm
  JOIN mfc.metric_definitions md ON md.id = hm.metric_id
  JOIN mfc.health_profiles hp ON hp.id = hm.profile_id
  WHERE hp.user_id = :user_id AND hp.is_active AND hm.is_active
),
recipe_signals AS (
  -- Ingredient signals
  SELECT ri.recipe_id, nm.metric_id, nm.affinity, af.direction
  FROM mfc.recipe_ingredients ri
  JOIN mfc.nutrient_mappings nm
    ON nm.target_kind = 'ingredient' AND nm.target_value = ri.ingredient_id
  JOIN active_flags af ON af.metric_id = nm.metric_id

  UNION ALL
  -- Tag signals
  SELECT rt.recipe_id, nm.metric_id, nm.affinity, af.direction
  FROM mfc.recipe_tags rt
  JOIN mfc.nutrient_mappings nm
    ON nm.target_kind = 'tag' AND nm.target_value = rt.tag
  JOIN active_flags af ON af.metric_id = nm.metric_id

  UNION ALL
  -- Cuisine signals
  SELECT r.id AS recipe_id, nm.metric_id, nm.affinity, af.direction
  FROM mfc.recipes r
  JOIN mfc.nutrient_mappings nm
    ON nm.target_kind = 'cuisine' AND nm.target_value = r.cuisine
  JOIN active_flags af ON af.metric_id = nm.metric_id
),
scored AS (
  SELECT recipe_id,
         SUM(affinity * CASE direction WHEN 'decrease' THEN -1 ELSE 1 END) AS raw_score
  FROM recipe_signals
  GROUP BY recipe_id
),
penalized AS (
  SELECT s.recipe_id,
         s.raw_score
           + COALESCE(LN(NULLIF(rp.views_30d, 0) + 1) * 0.05, 0)
           - COALESCE(rc.recent_cook_count * 1.0, 0) AS final_score
  FROM scored s
  LEFT JOIN mv_recipe_popularity rp ON rp.recipe_id = s.recipe_id
  LEFT JOIN (
    SELECT recipe_id, COUNT(*) AS recent_cook_count
    FROM mfc.cooking_sessions
    WHERE user_id = :user_id
      AND status = 'completed'
      AND started_at > now() - INTERVAL '30 days'
    GROUP BY recipe_id
  ) rc ON rc.recipe_id = s.recipe_id
)
SELECT p.recipe_id, p.final_score, r.name, r.cuisine, r.color
FROM penalized p
JOIN mfc.recipes r ON r.id = p.recipe_id
WHERE r.is_published
ORDER BY p.final_score DESC
LIMIT 10;
```

The service then takes `LIMIT 10`, applies a cool-down filter (no recipe seen in last 7 days for this user), picks the head, and returns it.

---

## Micro-Targets Computation

Today's `microTargets()` (line ~687) uses a static lookup. The dynamic version computes percentages from the **chosen meal** against per-metric per-day reference intakes.

For each active flag `m`:

| Field | Computation |
|-------|-------------|
| `label` | `metric_definitions.name` |
| `pct` | `clamp(0, 100, recipe_value(m) / metric_target(m) * 100)` |
| `color` | Mapping in `metric_definitions.ui_color` (new column; default below) |
| `v` | Formatted value from `recipe_value(m)` + `metric_definitions.unit` |
| `inverted` | `metric_definitions.direction == 'decrease'` |

`recipe_value(m)` is sourced from `recipe_nutrients` (defined in [01-database-schema.md](01-database-schema.md#recipe_nutrients)) — one row per `(recipe_id, metric_id)` with a per-serving numeric value and a confidence band.

### `ui_color` defaults (matches existing CSS classes)

| metric_id | ui_color | CSS class |
|-----------|----------|-----------|
| `iron` | `berry` | `.ring--berry` |
| `b12` | `matcha` | `.ring--matcha` |
| `fiber` | `butter` | `.ring--butter` |
| `sodium` | `orange` | `.ring--orange` |

Add `ui_color TEXT` to `metric_definitions` to keep the UI rendering data-driven.

---

## Explanation Generation

Today: a single hardcoded sentence ("Tuned for ${active.map(...).join(' · ')}. Macros sit inside your goals, micros patch your gaps.").

Dynamic version, deterministic + extensible:

```
explanation(meal, F):
    parts = []
    parts.append(f"Tuned for {' · '.join(metric_definitions[m].name for m in F)}.")
    top_signals = top 2 mappings that contributed most score for this meal
    for s in top_signals:
        parts.append(s.note or f"{s.target_value} boosts {metric_definitions[s.metric_id].name}.")
    parts.append("Macros sit inside your goals, micros patch your gaps.")
    return ' '.join(parts)
```

Output examples:

> "Tuned for Iron · B12 · Sodium watch. Spinach is iron-rich, especially with vitamin C. Salmon delivers a clean B12 hit. Macros sit inside your goals, micros patch your gaps."

The phrasing matches the existing UI tone (lowercase-friendly, em-dash-friendly).

---

## "Why this meal" Tag List

Today: hardcoded per `PERSONA_MEALS` entry (`["+47% iron", "low sodium", "B12 boost"]`).

Dynamic version: derive from top-3 signals:

```
why_tags(meal, F):
    out = []
    for s in top 3 mappings:
        m = metric_definitions[s.metric_id]
        if m.direction == 'increase':
            pct = round((recipe_value(m) / m.default_target) * 100 - 100)
            if pct > 5:  out.append(f"+{pct}% {m.name.lower()}")
            else:        out.append(f"{m.name.lower()} boost")
        elif m.direction == 'decrease':
            out.append(f"low {m.name.lower().replace(' watch','')}")
    return out
```

Output remains the short, headline-style tags today's UI displays.

---

## Cold-Start Behavior

| Situation | Behavior |
|-----------|----------|
| New user, no health profile | API auto-creates a default profile with all four seed metrics `is_active=TRUE`. First recommendation uses defaults. |
| All flags off | Return the most popular published recipe (`mv_recipe_popularity`) with explanation: "Some chef-favorite picks while you set up your profile." |
| No matching recipe (score = 0 for everything) | Return a random featured recipe with explanation: "Nothing closely matches your flags yet — here's a chef pick." |
| Anonymous user | Frontend uses static `PERSONA_MEALS` + `microTargets()` (existing path). API endpoint `GET /api/v1/personalization/recommend/anonymous` returns the same demo response so frontend can use one code path. |

---

## Caching Strategy

- Recommendation per `(user_id, sorted active_flag_set, recipe_catalog_version)` cached in Redis for 5 min.
- Cache key: `rec:{user_id}:{flagset_hash}:{catalog_v}`.
- Bust on:
  - User toggles a metric → DELETE all `rec:{user_id}:*`.
  - Catalog rev (admin recipe edit) → bump `catalog_v` global key in Redis.
  - User completes a cooking session → DELETE `rec:{user_id}:*` (so penalty applies next time).
- Anonymous demo response is HTTP-cacheable for 24h.

---

## Recommendation Quality Tests

Stored in `tests/personalization/`:

| Case | Active flags | Expected behavior |
|------|--------------|-------------------|
| All seed metrics on | iron, b12, sodium, fiber | A high-fiber, iron-rich, low-sodium dish wins (e.g. Spinach + Lentil bowl). |
| Iron-only | iron | Spinach- or lentil-heavy recipe in top 3. |
| B12-only | b12 | A meat or paneer recipe in top 3. |
| Sodium-only (decrease) | sodium | A recipe lacking soy-sauce / pickle / cured meats wins. |
| All off | — | Returns most-popular fallback. |
| Recently cooked | iron, b12 + last 30d included Spinach Bowl | Spinach Bowl penalized; B12-rich alternative wins. |
| Empty catalog (test fixture) | iron | Returns 404 with `{ "detail": "No recipes match" }`. |

---

## Future Extensions (out of scope V1)

- Per-ingredient amount-weighted scoring (currently binary).
- Time-of-day awareness (breakfast vs dinner).
- Constraint-based filtering ("avoid peanuts", "lactose-free").
- Collaborative filtering signal once we have ≥ 10k cooks (popularity among users with similar flag sets).
- LLM-narrated "why this meal" with chef voice — only if measurable improvement over the deterministic version.
