// Admin CRUD wrappers. Reads use the public client; writes succeed only when
// the signed-in user's JWT carries app_metadata.role = 'admin' (enforced by RLS
// via public.is_admin()). See data/db/schema.sql §7 and docs/USER-TODO.md §3.
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
      .select('id,name,tagline,category,default_unit,photo,show,ai_filled_at,updated_at,ingredient_details(calories,protein,total_fat,carbohydrate)')
      .order('name', { ascending: true });
    check(error, 'listIngredients');
    return (data || []).map(row => ({
      ...row,
      nutrition: row.ingredient_details ? {
        calories: row.ingredient_details.calories,
        protein: row.ingredient_details.protein,
        total_fat: row.ingredient_details.total_fat,
        carbohydrate: row.ingredient_details.carbohydrate,
      } : {},
      ingredient_details: undefined,
    }));
  }

  async function getIngredient(id) {
    const { data: row, error } = await sb()
      .from('ingredients')
      .select('*, ingredient_details(*)')
      .eq('id', id)
      .maybeSingle();
    check(error, 'getIngredient');
    if (!row) return null;

    const { data: factRows, error: factErr } = await sb()
      .from('health_facts')
      .select('sort_order, fact')
      .eq('category', 'ingredient')
      .eq('target_id', id)
      .order('sort_order');
    check(factErr, 'getIngredient.healthFacts');

    const d = row.ingredient_details || {};
    return {
      ...row,
      ingredient_details: undefined,
      // Full nutrient block (all ~140 columns) for the deep editor
      details: d,
      // Convenience macro view kept for legacy list-page code paths
      nutrition: {
        calories: d.calories ?? 0,
        protein: d.protein ?? 0,
        total_fat: d.total_fat ?? 0,
        carbohydrate: d.carbohydrate ?? 0,
      },
      storage: d.storage || '',
      substitutes: d.substitutes || [],
      health_facts: (factRows || []).map(f => f.fact),
    };
  }

  async function upsertIngredient(row) {
    const id = row.id;
    if (!id) throw new Error('upsertIngredient: missing id');

    const ingRow = { ...row };
    const details   = ingRow.details || null;
    const nut       = ingRow.nutrition || {};
    const storage   = ingRow.storage;
    const substitutes = ingRow.substitutes;
    const healthFacts = Array.isArray(ingRow.health_facts) ? ingRow.health_facts : [];
    delete ingRow.details;
    delete ingRow.nutrition;
    delete ingRow.storage;
    delete ingRow.substitutes;
    delete ingRow.health_facts;
    delete ingRow.health_fact;
    delete ingRow.ingredient_details;

    const { data, error } = await sb().from('ingredients').upsert(ingRow).select().single();
    check(error, 'upsertIngredient');

    // Pass through every nutrient column when `details` provided; fall back
    // to the legacy 4-macro payload when only `nutrition` was supplied.
    const detPayload = details
      ? { ...details, id, storage: storage || null, substitutes: substitutes || [] }
      : {
          id,
          storage: storage || null,
          substitutes: substitutes || [],
          calories: nut.calories ?? null,
          protein: nut.protein ?? null,
          total_fat: nut.total_fat ?? null,
          carbohydrate: nut.carbohydrate ?? null,
        };
    const { error: detErr } = await sb()
      .from('ingredient_details')
      .upsert(detPayload, { onConflict: 'id' });
    check(detErr, 'upsertIngredient.details');

    const { error: delErr } = await sb()
      .from('health_facts')
      .delete()
      .eq('category', 'ingredient')
      .eq('target_id', id);
    check(delErr, 'upsertIngredient.healthFactsDelete');
    const insertRows = healthFacts
      .map((f) => (f || '').trim())
      .filter(Boolean)
      .map((fact, i) => ({ category: 'ingredient', target_id: id, sort_order: i, fact }));
    if (insertRows.length) {
      const { error: insErr } = await sb().from('health_facts').insert(insertRows);
      check(insErr, 'upsertIngredient.healthFactsInsert');
    }

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

  // Admin-only: fetch one user's profile + activity counts (last 30 days).
  // Backed by user_profiles_admin_read / saved_recipes_admin_read /
  // meal_logs_admin_read / user_health_markers_admin_read RLS policies.
  async function getUserAdminView(userId) {
    const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const since = new Date(sinceMs).toISOString();
    const sinceDate = since.slice(0, 10);

    const [profileRes, savesRes, mealsRes, markersRes] = await Promise.all([
      sb().from('user_profiles')
        .select('date_of_birth,diet_tags,allergies,goals,units')
        .eq('user_id', userId).maybeSingle(),
      sb().from('saved_recipes')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('saved_at', since),
      sb().from('meal_logs')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('logged_at', since),
      sb().from('user_health_markers')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('measured_at', sinceDate),
    ]);

    [profileRes, savesRes, mealsRes, markersRes].forEach((r, i) =>
      check(r.error, `getUserAdminView.${i}`));

    return {
      profile: profileRes.data || null,
      activity: {
        savedRecipes: savesRes.count ?? 0,
        mealsLogged:  mealsRes.count ?? 0,
        markersUpdated: markersRes.count ?? 0,
      },
    };
  }

  async function utensilUsageCounts() {
    const { data, error } = await sb()
      .from('recipe_utensils').select('utensil_id');
    check(error, 'utensilUsageCounts');
    const counts = {};
    for (const r of data || []) counts[r.utensil_id] = (counts[r.utensil_id] || 0) + 1;
    return counts;
  }

  async function listUtensilBuyLinks(utensilId) {
    const { data, error } = await sb()
      .from('utensil_buy_links')
      .select('store,url,price,affiliate_tag,sort_order')
      .eq('utensil_id', utensilId)
      .order('sort_order', { ascending: true });
    check(error, 'listUtensilBuyLinks');
    return data || [];
  }

  // Replaces all buy_links for a utensil. Deletes existing rows then inserts new.
  async function saveUtensilBuyLinks(utensilId, links) {
    const { error: delErr } = await sb()
      .from('utensil_buy_links').delete().eq('utensil_id', utensilId);
    check(delErr, 'saveUtensilBuyLinks.delete');
    const rows = (links || [])
      .filter((l) => l && (l.url || l.store))
      .map((l, i) => ({
        utensil_id: utensilId,
        sort_order: i,
        store: l.store || null,
        url: l.url || null,
        price: l.price || null,
        affiliate_tag: l.affiliate_tag || null,
      }));
    if (rows.length === 0) return;
    const { error: insErr } = await sb().from('utensil_buy_links').insert(rows);
    check(insErr, 'saveUtensilBuyLinks.insert');
  }

  // ---------- RECIPES ----------
  async function listRecipes() {
    const { data, error } = await sb()
      .from('recipes')
      .select('id,name,tagline,short_tagline,cuisine,difficulty,servings,total_minutes,media,created_by,updated_at,recipe_steps(count),recipe_ingredients(count)')
      .order('updated_at', { ascending: false });
    check(error, 'listRecipes');
    return (data || []).map((r) => ({
      ...r,
      stepCount: r.recipe_steps?.[0]?.count ?? 0,
      ingCount:  r.recipe_ingredients?.[0]?.count ?? 0,
    }));
  }

  // Same shape as listRecipes() but inner-joins on recipe_owners to scope
  // to recipes where the given userId appears as an owner. Used by the
  // chef portal's list page so chefs see only what they own and admins
  // (when scoped) see only their own subset.
  async function listOwnedRecipes(userId) {
    const { data, error } = await sb()
      .from('recipes')
      .select('id,name,tagline,short_tagline,cuisine,difficulty,servings,total_minutes,media,created_by,updated_at,recipe_steps(count),recipe_ingredients(count),recipe_owners!inner(user_id)')
      .eq('recipe_owners.user_id', userId)
      .order('updated_at', { ascending: false });
    check(error, 'listOwnedRecipes');
    return (data || []).map((r) => ({
      ...r,
      stepCount: r.recipe_steps?.[0]?.count ?? 0,
      ingredientCount: r.recipe_ingredients?.[0]?.count ?? 0,
    }));
  }

  // Returns the full recipe shape the admin editor expects (FK-style).
  async function getRecipe(id) {
    const { data, error } = await sb()
      .from('recipes')
      .select(`
        id, name, tagline, short_tagline, cuisine, difficulty, servings, total_minutes, media, color, color_soft, meal_types, created_by,
        recipe_ingredients ( sort_order, group_name, ingredient_id, amount, unit ),
        recipe_steps       ( sort_order, title, detail, duration_seconds, tip, media_caption, media_src ),
        recipe_utensils    ( sort_order, utensil_id, essential ),
        recipe_tags        ( tag )
      `)
      .eq('id', id).maybeSingle();
    check(error, 'getRecipe');
    if (!data) return data;
    const { data: factRows, error: fErr } = await sb()
      .from('health_facts')
      .select('sort_order, fact')
      .eq('category', 'recipe')
      .eq('target_id', id)
      .order('sort_order');
    check(fErr, 'getRecipe.health_facts');
    return { ...data, recipe_health_facts: factRows || [] };
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
        media_src: s.media_src ?? null,
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

    {
      const { error } = await sb().from('health_facts').delete()
        .eq('category', 'recipe').eq('target_id', id);
      check(error, 'saveRecipe.wipe.health_facts');
    }
    if (health?.length) {
      const rows = health.filter(Boolean).map((fact, i) => ({
        category: 'recipe', target_id: id, sort_order: i, fact,
      }));
      if (rows.length) {
        const { error } = await sb().from('health_facts').insert(rows);
        check(error, 'saveRecipe.health_facts');
      }
    }
  }

  // Like saveRecipe but stamps recipe.created_by = userId before the
  // upsert. Used by the chef portal editor when saving a new recipe.
  // The DB trigger handles populating recipe_owners after the INSERT.
  async function createOwnedRecipe(payload, userId) {
    const stamped = {
      ...payload,
      recipe: { ...payload.recipe, created_by: userId },
    };
    return saveRecipe(stamped);
  }

  async function deleteRecipe(id) {
    const { error } = await sb().from('recipes').delete().eq('id', id);
    check(error, 'deleteRecipe');
  }

  // ---------- DASHBOARD AGGREGATES ----------
  // Single shot: fetches everything the analytics dashboard needs in parallel.
  // All catalog/library tables are public-read, so this works for any signed-in
  // admin (or anonymous, but the page is gated to admins).
  async function getDashboardSnapshot() {
    const [
      recipesRes,
      ingredientsRes,
      utensilsRes,
      ingUsageRes,
      utUsageRes,
      tagsRes,
      healthRes,
      utLinksRes,
    ] = await Promise.all([
      sb().from('recipes').select(
        'id,name,cuisine,difficulty,total_minutes,meal_types,media,created_by,created_at,updated_at,' +
        'recipe_steps(count),recipe_ingredients(count),recipe_utensils(count),recipe_tags(count)'
      ).order('updated_at', { ascending: false }),
      sb().from('ingredients').select('id,name,category,photo,ai_filled_at,created_at,updated_at,ingredient_details(calories,protein,total_fat,carbohydrate)'),
      sb().from('utensils').select('id,name,category,photo,care_tip,ai_filled_at,created_at,updated_at'),
      sb().from('recipe_ingredients').select('ingredient_id'),
      sb().from('recipe_utensils').select('utensil_id'),
      sb().from('recipe_tags').select('tag,recipe_id'),
      sb().from('health_facts').select('target_id').eq('category', 'recipe'),
      sb().from('utensil_buy_links').select('utensil_id'),
    ]);

    [recipesRes, ingredientsRes, utensilsRes, ingUsageRes, utUsageRes, tagsRes, healthRes, utLinksRes]
      .forEach((r, i) => check(r.error, `dashboard.${i}`));

    const healthTally = tally(healthRes.data || [], 'target_id');
    const recipes = (recipesRes.data || []).map((r) => ({
      ...r,
      stepCount: r.recipe_steps?.[0]?.count ?? 0,
      ingCount:  r.recipe_ingredients?.[0]?.count ?? 0,
      utCount:   r.recipe_utensils?.[0]?.count ?? 0,
      tagCount:  r.recipe_tags?.[0]?.count ?? 0,
      healthCount: healthTally[r.id] ?? 0,
    }));

    return {
      recipes,
      ingredients: (ingredientsRes.data || []).map(row => ({
        ...row,
        nutrition: row.ingredient_details ? {
          calories: row.ingredient_details.calories,
          protein: row.ingredient_details.protein,
          total_fat: row.ingredient_details.total_fat,
          carbohydrate: row.ingredient_details.carbohydrate,
        } : {},
        ingredient_details: undefined,
      })),
      utensils:    utensilsRes.data || [],
      ingredientUsage: tally(ingUsageRes.data || [], 'ingredient_id'),
      utensilUsage:    tally(utUsageRes.data || [], 'utensil_id'),
      tags:            tagsRes.data || [],
      utensilBuyLinks: tally(utLinksRes.data || [], 'utensil_id'),
    };
  }

  function tally(rows, key) {
    const out = {};
    for (const r of rows) out[r[key]] = (out[r[key]] || 0) + 1;
    return out;
  }

  return {
    listIngredients, getIngredient, upsertIngredient, deleteIngredient, ingredientUsageCounts,
    listUtensils,    getUtensil,    upsertUtensil,    deleteUtensil,    utensilUsageCounts,
    listUtensilBuyLinks, saveUtensilBuyLinks,
    getUserAdminView,
    listRecipes,     listOwnedRecipes, getRecipe,     saveRecipe,       createOwnedRecipe, deleteRecipe,
    getDashboardSnapshot,
  };
})();
