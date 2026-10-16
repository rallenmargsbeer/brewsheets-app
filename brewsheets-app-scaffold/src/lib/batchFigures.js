// Batch figures worked out from what's recorded elsewhere (Brew Day, Fermentation, Cellar,
// Packaging), so Batch Details never needs typing into.
import { abvTracker } from '../components/FermentationSection.jsx'
import { blendGravity, gravityAfter } from './dilution'
import { tinsethIbu, moreySrm, byName } from './beerCalcs'

const n = (v) => (v == null || v === '' ? null : Number(v))

// Actual OG: an admin's override if set, else the turns' KO gravities blended by knockout
// volume, then diluted by any water added on the last turn.
export function actualOg(batch) {
  if (n(batch.og_override) != null) return n(batch.og_override)
  const turns = (batch.brew_runs ?? []).filter((r) => n(r.whirlpool_gravity) != null)
  if (!turns.length) return null
  const weighted = turns.every((r) => n(r.ko_flowmeter_l) > 0)
  if (!weighted) return turns.reduce((a, r) => a + n(r.whirlpool_gravity), 0) / turns.length
  const blend = blendGravity(turns.map((r) => ({ volumeL: n(r.ko_flowmeter_l), plato: n(r.whirlpool_gravity) })))
  return gravityAfter(blend.volumeL, blend.plato, dilutionWater(batch))
}

export const dilutionWater = (batch) => (batch.brew_runs ?? []).reduce((a, r) => a + (n(r.correction_l) ?? 0), 0)

// Actual FG: the latest fermentation reading with a gravity.
export function actualFg(batch) {
  const r = [...(batch.fermentation_readings ?? [])]
    .filter((x) => n(x.gravity_plato) != null)
    .sort((a, b) => (a.reading_date ?? '').localeCompare(b.reading_date ?? '') || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    .pop()
  return r ? { plato: n(r.gravity_plato), date: r.reading_date } : null
}

// Excise: the beer's ABV has to be within 0.2% of its target ABV.
export const ABV_TOLERANCE = 0.2
export function abvCheck(batch) {
  const og = actualOg(batch)
  const fg = actualFg(batch)
  const target = n(batch.recipes?.target_abv) ?? n(batch.target_abv)
  const abv = og != null && fg ? abvTracker(og, fg.plato) : null
  if (abv == null || target == null) return { abv, target, ok: null }
  const diff = abv - target
  return { abv, target, diff, ok: Math.abs(diff) <= ABV_TOLERANCE + 1e-9 }
}

// DAW (de-aerated water) dilutes down to the top of the excise range: target + 0.2%.
export const dawAim = (target) => Number(target) + ABV_TOLERANCE
export function dawLitres(beerL, abv, target) {
  const aim = dawAim(target)
  if (!(beerL > 0) || abv == null || !(target > 0) || abv <= aim) return 0
  return beerL * (abv / aim - 1)
}

// Knockout volume (plus any dilution water): the most beer the FV can hold, for a DAW estimate.
export const koLitres = (batch) => {
  const ko = (batch.brew_runs ?? []).reduce((a, r) => a + (n(r.ko_flowmeter_l) ?? 0), 0)
  return ko ? ko + dilutionWater(batch) : n(batch.brewhouse_yield_l)
}

export function batchFigures(batch, sessions = []) {
  const og = actualOg(batch)
  const fg = actualFg(batch)
  const recipe = batch.recipes ?? {}
  const turns = batch.brew_runs ?? []
  const koVol = turns.reduce((a, r) => a + (n(r.ko_flowmeter_l) ?? 0), 0)
  const packed = sessions.reduce(
    (t, s) => ({ cubes: t.cubes + (n(s.cubes) ?? 0), kegs_50: t.kegs_50 + (n(s.kegs_50) ?? 0), kegs_30: t.kegs_30 + (n(s.kegs_30) ?? 0), kegs_20: t.kegs_20 + (n(s.kegs_20) ?? 0) }),
    { cubes: 0, kegs_50: 0, kegs_30: 0, kegs_20: 0 }
  )
  const dates = sessions.map((s) => s.package_date).filter(Boolean).sort()
  return {
    og,
    fg,
    abv: og != null && fg ? abvTracker(og, fg.plato) : null,
    targetOg: n(recipe.target_og),
    targetFg: n(recipe.target_fg),
    targetAbv: n(recipe.target_abv),
    yieldL: koVol ? koVol + dilutionWater(batch) : null,
    dilutionL: dilutionWater(batch) || null,
    turnsDone: turns.filter((r) => r.knockout_confirmed_at).length,
    packed,
    packedLitres: packed.cubes * 6 + packed.kegs_50 * 50 + packed.kegs_30 * 30 + packed.kegs_20 * 20,
    packFrom: dates[0] ?? null,
    packTo: dates[dates.length - 1] ?? null,
  }
}

// Estimated IBU and SRM for the batch from what actually went in on Brew Day. IBU is worked
// out per turn (its own hops, post-boil gravity and volume), blended by volume and thinned by
// dilution water; SRM uses all turns' grist over the final volume.
export function batchIbuSrm(batch, ingredients) {
  const alpha = byName(ingredients, 'alpha_acid_pct')
  const colour = byName(ingredients, 'color_lovibond')
  const turns = batch.brew_runs ?? []
  const qty = (i) => n(i.actual_qty) ?? n(i.planned_qty) ?? 0
  let ibuVol = 0, ibuSum = 0
  for (const r of turns) {
    const items = r.brew_run_ingredients ?? []
    const hops = items
      .filter((i) => i.section === 'kettle' || i.section === 'whirlpool')
      .map((i) => ({ grams: qty(i), alphaPct: alpha.get(i.item_name), minutes: i.time_min }))
    const ibu = tinsethIbu(hops, r.postboil_gravity, n(r.postboil_volume_l))
    const vol = n(r.ko_flowmeter_l) ?? n(r.postboil_volume_l)
    if (ibu != null && vol) { ibuSum += ibu * vol; ibuVol += vol }
  }
  const water = dilutionWater(batch)
  const ibu = ibuVol ? (ibuSum / ibuVol) * (ibuVol / (ibuVol + water)) : null
  const koVol = turns.reduce((a, r) => a + (n(r.ko_flowmeter_l) ?? 0), 0)
  const finalVol = koVol ? koVol + water : n(batch.target_volume_l)
  const malts = turns.flatMap((r) => (r.brew_run_ingredients ?? []).filter((i) => i.section === 'grist').map((i) => ({ grams: qty(i), lovibond: colour.get(i.item_name) })))
  return { ibu, srm: moreySrm(malts, finalVol) }
}
