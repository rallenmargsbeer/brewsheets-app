// Moving a brew later pushes the brews after it in the same tank, so they never overlap.
//
// A "stay" is a beer's block in one tank ({ beer, start, end } from assignBeers, with
// start/end as slot keys "YYYY-MM-DD|0" for AM, "|1" for PM). Times here are half-day
// indexes so AM/PM arithmetic is exact; shifts are always whole days.
import { addDays } from './schedule'
import { slotKey } from './beerColours'

const idx = (date, slot) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000) * 2 + (slot === 'PM' ? 1 : 0)
const keyIdx = (key) => {
  const [date, half] = key.split('|')
  return idx(date, half === '1' ? 'PM' : 'AM')
}

export const isBrewLane = (e) => e.lane === 'brew_1' || e.lane === 'brew_2'
const nameKey = (t) => String(t ?? '').replace(/\s*-?\s*\d+\s*L$/i, '').trim().toLowerCase()

// Rows of one stay: a booked brew's own cells (every lane), else the tank's jobs inside it
// plus that beer's Brew 1 / Brew 2 turns on its brew day (and the next, if turns spilled over).
export function stayRows(entries, tankId, stay) {
  const inStay = entries.filter((e) => e.lane === 'tank' && e.tank_id === tankId && slotKey(e.entry_date, e.slot) >= stay.start && slotKey(e.entry_date, e.slot) <= stay.end)
  const bookingId = inStay.find((e) => e.booking_id)?.booking_id
  if (bookingId) return entries.filter((e) => e.booking_id === bookingId)
  const brewDay = stay.start.split('|')[0]
  const turns = entries.filter(
    (e) => isBrewLane(e) && !e.booking_id && nameKey(e.text) === nameKey(stay.beer) && (e.entry_date === brewDay || e.entry_date === addDays(brewDay, 1))
  )
  return [...inStay, ...turns]
}

// The brew a Brew 1 / Brew 2 cell belongs to: its booking, else the tank stay of that beer
// starting that day (or the day before, when turns spill over), else just its turns.
export function brewGroup(entries, runs, row) {
  if (row.booking_id) return entries.filter((e) => e.booking_id === row.booking_id)
  for (const [tankId, list] of runs) {
    for (const stay of list) {
      const day = stay.start.split('|')[0]
      if (nameKey(stay.beer) === nameKey(row.text) && (day === row.entry_date || addDays(day, 1) === row.entry_date)) return stayRows(entries, tankId, stay)
    }
  }
  return entries.filter((e) => isBrewLane(e) && !e.booking_id && e.entry_date === row.entry_date && nameKey(e.text) === nameKey(row.text))
}

// Works out every change a move needs.
// move: { rows, days, toTankId? } — shift `rows` by `days` and/or put their tank jobs in another
// tank — or an array of them (extra moves chosen while resolving brewhouse clashes).
// Returns { updates: [{ id, entry_date?, tank_id? }], pushed: [{ beer, tankId, days }], blocked: [{ beer, tankId }] }.
//  - pushed: later brews moved to keep their turnaround gap (moving into another tank: at least a day).
//  - blocked: earlier brews the move now overlaps (they're never pushed back in time).
export function planMove(entries, runs, move) {
  const shiftOf = new Map() // entry id -> days
  const tankOf = new Map() // entry id -> new tank id
  const pushedByStay = new Map() // "tank|start" -> { beer, tankId, days }
  const blocked = []
  const queue = (Array.isArray(move) ? move : [move]).map((m) => ({ ...m, root: true }))
  const groups = [] // every brew that moves: { rows, days, toTankId, root }
  let guard = 0

  while (queue.length && guard++ < 200) {
    const { rows, days, toTankId, root } = queue.shift()
    const fresh = rows.filter((r) => root || (shiftOf.get(r.id) ?? -Infinity) < days)
    if (!fresh.length) continue
    for (const r of fresh) {
      shiftOf.set(r.id, days)
      if (toTankId && r.lane === 'tank') tankOf.set(r.id, toTankId)
    }
    groups.push({ rows, days, toTankId, root: !!root })

    // Where this group now sits, tank by tank.
    const spans = new Map() // tank -> { oldStart, oldEnd, newStart, newEnd, sameTank }
    for (const r of rows) {
      if (r.lane !== 'tank') continue
      const to = tankOf.get(r.id) ?? r.tank_id
      const o = idx(r.entry_date, r.slot)
      const n = o + (shiftOf.get(r.id) ?? 0) * 2
      const s = spans.get(to) ?? { oldStart: Infinity, oldEnd: -Infinity, newStart: Infinity, newEnd: -Infinity, sameTank: to === r.tank_id }
      s.oldStart = Math.min(s.oldStart, o)
      s.oldEnd = Math.max(s.oldEnd, o)
      s.newStart = Math.min(s.newStart, n)
      s.newEnd = Math.max(s.newEnd, n)
      spans.set(to, s)
    }

    const ownIds = new Set(rows.map((r) => r.id))
    for (const [tankId, s] of spans) {
      for (const stay of runs.get(tankId) ?? []) {
        const sStart = keyIdx(stay.start)
        const sEnd = keyIdx(stay.end)
        const its = stayRows(entries, tankId, stay)
        if (its.some((r) => ownIds.has(r.id))) continue // the brew being moved
        if (sEnd < s.newStart) continue // finished before the moved brew starts

        const isLater = s.sameTank ? sStart > s.oldEnd : sStart >= s.newStart
        if (!isLater) {
          if (sStart <= s.newEnd) blocked.push({ beer: stay.beer, tankId, from: stay.start.split('|')[0] })
          continue
        }
        // Keep the turnaround the later brew had (moving into a new tank: at least a day).
        const gap = s.sameTank ? Math.max(1, sStart - s.oldEnd) : 2
        const needHalfDays = s.newEnd + gap - sStart
        if (needHalfDays <= 0) continue
        const push = Math.ceil(needHalfDays / 2)
        const key = `${tankId}|${stay.start}`
        if ((pushedByStay.get(key)?.days ?? 0) >= push) continue
        pushedByStay.set(key, { beer: stay.beer, tankId, days: push, from: stay.start.split('|')[0], ids: its.map((r) => r.id) })
        queue.push({ rows: its, days: push })
      }
    }
  }

  const byId = new Map(entries.map((e) => [e.id, e]))
  const updates = []
  for (const id of new Set([...shiftOf.keys(), ...tankOf.keys()])) {
    const e = byId.get(id)
    if (!e) continue
    const days = shiftOf.get(id) ?? 0
    const u = { id }
    if (days) u.entry_date = addDays(e.entry_date, days)
    if (tankOf.has(id) && tankOf.get(id) !== e.tank_id) u.tank_id = tankOf.get(id)
    if (u.entry_date || u.tank_id) updates.push(u)
  }
  const seen = new Set()
  return {
    updates,
    shiftOf,
    groups,
    // A brew can end up moved further than its push (a clash choice): report where it really goes.
    pushed: [...pushedByStay.values()].map(({ ids, ...p }) => ({ ...p, days: Math.max(p.days, ...ids.map((id) => shiftOf.get(id) ?? 0)) })),
    blocked: blocked.filter((b) => (seen.has(b.beer + b.tankId) ? false : seen.add(b.beer + b.tankId))),
  }
}

const isWeekend = (date) => [0, 6].includes(new Date(`${date}T00:00:00`).getDay())

// Brewhouse turns per day once a plan is applied: date -> number of Brew 1 / Brew 2 cells.
function turnsByDay(entries, shiftOf) {
  const m = new Map()
  for (const e of entries) {
    if (!isBrewLane(e)) continue
    const d = shiftOf.has(e.id) ? addDays(e.entry_date, shiftOf.get(e.id)) : e.entry_date
    m.set(d, (m.get(d) ?? 0) + 1)
  }
  return m
}

// Brew days a plan breaks: a moved brew's new brew day that's over the turn limit, or a
// pushed brew landing on a weekend. `accepted` holds dates you've OK'd (e.g. 4 turns).
// Each clash: { date, reason: 'full' | 'weekend', group, turns, total, others: [rows already brewing that day] }
export function brewDayClashes(entries, plan, { maxTurns = 3, accepted = new Set() } = {}) {
  const totals = turnsByDay(entries, plan.shiftOf)
  const clashes = []
  const seen = new Set()
  for (const g of plan.groups) {
    const turns = g.rows.filter(isBrewLane)
    if (!turns.length || plan.shiftOf.get(turns[0].id) === 0) continue
    for (const date of new Set(turns.map((t) => addDays(t.entry_date, plan.shiftOf.get(t.id) ?? 0)))) {
      if (seen.has(date) || accepted.has(date)) continue
      const mine = turns.filter((t) => addDays(t.entry_date, plan.shiftOf.get(t.id) ?? 0) === date)
      const others = entries.filter((e) => isBrewLane(e) && !mine.includes(e) && (plan.shiftOf.has(e.id) ? addDays(e.entry_date, plan.shiftOf.get(e.id)) : e.entry_date) === date)
      const total = totals.get(date) ?? 0
      if (total > maxTurns) clashes.push({ date, reason: 'full', group: g, turns: mine.length, total, others })
      else if (!g.root && isWeekend(date)) clashes.push({ date, reason: 'weekend', group: g, turns: mine.length, total, others })
      else continue
      seen.add(date)
    }
  }
  return clashes.sort((a, b) => a.date.localeCompare(b.date))
}

// How many more days a brew must move so all its brew days fall on weekdays with room for
// its turns (others' turns as planned). Looks up to 30 days ahead.
export function daysToNextFreeDay(entries, plan, group, { maxTurns = 3, minDays = 1 } = {}) {
  const totals = turnsByDay(entries, plan.shiftOf)
  const turns = group.rows.filter(isBrewLane)
  const cur = (t) => addDays(t.entry_date, plan.shiftOf.get(t.id) ?? 0)
  for (let k = minDays; k <= 30; k++) {
    const need = new Map()
    for (const t of turns) need.set(addDays(cur(t), k), (need.get(addDays(cur(t), k)) ?? 0) + 1)
    let ok = true
    for (const [d, n] of need) {
      const mineThere = turns.filter((t) => cur(t) === d).length // own turns already counted there
      if (isWeekend(d) || (totals.get(d) ?? 0) - mineThere + n > maxTurns) ok = false
    }
    if (ok) return k
  }
  return null
}
