// Split wort: part of one brewhouse turn goes to another (already scheduled) batch, e.g.
// 500 L of a 2,500 L turn into YP. The ticked ingredients are shared by volume: the donor
// turn keeps the rest, the receiving batch gets the split share.
import { supabase } from '../supabaseClient'

export const qtyOf = (line) => Number(line.actual_qty ?? line.planned_qty ?? 0)

// Default: everything from the brewhouse carries over; fermenter additions (yeast) don't.
export const carriedByDefault = (line) => line.section !== 'fermenter'

// { line, total, move, stay } for each ticked line.
export function splitShares(lines, carried, splitL, turnL) {
  const f = turnL > 0 ? Math.min(1, Math.max(0, splitL / turnL)) : 0
  return lines.filter((l) => carried.has(l.id)).map((l) => {
    const total = qtyOf(l)
    const move = total * f
    return { line: l, total, move, stay: total - move }
  })
}

// Batches a split can go to: scheduled or brewing, not the donor.
export async function listReceivingBatches(excludeId) {
  const { data, error } = await supabase
    .from('batches')
    .select('id, batch_number, beer_style, status, date_brewed, tanks(name), brew_runs(id, run_number, mash_confirmed_at, notes)')
    .in('status', ['planned', 'brewing'])
    .neq('id', excludeId)
    .order('date_brewed', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data
}

const round = (n) => Math.round(n * 1000) / 1000
// Grams (mL for liquids) for notes: kg from 1,000.
const amount = (g) => (g >= 1000 ? `${Math.round(g / 10) / 100} kg` : `${Math.round(g * 10) / 10} g`)
const beerOf = (b) => b.beer_style ?? b.recipes?.name ?? 'beer'
const appendNote = (prev, text) => (prev ? `${prev}\n${text}` : text)

export async function applySplit({ donorBatch, donorRun, shares, splitL, receiving }) {
  const today = new Date().toLocaleDateString('en-CA')
  const recvLabel = `#${receiving.batch_number}${receiving.tanks?.name ? ` (${receiving.tanks.name})` : ''}`

  // 1. Donor turn keeps the rest.
  for (const s of shares) {
    const l = s.line
    const f = s.total > 0 ? s.stay / s.total : 0
    const { error } = await supabase.from('brew_run_ingredients').update({
      actual_qty: round(s.stay),
      planned_qty: l.planned_qty == null ? null : round(Number(l.planned_qty) * f),
      extra_notes: appendNote(l.extra_notes, `Split: ${amount(s.move)} to batch ${recvLabel}`),
    }).eq('id', l.id)
    if (error) throw error
  }

  // 2. Receiving batch: its first unstarted turn, else a new turn.
  const runs = [...(receiving.brew_runs ?? [])].sort((a, b) => a.run_number - b.run_number)
  let target = runs.find((r) => !r.mash_confirmed_at)
  if (target) {
    // Its own planned brewhouse ingredients in the same sections are replaced by the split's.
    const sections = [...new Set(shares.map((s) => s.line.section))]
    const { error } = await supabase.from('brew_run_ingredients').delete().eq('brew_run_id', target.id).in('section', sections)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('brew_runs').insert({ batch_id: receiving.id, run_number: (runs[runs.length - 1]?.run_number ?? 0) + 1 }).select().single()
    if (error) throw error
    target = data
  }
  const rows = shares.map((s, i) => ({
    brew_run_id: target.id,
    section: s.line.section,
    addition_stage: s.line.addition_stage ?? null,
    timing_note: s.line.timing_note ?? null,
    item_name: s.line.item_name,
    planned_qty: round(s.move),
    actual_qty: round(s.move),
    time_min: s.line.time_min ?? null,
    extra_notes: `From split of batch #${donorBatch.batch_number} turn ${donorRun.run_number}`,
    sort_order: i,
    added_at: s.line.added_at ?? null,
  }))
  if (rows.length) {
    const { error } = await supabase.from('brew_run_ingredients').insert(rows)
    if (error) throw error
  }

  // 3. Notes on both turns, and the receiving turn's brew date.
  const r1 = await supabase.from('brew_runs').update({ notes: appendNote(donorRun.notes, `Split ${splitL} L to batch ${recvLabel} on ${today}.`) }).eq('id', donorRun.id)
  if (r1.error) throw r1.error
  const r2 = await supabase.from('brew_runs').update({
    notes: appendNote(target.notes, `${splitL} L split from batch #${donorBatch.batch_number} (${beerOf(donorBatch)}) turn ${donorRun.run_number} on ${today}.`),
    brew_date: donorRun.brew_date ?? today,
  }).eq('id', target.id)
  if (r2.error) throw r2.error
  return { targetRunNumber: target.run_number }
}
