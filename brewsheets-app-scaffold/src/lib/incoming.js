// Packaging coming up on the schedule, for projecting stock: each canning / kegging cell from
// today on, with the beer it's for (worked out the same way the schedule colours it).
import { listTanks } from './api'
import { addDays, todayIso, listScheduleEntries, listCellarTemplates, listBookings } from './schedule'
import { assignBeers, packBeer } from './beerColours'

// "2 pallets (432 cubes)" -> 432, "660" -> 660, "45 x 50L" -> 45, "40 PET" -> 40.
export function packCount(text) {
  const t = String(text ?? '')
  const cubes = /(\d+)\s*cubes?/i.exec(t)
  if (cubes) return Number(cubes[1])
  const first = /\d+/.exec(t)
  return first ? Number(first[0]) : 0
}

export async function loadIncoming({ days = 120 } = {}) {
  const today = todayIso()
  // Look back far enough to see the brews whose packaging is coming up.
  const from = addDays(today, -60)
  const to = addDays(today, days)
  const [entries, templates, bookings, tanks] = await Promise.all([
    listScheduleEntries(from, to),
    listCellarTemplates(),
    listBookings({ fromIso: addDays(from, -30), toIso: to }),
    listTanks(),
  ])
  const bookingBeer = Object.fromEntries(bookings.map((b) => [b.id, b.beer_name]))
  const { beerOf, runs } = assignBeers(entries, { knownBeers: templates.map((t) => t.name), bookingBeer })
  const brightTankIds = tanks.filter((t) => t.tank_type === 'BBT').map((t) => t.id)

  const cells = new Map() // "date|slot|lane" -> entries
  for (const e of entries) {
    if (!/^(canning|kegging)_/.test(e.lane) || e.entry_date < today) continue
    const k = `${e.entry_date}|${e.slot}|${e.lane}`
    cells.set(k, [...(cells.get(k) ?? []), e])
  }
  const out = []
  for (const list of cells.values()) {
    const { entry_date: date, slot, lane } = list[0]
    const beer = packBeer(list, date, slot, { entries, beerOf, runs, brightTankIds })
    const qty = list.reduce((a, e) => a + packCount(e.text), 0)
    // Kegging cells may name a size ("45 x 50L", "20 x 30L"); otherwise they're 50 L kegs.
    const size = Number(/(\d{2})\s*l\b/i.exec(list.map((e) => e.text).join(' '))?.[1] ?? 50)
    if (beer && qty) out.push({ beer, format: lane.startsWith('canning') ? 'cube' : 'keg', size, date, qty })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// Stock and schedule spell some beers differently ("Pale" / "Pale Ale", "Riverdog" / "River Dog").
const SAME = { pale: 'paleale', red: 'redipa', margsdraught: 'draught', drift: 'driftxpa', inthepines: 'itp' }
export const beerMatch = (name) => {
  const k = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return SAME[k] ?? k
}

// Weeks until stock runs out: it falls by `weekly` a week (or by `weekly(date)` a day, for a
// forecast that changes month to month) and rises on each packaging day.
// Returns null with no demand, or `maxWeeks` when it lasts that long.
export function weeksOfCover(stock, weekly, incoming = [], { today = todayIso(), maxWeeks = 26 } = {}) {
  const perDayOn = typeof weekly === 'function' ? weekly : () => weekly / 7
  if (typeof weekly !== 'function' && !(weekly > 0.05)) return null
  let s = Math.max(0, stock)
  const add = new Map()
  for (const i of incoming) add.set(i.date, (add.get(i.date) ?? 0) + i.qty)
  let any = false
  for (let d = 0; d < maxWeeks * 7; d++) {
    const date = addDays(today, d)
    const perDay = perDayOn(date)
    s += add.get(date) ?? 0
    if (perDay > 0) {
      any = true
      if (s < perDay) return (d + s / perDay) / 7
    }
    s -= perDay
  }
  return any ? maxWeeks : null
}
