// What's on for a day: the schedule's cells (brewhouse, tanks, packaging, notes), a
// suggestion from the recipe's cellar template for tanks the schedule says nothing about,
// and gravity-based suggestions for beer that's fermenting.
import { supabase } from '../supabaseClient'
import { listTanks } from './api'
import { addDays, daysBetween, listScheduleEntries, listCellarTemplates, listBookings, saveScheduleEntry, stepsForTank, BREW_LANES, PACK_LANES } from './schedule'
import { assignBeers, packBeer } from './beerColours'
import { IN_TANK_STATUSES } from './tanks'
import { packCount } from './incoming'

// Jobs (tank and notes cells) not ticked off roll into the following days until done.
// Only from when the app started tracking jobs: older schedule cells were never ticked.
export const CARRY_FROM = '2026-10-16'
const CARRY_DAYS = 14

const slotRank = (s) => (s === 'AM' ? 0 : 1)
const bySlot = (a, b) => slotRank(a.slot) - slotRank(b.slot)

async function listCellarBatches() {
  const { data, error } = await supabase
    .from('batches')
    .select('id, batch_number, beer_style, status, date_brewed, bbt_transfer_date, tank_id, recipes(name, target_fg, cellar_template_id, recipe_fermenter_additions(item_name, timing_notes)), fermentation_readings(reading_date, gravity_plato, created_at, notes), tank_additions(item_name, added_on)')
    .in('status', IN_TANK_STATUSES)
  if (error) throw error
  return data
}

export async function loadDay(date) {
  const from = addDays(date, -75)
  const [entries, templates, bookings, tanks, batches] = await Promise.all([
    listScheduleEntries(from, addDays(date, 1)),
    listCellarTemplates(),
    listBookings({ fromIso: addDays(from, -30) }),
    listTanks(),
    listCellarBatches(),
  ])
  const bookingBeer = Object.fromEntries(bookings.map((b) => [b.id, b.beer_name]))
  const { beerOf, runs } = assignBeers(entries, { knownBeers: templates.map((t) => t.name), bookingBeer })
  const brightTankIds = tanks.filter((t) => t.tank_type === 'BBT').map((t) => t.id)
  const today = entries.filter((e) => e.entry_date === date)
  const task = (e) => ({ id: e.id, slot: e.slot, text: e.text, done: !!e.done, beer: beerOf.get(e.id) ?? e.beer_name ?? null, carriedFrom: e.entry_date === date ? null : e.entry_date })
  // Unfinished jobs from the days before (tank and notes lanes, with text).
  const carryStart = [CARRY_FROM, addDays(date, -CARRY_DAYS)].sort()[1]
  // Not the cells that just name the beer in a tank (or "Brew"): those aren't jobs.
  const beerNames = new Set([...templates.map((t) => t.name), ...bookings.map((b) => b.beer_name), ...batches.map((b) => b.beer_style), ...batches.map((b) => b.recipes?.name)].filter(Boolean).map((n) => n.trim().toLowerCase()))
  const isJob = (e) => { const t = (e.text ?? '').trim().toLowerCase(); return t && t !== 'brew' && !beerNames.has(t) }
  const carried = entries.filter((e) => e.entry_date >= carryStart && e.entry_date < date && !e.done && isJob(e) && (e.lane === 'tank' || ['notes', 'casual', 'deliveries'].includes(e.lane)))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || bySlot(a, b))

  const brewhouse = today.filter((e) => BREW_LANES.includes(e.lane)).map((e) => ({ ...task(e), lane: e.lane })).sort(bySlot)

  // Packaging: one line per cell, with the beer worked out like the schedule does.
  const cells = new Map()
  for (const e of today.filter((x) => PACK_LANES.includes(x.lane))) {
    const k = `${e.slot}|${e.lane}`
    cells.set(k, [...(cells.get(k) ?? []), e])
  }
  const packaging = [...cells.values()].map((list) => ({
    slot: list[0].slot,
    lane: list[0].lane,
    kind: list[0].lane.startsWith('canning') ? 'Canning' : 'Kegging',
    beer: packBeer(list, date, list[0].slot, { entries, beerOf, runs, brightTankIds }),
    qty: list.reduce((a, e) => a + packCount(e.text), 0),
    tasks: list.map(task),
  })).sort(bySlot)

  const other = [
    ...carried.filter((e) => e.lane !== 'tank').map((e) => ({ ...task(e), lane: e.lane })),
    ...today.filter((e) => ['notes', 'casual', 'deliveries'].includes(e.lane)).map((e) => ({ ...task(e), lane: e.lane })).sort(bySlot),
  ]

  // Tanks: scheduled tasks, else the template's step for this day of the brew, plus gravity.
  const templateById = Object.fromEntries(templates.map((t) => [t.id, t]))
  const tankDays = tanks.filter((t) => t.is_active !== false).map((t) => {
    const batch = batches.find((b) => b.tank_id === t.id) ?? null
    const todays = today.filter((e) => e.lane === 'tank' && e.tank_id === t.id).map(task).sort(bySlot)
    const scheduled = [...carried.filter((e) => e.lane === 'tank' && e.tank_id === t.id).map(task), ...todays]
    let fromTemplate = []
    if (!todays.length && batch?.recipes?.cellar_template_id && t.tank_type !== 'BBT' && batch.date_brewed) {
      const day = daysBetween(batch.date_brewed, date) + 1 // brew day is day 1
      const tpl = templateById[batch.recipes.cellar_template_id]
      fromTemplate = stepsForTank(tpl, t).filter((s) => Number(s.day) === day).map((s) => ({ slot: s.slot, text: s.task, template: tpl.name, day })).sort(bySlot)
    }
    // The beer in the tank: the batch, or the schedule's run for this half-day.
    const beer = batch?.beer_style ?? scheduled.find((s) => s.beer)?.beer ?? null
    return { tank: t, batch, beer, scheduled, fromTemplate, advice: batch ? gravityAdvice(batch, date, jobState(batch, entries.filter((e) => e.lane === 'tank' && e.tank_id === t.id), date)) : [] }
  })
  return { date, brewhouse, packaging, other, tanks: tankDays }
}

// Through an RPC so every signed-in user (not only schedule editors) can tick tasks off.
export async function setTaskDone(id, done) {
  const { error } = await supabase.rpc('set_task_done', { p_id: id, p_done: done })
  if (error) throw error
}

// The recipe's terminal dry hops (fermenter additions timed "Terminal") not yet in the tank:
// not marked added on the Cellar tab, no Dry Hop job ticked off, and no reading note saying
// it was dry hopped (DH).
const plannedDryHops = (batch) => (batch.recipes?.recipe_fermenter_additions ?? []).filter((a) => /terminal|dry ?hop|\bdh\b/i.test(a.timing_notes ?? '')).map((a) => a.item_name)
function pendingDryHops(batch, dryHopped) {
  const planned = plannedDryHops(batch)
  if (!planned.length || dryHopped) return []
  if ((batch.fermentation_readings ?? []).some((r) => /\bDH\b|dry ?hop/i.test(r.notes ?? ''))) return []
  const added = new Set((batch.tank_additions ?? []).filter((a) => a.added_on).map((a) => a.item_name))
  return planned.filter((p) => !added.has(p))
}

// A job ticked off on the schedule for this batch's tank since brew day (chill / crash, dry hop).
export const CHILL_JOB = /chill|crash/i
export const DRY_HOP_JOB = /dry ?hop|\bdh\b/i
const jobDone = (re) => (batch, jobs, date) => (jobs ?? []).some((e) =>
  e.done && re.test(e.text ?? '') && (!e.tank_id || e.tank_id === batch.tank_id) &&
  (!batch.date_brewed || e.entry_date >= batch.date_brewed) && e.entry_date <= date)
export const isChilled = jobDone(CHILL_JOB)
export const isDryHopped = jobDone(DRY_HOP_JOB)
// Both, for gravityAdvice's options.
export const jobState = (batch, jobs, date) => ({ chilled: isChilled(batch, jobs, date), dryHopped: isDryHopped(batch, jobs, date) })

// Suggestions from the gravity readings of a fermenting batch (°P). Target FG from the recipe.
// Once it's been chilled (chill job ticked off) there's nothing more: no readings after chill.
export function gravityAdvice(batch, date, { chilled = false, dryHopped = false } = {}) {
  if (batch.status !== 'fermenting' || chilled) return []
  const readings = (batch.fermentation_readings ?? [])
    .filter((r) => r.gravity_plato != null && r.reading_date <= date)
    .sort((a, b) => a.reading_date.localeCompare(b.reading_date) || String(a.created_at).localeCompare(String(b.created_at)))
  const fg = batch.recipes?.target_fg != null ? Number(batch.recipes.target_fg) : null
  const fmt = (g) => `${Number(g).toFixed(1)} °P`
  const out = []
  const last = readings[readings.length - 1]
  if (!last) return [{ level: 'info', text: 'No gravity reading yet: take one.' }]
  if (last.reading_date < date) out.push({ level: 'info', text: `Take today's gravity reading (last ${fmt(last.gravity_plato)} on ${last.reading_date.slice(5)}).` })
  const g = Number(last.gravity_plato)
  // The latest reading at least a day before the last one, to see if it's still moving.
  const prev = [...readings].reverse().find((r) => r.reading_date < last.reading_date)
  const stable = prev && Math.abs(Number(prev.gravity_plato) - g) <= 0.1
  const dh = pendingDryHops(batch, dryHopped)
  const hopsDone = dryHopped || (plannedDryHops(batch).length > 0 && !dh.length)
  if (fg != null && g <= fg + 0.2) {
    out.push(dh.length
      ? { level: 'soon', label: 'Dry hop due', text: `At target FG (${fmt(g)}, target ${fmt(fg)})${stable ? ' and stable' : ''}: dry hop (${dh.join(', ')}) before VDK / diacetyl and chilling.` }
      : { level: 'go', text: `At target FG (${fmt(g)}, target ${fmt(fg)})${stable ? ' and stable' : ''}: check VDK / diacetyl, then chill.` })
  } else if (stable) {
    out.push(fg != null
      ? { level: 'warn', text: `Gravity hasn't moved since ${prev.reading_date.slice(5)} (${fmt(g)}, target ${fmt(fg)}): check temperature, consider rousing.` }
      : { level: 'go', text: `Gravity stable at ${fmt(g)}: likely terminal, check VDK / diacetyl.` })
  } else if (fg != null && g <= fg + 1.5) {
    out.push({ level: 'soon', text: `Nearing terminal (${fmt(g)}, target ${fmt(fg)})${hopsDone ? '.' : ': get dry hops / spunding ready.'}` })
  }
  return out
}
