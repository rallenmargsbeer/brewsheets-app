// Sales forecast (entered by hand, cubes and 50 L kegs per beer per month) and the brew plan
// built from it: stock now + beer in tanks + brews on the schedule, against forecast demand and
// minimum stock.
import { supabase } from '../supabaseClient'
import { listTanks } from './api'
import { addDays, todayIso, listScheduleEntries, listCellarTemplates, listBookings } from './schedule'
import { assignBeers, beerKey } from './beerColours'
import { beerMatch } from './incoming'

export const CUBE_L = 6 // 16 x 375 mL
export const KEG_L = 50
// Packaged litres per litre in an FV (losses from tank to package), as in the forecast sheet.
export const YIELD = 0.8
// Brew day to packaged, roughly: brew this long before stock would drop below minimum.
export const LEAD_DAYS = 21

export const monthOf = (iso) => `${iso.slice(0, 7)}-01`
export function addMonths(monthIso, n) {
  const [y, m] = monthIso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)
}
export const daysInMonth = (monthIso) => {
  const [y, m] = monthIso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export async function loadForecast() {
  const [f, m] = await Promise.all([
    supabase.from('stock_forecast').select('beer, format, month, qty'),
    supabase.from('stock_min').select('beer, format, qty'),
  ])
  if (f.error) throw f.error
  if (m.error) throw m.error
  return { rows: f.data, mins: m.data }
}

export async function saveForecast(beer, format, month, qty) {
  const { error } = await supabase.from('stock_forecast').upsert({ beer, format, month, qty, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function saveMin(beer, format, qty) {
  const { error } = await supabase.from('stock_min').upsert({ beer, format, qty, updated_at: new Date().toISOString() })
  if (error) throw error
}

// Lookups by beer (matched loosely, "Pale" = "Pale Ale") and format.
export function forecastIndex({ rows, mins }) {
  const qty = new Map() // "beer|format|month" -> qty
  const beers = new Map() // match key -> display name
  for (const r of rows) {
    qty.set(`${beerMatch(r.beer)}|${r.format}|${r.month}`, Number(r.qty))
    if (Number(r.qty)) beers.set(beerMatch(r.beer), r.beer)
  }
  const min = new Map(mins.map((r) => [`${beerMatch(r.beer)}|${r.format}`, Number(r.qty)]))
  const month = (beer, format, monthIso) => qty.get(`${beerMatch(beer)}|${format}|${monthIso}`) ?? 0
  return {
    beers: [...beers.values()],
    has: (beer) => beers.has(beerMatch(beer)),
    month,
    // Forecast units a day on a given date (the month's figure spread over its days).
    perDay: (beer, format, iso) => month(beer, format, monthOf(iso)) / daysInMonth(iso),
    min: (beer, format) => min.get(`${beerMatch(beer)}|${format}`) ?? 0,
  }
}

// Brews on the schedule, per FV stay: in a tank now, or booked to brew. Beer already filtered
// into a bright tank counts too. Litres are the batch size written on the brew cell
// ("8 Ball 1500L") or the FV's capacity.
export async function loadBrews({ days = 200, today = todayIso() } = {}) {
  const from = addDays(today, -75)
  const [entries, templates, bookings, tanks] = await Promise.all([
    listScheduleEntries(from, addDays(today, days)),
    listCellarTemplates(),
    listBookings({ fromIso: addDays(from, -30) }),
    listTanks(),
  ])
  const bookingBeer = Object.fromEntries(bookings.map((b) => [b.id, b.beer_name]))
  const { runs } = assignBeers(entries, { knownBeers: templates.map((t) => t.name), bookingBeer })
  const dateOf = (k) => k.split('|')[0]

  // Batch size from brew cells naming the beer on the day the stay starts (or the day before).
  const sizeOn = (beer, date) => {
    for (const e of entries) {
      if (!/^brew_/.test(e.lane) || (e.entry_date !== date && e.entry_date !== addDays(date, -1))) continue
      const l = /(\d{3,5})\s*l\b/i.exec(e.text)
      if (l && beerKey(e.text.replace(l[0], '')) === beerKey(beer)) return Number(l[1])
    }
    return null
  }

  const fvs = tanks.filter((t) => t.tank_type === 'FV' && Number(t.capacity_l) >= 1000)
  const out = []
  const filtered = [] // closed FV stays: { beer, end, litres }, to size what's in bright tanks
  for (const t of fvs) {
    for (const r of runs.get(t.id) ?? []) {
      const start = dateOf(r.start)
      const end = dateOf(r.end)
      const litres = sizeOn(r.beer, start) ?? Number(t.capacity_l)
      if (!r.open) filtered.push({ beer: r.beer, end, litres })
      // Stays that ended before today have been filtered already (and count in their bright tank).
      if (end < today) continue
      out.push({ beer: r.beer, tank: `FV ${t.name}`, status: start <= today ? 'tank' : 'booked', start, ready: addDays(end, 1), litres })
    }
  }
  for (const t of tanks.filter((x) => x.tank_type === 'BBT')) {
    for (const r of runs.get(t.id) ?? []) {
      const start = dateOf(r.start)
      const end = dateOf(r.end)
      if (start > today || end < today) continue
      const from = filtered.filter((f) => f.beer === r.beer && f.end <= start && f.end >= addDays(start, -3)).sort((a, b) => b.end.localeCompare(a.end))[0]
      // Filtered today or later: still counted with its FV.
      if (from && from.end >= today) continue
      out.push({ beer: r.beer, tank: t.name, status: 'tank', start, ready: end, litres: from?.litres ?? Number(t.capacity_l) })
    }
  }
  return out.map((b) => ({ ...b, packaged: b.litres * YIELD })).sort((a, b) => a.ready.localeCompare(b.ready))
}

// One line per forecast beer over the next `months` months, in packaged litres:
// stock now, plus beer coming out of tanks and booked brews on their ready day, less forecast
// demand day by day, kept above minimum stock.
export function brewPlan({ stock, fc, brews, months = 3, today = todayIso() }) {
  const end = addDays(today, Math.round(months * 30.44))
  const stockOf = new Map()
  for (const [beer, s] of stock) {
    const k = beerMatch(beer)
    const cur = stockOf.get(k) ?? { cubes: 0, kegs: 0, smallKegL: 0 }
    stockOf.set(k, { cubes: cur.cubes + s.cubes, kegs: cur.kegs + s.kegs, smallKegL: cur.smallKegL + s.smallKegL })
  }
  return fc.beers.map((beer) => {
    const k = beerMatch(beer)
    const s = stockOf.get(k) ?? { cubes: 0, kegs: 0, smallKegL: 0 }
    const stockL = Math.max(0, s.cubes) * CUBE_L + Math.max(0, s.kegs) * KEG_L + Math.max(0, s.smallKegL)
    const minC = fc.min(beer, 'cube')
    const minK = fc.min(beer, 'keg')
    const minL = minC * CUBE_L + minK * KEG_L
    const mine = brews.filter((b) => beerMatch(b.beer) === k && b.ready <= end)
    const inTank = mine.filter((b) => b.status === 'tank')
    const booked = mine.filter((b) => b.status === 'booked')
    const supply = new Map()
    for (const b of mine) supply.set(b.ready < today ? today : b.ready, (supply.get(b.ready < today ? today : b.ready) ?? 0) + b.packaged)

    let level = stockL
    let demandC = 0
    let demandK = 0
    let worst = 0
    let belowMin = null
    let runsOut = null
    for (let d = today; d < end; d = addDays(d, 1)) {
      level += supply.get(d) ?? 0
      const c = fc.perDay(beer, 'cube', d)
      const g = fc.perDay(beer, 'keg', d)
      demandC += c
      demandK += g
      level -= c * CUBE_L + g * KEG_L
      worst = Math.max(worst, minL - level)
      if (level < minL && !belowMin) belowMin = d
      if (level < 0 && !runsOut) runsOut = d
    }
    const brewL = worst > 0 ? worst / YIELD : 0
    return {
      beer,
      stock: s,
      stockL,
      minC,
      minK,
      minL,
      demandC,
      demandK,
      demandL: demandC * CUBE_L + demandK * KEG_L,
      inTank,
      booked,
      inTankL: inTank.reduce((a, b) => a + b.packaged, 0),
      bookedL: booked.reduce((a, b) => a + b.packaged, 0),
      endL: level,
      brewL,
      belowMin,
      runsOut,
      brewBy: belowMin ? (addDays(belowMin, -LEAD_DAYS) < today ? today : addDays(belowMin, -LEAD_DAYS)) : null,
    }
  }).sort((a, b) => (a.brewBy ?? '9999').localeCompare(b.brewBy ?? '9999') || b.brewL - a.brewL || a.beer.localeCompare(b.beer))
}
