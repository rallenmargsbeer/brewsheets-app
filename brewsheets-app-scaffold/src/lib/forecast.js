// Sales forecast (entered by hand, cubes and 50 L kegs per beer per month) and the brew plan
// built from it: stock now + beer in tanks + brews on the schedule, against forecast demand and
// minimum stock.
import { supabase } from '../supabaseClient'
import { listTanks } from './api'
import { addDays, daysBetween, todayIso, listScheduleEntries, listCellarTemplates, listBookings } from './schedule'
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

// Shared planning settings (brew_settings): stock to hold, in weeks of forecast sales, and
// how much the brewhouse can brew in a month.
export const DEFAULT_COVER_WEEKS = 6
export const DEFAULT_CAPACITY_L = 125000
export const SETTING = { coverWeeks: 'stock_cover_weeks', capacityL: 'brewhouse_month_l' }

export async function loadForecast() {
  const [f, s] = await Promise.all([
    supabase.from('stock_forecast').select('beer, format, month, qty'),
    supabase.from('brew_settings').select('key, value').in('key', Object.values(SETTING)),
  ])
  if (f.error) throw f.error
  const val = (k) => Number(s.data?.find((r) => r.key === k)?.value) || null
  return {
    rows: f.data,
    coverWeeks: val(SETTING.coverWeeks) ?? DEFAULT_COVER_WEEKS,
    capacityL: val(SETTING.capacityL) ?? DEFAULT_CAPACITY_L,
  }
}

export async function saveSetting(name, value) {
  const { error } = await supabase.from('brew_settings').upsert({ key: SETTING[name], value, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function saveForecast(beer, format, month, qty) {
  const { error } = await supabase.from('stock_forecast').upsert({ beer, format, month, qty, updated_at: new Date().toISOString() })
  if (error) throw error
}

// Lookups by beer (matched loosely, "Pale" = "Pale Ale") and format.
export function forecastIndex({ rows, coverWeeks = DEFAULT_COVER_WEEKS }) {
  const qty = new Map() // "beer|format|month" -> qty
  const beers = new Map() // match key -> display name
  for (const r of rows) {
    qty.set(`${beerMatch(r.beer)}|${r.format}|${r.month}`, Number(r.qty))
    if (Number(r.qty)) beers.set(beerMatch(r.beer), r.beer)
  }
  const month = (beer, format, monthIso) => qty.get(`${beerMatch(beer)}|${format}|${monthIso}`) ?? 0
  const perDay = (beer, format, iso) => month(beer, format, monthOf(iso)) / daysInMonth(iso)
  return {
    coverWeeks,
    beers: [...beers.values()],
    has: (beer) => beers.has(beerMatch(beer)),
    month,
    // Forecast units a day on a given date (the month's figure spread over its days).
    perDay,
    // Stock to hold on a date: forecast sales over the next `coverWeeks` weeks.
    target: (beer, format, iso) => {
      let t = 0
      for (let i = 0; i < coverWeeks * 7; i++) t += perDay(beer, format, addDays(iso, i))
      return t
    },
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
// demand day by day, kept above the target (the next `fc.coverWeeks` weeks of forecast sales).
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
    const minC = fc.target(beer, 'cube', today)
    const minK = fc.target(beer, 'keg', today)
    const minL = minC * CUBE_L + minK * KEG_L
    // Daily demand in litres from today to the end of the period plus the cover window,
    // so the rolling target can be read off for every day of the period.
    const coverDays = fc.coverWeeks * 7
    const days = daysBetween(today, end)
    const daily = []
    for (let i = 0; i < days + coverDays; i++) {
      const d = addDays(today, i)
      daily.push(fc.perDay(beer, 'cube', d) * CUBE_L + fc.perDay(beer, 'keg', d) * KEG_L)
    }
    let window = daily.slice(0, coverDays).reduce((a, x) => a + x, 0)
    // Brewhouse litres still to brew, by the month they need brewing in (brew-by month).
    const needByMonth = new Map()
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
    for (let i = 0, d = today; i < days; i++, d = addDays(d, 1)) {
      // Stock held this morning (after today's packaging) against the next weeks' sales.
      level += supply.get(d) ?? 0
      if (window - level > worst) {
        const by = addDays(d, -LEAD_DAYS) < today ? today : addDays(d, -LEAD_DAYS)
        needByMonth.set(monthOf(by), (needByMonth.get(monthOf(by)) ?? 0) + (window - level - worst) / YIELD)
        worst = window - level
      }
      if (level < window && !belowMin) belowMin = d
      demandC += fc.perDay(beer, 'cube', d)
      demandK += fc.perDay(beer, 'keg', d)
      level -= daily[i]
      if (level < 0 && !runsOut) runsOut = d
      window += daily[i + coverDays] - daily[i]
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
      needByMonth,
      belowMin,
      runsOut,
      brewBy: belowMin ? (addDays(belowMin, -LEAD_DAYS) < today ? today : addDays(belowMin, -LEAD_DAYS)) : null,
    }
  }).sort((a, b) => (a.brewBy ?? '9999').localeCompare(b.brewBy ?? '9999') || b.brewL - a.brewL || a.beer.localeCompare(b.beer))
}

// How far ahead the brewhouse plan looks for busy months, whatever period is on screen.
export const LOOKAHEAD_MONTHS = 12

// Brewing by month within the brewhouse limit. `plan` must reach LOOKAHEAD_MONTHS ahead.
// Works back from the furthest month: whatever a month needs beyond the limit (after brews
// already booked) has to be brewed in earlier months and held as stock. Anything that still
// doesn't fit by this month is `short`: too late even brewing at the limit from now.
export function levelBrewing({ plan, brews, capacityL = DEFAULT_CAPACITY_L, today = todayIso() }) {
  const sum = (m) => [...m.values()].reduce((a, x) => a + x, 0)
  const first = monthOf(today)
  const lastNeed = plan.reduce((a, r) => [...r.needByMonth].reduce((b, [m, l]) => (l > 1 && m > b ? m : b), a), first)
  const months = []
  for (let i = 0; i < LOOKAHEAD_MONTHS; i++) {
    const m = addMonths(first, i)
    const next = addMonths(m, 1)
    const booked = brews.filter((b) => b.status === 'booked' && b.start >= m && b.start < next).reduce((a, b) => a + b.litres, 0)
    if (m > lastNeed && !booked) break
    // This month only has the days left in it.
    const capacity = i === 0 ? (capacityL * daysBetween(today, next)) / daysInMonth(m) : capacityL
    const need = new Map(plan.map((r) => [r.beer, r.needByMonth.get(m) ?? 0]))
    months.push({ month: m, capacity, booked, need, needed: sum(need) })
  }
  const carry = new Map()
  for (let i = months.length - 1; i >= 0; i--) {
    const row = months[i]
    const want = new Map(plan.map((r) => [r.beer, (row.need.get(r.beer) ?? 0) + (carry.get(r.beer) ?? 0)]))
    const total = sum(want)
    const room = Math.max(0, row.capacity - row.booked)
    const f = total > room ? room / total : 1
    row.brew = new Map([...want].map(([b, w]) => [b, w * f]))
    for (const [b, w] of want) carry.set(b, w * (1 - f))
    row.planned = total * f
    row.early = Math.max(0, row.planned - row.needed) // brewed now for later, busier months
    // Over the limit: brewed in an earlier month, or for this month, too late to brew at all.
    row.movedEarlier = i > 0 ? Math.max(0, row.needed - row.planned) : 0
    row.total = row.booked + row.planned
    row.spare = row.capacity - row.total
  }
  if (months.length) months[0].tooLate = sum(carry)
  return { months, short: sum(carry), shortByBeer: carry }
}

// The on-screen plan with brewing levelled to the brewhouse limit: brew more includes beer
// that has to be brewed early for later busy months, and brew by moves forward to match.
export function applyLevelling(plan, levelled, { months = 3, today = todayIso() } = {}) {
  const end = addDays(today, Math.round(months * 30.44))
  const inView = levelled.months.filter((m) => m.month < end)
  return plan.map((r) => {
    const plannedL = inView.reduce((a, m) => a + (m.brew.get(r.beer) ?? 0), 0)
    const firstMonth = inView.find((m) => (m.brew.get(r.beer) ?? 0) > 1)?.month
    let brewBy = r.brewBy
    if (firstMonth && (!brewBy || monthOf(brewBy) > firstMonth)) brewBy = firstMonth < today ? today : firstMonth
    return {
      ...r,
      unlevelledL: r.brewL,
      brewL: Math.max(plannedL, 0),
      earlyL: Math.max(0, plannedL - r.brewL),
      brewBy: plannedL > 1 ? brewBy : null,
      shortL: levelled.shortByBeer.get(r.beer) ?? 0,
    }
  }).sort((a, b) => (a.brewBy ?? '9999').localeCompare(b.brewBy ?? '9999') || b.brewL - a.brewL || a.beer.localeCompare(b.beer))
}
