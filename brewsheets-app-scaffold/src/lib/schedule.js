import { supabase } from '../supabaseClient'

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

export async function listScheduleEntries(fromIso, toIso) {
  const { data, error } = await supabase
    .from('schedule_entries')
    .select('*')
    .gte('entry_date', fromIso)
    .lte('entry_date', toIso)
  if (error) throw error
  return data
}

export async function saveScheduleEntry(entry) {
  const { id, ...fields } = entry
  const query = id
    ? supabase.from('schedule_entries').update(fields).eq('id', id)
    : supabase.from('schedule_entries').insert(fields)
  const { error } = await query
  if (error) throw error
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
export async function createBooking({ brewDate, beerName, recipeId, template, tank, turnVolumeL, turnQuantity, notes }) {
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
  for (const s of stepsForTank(template, tank)) {
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
