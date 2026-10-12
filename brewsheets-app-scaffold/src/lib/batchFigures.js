// Batch figures worked out from what's recorded elsewhere (Brew Day, Fermentation, Cellar,
// Packaging), so Batch Details never needs typing into.
import { abvTracker } from '../components/FermentationSection.jsx'

const n = (v) => (v == null || v === '' ? null : Number(v))

// Actual OG: each turn's KO gravity (°P), weighted by its knockout volume.
export function actualOg(batch) {
  const turns = (batch.brew_runs ?? []).filter((r) => n(r.whirlpool_gravity) != null)
  if (!turns.length) return null
  const weighted = turns.filter((r) => n(r.ko_flowmeter_l) > 0)
  if (weighted.length === turns.length) {
    const vol = weighted.reduce((a, r) => a + n(r.ko_flowmeter_l), 0)
    return weighted.reduce((a, r) => a + n(r.whirlpool_gravity) * n(r.ko_flowmeter_l), 0) / vol
  }
  return turns.reduce((a, r) => a + n(r.whirlpool_gravity), 0) / turns.length
}

// Actual FG: the latest fermentation reading with a gravity.
export function actualFg(batch) {
  const r = [...(batch.fermentation_readings ?? [])]
    .filter((x) => n(x.gravity_plato) != null)
    .sort((a, b) => (a.reading_date ?? '').localeCompare(b.reading_date ?? '') || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    .pop()
  return r ? { plato: n(r.gravity_plato), date: r.reading_date } : null
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
    yieldL: koVol || null,
    turnsDone: turns.filter((r) => r.knockout_confirmed_at).length,
    packed,
    packedLitres: packed.cubes * 6 + packed.kegs_50 * 50 + packed.kegs_30 * 30 + packed.kegs_20 * 20,
    packFrom: dates[0] ?? null,
    packTo: dates[dates.length - 1] ?? null,
  }
}
