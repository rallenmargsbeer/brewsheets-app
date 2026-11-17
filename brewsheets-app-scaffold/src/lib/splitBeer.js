// Split part of a fermenting (or chilled) beer off into a new beer: e.g. 1,000 L of a batch moved
// to another FV, a BBT or barrels with different additions. The new beer is its own batch (the
// next batch number), linked to its parent. It starts from the parent's OG, readings and cellar
// steps so far. The parent's additions still to go in are shared by volume. In Unleashed the
// parent is assembled for its full volume and the new beer is assembled from litres of the
// parent's FB plus its own additions, so the new batch's ingredients are "litres of the parent"
// and its own additions, never a share of the brewhouse ingredients (that would count them twice).
import { supabase } from '../supabaseClient'
import { listBatches, upsertBatch, loadTankAdditionsFromRecipe, getBatch } from './api'
import { actualOg, koLitres } from './batchFigures'

const today = () => new Date().toLocaleDateString('en-CA')
const toBarrelsKind = (dest) => dest.kind === 'barrels'
const round = (n) => Math.round(n * 1000) / 1000

// Beers already split off this batch.
export async function listSplits(batchId) {
  const { data, error } = await supabase
    .from('batches')
    .select('id, batch_number, beer_style, split_l, split_date, status')
    .eq('parent_batch_id', batchId)
    .order('split_date')
  if (error) throw error
  return data
}

export async function getParent(parentId) {
  const { data, error } = await supabase.from('batches').select('id, batch_number, beer_style').eq('id', parentId).maybeSingle()
  if (error) throw error
  return data
}

// Litres in the tank now: knockout (or the target volume) less anything already split off.
export function litresNow(batch, splits = []) {
  const start = koLitres(batch) || Number(batch.target_volume_l) || 0
  return Math.max(0, start - splits.reduce((a, s) => a + (Number(s.split_l) || 0), 0))
}

// dest: { kind: 'tank', tank } (an FV or BBT) or { kind: 'barrels', count }.
export async function splitBeer({ parent: given, litres, tankLitres, dest, beerName, recipeId }) {
  const L = Number(litres), T = Number(tankLitres)
  if (!(L > 0)) throw new Error('Enter the litres being split off.')
  if (!(T > L)) throw new Error(`The tank needs more than ${L.toLocaleString()} L in it to split that off.`)
  if (!beerName?.trim()) throw new Error('Name the new beer.')
  const f = L / T
  const parent = await getBatch(given.id) // full record: brew runs for the OG, notes, yeast
  const date = today()

  if (!toBarrelsKind(dest)) {
    const { data: inTank } = await supabase.from('batches').select('batch_number').eq('tank_id', dest.tank.id)
      .in('status', ['brewing', 'fermenting', 'chilling', 'conditioning']).limit(1)
    if (inTank?.length) throw new Error(`${dest.tank.name} already has #${inTank[0].batch_number} in it.`)
  }
  const nums = (await listBatches()).map((b) => parseInt(b.batch_number, 10)).filter(Number.isInteger)
  const number = String(nums.length ? Math.max(...nums) + 1 : 1)
  const toBarrels = dest.kind === 'barrels'
  const toBbt = !toBarrels && dest.tank?.tank_type === 'BBT'
  const status = toBarrels ? 'barrelled' : toBbt ? 'conditioning' : parent.status === 'chilling' ? 'chilling' : 'fermenting'
  const where = toBarrels ? `${dest.count} barrel${Number(dest.count) === 1 ? '' : 's'}` : dest.tank?.name

  const child = await upsertBatch({
    recipe_id: recipeId || parent.recipe_id,
    batch_number: number,
    beer_style: beerName.trim(),
    status,
    tank_id: toBarrels ? null : dest.tank.id,
    date_brewed: parent.date_brewed,
    target_volume_l: L,
    og_override: actualOg(parent) == null ? null : Math.round(actualOg(parent) * 100) / 100,
    yeast_name: parent.yeast_name ?? null,
    yeast_generation: parent.yeast_generation ?? null,
    parent_batch_id: parent.id,
    split_l: L,
    split_date: date,
    ...(toBarrels ? { barrel_date: date, barrel_l: L, barrel_count: Number(dest.count) || null } : {}),
    ...(toBbt ? { bbt_transfer_date: date, fv_to_bbt_l: L } : {}),
    notes: `Split from #${parent.batch_number} ${parent.beer_style ?? ''} on ${date}: ${L.toLocaleString()} L of ${T.toLocaleString()} L, into ${where}.`,
  })

  // Additions still to go in: the parent keeps its share; the new beer gets the rest of the same
  // additions (same recipe) or its own recipe's.
  const { data: pending, error: e1 } = await supabase.from('tank_additions').select('*').eq('batch_id', parent.id).is('added_on', null)
  if (e1) throw e1
  for (const a of pending ?? []) {
    if (a.planned_qty == null) continue
    const { error } = await supabase.from('tank_additions').update({ planned_qty: round(Number(a.planned_qty) * (1 - f)) }).eq('id', a.id)
    if (error) throw error
  }
  if (!recipeId || recipeId === parent.recipe_id) {
    const rows = (pending ?? []).map((a) => ({
      batch_id: child.id, item_name: a.item_name, timing_note: a.timing_note, sort_order: a.sort_order,
      planned_qty: a.planned_qty == null ? null : round(Number(a.planned_qty) * f),
    }))
    if (rows.length) {
      const { error } = await supabase.from('tank_additions').insert(rows)
      if (error) throw error
    }
  } else {
    await loadTankAdditionsFromRecipe(child)
  }

  // The same beer so far: its gravity readings and the cellar steps already done.
  const { data: readings } = await supabase.from('fermentation_readings').select('*').eq('batch_id', parent.id)
  const r = (readings ?? []).map(({ id, created_at, batch_id, ...x }) => ({ ...x, batch_id: child.id }))
  if (r.length) {
    const { error } = await supabase.from('fermentation_readings').insert(r)
    if (error) throw error
  }
  const { data: actions } = await supabase.from('cellar_actions').select('action, done_on, result').eq('batch_id', parent.id)
  if (actions?.length) {
    const { error } = await supabase.from('cellar_actions').insert(actions.map((a) => ({ ...a, batch_id: child.id })))
    if (error) throw error
  }

  const note = `Split ${L.toLocaleString()} L off to #${number} ${beerName.trim()} on ${date}.`
  await upsertBatch({ id: parent.id, notes: parent.notes ? `${parent.notes}\n${note}` : note })
  return child
}
