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
      '*, recipes(*, recipe_grist_items(*), recipe_water_additions(*), recipe_kettle_additions(*), recipe_whirlpool_additions(*), recipe_fermenter_additions(*)), tanks(*), brew_runs(*), fermentation_readings(*), cellar_tasks(*)'
    )
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function upsertBatch(batch) {
  const { data, error } = await supabase
    .from('batches')
    .upsert(batch)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteBatch(id) {
  const { error } = await supabase.from('batches').delete().eq('id', id)
  if (error) throw error
}

// ---- Brew runs ----

export async function upsertBrewRun(run) {
  const { data, error } = await supabase
    .from('brew_runs')
    .upsert(run)
    .select()
    .single()
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
