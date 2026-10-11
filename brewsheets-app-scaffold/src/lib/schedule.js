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
export async function saveScheduleEntry(entry) {
  const { id, ...fields } = entry
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
  for (const { id, ...fields } of rows) {
    const { error } = await supabase.from('schedule_entries').update(fields).eq('id', id)
    if (error) throw error
  }
}

export async function insertEntries(rows) {
  if (!rows.length) return []
  const { data, error } = await supabase.from('schedule_entries').insert(rows).select('id')
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
// rest (Carb, Can & Keg) in the bright tank. Templates with nothing after Filter get the
// usual Carb (filter afternoon) and Can & Keg (next morning).
export function splitAtFilter(steps) {
  const ordered = [...steps].sort(slotOrder)
  const fi = ordered.findIndex((s) => isFilter(s.task))
  if (fi === -1) return { fvSteps: ordered, filterStep: null, btSteps: [] }
  const filterStep = ordered[fi]
  let btSteps = ordered.slice(fi + 1)
  if (btSteps.length === 0) {
    btSteps = [
      ...(filterStep.slot === 'AM' ? [{ day: filterStep.day, slot: 'PM', task: 'Carb' }] : []),
      { day: filterStep.day + 1, slot: 'AM', task: 'Can & Keg' },
    ]
  }
  return { fvSteps: ordered.slice(0, fi + 1), filterStep, btSteps }
}

// Default bright-tank jobs when a beer is moved over on its filter day.
export function defaultBtJobs(filterDate, filterSlot) {
  return [
    ...(filterSlot === 'AM' ? [{ date: filterDate, slot: 'PM', task: 'Carb' }] : []),
    { date: addDays(filterDate, 1), slot: 'AM', task: 'Can & Keg' },
  ]
}

// Suggests a bright tank that's empty from `fromDate` to `toDate` (no schedule jobs in it
// then) and big enough for `litres`. Smallest that fits wins, so big BTs stay free.
export function suggestBrightTank(brightTanks, entries, fromDate, toDate, litres) {
  const busy = new Set(entries.filter((e) => e.lane === 'tank' && e.entry_date >= fromDate && e.entry_date <= toDate).map((e) => e.tank_id))
  return (
    brightTanks
      .filter((t) => !busy.has(t.id) && (t.capacity_l == null || !litres || Number(t.capacity_l) >= litres))
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

// Text for the Canning / Kegging cells from a packaging plan.
export function packTexts(pack) {
  const pallets = Number(pack?.pallets) || 0
  const cubes = pallets * CUBES_PER_PALLET
  const kegs = [50, 30, 20].filter((l) => Number(pack?.[`kegs_${l}`]) > 0).map((l) => `${pack[`kegs_${l}`]} x ${l}L`)
  return { canning: pallets ? `${pallets} pallet${pallets === 1 ? '' : 's'} (${cubes} cubes)` : null, kegging: kegs.length ? kegs.join(', ') : null }
}

// When packaging happens: the Can & Keg job in the bright tank, else the morning after Filter.
export function packDay(brewDate, filterStep, btSteps) {
  const job = btSteps.find((s) => /can|keg|packag/i.test(s.task))
  if (job) return { date: addDays(brewDate, job.day - 1), slot: job.slot }
  if (filterStep) return { date: addDays(brewDate, filterStep.day), slot: 'AM' }
  return null
}

export async function createBooking({ brewDate, beerName, recipeId, template, tank, brightTank, turnVolumeL, turnQuantity, notes, pack }) {
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
  const turnLabel = beerName
  for (let i = 0; i < (turnQuantity || 0); i++) {
    // 2 turns per half-day: AM Brew 1, AM Brew 2, PM Brew 1, PM Brew 2, then next day.
    const day = Math.floor(i / 4)
    entries.push({
      entry_date: addDays(brewDate, day),
      slot: i % 4 < 2 ? 'AM' : 'PM',
      lane: BREW_LANES[i % 2],
      text: turnLabel,
      booking_id: booking.id,
    })
  }
  const { fvSteps, filterStep, btSteps } = splitAtFilter(stepsForTank(template, tank))
  for (const s of brightTank ? fvSteps : stepsForTank(template, tank)) {
    entries.push({
      entry_date: addDays(brewDate, s.day - 1),
      slot: s.slot,
      lane: 'tank',
      tank_id: tank.id,
      // The template's day-1 PM cell is the beer's name; use this booking's beer.
      text: s.task === template.name ? beerName : s.task,
      booking_id: booking.id,
    })
  }
  // Filter day: the beer moves to the bright tank, where the rest of its jobs happen.
  if (brightTank && filterStep) {
    const filterDate = addDays(brewDate, filterStep.day - 1)
    entries.push({ entry_date: filterDate, slot: filterStep.slot, lane: 'tank', tank_id: brightTank.id, text: beerName, booking_id: booking.id })
    for (const s of btSteps) {
      entries.push({ entry_date: addDays(brewDate, s.day - 1), slot: s.slot, lane: 'tank', tank_id: brightTank.id, text: s.task, booking_id: booking.id })
    }
  }
  // Planned packaging goes straight into the Canning / Kegging columns on pack day.
  const when = packDay(brewDate, filterStep, btSteps)
  const { canning, kegging } = packTexts(pack)
  if (when && canning) entries.push({ entry_date: when.date, slot: when.slot, lane: 'canning_1', text: canning, beer_name: beerName, booking_id: booking.id })
  if (when && kegging) entries.push({ entry_date: when.date, slot: when.slot, lane: 'kegging_1', text: kegging, beer_name: beerName, booking_id: booking.id })
  if (entries.length) {
    const { error: e2 } = await supabase.from('schedule_entries').insert(entries)
    if (e2) throw e2
  }
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
