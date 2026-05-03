#!/usr/bin/env node
// One-shot recipe import: data/recipes.json + data/recipe-bundles/{id}/recipe.json → Supabase.
// Idempotent: re-runs reconcile to the same state. No duplicate library entries.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SECRET_KEY=<secret-key> \
//   node scripts/import_recipes.mjs
//
// Requires: npm i -g @supabase/supabase-js   (or run via `npx --yes` from a temp install)

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LISTING_PATH = join(ROOT, 'data', 'recipes.json');
const BUNDLES_DIR = join(ROOT, 'data', 'recipe-bundles');

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY env vars.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadDetailIfExists(id) {
  const path = join(BUNDLES_DIR, id, 'recipe.json');
  try { return await readJson(path); }
  catch { return null; }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function guessUnit(amountStr) {
  if (!amountStr) return 'g';
  const s = amountStr.toLowerCase();
  if (/\btbsp\b/.test(s))    return 'tbsp';
  if (/\btsp\b/.test(s))     return 'tsp';
  if (/\bcups?\b/.test(s))   return 'cup';
  if (/\bml\b/.test(s))      return 'ml';
  if (/\bmedium\b/.test(s))  return 'medium';
  if (/\blarge\b/.test(s))   return 'large';
  if (/\bwhole\b/.test(s))   return 'whole';
  if (/\bpinch\b/.test(s))   return 'pinch';
  return 'g';
}

// ---- Pass 1: collect all unique ingredients + utensils across all recipes ----

async function collectLibrary(listing) {
  // Maps: slug → { id, name, default_unit }  and  slug → { id, name }
  const ingredients = new Map();
  const utensils    = new Map();

  for (const r of listing) {
    const detail = await loadDetailIfExists(r.id);
    if (!detail) continue;

    for (const ing of (detail.ingredients || [])) {
      if (!ing.name) continue;
      const id = slugify(ing.name);
      if (!ingredients.has(id)) {
        ingredients.set(id, { id, name: ing.name, default_unit: guessUnit(ing.amt) });
      }
    }

    for (const u of (detail.utensils || [])) {
      if (!u.name) continue;
      const id = slugify(u.name);
      if (!utensils.has(id)) {
        utensils.set(id, { id, name: u.name });
      }
    }
  }

  return { ingredients, utensils };
}

// ---- Pass 2: upsert library tables ----

async function upsertLibrary(ingredients, utensils) {
  if (ingredients.size) {
    const rows = [...ingredients.values()];
    const { error } = await sb.from('ingredients').upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw new Error(`ingredients upsert: ${error.message}`);
  }
  console.log(`  ingredients populated (${ingredients.size} unique)`);

  if (utensils.size) {
    const rows = [...utensils.values()];
    const { error } = await sb.from('utensils').upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw new Error(`utensils upsert: ${error.message}`);
  }
  console.log(`  utensils populated (${utensils.size} unique)`);
}

// ---- Pass 3: upsert recipes + all join tables ----

function buildRecipeRow(listing, detail) {
  const id = listing.id;
  return {
    id,
    name: listing.name,
    tagline: listing.tagline ?? null,
    short_tagline: detail?.tagline ?? null,
    cuisine: listing.cuisine,
    difficulty: listing.difficulty,
    servings: listing.servings,
    total_minutes: listing.totalMinutes,
    media: {
      emoji: listing.media?.emoji ?? detail?.media?.emoji ?? null,
      hero:  detail?.media?.hero ?? null,
      image: `data/recipe-bundles/${id}/hero.jpg`,
    },
    color:      listing.color ?? null,
    color_soft: listing.colorSoft ?? null,
    featured:   !!listing.featured,
    highlight:  listing.highlight ?? null,
    meal_types: [],
  };
}

async function upsertRecipe(listing) {
  const id     = listing.id;
  const detail = await loadDetailIfExists(id);

  const { error: rErr } = await sb.from('recipes').upsert(buildRecipeRow(listing, detail));
  if (rErr) throw new Error(`recipes upsert ${id}: ${rErr.message}`);

  // Tags
  await sb.from('recipe_tags').delete().eq('recipe_id', id);
  if (Array.isArray(listing.tags) && listing.tags.length) {
    const { error } = await sb.from('recipe_tags')
      .insert(listing.tags.map((tag) => ({ recipe_id: id, tag })));
    if (error) throw new Error(`recipe_tags ${id}: ${error.message}`);
  }

  if (!detail) {
    console.log(`  ✓ ${id} (listing only — no recipe-bundle detail found)`);
    return;
  }

  // Ingredients — FK join using slugified ingredient IDs
  await sb.from('recipe_ingredients').delete().eq('recipe_id', id);
  if (Array.isArray(detail.ingredients) && detail.ingredients.length) {
    const rows = detail.ingredients.map((ing, i) => ({
      recipe_id:     id,
      sort_order:    i,
      ingredient_id: slugify(ing.name),
      group_name:    ing.group ?? null,
      amount:        ing.amt ?? null,
      unit:          null,
    }));
    const { error } = await sb.from('recipe_ingredients').insert(rows);
    if (error) throw new Error(`recipe_ingredients ${id}: ${error.message}`);
  }

  // Steps
  await sb.from('recipe_steps').delete().eq('recipe_id', id);
  if (Array.isArray(detail.steps) && detail.steps.length) {
    const rows = detail.steps.map((step, i) => ({
      recipe_id:       id,
      sort_order:      typeof step.id === 'number' ? step.id : i + 1,
      title:           step.title,
      detail:          step.detail,
      duration_seconds: step.duration ?? null,
      tip:             step.tip ?? null,
      media_caption:   step.media?.caption ?? null,
    }));
    const { error } = await sb.from('recipe_steps').insert(rows);
    if (error) throw new Error(`recipe_steps ${id}: ${error.message}`);
  }

  // Utensils — FK join using slugified utensil IDs, deduplicated
  await sb.from('recipe_utensils').delete().eq('recipe_id', id);
  if (Array.isArray(detail.utensils) && detail.utensils.length) {
    const seen = new Set();
    const rows = [];
    for (const u of detail.utensils) {
      const utensil_id = slugify(u.name);
      if (seen.has(utensil_id)) continue;
      seen.add(utensil_id);
      rows.push({ recipe_id: id, sort_order: rows.length, utensil_id, essential: !!u.essential });
    }
    const { error } = await sb.from('recipe_utensils').insert(rows);
    if (error) throw new Error(`recipe_utensils ${id}: ${error.message}`);
  }

  // Health facts
  await sb.from('recipe_health_facts').delete().eq('recipe_id', id);
  if (Array.isArray(detail.healthFacts) && detail.healthFacts.length) {
    const rows = detail.healthFacts.map((fact, i) => ({ recipe_id: id, sort_order: i, fact }));
    const { error } = await sb.from('recipe_health_facts').insert(rows);
    if (error) throw new Error(`recipe_health_facts ${id}: ${error.message}`);
  }

  console.log(`  ✓ ${id}`);
}

async function main() {
  const listing = await readJson(LISTING_PATH);
  const bundleIds = (await readdir(BUNDLES_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const listingIds = new Set(listing.map((r) => r.id));
  const orphans = bundleIds.filter((id) => !listingIds.has(id));
  if (orphans.length) {
    console.warn(`! recipe-bundles without listing entry (skipping): ${orphans.join(', ')}`);
  }

  console.log('Pass 1/3: collecting library rows…');
  const { ingredients, utensils } = await collectLibrary(listing);

  console.log('Pass 2/3: upserting library tables…');
  await upsertLibrary(ingredients, utensils);

  console.log('Pass 3/3: upserting recipes…');
  for (const r of listing) {
    try { await upsertRecipe(r); }
    catch (e) { console.error(`  ✗ ${r.id}: ${e.message}`); process.exitCode = 1; }
  }

  const { count } = await sb.from('recipes').select('*', { count: 'exact', head: true });
  console.log(`\nrecipes populated (${count} rows) · ingredients populated · utensils populated`);
}

main().catch((e) => { console.error(e); process.exit(1); });
