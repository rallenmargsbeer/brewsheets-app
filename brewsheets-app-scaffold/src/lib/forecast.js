// Sales forecast (entered by hand, cubes and 50 L kegs per beer per month) and the brew plan
// built from it: stock now + beer in tanks + brews on the schedule, against forecast demand and
// minimum stock.
import { supabase } from '../supabaseClient'
import { listTanks } from './api'
import { addDays, daysBetween, todayIso, listScheduleEntries, listCellarTemplates, listBookings, stepsForTank, isWeekend, BREW_LANES } from './schedule'
import { assignBeers, beerKey, looseKey } from './beerColours'
import { beerMatch } from './incoming'

export const CUBE_L = 6 // 16 x 375 mL
export const KEG_L = 50
// Packaged litres per litre in an FV when a beer has no efficiency figures of its own.
export const YIELD = 0.8
// Brew day to packaged when a beer has no cellar template.
export const LEAD_DAYS = 21
// The brewhouse does at most this many 2,500 L turns a day.
export const TURNS_PER_DAY = 3
export const TURN_L = 2500

// When the brewhouse can't keep up, these get brewed first, in this order; the rest share
// what's left.
export const PRIORITY = ['In The Pines', 'Mermid', 'Kolsch', 'Megsy', 'Riverdog', 'Drift']
export const priorityOf = (beer) => {
  const i = PRIORITY.findIndex((p) => beerMatch(p) === beerMatch(beer))
  return i < 0 ? PRIORITY.length : i
}

// Beers made outside the brewhouse. Megsy (ginger beer RTD) is mixed in a bright tank in a
// day: no brewhouse capacity, no brewhouse loss, a day or two of lead time.
const MIXED = { megsy: { leadDays: 2, yield: 1 } }
// Each beer's real overall efficiency (packaged / fermenter litres, from Unleashed) and its
// days in an FV (cellar template, brew day to Filter), once loaded (setBeerProfiles).
let profiles = { yieldOf: () => null, fvDaysOf: () => null }
export function setBeerProfiles(p) {
  profiles = { ...profiles, ...p }
}
export const profileOf = (beer) => {
  const m = MIXED[beerMatch(beer)]
  const y = profiles.yieldOf(beer)
  if (m) return { ...m, yield: y ?? m.yield, brewhouse: false, fvDays: 0 }
  const fv = profiles.fvDaysOf(beer)
  // Ready (packaged) the day after Filter.
  return { leadDays: fv ? fv + 1 : LEAD_DAYS, yield: y ?? YIELD, brewhouse: true, fvDays: fv ?? 13 }
}

// Days a beer spends in an FV, from its cellar template (Filter's day; FV7 / FV8 can differ).
// Beers without a template use the Specialty one.
export function fvDaysFrom(templates) {
  const find = (beer) => templates.find((t) => looseKey(t.name) === looseKey(beer)) ?? templates.find((t) => /specialty/i.test(t.name))
  return (beer, tank = null) => {
    const t = find(beer)
    const f = t && stepsForTank(t, tank ?? { name: '' }).find((x) => /^filter\b/i.test(x.task.trim()))
    return f ? Number(f.day) : null
  }
}

const byUrgency = (a, b) => (a.brewBy ?? '9999').localeCompare(b.brewBy ?? '9999') || a.priority - b.priority || b.brewL - a.brewL || a.beer.localeCompare(b.beer)

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
export async function loadBrews(opts) {
  return (await loadPlanning(opts)).brews
}

// The brews (as loadBrews) plus what the brews-to-book planner needs: the FVs, when each is
// taken (stays on the schedule), brewhouse turns already used per day, and FV days per beer.
export async function loadPlanning({ days = 400, today = todayIso() } = {}) {
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
  const busy = []
  for (const t of fvs) {
    for (const r of runs.get(t.id) ?? []) {
      if (dateOf(r.end) >= today) busy.push({ tankId: t.id, from: dateOf(r.start), to: dateOf(r.end) })
    }
  }
  const turns = new Map()
  for (const e of entries) if (BREW_LANES.includes(e.lane) && (e.text ?? '').trim()) turns.set(e.entry_date, (turns.get(e.entry_date) ?? 0) + 1)
  return {
    brews: out.map((b) => ({ ...b, packaged: b.litres * profileOf(b.beer).yield })).sort((a, b) => a.ready.localeCompare(b.ready)),
    fvs: fvs.map((t) => ({ id: t.id, name: t.name, capacity: Number(t.capacity_l) })),
    busy,
    turns,
    fvDaysOf: fvDaysFrom(templates),
  }
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
    const { leadDays, yield: yld, brewhouse } = profileOf(beer)
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
        const by = addDays(d, -leadDays) < today ? today : addDays(d, -leadDays)
        needByMonth.set(monthOf(by), (needByMonth.get(monthOf(by)) ?? 0) + (window - level - worst) / yld)
        worst = window - level
      }
      if (level < window && !belowMin) belowMin = d
      demandC += fc.perDay(beer, 'cube', d)
      demandK += fc.perDay(beer, 'keg', d)
      level -= daily[i]
      if (level < 0 && !runsOut) runsOut = d
      window += daily[i + coverDays] - daily[i]
    }
    const brewL = worst > 0 ? worst / yld : 0
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
      brewBy: belowMin ? (addDays(belowMin, -leadDays) < today ? today : addDays(belowMin, -leadDays)) : null,
      brewhouse,
      priority: priorityOf(beer),
    }
  }).sort(byUrgency)
}

// How far ahead the brewhouse plan looks for busy months, whatever period is on screen.
export const LOOKAHEAD_MONTHS = 12

// Brewing by month within the brewhouse limit. `plan` must reach LOOKAHEAD_MONTHS ahead.
// Works back from the furthest month: whatever a month needs beyond the limit (after brews
// already booked) has to be brewed in earlier months and held as stock. Anything that still
// doesn't fit by this month is `short`: too late even brewing at the limit from now.
export function levelBrewing({ plan: all, brews, capacityL = DEFAULT_CAPACITY_L, today = todayIso() }) {
  const sum = (m) => [...m.values()].reduce((a, x) => a + x, 0)
  // Mixed beers (Megsy) don't use the brewhouse.
  const plan = all.filter((r) => r.brewhouse).sort((a, b) => a.priority - b.priority)
  const first = monthOf(today)
  const lastNeed = plan.reduce((a, r) => [...r.needByMonth].reduce((b, [m, l]) => (l > 1 && m > b ? m : b), a), first)
  const months = []
  for (let i = 0; i < LOOKAHEAD_MONTHS; i++) {
    const m = addMonths(first, i)
    const next = addMonths(m, 1)
    const booked = brews.filter((b) => b.status === 'booked' && b.start >= m && b.start < next && profileOf(b.beer).brewhouse).reduce((a, b) => a + b.litres, 0)
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
    // Fill the month in priority order; the unlisted beers share what's left. What doesn't
    // fit moves to the month before (or, this month, is too late).
    let room = Math.max(0, row.capacity - row.booked)
    row.brew = new Map()
    for (const r of plan.filter((x) => x.priority < PRIORITY.length)) {
      const take = Math.min(want.get(r.beer), room)
      row.brew.set(r.beer, take)
      room -= take
    }
    const rest = plan.filter((r) => r.priority >= PRIORITY.length)
    const restWant = rest.reduce((a, r) => a + want.get(r.beer), 0)
    const f = restWant > room ? room / restWant : 1
    for (const r of rest) row.brew.set(r.beer, want.get(r.beer) * f)
    for (const [b, w] of want) carry.set(b, w - row.brew.get(b))
    row.planned = sum(row.brew)
    row.early = Math.max(0, row.planned - row.needed) // brewed now for later, busier months (before catch-up)
    // Over the limit: brewed in an earlier month, or for this month, too late to brew at all.
    row.movedEarlier = i > 0 ? Math.max(0, row.needed - row.planned) : 0
  }
  // What couldn't be brewed in time is caught up in the first months with spare capacity,
  // in priority order (stock dips under the goal until then).
  const late = new Map(carry)
  for (const row of months) {
    let room = Math.max(0, row.capacity - row.booked - row.planned)
    row.catchUp = 0
    for (const r of plan) {
      const l = late.get(r.beer) ?? 0
      if (l <= 0 || room <= 0) continue
      const take = Math.min(l, room)
      row.brew.set(r.beer, row.brew.get(r.beer) + take)
      late.set(r.beer, l - take)
      room -= take
      row.catchUp += take
    }
    row.planned += row.catchUp
    row.total = row.booked + row.planned
    row.spare = row.capacity - row.total
  }
  if (months.length) months[0].tooLate = sum(carry)
  // shortByBeer: brewed late (stock dips under the goal); never: doesn't fit at all.
  return { months, short: sum(carry), shortByBeer: carry, never: sum(late) }
}

// The on-screen plan with brewing levelled to the brewhouse limit: brew more includes beer
// that has to be brewed early for later busy months, and brew by moves forward to match.
export function applyLevelling(plan, levelled, { months = 3, today = todayIso() } = {}) {
  const end = addDays(today, Math.round(months * 30.44))
  // A month only partly in the period counts for the share of its days that are in it
  // (the current month from today), so "next month" isn't all of this month and next.
  const share = (m) => {
    const from = m.month < today ? today : m.month
    const next = addMonths(m.month, 1)
    const to = next < end ? next : end
    const total = daysBetween(from, next)
    return total > 0 ? Math.max(0, daysBetween(from, to)) / total : 0
  }
  const inView = levelled.months.filter((m) => m.month < end).map((m) => ({ ...m, share: share(m) }))
  return plan.map((r) => {
    // Mixed beers aren't levelled: they're made when needed.
    if (!r.brewhouse) return { ...r, unlevelledL: r.brewL, earlyL: 0, shortL: 0 }
    const plannedL = inView.reduce((a, m) => a + (m.brew.get(r.beer) ?? 0) * m.share, 0)
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
  }).sort(byUrgency)
}

// Suggested cubes / kegs split for a batch packaged on `packDate`, from the forecast:
// each format's shortfall against the stock goal (the next coverWeeks of sales) on pack
// day, after selling from today's stock until then; with no shortfall, the forecast mix.
// Returns null when the beer has no forecast.
export function suggestPackSplit({ fc, stock, beer, packDate, packagedL, today = todayIso() }) {
  if (!fc?.has(beer) || !(packagedL > 0)) return null
  const k = beerMatch(beer)
  let s = { cubes: 0, kegs: 0 }
  for (const [name, v] of stock) if (beerMatch(name) === k) s = { cubes: s.cubes + v.cubes, kegs: s.kegs + v.kegs }
  const until = (format, from, to) => {
    let t = 0
    for (let d = from; d < to; d = addDays(d, 1)) t += fc.perDay(beer, format, d)
    return t
  }
  const start = packDate > today ? packDate : today
  const line = (format, have, perUnit) => {
    const atPack = have - until(format, today, start)
    const goal = fc.target(beer, format, start)
    return { atPack, goal, needL: Math.max(0, goal - atPack) * perUnit, demandL: goal * perUnit }
  }
  const c = line('cube', Math.max(0, s.cubes), CUBE_L)
  const g = line('keg', Math.max(0, s.kegs), KEG_L)
  const byNeed = c.needL + g.needL > 0
  const cubeShare = byNeed ? c.needL / (c.needL + g.needL) : c.demandL + g.demandL > 0 ? c.demandL / (c.demandL + g.demandL) : 0.5
  return { cubeShare, byNeed, cube: c, keg: g, cubesL: packagedL * cubeShare, kegsL: packagedL * (1 - cubeShare) }
}

// ---- Brews to book ----
// The plan as separate brews, each with a brew day and an FV: each beer's stock is run forward
// day by day (as in brewPlan) and a brew is added whenever stock would drop under the goal,
// due its lead time (FV days + 1) before. Then each brew is fitted to the real schedule, highest
// priority beer first: a weekday with brewhouse turns free (TURNS_PER_DAY a day; a big batch
// is filled over two days) and an FV big enough that's empty from brew day until Filter. It
// goes on the latest such day by its due date, or if there's none, the first day there is
// (late), with a suggested swap: a lower priority brew already booked earlier that could move
// to the later slot without its own stock dropping under the goal.

// Usual batch: 10,000 L for the big sellers, 7,500 L or 5,000 L for the rest; Megsy mixes
// in a 5,000 L bright tank.
export function batchSizeFor(beer, monthlyL) {
  if (!profileOf(beer).brewhouse) return 5000
  return monthlyL >= 20000 ? 10000 : monthlyL >= 9000 ? 7500 : 5000
}

// Latest working day on or before a date (Friday for a weekend).
function workdayOnOrBefore(iso) {
  let d = iso
  while (isWeekend(d)) d = addDays(d, -1)
  return d
}

export function brewsToBook({ stock, fc, brews, fvs = [], busy = [], turns = new Map(), fvDaysOf = () => null, belowMin = new Map(), months = LOOKAHEAD_MONTHS, today = todayIso() }) {
  const days = Math.round(months * 30.44)
  const coverDays = fc.coverWeeks * 7
  const stockOf = new Map()
  for (const [beer, s] of stock) {
    const k = beerMatch(beer)
    const cur = stockOf.get(k) ?? { cubes: 0, kegs: 0, smallKegL: 0 }
    stockOf.set(k, { cubes: cur.cubes + s.cubes, kegs: cur.kegs + s.kegs, smallKegL: cur.smallKegL + s.smallKegL })
  }
  const list = []
  for (const beer of fc.beers) {
    const k = beerMatch(beer)
    const { leadDays, yield: yld, brewhouse } = profileOf(beer)
    // Mixed beers (Megsy) are made ad hoc, not booked ahead.
    if (!brewhouse) continue
    const s = stockOf.get(k) ?? { cubes: 0, kegs: 0, smallKegL: 0 }
    const daily = []
    for (let i = 0; i < days + coverDays; i++) {
      const d = addDays(today, i)
      daily.push(fc.perDay(beer, 'cube', d) * CUBE_L + fc.perDay(beer, 'keg', d) * KEG_L)
    }
    // Batch size from the next three months' brewhouse litres a month.
    const monthlyL = (daily.slice(0, 91).reduce((a, x) => a + x, 0) / 3) / yld
    const size = batchSizeFor(beer, monthlyL)
    const supply = new Map()
    for (const b of brews.filter((x) => beerMatch(x.beer) === k)) {
      const d = b.ready < today ? today : b.ready
      supply.set(d, (supply.get(d) ?? 0) + b.packaged)
    }
    let level = Math.max(0, s.cubes) * CUBE_L + Math.max(0, s.kegs) * KEG_L + Math.max(0, s.smallKegL)
    let window = daily.slice(0, coverDays).reduce((a, x) => a + x, 0)
    for (let i = 0, d = today; i < days; i++, d = addDays(d, 1)) {
      level += supply.get(d) ?? 0
      while (window - level > 1) {
        const by = addDays(d, -leadDays)
        list.push({ beer, size, brewhouse, leadDays, priority: priorityOf(beer), neededFor: d, brewBy: by < today ? today : by, late: by < today, early: false })
        level += size * yld
      }
      level -= daily[i]
      window += daily[i + coverDays] - daily[i]
    }
  }

  // ---- Fit the brewhouse brews to the schedule ----
  const used = new Map(turns) // date -> turns used
  const taken = busy.map((b) => ({ ...b })) // { tankId, from, to }
  const horizon = addDays(today, days + 60)
  const free = (tankId, from, to) => !taken.some((b) => b.tankId === tankId && b.from <= to && b.to >= from)
  // Brew days for `n` turns starting on d: [{ date, turns }], or null when the first day is full.
  const fill = (d, n) => {
    const out = []
    let left = n
    let day = d
    for (let guard = 0; left > 0 && guard < 5; guard++) {
      const room = TURNS_PER_DAY - (used.get(day) ?? 0)
      if (room > 0) { const t = Math.min(room, left); out.push({ date: day, turns: t }); left -= t }
      else if (!out.length) return null
      do day = addDays(day, 1); while (isWeekend(day))
    }
    return left > 0 || out.length > 2 ? null : out
  }
  // A way to brew x starting on d: its brew days and an FV, smallest that fits.
  const slotOn = (x, d) => {
    if (isWeekend(d)) return null
    const plan = fill(d, Math.ceil(x.size / TURN_L))
    if (!plan) return null
    const last = plan[plan.length - 1].date
    for (const t of fvs.filter((f) => f.capacity >= x.size).sort((p, q) => p.capacity - q.capacity)) {
      const stay = fvDaysOf(x.beer, t) ?? profileOf(x.beer).fvDays
      const to = addDays(last, stay - 1)
      if (free(t.id, d, to)) return { plan, tank: t, to, ready: addDays(to, 1) }
    }
    return null
  }
  const take = (x, d, slot, late) => {
    for (const p of slot.plan) used.set(p.date, (used.get(p.date) ?? 0) + p.turns)
    taken.push({ tankId: slot.tank.id, from: d, to: slot.to })
    Object.assign(x, { bookOn: d, tank: slot.tank, ready: slot.ready, late, early: !late && daysBetween(d, x.brewBy) > 6 })
  }
  const bh = list.filter((x) => x.brewhouse).sort((p, q) => p.priority - q.priority || p.neededFor.localeCompare(q.neededFor))
  for (const x of bh) {
    let placed = false
    if (!x.late) {
      for (let d = x.brewBy; d >= today; d = addDays(d, -1)) {
        const slot = slotOn(x, d)
        if (slot) { take(x, d, slot, false); placed = true; break }
      }
    }
    if (placed) continue
    for (let d = today; d <= horizon; d = addDays(d, 1)) {
      const slot = slotOn(x, d)
      if (slot) { take(x, d, slot, true); placed = true; break }
    }
    if (!placed) Object.assign(x, { bookOn: horizon, late: true, noRoom: true })
  }

  // Late brews: a lower priority brew booked before it that could swap places, if that beer's
  // stock stays above its goal until the later slot's beer would be ready.
  const booked = brews.filter((b) => b.status === 'booked' && b.start >= today)
  const fvByName = new Map(fvs.map((f) => [`FV ${f.name}`, f]))
  const swapped = new Set()
  for (const x of bh.filter((y) => y.late && !y.noRoom)) {
    const cand = booked
      .filter((b) => !swapped.has(b) && b.start < x.bookOn && priorityOf(b.beer) > x.priority && (fvByName.get(b.tank)?.capacity ?? 0) >= x.size)
      .filter((b) => {
        const until = belowMin.get(beerMatch(b.beer))
        return !until || addDays(x.bookOn, profileOf(b.beer).leadDays) <= until
      })
      .sort((p, q) => p.start.localeCompare(q.start))[0]
    if (cand) { swapped.add(cand); x.swap = { beer: cand.beer, tank: cand.tank, tankId: fvByName.get(cand.tank)?.id ?? null, start: cand.start, until: belowMin.get(beerMatch(cand.beer)) ?? null } }
  }

  for (const x of list) if (!x.brewhouse) x.bookOn = x.brewBy <= today ? today : workdayOnOrBefore(x.brewBy)
  return list.sort((p, q) => p.bookOn.localeCompare(q.bookOn) || p.priority - q.priority)
}
