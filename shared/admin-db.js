// Admin CRUD wrappers. Reads use the public client; writes succeed only when
// the signed-in user's JWT carries app_metadata.role = 'admin' (enforced by RLS
// via public.is_admin()). See data/db/schema.sql §7 and USER-TODO.md §3.
//
// Public surface: window.MFC.adminDb.{ ... }
window.MFC = window.MFC || {};
window.MFC.adminDb = (function () {
  const sb = () => window.MFC.supabase;

  function check(error, label) {
    if (error) { console.warn(`[adminDb.${label}]`, error); throw error; }
  }

  // ---------- INGREDIENTS LIBRARY ----------
  async function listIngredients() {
    const { data, error } = await sb()
      .from('ingredients')
      .select('id,name,tagline,category,default_unit,photo,nutrition,health_fact,storage,substitutes,show,ai_filled_at,updated_at')
      .order('name', { ascending: true });
    check(error, 'listIngredients');
    return data || [];
  }

  async function getIngredient(id) {
    const { data, error } = await sb()
      .from('ingredients').select('*').eq('id', id).maybeSingle();
    check(error, 'getIngredient');
    return data;
  }

  async function upsertIngredient(row) {
    const { data, error } = await sb().from('ingredients').upsert(row).select().single();
    check(error, 'upsertIngredient');
    return data;
  }

  async function deleteIngredient(id) {
    const { error } = await sb().from('ingredients').delete().eq('id', id);
    check(error, 'deleteIngredient');
  }

  async function ingredientUsageCounts() {
    const { data, error } = await sb()
      .from('recipe_ingredients').select('ingredient_id');
    check(error, 'ingredientUsageCounts');
    const counts = {};
    for (const r of data || []) counts[r.ingredient_id] = (counts[r.ingredient_id] || 0) + 1;
    return counts;
  }

  // ---------- UTENSILS LIBRARY ----------
  async function listUtensils() {
    const { data, error } = await sb()
      .from('utensils')
      .select('id,name,tagline,category,photo,care_tip,specs,show,ai_filled_at,updated_at')
      .order('name', { ascending: true });
    check(error, 'listUtensils');
    return data || [];
  }

  async function getUtensil(id) {
    const { data, error } = await sb()
      .from('utensils').select('*').eq('id', id).maybeSingle();
    check(error, 'getUtensil');
    return data;
  }

  async function upsertUtensil(row) {
    const { data, error } = await sb().from('utensils').upsert(row).select().single();
    check(error, 'upsertUtensil');
    return data;
  }

  async function deleteUtensil(id) {
    const { error } = await sb().from('utensils').delete().eq('id', id);
    check(error, 'deleteUtensil');
  }

  async function utensilUsageCounts() {
    const { data, error } = await sb()
      .from('recipe_utensils').select('utensil_id');
    check(error, 'utensilUsageCounts');
    const counts = {};
    for (const r of data || []) counts[r.utensil_id] = (counts[r.utensil_id] || 0) + 1;
    return counts;
  }

  // ---------- RECIPES ----------
  async function listRecipes() {
    const { data, error } = await sb()
      .from('recipes')
      .select('id,name,tagline,short_tagline,cuisine,difficulty,servings,total_minutes,featured,updated_at,recipe_steps(count),recipe_ingredients(count)')
      .order('updated_at', { ascending: false });
    check(error, 'listRecipes');
    return (data || []).map((r) => ({
      ...r,
      stepCount: r.recipe_steps?.[0]?.count ?? 0,
      ingCount:  r.recipe_ingredients?.[0]?.count ?? 0,
    }));
  }

  // Returns the full recipe shape the admin editor expects (FK-style).
  async function getRecipe(id) {
    const { data, error } = await sb()
      .from('recipes')
      .select(`
        id, name, tagline, short_tagline, cuisine, difficulty, servings, total_minutes, media, color, color_soft, featured, highlight, meal_types,
        recipe_ingredients ( sort_order, group_name, ingredient_id, amount, unit ),
        recipe_steps       ( sort_order, title, detail, duration_seconds, tip, media_caption ),
        recipe_utensils    ( sort_order, utensil_id, essential ),
        recipe_tags        ( tag ),
        recipe_health_facts ( sort_order, fact )
      `)
      .eq('id', id).maybeSingle();
    check(error, 'getRecipe');
    return data;
  }

  // Saves the whole recipe atomically (delete-and-insert children).
  async function saveRecipe(payload) {
    const { id, recipe, ingredients, steps, utensils, tags, health } = payload;

    const { error: rErr } = await sb().from('recipes').upsert({ ...recipe, id });
    check(rErr, 'saveRecipe.recipes');

    const wipe = async (table) => {
      const { error } = await sb().from(table).delete().eq('recipe_id', id);
      check(error, `saveRecipe.wipe.${table}`);
    };

    await wipe('recipe_ingredients');
    if (ingredients?.length) {
      const rows = ingredients.map((ing, i) => ({
        recipe_id:     id,
        sort_order:    i,
        ingredient_id: ing.ingredient_id,
        group_name:    ing.group_name ?? null,
        amount:        ing.amount ?? null,
        unit:          ing.unit ?? null,
      }));
      const { error } = await sb().from('recipe_ingredients').insert(rows);
      check(error, 'saveRecipe.recipe_ingredients');
    }

    await wipe('recipe_steps');
    if (steps?.length) {
      const rows = steps.map((s, i) => ({
        recipe_id: id,
        sort_order: i + 1,
        title: s.title,
        detail: s.detail ?? '',
        duration_seconds: s.duration_seconds ?? null,
        tip: s.tip ?? null,
        media_caption: s.media_caption ?? null,
      }));
      const { error } = await sb().from('recipe_steps').insert(rows);
      check(error, 'saveRecipe.recipe_steps');
    }

    await wipe('recipe_utensils');
    if (utensils?.length) {
      const seen = new Set();
      const rows = utensils
        .filter((u) => u.utensil_id && !seen.has(u.utensil_id) && seen.add(u.utensil_id))
        .map((u, i) => ({
          recipe_id:  id,
          sort_order: i,
          utensil_id: u.utensil_id,
          essential:  !!u.essential,
        }));
      if (rows.length) {
        const { error } = await sb().from('recipe_utensils').insert(rows);
        check(error, 'saveRecipe.recipe_utensils');
      }
    }

    await wipe('recipe_tags');
    if (tags?.length) {
      const rows = [...new Set(tags)].map((tag) => ({ recipe_id: id, tag }));
      const { error } = await sb().from('recipe_tags').insert(rows);
      check(error, 'saveRecipe.recipe_tags');
    }

    await wipe('recipe_health_facts');
    if (health?.length) {
      const rows = health.filter(Boolean).map((fact, i) => ({ recipe_id: id, sort_order: i, fact }));
      if (rows.length) {
        const { error } = await sb().from('recipe_health_facts').insert(rows);
        check(error, 'saveRecipe.recipe_health_facts');
      }
    }
  }

  async function deleteRecipe(id) {
    const { error } = await sb().from('recipes').delete().eq('id', id);
    check(error, 'deleteRecipe');
  }

  return {
    listIngredients, getIngredient, upsertIngredient, deleteIngredient, ingredientUsageCounts,
    listUtensils,    getUtensil,    upsertUtensil,    deleteUtensil,    utensilUsageCounts,
    listRecipes,     getRecipe,     saveRecipe,       deleteRecipe,
  };
})();
