// Thin Supabase wrappers with local JSON fallbacks for static preview.
// The only user-data short-circuits below check whether the user is signed in.
//
// Public surface: window.MFC.db.{ ... }
window.MFC = window.MFC || {};
window.MFC.db = (function () {
  const sb = window.MFC.supabase;
  const userId = () => window.MFC.auth?.getUser()?.id || null;

  async function fetchJson(path) {
    try {
      const res = await fetch(path);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  const getLocalRecipe = (id) => fetchJson(`data/recipe-bundles/${id}/recipe.json`);

  // ---------- Catalog ----------

  // Returns the recipe listing (summary fields only).
  async function getRecipes() {
    if (!sb) return [];
    const { data, error } = await sb
      .from('recipes')
      .select('id,name,tagline,cuisine,difficulty,total_minutes,servings,media,color,color_soft,featured,highlight,recipe_tags(tag)')
      .order('featured', { ascending: false })
      .order('name', { ascending: true });
    if (error) { console.warn('[db.getRecipes]', error); return []; }
    return data.map((r) => ({
      id: r.id,
      name: r.name,
      tagline: r.tagline,
      cuisine: r.cuisine,
      difficulty: r.difficulty,
      totalMinutes: r.total_minutes,
      servings: r.servings,
      media: r.media || {},
      tags: (r.recipe_tags || []).map((t) => t.tag),
      color: r.color,
      colorSoft: r.color_soft,
      featured: !!r.featured,
      highlight: r.highlight,
    }));
  }

  // Returns object shaped like data/recipe-bundles/{id}/recipe.json (detail).
  async function getRecipe(id) {
    const local = await getLocalRecipe(id);
    if (!sb) return local;
    const { data, error } = await sb
      .from('recipes')
      .select(`
        id, name, tagline, short_tagline, cuisine, difficulty, servings, total_minutes, media,
        recipe_ingredients ( sort_order, group_name, amount, unit,
          ingredient:ingredients ( id, name, photo ) ),
        recipe_steps ( sort_order, title, detail, duration_seconds, tip, media_caption ),
        recipe_utensils ( sort_order, essential,
          utensil:utensils ( id, name, photo ) ),
        recipe_health_facts ( sort_order, fact )
      `)
      .eq('id', id)
      .maybeSingle();
    if (error) { console.warn('[db.getRecipe]', error); return local; }
    if (!data) return local;

    const ingredients = (data.recipe_ingredients || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ name: i.ingredient?.name, amt: i.amount, unit: i.unit, group: i.group_name }));

    const localSteps = new Map((local?.steps || []).map((s) => [s.id, s]));
    const steps = (data.recipe_steps || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => {
        const localStep = localSteps.get(s.sort_order);
        const media = {
          ...(s.media_caption ? { caption: s.media_caption } : {}),
          ...(localStep?.media || {}),
        };
        return {
          id: s.sort_order,
          title: s.title,
          detail: s.detail,
          duration: s.duration_seconds,
          tip: s.tip,
          ...(Object.keys(media).length ? { media } : {}),
        };
      });

    const utensils = (data.recipe_utensils || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((u) => ({ name: u.utensil?.name, essential: !!u.essential }));

    const healthFacts = (data.recipe_health_facts || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((h) => h.fact);

    return {
      id: data.id,
      name: data.name,
      tagline: data.short_tagline || data.tagline,
      cuisine: data.cuisine,
      difficulty: data.difficulty,
      servings: data.servings,
      totalMinutes: data.total_minutes,
      media: {
        ...(local?.media || {}),
        ...(data.media || {}),
        hero: {
          ...(local?.media?.hero || {}),
          ...(data.media?.hero || {}),
        },
      },
      healthFacts,
      ingredients,
      utensils,
      steps,
    };
  }

  // ---------- Saved recipes ----------

  async function saveRecipe(recipeId, note = null) {
    if (!sb) return false;
    const uid = userId(); if (!uid) return false;
    const { error } = await sb.from('saved_recipes').upsert({ user_id: uid, recipe_id: recipeId, note });
    if (error) { console.warn('[db.saveRecipe]', error); return false; }
    return true;
  }

  async function unsaveRecipe(recipeId) {
    if (!sb) return false;
    const uid = userId(); if (!uid) return false;
    const { error } = await sb.from('saved_recipes').delete()
      .eq('user_id', uid).eq('recipe_id', recipeId);
    if (error) { console.warn('[db.unsaveRecipe]', error); return false; }
    return true;
  }

  async function getSaved() {
    if (!sb) return [];
    const uid = userId(); if (!uid) return [];
    const { data, error } = await sb.from('saved_recipes')
      .select('recipe_id,note,saved_at').eq('user_id', uid).order('saved_at', { ascending: false });
    if (error) { console.warn('[db.getSaved]', error); return []; }
    return data;
  }

  // ---------- Cooking sessions ----------

  async function upsertSession({ recipeId, currentStep, servings, completedAt = null }) {
    if (!sb) return false;
    const uid = userId(); if (!uid) return false;
    const { error } = await sb.from('cooking_sessions').upsert({
      user_id: uid,
      recipe_id: recipeId,
      current_step: currentStep,
      servings: servings ?? null,
      completed_at: completedAt,
    });
    if (error) { console.warn('[db.upsertSession]', error); return false; }
    return true;
  }

  async function getSession(recipeId) {
    if (!sb) return null;
    const uid = userId(); if (!uid) return null;
    const { data, error } = await sb.from('cooking_sessions')
      .select('*').eq('user_id', uid).eq('recipe_id', recipeId).maybeSingle();
    if (error) { console.warn('[db.getSession]', error); return null; }
    return data;
  }

  // ---------- Profile ----------

  async function getUserProfile() {
    if (!sb) return null;
    const uid = userId(); if (!uid) return null;
    const { data, error } = await sb.from('user_profiles')
      .select('user_id,date_of_birth,diet_tags,allergies,goals,units,updated_at')
      .eq('user_id', uid).maybeSingle();
    if (error) { console.warn('[db.getUserProfile]', error); return null; }
    return data;
  }

  async function upsertUserProfile({
    dateOfBirth = null,
    dietTags    = [],
    allergies   = [],
    goals       = [],
    units       = 'metric',
  } = {}) {
    if (!sb) return false;
    const uid = userId(); if (!uid) return false;
    const { data, error } = await sb.from('user_profiles').upsert({
      user_id: uid,
      date_of_birth: dateOfBirth,
      diet_tags: dietTags,
      allergies,
      goals,
      units,
    }).select('user_id,date_of_birth,diet_tags,allergies,goals,units,updated_at').maybeSingle();
    if (error) { console.warn('[db.upsertUserProfile]', error); return false; }
    window.dispatchEvent(new CustomEvent('mfc:profile-change', { detail: { profile: data } }));
    return true;
  }

  // ---------- Health markers ----------

  async function getMetricDefinitions() {
    if (!sb) return [];
    const { data, error } = await sb.from('metric_definitions')
      .select('*').order('sort_order', { ascending: true });
    if (error) { console.warn('[db.getMetricDefinitions]', error); return []; }
    return data;
  }

  // Returns latest value per metric for the current user.
  async function getHealthMarkers() {
    if (!sb) return [];
    const uid = userId(); if (!uid) return [];
    const { data, error } = await sb.from('user_health_markers')
      .select('metric_id,value,unit,measured_at,source,note,updated_at')
      .eq('user_id', uid)
      .order('measured_at', { ascending: false });
    if (error) { console.warn('[db.getHealthMarkers]', error); return []; }
    const seen = new Set();
    const latest = [];
    for (const row of data) {
      if (seen.has(row.metric_id)) continue;
      seen.add(row.metric_id); latest.push(row);
    }
    return latest;
  }

  async function upsertHealthMarker({ metricId, value, unit, measuredAt, source = 'manual', note = null }) {
    if (!sb) return false;
    const uid = userId(); if (!uid) return false;
    const { error } = await sb.from('user_health_markers').upsert({
      user_id: uid,
      metric_id: metricId,
      value,
      unit,
      measured_at: measuredAt,
      source,
      note,
    });
    if (error) { console.warn('[db.upsertHealthMarker]', error); return false; }
    return true;
  }

  // ---------- Recommendations (read-only) ----------

  async function getRecommendations(mealType) {
    if (!sb) return [];
    const uid = userId(); if (!uid) return [];
    const q = sb.from('recommendations')
      .select('recipe_id,rank,reason,meal_type,generated_at')
      .eq('user_id', uid)
      .order('rank', { ascending: true });
    const { data, error } = mealType ? await q.eq('meal_type', mealType) : await q;
    if (error) { console.warn('[db.getRecommendations]', error); return []; }
    return data;
  }

  // ---------- Meal logs ----------

  async function logMeal({ recipeId = null, mealType, servings = null, note = null, source = 'manual' }) {
    if (!sb) return false;
    const uid = userId(); if (!uid) return false;
    const { error } = await sb.from('meal_logs').insert({
      user_id: uid,
      recipe_id: recipeId,
      meal_type: mealType,
      servings,
      note,
      source,
    });
    if (error) { console.warn('[db.logMeal]', error); return false; }
    return true;
  }

  async function getMealLogs({ from = null, to = null } = {}) {
    if (!sb) return [];
    const uid = userId(); if (!uid) return [];
    let q = sb.from('meal_logs').select('*').eq('user_id', uid).order('logged_at', { ascending: false });
    if (from) q = q.gte('logged_at', from);
    if (to)   q = q.lte('logged_at', to);
    const { data, error } = await q;
    if (error) { console.warn('[db.getMealLogs]', error); return []; }
    return data;
  }

  async function getActiveSessions() {
    if (!sb) return [];
    const uid = userId(); if (!uid) return [];
    const { data, error } = await sb.from('cooking_sessions')
      .select('recipe_id,current_step,servings,started_at,updated_at')
      .eq('user_id', uid)
      .is('completed_at', null)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (error) { console.warn('[db.getActiveSessions]', error); return []; }
    return data;
  }

  // ---------- Anonymous → authenticated state hand-off ----------

  async function handoffAnonymous() {
    if (!sb) return;
    const uid = userId(); if (!uid) return;

    // In-progress cooking sessions (keys like 'mfc_session_<recipeId>').
    try {
      const sessionKeys = Object.keys(localStorage).filter((k) => k.startsWith('mfc_session_'));
      for (const k of sessionKeys) {
        const recipeId = k.slice('mfc_session_'.length);
        let s; try { s = JSON.parse(localStorage.getItem(k)); } catch { continue; }
        if (!s) continue;
        await upsertSession({
          recipeId,
          currentStep: s.currentStep ?? 0,
          servings: s.servings ?? null,
          completedAt: s.completedAt ?? null,
        });
        localStorage.removeItem(k);
      }
    } catch (e) { console.warn('[handoff sessions]', e); }
  }

  return {
    getRecipes, getRecipe,
    saveRecipe, unsaveRecipe, getSaved,
    upsertSession, getSession,
    getUserProfile, upsertUserProfile,
    getMetricDefinitions, getHealthMarkers, upsertHealthMarker,
    getRecommendations,
    logMeal, getMealLogs,
    getActiveSessions,
    handoffAnonymous,
  };
})();
