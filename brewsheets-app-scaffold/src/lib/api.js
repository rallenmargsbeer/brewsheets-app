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

export async function updateIngredientPotentialPpg(id, potentialPpg) {
  const { data, error } = await supabase
    .from('ingredients')
    .update({ potential_ppg: potentialPpg })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateIngredientAlphaAcid(id, alphaAcidPct) {
  const { data, error } = await supabase
    .from('ingredients')
    .update({ alpha_acid_pct: alphaAcidPct })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
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

// Batches currently sitting in a tank, for the Tanks board.
export async function listBatchesInTanks(statuses) {
  const { data, error } = await supabase
    .from('batches')
    .select('id, batch_number, beer_style, status, date_brewed, bbt_transfer_date, tank_id, brewhouse_yield_l, fv_to_bbt_l, tanks(name, tank_type)')
    .not('tank_id', 'is', null)
    .in('status', statuses)
    .order('date_brewed', { ascending: false })
  if (error) throw error
  return data
}

export async function getBatch(id) {
  const { data, error } = await supabase
    .from('batches')
    .select(
      '*, recipes(*, recipe_grist_items(*), recipe_water_additions(*), recipe_kettle_additions(*), recipe_whirlpool_additions(*), recipe_fermenter_additions(*)), tanks(*), brew_runs(*, brew_run_ingredients(*)), fermentation_readings(*), cellar_tasks(*), tank_additions(*)'
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

// bagCounts (grist only): { [recipe_grist_items.id]: bagsForThisTurn }. When a grist item has
// a pack_size_kg set AND this turn has a bag count for it, planned/actual is bag_count ×
// pack_size_kg instead of the usual qty_g_per_l × turnVolumeL — this is what lets a turn's
// sheet say "1 bag (25.00 kg)" instead of a computed-to-the-gram figure for something that's
// actually grabbed off the shelf by the whole bag. Everything else (no pack size, or no bag
// count supplied for this turn/item) keeps the original per-litre calc, bag_count stays null.
// Names of ingredients in Unleashed's "Yeast" group. Yeast is pitched on brew day so it
// stays on the brew sheet; every other fermenter addition (dry hops etc.) goes to the
// tank's checklist on the Cellar tab instead.
async function yeastNames() {
  const { data, error } = await supabase.from('ingredients').select('name').eq('unleashed_group', 'Yeast')
  if (error) throw error
  return new Set(data.map((d) => d.name))
}

export async function snapshotBrewRunIngredients(brewRunId, recipe, turnVolumeL, bagCounts = {}) {
  const yeast = (recipe.recipe_fermenter_additions ?? []).length ? await yeastNames() : new Set()
  const sections = [
    ['grist', recipe.recipe_grist_items ?? [], 'ingredient_name'],
    ['water', recipe.recipe_water_additions ?? [], 'additive_name'],
    ['kettle', recipe.recipe_kettle_additions ?? [], 'item_name'],
    ['whirlpool', recipe.recipe_whirlpool_additions ?? [], 'item_name'],
    ['fermenter', (recipe.recipe_fermenter_additions ?? []).filter((f) => yeast.has(f.item_name)), 'item_name'],
  ]
  const rows = []
  let sortOrder = 0
  for (const [section, items, nameKey] of sections) {
    for (const item of items) {
      let qty = item.qty_g_per_l != null ? item.qty_g_per_l * turnVolumeL : null
      let bagCount = null
      if (section === 'grist' && item.pack_size_kg > 0 && bagCounts[item.id] != null) {
        bagCount = bagCounts[item.id]
        qty = bagCount * item.pack_size_kg * 1000
      }
      const timeMin =
        section === 'kettle' ? item.boil_time_min ?? null : section === 'whirlpool' ? item.stand_time_min ?? null : null
      rows.push({
        brew_run_id: brewRunId,
        section,
        addition_stage: section === 'water' ? item.addition_stage ?? null : null,
        timing_note: ingredientTimingNote(section, item),
        item_name: item[nameKey],
        planned_qty: qty,
        actual_qty: qty,
        bag_count: bagCount,
        time_min: timeMin,
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
// shape. `bagAllocations` (optional, grist only): { [gristItemId]: [countForTurn1,
// countForTurn2, ...] } — the Allocate Grist Bags wizard step's output.
export async function initializeBrewRuns(batchId, turnQuantity, recipe, turnVolumeL, bagAllocations = {}) {
  const rows = Array.from({ length: turnQuantity }, (_, i) => ({
    batch_id: batchId,
    run_number: i + 1,
  }))
  const { data: runs, error } = await supabase.from('brew_runs').insert(rows).select()
  if (error) throw error
  for (const [i, run] of runs.entries()) {
    const bagCounts = Object.fromEntries(
      Object.entries(bagAllocations).map(([itemId, counts]) => [itemId, counts[i] ?? 0])
    )
    await snapshotBrewRunIngredients(run.id, recipe, turnVolumeL, bagCounts)
  }
  await createTankAdditions(batchId, recipe, turnVolumeL * turnQuantity)
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

// ---- Packaging ----

export async function listPackagingSessions(batchId) {
  const { data, error } = await supabase
    .from('packaging_sessions')
    .select('*, packaging_do_checks(*)')
    .eq('batch_id', batchId)
    .order('package_date')
    .order('created_at')
  if (error) throw error
  return data
}

// Totals per batch for the Packaging list.
export async function listPackagingTotals(batchIds) {
  if (batchIds.length === 0) return []
  const { data, error } = await supabase
    .from('packaging_sessions')
    .select('batch_id, kegs_20, kegs_30, kegs_50, cubes')
    .in('batch_id', batchIds)
  if (error) throw error
  return data
}

export async function upsertPackagingSession(session) {
  const { id, packaging_do_checks, ...fields } = session
  const query = id
    ? supabase.from('packaging_sessions').update(fields).eq('id', id)
    : supabase.from('packaging_sessions').insert(fields)
  const { data, error } = await query.select().single()
  if (error) throw error
  return data
}

export async function deletePackagingSession(id) {
  const { error } = await supabase.from('packaging_sessions').delete().eq('id', id)
  if (error) throw error
}

export async function addDoCheck(check) {
  const { error } = await supabase.from('packaging_do_checks').insert(check)
  if (error) throw error
}

export async function deleteDoCheck(id) {
  const { error } = await supabase.from('packaging_do_checks').delete().eq('id', id)
  if (error) throw error
}

// ---- Tank additions (dry hops etc., added in the cellar) ----

// Seeds a batch's tank checklist from the recipe's non-yeast fermenter additions,
// sized for the whole batch.
async function createTankAdditions(batchId, recipe, batchVolumeL) {
  const yeast = await yeastNames()
  const rows = (recipe.recipe_fermenter_additions ?? [])
    .filter((f) => f.item_name && !yeast.has(f.item_name))
    .map((f, i) => ({
      batch_id: batchId,
      item_name: f.item_name,
      planned_qty: f.qty_g_per_l != null ? f.qty_g_per_l * batchVolumeL : null,
      timing_note: f.timing_notes ?? null,
      sort_order: f.sort_order ?? i,
    }))
  if (rows.length === 0) return
  const { error } = await supabase.from('tank_additions').insert(rows)
  if (error) throw error
}

export async function listTankAdditions(batchId) {
  const { data, error } = await supabase
    .from('tank_additions')
    .select('*')
    .eq('batch_id', batchId)
    .order('sort_order')
    .order('created_at')
  if (error) throw error
  return data
}

export async function saveTankAddition(addition) {
  const { id, ...fields } = addition
  const query = id
    ? supabase.from('tank_additions').update(fields).eq('id', id)
    : supabase.from('tank_additions').insert(fields)
  const { error } = await query
  if (error) throw error
}

export async function deleteTankAddition(id) {
  const { error } = await supabase.from('tank_additions').delete().eq('id', id)
  if (error) throw error
}

// Batches started before the Cellar checklist existed have their dry hops (non-yeast
// fermenter additions) on the brew-day turns. Move them to the tank checklist, totalled
// across turns, and take them off the brew sheet so nothing is counted twice. Safe to
// call every time: once moved there's nothing left to move.
const movesInFlight = new Map()
export function moveFermenterAdditionsToTank(batchId) {
  // One move per batch at a time, so opening the tank twice quickly can't double up.
  if (!movesInFlight.has(batchId)) {
    movesInFlight.set(batchId, doMoveFermenterAdditions(batchId).finally(() => movesInFlight.delete(batchId)))
  }
  return movesInFlight.get(batchId)
}

async function doMoveFermenterAdditions(batchId) {
  const { data: runs, error } = await supabase
    .from('brew_runs')
    .select('id, brew_run_ingredients(id, section, item_name, planned_qty, timing_note, sort_order)')
    .eq('batch_id', batchId)
  if (error) throw error
  const yeast = await yeastNames()
  const rows = runs.flatMap((r) => r.brew_run_ingredients ?? []).filter((i) => i.section === 'fermenter' && !yeast.has(i.item_name))
  if (rows.length === 0) return
  const byItem = new Map()
  for (const r of rows) {
    const key = `${r.item_name}|${r.timing_note ?? ''}`
    const t = byItem.get(key) ?? { batch_id: batchId, item_name: r.item_name, planned_qty: 0, timing_note: r.timing_note ?? null, sort_order: r.sort_order ?? 0 }
    t.planned_qty += Number(r.planned_qty) || 0
    byItem.set(key, t)
  }
  // If the checklist was already seeded (e.g. the tank opened twice at once), don't add it again.
  const { count, error: cErr } = await supabase
    .from('tank_additions')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .not('planned_qty', 'is', null)
  if (cErr) throw cErr
  if (!count) {
    const { error: insErr } = await supabase.from('tank_additions').insert([...byItem.values()])
    if (insErr) throw insErr
  }
  const { error: delErr } = await supabase.from('brew_run_ingredients').delete().in('id', rows.map((r) => r.id))
  if (delErr) throw delErr
}
