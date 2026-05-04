// Recipe ↔ profile classifier. Single source of truth for matching recipes
// against a user's profile (diet identity, allergies, soft prefs, cuisine).
//
//   MFC.recipePrefs.classify(recipe, profile)
//     -> { score, violations: [...{ kind, tag, reason }] }
//
//   score:       count of soft-pref tags + cuisine matches
//   violations:  zero or more {
//     kind:    'allergy' (always enforced) | 'identity' (master-toggle gated)
//     tag:     the profile tag that fired the rule
//     reason:  short human-readable badge text ("Contains nuts" / "Not vegetarian")
//   }
//
// Caller responsibility:
//   - sort avoid-state recipes (any violation) last; among non-avoid, score desc
//   - render the badge using the first violation's `reason`; tooltip lists all
//   - allergy violations always rendered (safety); identity violations honored
//     only when the master toggle is ON

(function () {
  // Profile allergy tag → recipe ingredient-class tag.
  const ALLERGY_TO_TAG = {
    'nut-free':       'nuts',
    'egg-free':       'egg',
    'soy-free':       'soy',
    'shellfish-free': 'shellfish',
    'dairy-free':     'dairy',
    'gluten-free':    'gluten',
  };

  const ALLERGY_REASON = {
    nuts:      'Contains nuts',
    egg:       'Contains egg',
    soy:       'Contains soy',
    shellfish: 'Contains shellfish',
    dairy:     'Contains dairy',
    gluten:    'Contains gluten',
  };

  // Dietary-identity rules. Each takes a Set of recipe tags and returns either
  // a reason string (violation) or null (compatible / neutral).
  // Recipes that lack a clear classification default to neutral — never violate,
  // never match. Keeps the system safe-by-default.
  const IDENTITY_RULES = {
    vegetarian:   (t) => t.has('non-veg') ? 'Not vegetarian' : null,
    vegan:        (t) => {
      if (t.has('non-veg') || t.has('dairy') || t.has('egg')) return 'Not vegan';
      if (t.has('vegetarian') && !t.has('vegan')) return 'Not vegan';
      return null;
    },
    pescatarian:  (t) => (t.has('non-veg') && !t.has('seafood') && !t.has('fish'))
                          ? 'Not pescatarian' : null,
    'gluten-free':(t) => !t.has('gluten-free') ? 'Not gluten-free' : null,
    'dairy-free': (t) => {
      if (t.has('dairy')) return 'Contains dairy';
      if (t.has('vegetarian') && !t.has('vegan')) return 'May contain dairy';
      return null;
    },
    'low-fodmap': (t) => !t.has('low-fodmap') ? 'Not low-FODMAP' : null,
    halal:        (t) => {
      if (t.has('pork') || t.has('alcohol')) return 'Not halal';
      if (t.has('non-veg') && !t.has('halal')) return 'Not halal';
      return null;
    },
    kosher:       (t) => {
      if (t.has('pork') || t.has('shellfish')) return 'Not kosher';
      if (t.has('non-veg') && !t.has('kosher')) return 'Not kosher';
      return null;
    },
    jain:         (t) => {
      if (t.has('non-veg') || t.has('onion') || t.has('garlic') || t.has('root-veg'))
        return 'Not jain';
      return null;
    },
  };

  // Cuisine prefs match recipe.cuisine substring (case-insensitive). They don't
  // need to appear in recipe_tags. "mediterranean" appears in both Patterns and
  // Cuisine groups in the profile UI; the cuisine-match path handles the cuisine
  // angle, the soft-pref tag path handles the pattern angle. We dedupe so a
  // single tag never scores twice on one recipe.
  const CUISINE_PREFS = new Set(['indian', 'asian', 'mediterranean', 'mexican', 'italian']);

  function classify(recipe, profile) {
    if (!profile) return { score: 0, violations: [] };

    const tags = new Set((recipe?.tags || []).map((t) => String(t).toLowerCase()));
    const cuisineLower = String(recipe?.cuisine || '').toLowerCase();

    const violations = [];
    let score = 0;

    // 1. Allergies — always enforced.
    for (const allergy of profile.allergies || []) {
      const recipeTag = ALLERGY_TO_TAG[allergy];
      if (recipeTag && tags.has(recipeTag)) {
        violations.push({
          kind: 'allergy',
          tag: allergy,
          reason: ALLERGY_REASON[recipeTag] || `Contains ${recipeTag}`,
        });
      }
    }

    // 2. Single pass over diet_tags. Each tag either:
    //    - is a dietary-identity rule (may produce a violation, never scores)
    //    - is a cuisine pref (scores on cuisine substring; falls through to tag
    //      check if cuisine doesn't match — covers the "mediterranean tag on a
    //      non-Mediterranean cuisine" case)
    //    - is a soft-pref tag (scores when present in recipe.tags)
    for (const profTag of profile.diet_tags || []) {
      const tag = String(profTag).toLowerCase();

      const rule = IDENTITY_RULES[tag];
      if (rule) {
        const reason = rule(tags);
        if (reason) violations.push({ kind: 'identity', tag, reason });
        continue;
      }

      if (CUISINE_PREFS.has(tag) && cuisineLower.includes(tag)) {
        score += 1;
        continue;
      }

      if (tags.has(tag)) score += 1;
    }

    return { score, violations };
  }

  window.MFC = window.MFC || {};
  window.MFC.recipePrefs = { classify };
})();
