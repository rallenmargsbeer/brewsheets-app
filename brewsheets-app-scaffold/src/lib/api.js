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
      '*, recipe_grist_items(*), recipe_water_additions(*), recipe_kettle_additions(*), recipe_fermenter_additions(*)'
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
      '*, recipes(*, recipe_grist_items(*), recipe_water_additions(*), recipe_kettle_additions(*), recipe_fermenter_additions(*)), tanks(*), brew_runs(*), fermentation_readings(*), cellar_tasks(*)'
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
