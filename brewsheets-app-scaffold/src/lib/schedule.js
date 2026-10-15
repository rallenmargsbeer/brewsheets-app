import { supabase } from '../supabaseClient'
import { CUBES_PER_PALLET } from './packaging'

// ---- Dates (local yyyy-mm-dd, no time zones) ----

export const iso = (d) => d.toLocaleDateString('en-CA')
export const todayIso = () => iso(new Date())
export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + n)
  return iso(d)
}
export function mondayOf(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`)
  const back = (d.getDay() + 6) % 7 // Mon = 0
  d.setDate(d.getDate() - back)
  return iso(d)
}
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

// We don't work weekends.
export const isWeekend = (isoDate) => [0, 6].includes(new Date(`${isoDate}T00:00:00`).getDay())
export function nextWorkday(isoDate) {
  let d = isoDate
  while (isWeekend(d)) d = addDays(d, 1)
  return d
}
// n working days after a date (0 = the date itself, moved off a weekend).
export function addWorkdays(isoDate, n) {
  let d = nextWorkday(isoDate)
  for (let i = 0; i < n; i++) d = nextWorkday(addDays(d, 1))
  return d
}

// ---- Lanes (grid columns that aren't tanks) ----

export const BREW_LANES = ['brew_1', 'brew_2']
export const PACK_LANES = ['canning_1', 'canning_2', 'kegging_1', 'kegging_2']
export const LANE_LABEL = {
  brew_1: 'Brew 1',
  brew_2: 'Brew 2',
  canning_1: 'Canning',
  canning_2: 'Canning',
  kegging_1: 'Kegging',
  kegging_2: 'Kegging',
  notes: 'Notes',
  casual: 'Casual',
  deliveries: 'Deliveries',
}

// ---- Who can edit ----

export async function isScheduleEditor() {
  const { data, error } = await supabase.rpc('is_schedule_editor')
  if (error) return false
  return !!data
}

// ---- Entries ----

// Supabase returns at most 1000 rows per request, so long date ranges are fetched in pages.
export async function listScheduleEntries(fromIso, toIso) {
  const PAGE = 1000
  const all = []
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await supabase
      .from('schedule_entries')
      .select('*')
      .gte('entry_date', fromIso)
      .lte('entry_date', toIso)
      .order('entry_date')
      .order('id')
      .range(start, start + PAGE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE) return all
  }
}

// Returns the new row's id when it inserts (so the change can be undone).
// Canning and kegging are one cell a day (no AM / PM): stored as AM.
export const packSlot = (row) => (row.lane && PACK_LANES.includes(row.lane) && row.slot ? { ...row, slot: 'AM' } : row)

export async function saveScheduleEntry(entry) {
  const { id, ...fields } = packSlot(entry)
  if (id) {
    const { error } = await supabase.from('schedule_entries').update(fields).eq('id', id)
    if (error) throw error
    return id
  }
  const { data, error } = await supabase.from('schedule_entries').insert(fields).select('id').single()
  if (error) throw error
  return data.id
}

// ---- Bulk changes + undo ----

const ENTRY_COLS = 'id, entry_date, slot, lane, tank_id, text, booking_id, done, beer_name, cell_bg, cell_fg'

export async function getEntriesByIds(ids) {
  if (!ids.length) return []
  const { data, error } = await supabase.from('schedule_entries').select(ENTRY_COLS).in('id', ids)
  if (error) throw error
  return data
}

// rows: [{ id, ...fieldsToChange }]
export async function updateEntries(rows) {
  for (const { id, ...fields } of rows.map(packSlot)) {
    const { error } = await supabase.from('schedule_entries').update(fields).eq('id', id)
    if (error) throw error
  }
}

export async function insertEntries(rows) {
  if (!rows.length) return []
  const { data, error } = await supabase.from('schedule_entries').insert(rows.map(packSlot)).select('id')
  if (error) throw error
  return data.map((r) => r.id)
}

export async function deleteEntries(ids) {
  if (!ids.length) return
  const { error } = await supabase.from('schedule_entries').delete().in('id', ids)
  if (error) throw error
}

// Puts rows back exactly as they were (re-creating any that were deleted) and removes rows
// that the change created.
export async function restoreEntries(before, createdIds = []) {
  await deleteEntries(createdIds.filter((id) => !before.some((b) => b.id === id)))
  if (before.length) {
    const { error } = await supabase.from('schedule_entries').upsert(before, { onConflict: 'id' })
    if (error) throw error
  }
}

export async function deleteScheduleEntry(id) {
  const { error } = await supabase.from('schedule_entries').delete().eq('id', id)
  if (error) throw error
}

// ---- Cellar templates ----

export async function listCellarTemplates() {
  const { data, error } = await supabase
    .from('cellar_templates')
    .select('*, cellar_template_steps(*)')
    .order('name')
  if (error) throw error
  for (const t of data) t.cellar_template_steps.sort((a, b) => a.sort_order - b.sort_order)
  return data
}

export async function saveCellarTemplate(template, steps) {
  let id = template.id
  if (id) {
    const { error } = await supabase.from('cellar_templates').update({ name: template.name }).eq('id', id)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('cellar_templates').insert({ name: template.name }).select().single()
    if (error) throw error
    id = data.id
  }
  const { error: delErr } = await supabase.from('cellar_template_steps').delete().eq('template_id', id)
  if (delErr) throw delErr
  const rows = steps
    .filter((s) => s.task && s.day)
    .map((s, i) => ({ template_id: id, day: Number(s.day), slot: s.slot, task: s.task.trim(), variant: s.variant ?? 'all', sort_order: i }))
  if (rows.length) {
    const { error } = await supabase.from('cellar_template_steps').insert(rows)
    if (error) throw error
  }
  return id
}

export async function deleteCellarTemplate(id) {
  const { error } = await supabase.from('cellar_templates').delete().eq('id', id)
  if (error) throw error
}

// FV7 and FV8 run the 'fv78' variant of a template (later filter); every other tank 'standard'.
export const isFv78 = (tank) => tank && ['7', '8'].includes(String(tank.name))
export function stepsForTank(template, tank) {
  const variant = isFv78(tank) ? 'fv78' : 'standard'
  return (template?.cellar_template_steps ?? []).filter((s) => s.variant === 'all' || s.variant === variant)
}

// ---- Bookings ----

export async function listBookings({ unbrewedOnly = false, fromIso, toIso } = {}) {
  let q = supabase.from('brew_bookings').select('*, tanks(name, tank_type), recipes(name)').order('brew_date')
  if (unbrewedOnly) q = q.is('batch_id', null)
  if (fromIso) q = q.gte('brew_date', fromIso)
  if (toIso) q = q.lte('brew_date', toIso)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function getBooking(id) {
  const { data, error } = await supabase.from('brew_bookings').select('*, tanks(name, tank_type), recipes(name)').eq('id', id).single()
  if (error) throw error
  return data
}

// Books a brew: the booking itself, its brewhouse turns (Brew 1 / Brew 2, AM then PM),
// and the tank's cellar tasks from the template, dated from the brew day (day 1).
// ---- Bright tanks ----

const slotOrder = (a, b) => Number(a.day) - Number(b.day) || (a.slot === b.slot ? 0 : a.slot === 'AM' ? -1 : 1)
const isFilter = (task) => /^filter\b/i.test(task.trim())

// Splits a template's steps at Filter: up to and including Filter happen in the FV, the
// rest (Can & Keg) in the bright tank. Templates with nothing after Filter get the usual
// Can & Keg (next morning).
export function splitAtFilter(steps) {
  const ordered = [...steps].sort(slotOrder)
  const fi = ordered.findIndex((s) => isFilter(s.task))
  if (fi === -1) return { fvSteps: ordered, filterStep: null, btSteps: [], afterFilter: [] }
  const filterStep = ordered[fi]
  const afterFilter = ordered.slice(fi + 1)
  const btSteps = afterFilter.length ? afterFilter : [{ day: filterStep.day + 1, slot: 'AM', task: 'Can & Keg' }]
  return { fvSteps: ordered.slice(0, fi + 1), filterStep, btSteps, afterFilter }
}

// The template's steps dated from the brew day (day 1). Filter never lands on a weekend:
// it moves to the Monday, and everything after it moves with it (and off weekends too).
// fv: FV jobs up to and including Filter; bt: jobs after Filter (in the bright tank);
// afterFilter: the template's own jobs after Filter (for a beer left in the FV);
// pack: when packaging happens (the Can & Keg job, else the working day after Filter).
export function planSteps(brewDate, steps) {
  const { fvSteps, filterStep, btSteps, afterFilter } = splitAtFilter(steps)
  const at = (s, shift = 0) => ({ ...s, date: addDays(brewDate, s.day - 1 + shift) })
  if (!filterStep) return { fv: fvSteps.map((s) => at(s)), filter: null, bt: [], afterFilter: [], pack: null }
  const raw = addDays(brewDate, filterStep.day - 1)
  const shift = daysBetween(raw, nextWorkday(raw))
  const filter = at(filterStep, shift)
  const fv = [...fvSteps.slice(0, -1).map((s) => at(s)), filter]
  const later = (list) => {
    let prev = filter.date
    return list.map((s) => {
      let d = nextWorkday(addDays(brewDate, s.day - 1 + shift))
      if (d < prev) d = prev
      prev = d
      return { ...s, date: d }
    })
  }
  const bt = later(btSteps)
  const job = bt.find((s) => /can|keg|packag/i.test(s.task))
  const pack = job ? { date: job.date, slot: job.slot } : { date: addWorkdays(filter.date, 1), slot: 'AM' }
  return { fv, filter, bt, afterFilter: later(afterFilter), pack }
}

// Default bright-tank jobs when a beer is moved over on its filter day.
export function defaultBtJobs(filterDate, filterSlot) {
  return [{ date: addWorkdays(filterDate, 1), slot: 'AM', task: 'Can & Keg' }]
}

// Emptying a bright tank takes working days: 2 for a 10,000 L BT, 1 for the smaller ones.
export const emptyingDays = (tank) => (Number(tank?.capacity_l) >= 10000 ? 2 : 1)
// Last day a BT is tied up by a beer packaged from it on packDate.
export const btFreeAfter = (tank, packDate) => addWorkdays(packDate, emptyingDays(tank) - 1)

// Days each bright tank is tied up, from the schedule: a job holds its day, and a
// packaging job (Can & Keg) holds the tank until it's empty.
function btBusy(tank, entries) {
  return entries
    .filter((e) => e.lane === 'tank' && e.tank_id === tank.id)
    .map((e) => ({ from: e.entry_date, to: /can|keg|packag/i.test(e.text ?? '') ? btFreeAfter(tank, e.entry_date) : e.entry_date }))
}

// Suggests a bright tank that's free from the filter day until the beer packaged on
// packDate is out of it (emptying included), and big enough for `litres`. Smallest
// that fits wins, so big BTs stay free. `entries` should run a week either side.
export function suggestBrightTank(brightTanks, entries, fromDate, packDate, litres) {
  return (
    brightTanks
      .filter((t) => t.capacity_l == null || !litres || Number(t.capacity_l) >= litres)
      .filter((t) => {
        const until = btFreeAfter(t, packDate)
        return !btBusy(t, entries).some((b) => b.from <= until && b.to >= fromDate)
      })
      .sort((a, b) => (Number(a.capacity_l) || 0) - (Number(b.capacity_l) || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }))[0] ?? null
  )
}

// Puts a beer into a bright tank on its filter day: its name (arrival) then the BT jobs.
export async function moveToBrightTank({ bt, beerName, filterDate, filterSlot, bookingId = null, jobs }) {
  const rows = [
    { entry_date: filterDate, slot: filterSlot, lane: 'tank', tank_id: bt.id, text: beerName, booking_id: bookingId },
    ...(jobs ?? defaultBtJobs(filterDate, filterSlot)).map((j) => ({
      entry_date: j.date,
      slot: j.slot,
      lane: 'tank',
      tank_id: bt.id,
      text: j.task,
      booking_id: bookingId,
    })),
  ]
  return insertEntries(rows)
}

// The first free half-day in a column (a lane, or a tank) from (date, slot) on, working days
// only, so two jobs never end up in one cell. `ignore`: ids of entries moving away.
export function nextFreeCell(entries, { lane, tankId = null }, date, slot, ignore = new Set()) {
  let d = nextWorkday(date)
  let s = d === date ? slot : 'AM'
  for (let i = 0; i < 40; i++) {
    const taken = entries.some((e) => e.lane === lane && (e.tank_id ?? null) === tankId && e.entry_date === d && e.slot === s && !ignore.has(e.id) && (e.text ?? '').trim())
    if (!taken) return { date: d, slot: s }
    if (s === 'AM') s = 'PM'
    else { d = nextWorkday(addDays(d, 1)); s = 'AM' }
  }
  return { date, slot }
}

// Canning and kegging each have two columns: the first that's empty at that time, else
// null (both taken). `ignore`: ids of entries that are moving away.
export function freePackLane(kind, date, slot, entries, ignore = new Set()) {
  return [`${kind}_1`, `${kind}_2`].find((l) => !entries.some((e) => e.lane === l && e.entry_date === date && !ignore.has(e.id) && (e.text ?? '').trim())) ?? null
}

// The next free Canning / Kegging slots from a time on (working days only), for when both
// columns are taken then: [{ date, slot, lane }].
export function freePackSlots(kind, fromDate, fromSlot, entries, n = 8, ignore = new Set()) {
  const out = []
  // One cell a day: the next working days with a column free.
  let d = nextWorkday(fromDate)
  for (let guard = 0; guard < 30 && out.length < n; guard++) {
    const lane = freePackLane(kind, d, 'AM', entries, ignore)
    if (lane) out.push({ date: d, slot: 'AM', lane })
    d = nextWorkday(addDays(d, 1))
  }
  return out
}

// Text for the Canning / Kegging cells from a packaging plan.
export function packTexts(pack) {
  const pallets = Number(pack?.pallets) || 0
  const cubes = pallets * CUBES_PER_PALLET
  const kegs = [50, 30, 20].filter((l) => Number(pack?.[`kegs_${l}`]) > 0).map((l) => `${pack[`kegs_${l}`]} x ${l}L`)
  return { canning: pallets ? `${pallets} pallet${pallets === 1 ? '' : 's'} (${cubes} cubes)` : null, kegging: kegs.length ? kegs.join(', ') : null }
}

// Brewhouse slots in order: AM Brew 1, AM Brew 2, PM Brew 1, PM Brew 2, then the next working day.
export const TURN_SLOTS = [['AM', 'brew_1'], ['AM', 'brew_2'], ['PM', 'brew_1'], ['PM', 'brew_2']]
// The brewhouse does at most this many turns a day.
export const MAX_TURNS_PER_DAY = 3
export const turnsOn = (date, keys) => [...keys].filter((k) => k.startsWith(`${date}|`)).length
export function defaultTurnSlots(brewDate, n, taken = new Set()) {
  const out = []
  let d = brewDate
  for (let guard = 0; out.length < n && guard < 60; guard++) {
    let today = turnsOn(d, taken)
    for (const [slot, lane] of TURN_SLOTS) {
      if (out.length < n && today < MAX_TURNS_PER_DAY && !taken.has(`${d}|${slot}|${lane}`)) { out.push({ date: d, slot, lane }); today++ }
    }
    d = nextWorkday(addDays(d, 1))
  }
  return out
}

export async function createBooking({ brewDate, beerName, recipeId, template, tank, brightTank, turnVolumeL, turnQuantity, turnSlots, packSlots, notes, pack }) {
  const { data: booking, error } = await supabase
    .from('brew_bookings')
    .insert({
      brew_date: brewDate,
      beer_name: beerName,
      recipe_id: recipeId || null,
      cellar_template_id: template?.id ?? null,
      tank_id: tank.id,
      turn_volume_l: turnVolumeL || null,
      turn_quantity: turnQuantity || null,
      notes: notes || null,
      pack_cubes: (Number(pack?.pallets) || 0) * CUBES_PER_PALLET || null,
      pack_kegs_50: Number(pack?.kegs_50) || null,
      pack_kegs_30: Number(pack?.kegs_30) || null,
      pack_kegs_20: Number(pack?.kegs_20) || null,
    })
    .select()
    .single()
  if (error) throw error

  const entries = []
  // Brewhouse turns go in the slots picked (date, AM/PM, Brew 1/2); without them, AM Brew 1,
  // AM Brew 2, PM Brew 1, PM Brew 2 from the brew day.
  const slots = turnSlots?.length ? turnSlots : defaultTurnSlots(brewDate, turnQuantity || 0)
  for (const t of slots) entries.push({ entry_date: t.date, slot: t.slot, lane: t.lane, text: beerName, booking_id: booking.id })
  const plan = planSteps(brewDate, stepsForTank(template, tank))
  // The template's day-1 PM cell is the beer's name; use this booking's beer.
  const fvRow = (s) => ({ entry_date: s.date, slot: s.slot, lane: 'tank', tank_id: tank.id, text: s.task === template.name ? beerName : s.task, booking_id: booking.id })
  for (const s of brightTank && plan.filter ? plan.fv : [...plan.fv, ...plan.afterFilter]) entries.push(fvRow(s))
  // Filter day: the beer moves to the bright tank, where the rest of its jobs happen.
  if (brightTank && plan.filter) {
    entries.push({ entry_date: plan.filter.date, slot: plan.filter.slot, lane: 'tank', tank_id: brightTank.id, text: beerName, booking_id: booking.id })
    for (const s of plan.bt) entries.push({ entry_date: s.date, slot: s.slot, lane: 'tank', tank_id: brightTank.id, text: s.task, booking_id: booking.id })
  }
  // Planned packaging goes straight into the Canning / Kegging columns on pack day.
  const when = plan.pack
  const { canning, kegging } = packTexts(pack)
  // In whichever Canning / Kegging column is free then, or the slot picked when both were taken.
  const there = when && (canning || kegging) ? await listScheduleEntries(when.date, when.date) : []
  const place = (kind) => packSlots?.[kind] ?? { date: when.date, slot: when.slot, lane: freePackLane(kind, when.date, when.slot, there) ?? `${kind}_1` }
  for (const [kind, text] of [['canning', canning], ['kegging', kegging]]) {
    if (!when || !text) continue
    const at = place(kind)
    entries.push({ entry_date: at.date, slot: at.slot, lane: at.lane, text, beer_name: beerName, booking_id: booking.id })
  }
  // Bright tank jobs after the beer arrives never go into a cell that's already taken.
  if (brightTank && plan.filter) {
    const dates = entries.map((e) => e.entry_date).sort()
    const around = await listScheduleEntries(dates[0], addDays(dates[dates.length - 1], 14))
    const placed = [...around]
    for (const e of entries) {
      const isJob = e.tank_id === brightTank.id && !(e.entry_date === plan.filter.date && e.slot === plan.filter.slot)
      if (isJob) {
        const at = nextFreeCell(placed, { lane: 'tank', tankId: brightTank.id }, e.entry_date, e.slot)
        e.entry_date = at.date
        e.slot = at.slot
      }
      placed.push(e)
    }
  }
  if (entries.length) {
    const { error: e2 } = await supabase.from('schedule_entries').insert(entries.map(packSlot))
    if (e2) throw e2
  }
  return booking
}

// Books a beer mixed straight into a bright tank (Megsy): no brewhouse, no FV. The beer goes
// in on the mix day, Can & Keg the next working day, and planned packaging on that day in a
// free Canning / Kegging column. Nothing lands in a cell that's already taken.
export async function createMixBooking({ date, beerName, brightTank, litres, pack, packSlots, notes }) {
  const { data: booking, error } = await supabase
    .from('brew_bookings')
    .insert({
      brew_date: date,
      beer_name: beerName,
      recipe_id: null,
      cellar_template_id: null,
      tank_id: brightTank.id,
      turn_volume_l: litres || null,
      turn_quantity: 1,
      notes: notes || null,
      pack_cubes: (Number(pack?.pallets) || 0) * CUBES_PER_PALLET || null,
      pack_kegs_50: Number(pack?.kegs_50) || null,
      pack_kegs_30: Number(pack?.kegs_30) || null,
      pack_kegs_20: Number(pack?.kegs_20) || null,
    })
    .select()
    .single()
  if (error) throw error
  const around = await listScheduleEntries(date, addDays(date, 21))
  const bt = { lane: 'tank', tankId: brightTank.id }
  const inAt = nextFreeCell(around, bt, date, 'AM')
  const placed = [...around, { lane: 'tank', tank_id: brightTank.id, entry_date: inAt.date, slot: inAt.slot, text: beerName }]
  const ck = nextFreeCell(placed, bt, addWorkdays(inAt.date, 1), 'AM')
  const entries = [
    { entry_date: inAt.date, slot: inAt.slot, lane: 'tank', tank_id: brightTank.id, text: beerName, booking_id: booking.id },
    { entry_date: ck.date, slot: ck.slot, lane: 'tank', tank_id: brightTank.id, text: 'Can & Keg', booking_id: booking.id },
  ]
  const { canning, kegging } = packTexts(pack)
  for (const [kind, text] of [['canning', canning], ['kegging', kegging]]) {
    if (!text) continue
    const at = packSlots?.[kind] ?? { date: ck.date, slot: 'AM', lane: freePackLane(kind, ck.date, 'AM', around) ?? `${kind}_1` }
    entries.push({ entry_date: at.date, slot: 'AM', lane: at.lane, text, beer_name: beerName, booking_id: booking.id })
  }
  const { error: e2 } = await supabase.from('schedule_entries').insert(entries.map(packSlot))
  if (e2) throw e2
  return booking
}

// Moves a booking and every schedule cell it created by the same number of days.
export async function moveBooking(booking, newDate) {
  const delta = daysBetween(booking.brew_date, newDate)
  if (delta === 0) return
  const { data: entries, error } = await supabase.from('schedule_entries').select('id, entry_date').eq('booking_id', booking.id)
  if (error) throw error
  for (const e of entries) {
    const { error: uErr } = await supabase.from('schedule_entries').update({ entry_date: addDays(e.entry_date, delta) }).eq('id', e.id)
    if (uErr) throw uErr
  }
  const { error: bErr } = await supabase.from('brew_bookings').update({ brew_date: newDate }).eq('id', booking.id)
  if (bErr) throw bErr
}

// The booking brewing in an FV on a day (its brew day, or its first cell in that FV).
export async function findBooking(tankId, date) {
  const { data } = await supabase.from('brew_bookings').select('*').eq('tank_id', tankId).eq('brew_date', date).limit(1)
  if (data?.length) return data[0]
  const { data: cells } = await supabase.from('schedule_entries').select('booking_id').eq('tank_id', tankId).eq('entry_date', date).not('booking_id', 'is', null).limit(1)
  if (!cells?.length) return null
  const { data: b } = await supabase.from('brew_bookings').select('*').eq('id', cells[0].booking_id).maybeSingle()
  return b ?? null
}

// Moves a booking to another day and FV: every cell it made shifts by the same number of
// days, and its jobs in the old FV go to the new one.
export async function moveBookingToTank(booking, newDate, newTankId) {
  const delta = daysBetween(booking.brew_date, newDate)
  const { data: entries, error } = await supabase.from('schedule_entries').select('id, entry_date, tank_id').eq('booking_id', booking.id)
  if (error) throw error
  // Filter never on a weekend: if the shift puts it there, it and everything after it go to
  // the Monday (and later jobs off weekends too).
  const { data: full } = await supabase.from('schedule_entries').select('id, text').eq('booking_id', booking.id)
  const filterId = (full ?? []).find((x) => /^filter\b/i.test((x.text ?? '').trim()))?.id
  const filterAt = filterId ? addDays(entries.find((x) => x.id === filterId).entry_date, delta) : null
  const extra = filterAt ? daysBetween(filterAt, nextWorkday(filterAt)) : 0
  for (const e of entries) {
    let d = addDays(e.entry_date, delta)
    if (filterAt && d >= filterAt) d = extra ? nextWorkday(addDays(d, extra)) : nextWorkday(d)
    const fields = { entry_date: d, ...(newTankId && e.tank_id === booking.tank_id ? { tank_id: newTankId } : {}) }
    const { error: uErr } = await supabase.from('schedule_entries').update(fields).eq('id', e.id)
    if (uErr) throw uErr
  }
  const { error: bErr } = await supabase.from('brew_bookings').update({ brew_date: newDate, ...(newTankId ? { tank_id: newTankId } : {}) }).eq('id', booking.id)
  if (bErr) throw bErr
}

export async function restoreBooking(booking) {
  const { error } = await supabase.from('brew_bookings').update({ brew_date: booking.brew_date, tank_id: booking.tank_id }).eq('id', booking.id)
  if (error) throw error
}

// Removes the booking; its schedule cells go with it (on delete cascade).
export async function cancelBooking(id) {
  const { error } = await supabase.from('brew_bookings').delete().eq('id', id)
  if (error) throw error
}

export async function linkBookingToBatch(bookingId, batchId) {
  const { error } = await supabase.rpc('link_booking_to_batch', { p_booking: bookingId, p_batch: batchId })
  if (error) throw error
}

// ---- Beer colours ----

export async function listBeerColours() {
  const { data, error } = await supabase.from('beer_colours').select('beer_name, bg, fg')
  if (error) throw error
  return data
}

export async function saveBeerColour(beerName, bg, fg) {
  const { error } = await supabase.from('beer_colours').upsert({ beer_name: beerName, bg, fg, updated_at: new Date().toISOString() }, { onConflict: 'beer_name' })
  if (error) throw error
}

export async function deleteBeerColour(beerName) {
  const { error } = await supabase.from('beer_colours').delete().eq('beer_name', beerName)
  if (error) throw error
}

// After cells move, set each booking's brew date to its first brewhouse turn. Returns the
// old dates so it can be undone with setBookingDates.
export async function syncBookingDates(bookingIds) {
  const prev = []
  for (const id of new Set(bookingIds)) {
    const { data: b, error } = await supabase.from('brew_bookings').select('id, brew_date').eq('id', id).single()
    if (error) throw error
    const { data: first, error: e2 } = await supabase
      .from('schedule_entries')
      .select('entry_date')
      .eq('booking_id', id)
      .in('lane', BREW_LANES)
      .order('entry_date')
      .limit(1)
    if (e2) throw e2
    const date = first?.[0]?.entry_date
    if (date && date !== b.brew_date) {
      const { error: e3 } = await supabase.from('brew_bookings').update({ brew_date: date }).eq('id', id)
      if (e3) throw e3
      prev.push({ id, brew_date: b.brew_date })
    }
  }
  return prev
}

export async function setBookingDates(rows) {
  for (const { id, brew_date } of rows) {
    const { error } = await supabase.from('brew_bookings').update({ brew_date }).eq('id', id)
    if (error) throw error
  }
}

export async function listBookingEntries(bookingId) {
  const { data, error } = await supabase.from('schedule_entries').select(ENTRY_COLS).eq('booking_id', bookingId)
  if (error) throw error
  return data
}
