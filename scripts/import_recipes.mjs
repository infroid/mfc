#!/usr/bin/env node
// One-shot recipe import: data/recipe-bundles/{id}/recipe.json → Supabase.
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

async function loadBundle(id) {
  return readJson(join(BUNDLES_DIR, id, 'recipe.json'));
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

async function collectLibrary(bundles) {
  // Maps: slug → { id, name, default_unit }  and  slug → { id, name }
  const ingredients = new Map();
  const utensils    = new Map();

  for (const detail of bundles) {
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

function buildRecipeRow(detail) {
  const id = detail.id;
  return {
    id,
    name: detail.name,
    tagline: detail.tagline ?? null,
    short_tagline: detail.shortTagline ?? null,
    cuisine: detail.cuisine,
    difficulty: detail.difficulty,
    servings: detail.servings,
    total_minutes: detail.totalMinutes,
    media: {
      emoji: detail.media?.emoji ?? null,
      hero:  detail.media?.hero ?? null,
      image: `data/recipe-bundles/${id}/hero.jpg`,
    },
    color:      detail.color ?? null,
    color_soft: detail.colorSoft ?? null,
    featured:   !!detail.featured,
    highlight:  detail.highlight ?? null,
    meal_types: [],
  };
}

async function upsertRecipe(detail) {
  const id = detail.id;

  const { error: rErr } = await sb.from('recipes').upsert(buildRecipeRow(detail));
  if (rErr) throw new Error(`recipes upsert ${id}: ${rErr.message}`);

  // Tags
  await sb.from('recipe_tags').delete().eq('recipe_id', id);
  if (Array.isArray(detail.tags) && detail.tags.length) {
    const { error } = await sb.from('recipe_tags')
      .insert(detail.tags.map((tag) => ({ recipe_id: id, tag })));
    if (error) throw new Error(`recipe_tags ${id}: ${error.message}`);
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
  const bundleIds = (await readdir(BUNDLES_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const bundles = await Promise.all(bundleIds.map(loadBundle));

  console.log('Pass 1/3: collecting library rows…');
  const { ingredients, utensils } = await collectLibrary(bundles);

  console.log('Pass 2/3: upserting library tables…');
  await upsertLibrary(ingredients, utensils);

  console.log('Pass 3/3: upserting recipes…');
  for (const detail of bundles) {
    try { await upsertRecipe(detail); }
    catch (e) { console.error(`  ✗ ${detail.id}: ${e.message}`); process.exitCode = 1; }
  }

  const { count } = await sb.from('recipes').select('*', { count: 'exact', head: true });
  console.log(`\nrecipes populated (${count} rows) · ingredients populated · utensils populated`);
}

main().catch((e) => { console.error(e); process.exit(1); });
