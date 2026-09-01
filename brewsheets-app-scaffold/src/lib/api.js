import { supabase } from '../supabaseClient'

// ---- Recipes ----

export async function listRecipes() {
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

export async function getRecipe(id) {
  const { data, error } = await supabase
    .from('recipes')
    .select(
      '*, recipe_grist_items(*), recipe_water_additions(*), recipe_kettle_additions(*), recipe_whirlpool_additions(*), recipe_fermenter_additions(*)'
    )
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function upsertRecipe(recipe) {
  const { data, error } = await supabase
    .from('recipes')
    .upsert(recipe)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRecipe(id) {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}

export async function replaceGristItems(recipeId, items) {
  await supabase.from('recipe_grist_items').delete().eq('recipe_id', recipeId)
  if (items.length === 0) return
  const { error } = await supabase.from('recipe_grist_items').insert(
    items.map((it, i) => ({ ...it, recipe_id: recipeId, sort_order: i }))
  )
  if (error) throw error
}

export async function replaceWaterAdditions(recipeId, items) {
  await supabase
    .from('recipe_water_additions')
    .delete()
    .eq('recipe_id', recipeId)
  if (items.length === 0) return
  const { error } = await supabase.from('recipe_water_additions').insert(
    items.map((it, i) => ({ ...it, recipe_id: recipeId, sort_order: i }))
  )
  if (error) throw error
}

export async function replaceKettleAdditions(recipeId, items) {
  await supabase
    .from('recipe_kettle_additions')
    .delete()
    .eq('recipe_id', recipeId)
  if (items.length === 0) return
  const { error } = await supabase.from('recipe_kettle_additions').insert(
    items.map((it, i) => ({ ...it, recipe_id: recipeId, sort_order: i }))
  )
  if (error) throw error
}

export async function replaceWhirlpoolAdditions(recipeId, items) {
  await supabase
    .from('recipe_whirlpool_additions')
    .delete()
    .eq('recipe_id', recipeId)
  if (items.length === 0) return
  const { error } = await supabase.from('recipe_whirlpool_additions').insert(
    items.map((it, i) => ({ ...it, recipe_id: recipeId, sort_order: i }))
  )
  if (error) throw error
}

export async function replaceFermenterAdditions(recipeId, items) {
  await supabase
    .from('recipe_fermenter_additions')
    .delete()
    .eq('recipe_id', recipeId)
  if (items.length === 0) return
  const { error } = await supabase.from('recipe_fermenter_additions').insert(
    items.map((it, i) => ({ ...it, recipe_id: recipeId, sort_order: i }))
  )
  if (error) throw error
}

// ---- Ingredients (imported from Unleashed) ----

export async function listIngredients() {
  const { data, error } = await supabase
    .from('ingredients')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

// rows: [{ unleashed_code, name, unleashed_group, sections, base_unit }].
// Upserts by unleashed_code so re-importing an updated export updates
// existing ingredients instead of creating duplicates. `sections` is
// preserved for any ingredient that already exists — re-importing refreshes
// name/unleashed_group/base_unit from Unleashed but never overwrites Ryan's
// own section assignments (whether they're the computed default or a manual
// edit). Only brand-new ingredients get the computed default sections.
// Returns { inserted, updated } counts.
export async function importIngredients(rows) {
  if (rows.length === 0) return { inserted: 0, updated: 0 }
  // Fetch all existing rows unfiltered rather than a big `.in()` list — an
  // ingredient list is a few hundred rows at most, and this avoids building
  // a huge query-string for a large CSV import.
  const { data: existing, error: existingErr } = await supabase
    .from('ingredients')
    .select('unleashed_code, sections')
  if (existingErr) throw existingErr
  const existingSectionsByCode = new Map(existing.map((r) => [r.unleashed_code, r.sections]))

  const rowsToUpsert = rows.map((r) => {
    const existingSections = existingSectionsByCode.get(r.unleashed_code)
    return existingSections !== undefined ? { ...r, sections: existingSections } : r
  })

  const { error } = await supabase
    .from('ingredients')
    .upsert(rowsToUpsert, { onConflict: 'unleashed_code' })
  if (error) throw error

  const updated = rows.filter((r) => existingSectionsByCode.has(r.unleashed_code)).length
  return { inserted: rows.length - updated, updated }
}

export async function updateIngredientSections(id, sections) {
  const { data, error } = await supabase
    .from('ingredients')
    .update({ sections })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ---- Tanks ----

export async function listTanks() {
  const { data, error } = await supabase.from('tanks').select('*').order('name')
  if (error) throw error
  return data
}

export async function upsertTank(tank) {
  const { data, error } = await supabase
    .from('tanks')
    .upsert(tank)
    .select()
    .single()
  if (error) throw error
  return data
}

// ---- Batches ----

export async function listBatches() {
  const { data, error } = await supabase
    .from('batches')
    .select('*, recipes(name, style), tanks(name)')
    .order('date_brewed', { ascending: false, nullsFirst: true })
  if (error) throw error
  return data
}

export async function getBatch(id) {
  const { data, error } = await supabase
    .from('batches')
    .select(
      '*, recipes(*, recipe_grist_items(*), recipe_water_additions(*), recipe_kettle_additions(*), recipe_whirlpool_additions(*), recipe_fermenter_additions(*)), tanks(*), brew_runs(*, brew_run_ingredients(*)), fermentation_readings(*), cellar_tasks(*)'
    )
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// Not a plain .upsert() on purpose: Postgres validates NOT NULL constraints
// against the *proposed insert row* of an upsert before it ever gets to the
// ON CONFLICT DO UPDATE path — so a partial payload like { id, turn_quantity }
// (e.g. bumping just one field on an existing batch) fails with "null value in
// column ... violates not-null constraint" even though it's really just an
// update. Routing to a real .update() when `id` is present avoids that
// entirely, while still supporting a plain .insert() for brand-new rows.
export async function upsertBatch(batch) {
  if (batch.id) {
    const { id, ...fields } = batch
    const { data, error } = await supabase
      .from('batches')
      .update(fields)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('batches').insert(batch).select().single()
  if (error) throw error
  return data
}

export async function deleteBatch(id) {
  const { error } = await supabase.from('batches').delete().eq('id', id)
  if (error) throw error
}

// ---- Brew runs ----

// Builds this turn's planned/actual ingredient list from the recipe, scaled to this
// turn's own volume (not the whole batch) — one row per grist/water/kettle/whirlpool/
// fermenter line. Snapshotted at turn-creation time so a later recipe edit never
// silently rewrites what a past brew day says it used; actual_qty starts equal to
// planned_qty and is what the brewer edits for a shortage or substitution.
function ingredientTimingNote(section, item) {
  if (section === 'kettle' && item.boil_time_min != null) return `${item.boil_time_min} min`
  if (section === 'whirlpool' && item.stand_time_min != null) return `${item.stand_time_min} min stand`
  if (section === 'fermenter' && item.timing_notes) return item.timing_notes
  return null
}

export async function snapshotBrewRunIngredients(brewRunId, recipe, turnVolumeL) {
  const sections = [
    ['grist', recipe.recipe_grist_items ?? [], 'ingredient_name'],
    ['water', recipe.recipe_water_additions ?? [], 'additive_name'],
    ['kettle', recipe.recipe_kettle_additions ?? [], 'item_name'],
    ['whirlpool', recipe.recipe_whirlpool_additions ?? [], 'item_name'],
    ['fermenter', recipe.recipe_fermenter_additions ?? [], 'item_name'],
  ]
  const rows = []
  let sortOrder = 0
  for (const [section, items, nameKey] of sections) {
    for (const item of items) {
      const qty = item.qty_g_per_l != null ? item.qty_g_per_l * turnVolumeL : null
      rows.push({
        brew_run_id: brewRunId,
        section,
        addition_stage: section === 'water' ? item.addition_stage ?? null : null,
        timing_note: ingredientTimingNote(section, item),
        item_name: item[nameKey],
        planned_qty: qty,
        actual_qty: qty,
        sort_order: sortOrder++,
      })
    }
  }
  if (rows.length === 0) return
  const { error } = await supabase.from('brew_run_ingredients').insert(rows)
  if (error) throw error
}

// Edits a single planned/actual ingredient row — item_name (substitution), actual_qty
// (shortage/overage), or extra_notes. Plain .update(), never touches planned_qty.
export async function updateBrewRunIngredient(id, fields) {
  const { data, error } = await supabase
    .from('brew_run_ingredients')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// Creates `turnQuantity` blank brew_runs rows (run_number 1..N) in one go, right
// after a batch is created by the Add Brew wizard — one row per brewhouse turn — then
// snapshots each turn's ingredient list from the recipe. `recipe` must be the FULL
// recipe (from getRecipe, with its nested ingredient arrays), not the bare listRecipes()
// shape.
export async function initializeBrewRuns(batchId, turnQuantity, recipe, turnVolumeL) {
  const rows = Array.from({ length: turnQuantity }, (_, i) => ({
    batch_id: batchId,
    run_number: i + 1,
  }))
  const { data: runs, error } = await supabase.from('brew_runs').insert(rows).select()
  if (error) throw error
  for (const run of runs) {
    await snapshotBrewRunIngredients(run.id, recipe, turnVolumeL)
  }
  return runs
}

// Same reasoning as upsertBatch above — routes to a real .update() when `id`
// is present so a partial payload (e.g. reopenStage's { id, mash_confirmed_at:
// null }) doesn't trip brew_runs' batch_id/run_number NOT NULL constraints.
export async function upsertBrewRun(run) {
  if (run.id) {
    const { id, ...fields } = run
    const { data, error } = await supabase
      .from('brew_runs')
      .update(fields)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('brew_runs').insert(run).select().single()
  if (error) throw error
  return data
}

export async function deleteBrewRun(id) {
  const { error } = await supabase.from('brew_runs').delete().eq('id', id)
  if (error) throw error
}

// ---- Fermentation readings ----

export async function upsertFermentationReading(reading) {
  const { data, error } = await supabase
    .from('fermentation_readings')
    .upsert(reading)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteFermentationReading(id) {
  const { error } = await supabase
    .from('fermentation_readings')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ---- Cellar tasks ----

export async function upsertCellarTask(task) {
  const { data, error } = await supabase
    .from('cellar_tasks')
    .upsert(task)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteCellarTask(id) {
  const { error } = await supabase.from('cellar_tasks').delete().eq('id', id)
  if (error) throw error
}
