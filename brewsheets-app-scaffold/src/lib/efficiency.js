// Brewhouse efficiency from the Unleashed data (same figures as the Reports dashboard's
// Efficiency tab): each finished batch's litres packaged against litres in the fermenter.
import { supabase } from '../supabaseClient'
import { looseKey } from './beerColours'

// Same key the dashboard uses for a batch: batch number + beer code.
export const bkey = (b) => (b.bn + '__' + b.beer[0]).replace(/[^A-Za-z0-9_-]+/g, '-')

// Unleashed entries filed under the wrong batch number (can't be changed there): Unleashed key -> real batch number.
const ALIAS = { '396__FB-Drift-XPA': '395', '397__FB-ITP': '398' }

// Match an Unleashed beer code (e.g. FB-ITP, FB-Draught) to a brewsheets-app beer name (e.g. In The Pines, Draught).
const nbn = (x) => String(x).trim().replace(/^0+(?=\d)/, '')
const norm = (s) => String(s || '').toLowerCase().replace(/^fb-/, '').replace(/[^a-z0-9]/g, '')
const initials = (s) => String(s || '').toLowerCase().replace(/^fb-/, '').split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join('')
const sameBeer = (style, beer) => {
  const a = norm(style), b = norm(beer)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a) || initials(style) === b
}

// Turn the brewsheets-app litres (per batch number) into per-batch figures.
// If Unleashed has several different beers under one batch number, only the beer that matches the app's beer gets the litres.
export function appFermenterLitres(eff, rows, styles) {
  const byBn = {}
  for (const r of rows || []) byBn[nbn(r.batch_number)] = Number(r.fv_litres)
  const style = {}
  for (const r of styles || []) style[nbn(r.batch_number)] = r.beer_style
  const out = {}
  const groups = {}
  for (const b of eff) { const k = ALIAS[bkey(b)] || nbn(b.bn); (groups[k] = groups[k] || []).push(b) }
  for (const [bn, all] of Object.entries(groups)) {
    const fv = byBn[bn]
    if (!(fv > 0)) continue
    let list = all
    if (new Set(all.map((b) => b.beer[0])).size > 1) list = all.filter((b) => sameBeer(style[bn], b.beer[0]))
    const tot = list.reduce((s, b) => s + b.L, 0)
    if (!(tot > 0)) continue
    for (const b of list) out[bkey(b)] = Math.round(fv * (b.L / tot))
  }
  return out
}

// Unleashed beer codes the schedule knows by another name.
const CODE_ALIASES = { riverdog: 'wcipa' }
const codeKey = (code) => {
  const k = looseKey(String(code || '').replace(/^FB-/i, ''))
  return CODE_ALIASES[k] ?? k
}

const SMALL_L = 1500 // brews under this are left out, as on the dashboard
const dayShift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// Average overall efficiency (packaged L / fermenter L, weighted by litres) per beer over
// the last 12 months of finished batches. Fermenter litres as on the dashboard: typed in,
// else from the app's brew sheets, else the efficiency sheet, else rounded up.
// Returns effFor(name) -> { overall, n, code } or null.
export async function loadSkuEfficiency() {
  const [ds, fv, app, bs] = await Promise.all([
    supabase.from('unl_dataset').select('key, data').in('key', ['eff', 'meta']),
    supabase.from('eff_fv_litres').select('batch_key, source, litres'),
    supabase.from('app_batch_fv').select('batch_number, fv_litres'),
    supabase.from('batches').select('batch_number, beer_style'),
  ])
  if (ds.error) throw ds.error
  const m = Object.fromEntries((ds.data || []).map((r) => [r.key, r.data]))
  if (!m.eff || !m.meta) return () => null
  const OV = {}, SH = {}
  for (const r of fv.data || []) {
    if (r.source === 'manual') OV[r.batch_key] = Number(r.litres)
    else if (r.source === 'sheet') SH[r.batch_key] = Number(r.litres)
  }
  const AP = app.error ? {} : appFermenterLitres(m.eff, app.data, bs.data)
  const pulled = m.meta.pulled
  const from = dayShift(pulled, -365)
  const byBeer = new Map() // codeKey -> { pk, init, n, code }
  for (const b of m.eff) {
    const k = bkey(b)
    const init = OV[k] > 0 ? OV[k] : AP[k] > 0 ? AP[k] : SH[k] > 0 ? SH[k] : b.init
    const pr = b.L ? b.pk / b.L : 0
    const small = b.L < SMALL_L
    const inprog = b.done >= dayShift(pulled, -21) && pr < 0.9
    if (small || inprog || b.done < from || !(init > 0)) continue
    const key = codeKey(b.beer[0])
    const x = byBeer.get(key) ?? { pk: 0, init: 0, n: 0, code: b.beer[0] }
    x.pk += b.pk; x.init += init; x.n++
    byBeer.set(key, x)
  }
  return (name) => {
    const x = name ? byBeer.get(codeKey(name)) : null
    return x && x.n ? { overall: x.pk / x.init, n: x.n, code: x.code } : null
  }
}
