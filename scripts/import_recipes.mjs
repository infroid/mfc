#!/usr/bin/env node
// One-shot recipe import: data/recipes.json + data/recipe-bundles/{id}/recipe.json → Supabase.
// Idempotent on recipe.id; safe to re-run after edits to source JSON.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
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

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

function buildRecipeRow(listing, detail) {
  const id = listing.id;
  const heroImageRel = `data/recipe-bundles/${id}/hero.jpg`;
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
      hero: detail?.media?.hero ?? null,
      image: heroImageRel,
    },
    color: listing.color ?? null,
    color_soft: listing.colorSoft ?? null,
    featured: !!listing.featured,
    highlight: listing.highlight ?? null,
    meal_types: [],
  };
}

async function upsertRecipe(listing) {
  const id = listing.id;
  const detail = await loadDetailIfExists(id);

  const recipeRow = buildRecipeRow(listing, detail);
  const { error: rErr } = await sb.from('recipes').upsert(recipeRow);
  if (rErr) throw new Error(`recipes upsert ${id}: ${rErr.message}`);

  // Tags: from the listing (detail JSON doesn't carry tags today)
  await sb.from('recipe_tags').delete().eq('recipe_id', id);
  if (Array.isArray(listing.tags) && listing.tags.length) {
    const tagRows = listing.tags.map((tag) => ({ recipe_id: id, tag }));
    const { error } = await sb.from('recipe_tags').insert(tagRows);
    if (error) throw new Error(`recipe_tags ${id}: ${error.message}`);
  }

  if (!detail) {
    console.log(`✓ ${id} (listing only — no recipe-bundle detail found)`);
    return;
  }

  // Ingredients
  await sb.from('recipe_ingredients').delete().eq('recipe_id', id);
  if (Array.isArray(detail.ingredients) && detail.ingredients.length) {
    const rows = detail.ingredients.map((ing, i) => ({
      recipe_id: id,
      sort_order: i,
      group_name: ing.group ?? null,
      ingredient: ing.name,
      amount: ing.amt ?? null,
    }));
    const { error } = await sb.from('recipe_ingredients').insert(rows);
    if (error) throw new Error(`recipe_ingredients ${id}: ${error.message}`);
  }

  // Steps
  await sb.from('recipe_steps').delete().eq('recipe_id', id);
  if (Array.isArray(detail.steps) && detail.steps.length) {
    const rows = detail.steps.map((step, i) => ({
      recipe_id: id,
      sort_order: typeof step.id === 'number' ? step.id : i + 1,
      title: step.title,
      detail: step.detail,
      duration_seconds: step.duration ?? null,
      tip: step.tip ?? null,
      media_caption: step.media?.caption ?? null,
    }));
    const { error } = await sb.from('recipe_steps').insert(rows);
    if (error) throw new Error(`recipe_steps ${id}: ${error.message}`);
  }

  // Utensils
  await sb.from('recipe_utensils').delete().eq('recipe_id', id);
  if (Array.isArray(detail.utensils) && detail.utensils.length) {
    const seen = new Set();
    const rows = detail.utensils
      .filter((u) => { if (seen.has(u.name)) return false; seen.add(u.name); return true; })
      .map((u) => ({ recipe_id: id, name: u.name, essential: !!u.essential }));
    const { error } = await sb.from('recipe_utensils').insert(rows);
    if (error) throw new Error(`recipe_utensils ${id}: ${error.message}`);
  }

  // Health facts
  await sb.from('recipe_health_facts').delete().eq('recipe_id', id);
  if (Array.isArray(detail.healthFacts) && detail.healthFacts.length) {
    const rows = detail.healthFacts.map((fact, i) => ({
      recipe_id: id,
      sort_order: i,
      fact,
    }));
    const { error } = await sb.from('recipe_health_facts').insert(rows);
    if (error) throw new Error(`recipe_health_facts ${id}: ${error.message}`);
  }

  console.log(`✓ ${id}`);
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

  for (const r of listing) {
    try { await upsertRecipe(r); }
    catch (e) { console.error(`✗ ${r.id}: ${e.message}`); process.exitCode = 1; }
  }

  // Summary
  const { count } = await sb.from('recipes').select('*', { count: 'exact', head: true });
  console.log(`\nrecipes table now has ${count} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
