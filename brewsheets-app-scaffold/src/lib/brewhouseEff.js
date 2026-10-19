import { supabase } from '../supabaseClient'
import { toSg } from './beerCalcs'

// Brewhouse efficiency from past turns: KO gravity x KO volume against the grist's potential
// (PPG from the Ingredients page). Grist is the turn's own lines, else the recipe's g/L x turn volume.
// Turns over 100% are left out (their KO volume includes top-up water).
const KG_LB = 2.20462, L_GAL = 0.264172

export async function loadBrewhouseEff() {
  const [runs, ings] = await Promise.all([
    supabase.from('brew_runs')
      .select('whirlpool_gravity, ko_flowmeter_l, brew_run_ingredients(section, item_name, planned_qty, actual_qty), batches!inner(recipe_id, turn_volume_l, recipes(recipe_grist_items(ingredient_name, qty_g_per_l)))')
      .gt('whirlpool_gravity', 0).gt('ko_flowmeter_l', 0),
    supabase.from('ingredients').select('name, potential_ppg').not('potential_ppg', 'is', null),
  ])
  if (runs.error) throw runs.error
  if (ings.error) throw ings.error
  const ppg = new Map(ings.data.map((i) => [i.name, Number(i.potential_ppg)]))
  const turns = []
  for (const r of runs.data) {
    const own = (r.brew_run_ingredients ?? []).filter((i) => i.section === 'grist')
    const turnL = Number(r.batches.turn_volume_l) || 2500
    const grist = own.length
      ? own.map((i) => ({ name: i.item_name, kg: Number(i.actual_qty ?? i.planned_qty ?? 0) / 1000 }))
      : (r.batches.recipes?.recipe_grist_items ?? []).map((g) => ({ name: g.ingredient_name, kg: (Number(g.qty_g_per_l) * turnL) / 1000 }))
    if (!grist.length || grist.some((g) => g.kg > 0 && !ppg.has(g.name))) continue
    const potential = grist.reduce((a, g) => a + g.kg * KG_LB * ppg.get(g.name), 0)
    const actual = 1000 * (toSg(r.whirlpool_gravity) - 1) * Number(r.ko_flowmeter_l) * L_GAL
    const eff = (actual / potential) * 100
    if (potential > 0 && eff > 0 && eff <= 100) turns.push({ recipeId: r.batches.recipe_id, eff })
  }
  return turns
}

// Average for one recipe (3+ turns), else across all beers.
export function effFor(turns, recipeId) {
  const avg = (list) => list.reduce((a, t) => a + t.eff, 0) / list.length
  const mine = turns.filter((t) => t.recipeId === recipeId)
  if (mine.length >= 3) return { eff: avg(mine), n: mine.length, own: true }
  return turns.length ? { eff: avg(turns), n: turns.length, own: false } : null
}
