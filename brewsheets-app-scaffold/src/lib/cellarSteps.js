// What a fermenter needs next, worked out from what has actually happened to the beer (gravity
// readings, additions, steps ticked off) rather than from the schedule's cells. The brewery's rules:
//  - a gravity reading every day while fermenting
//  - trub off on day 3 and day 5 (brew day is day 1), until it's dry hopped
//  - free rise to 20°C once about half attenuated (gravity halfway from OG to target FG)
//  - "Day 3-4" dry hops (e.g. Riverdog #1) on those days
//  - terminal dry hop and close & spund within 1°P of target FG (beers without a dry hop just spund)
//  - VDK check once gravity is stable (a reading the same as, or higher than, the day before's;
//    target FG doesn't come into it), then chill if the VDK is negative
//  - Biofine the day after chill
//  - after chill, the recipe's cellar template steps (dump hops, 10 psi, filter ...), dated from the
//    day it was actually chilled
import { supabase } from '../supabaseClient'
import { actualOg } from './batchFigures'
import { addDays, daysBetween, stepsForTank } from './schedule'

const FREE_RISE_TEMP = 19.5 // a reading this warm or more means it's been free risen
const DRY_HOP_WITHIN = 1 // °P of target FG

const n = (v) => (v == null || v === '' ? null : Number(v))
const fmtP = (g) => `${Number(g).toFixed(1)} °P`
const fmtD = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })

// Ticked schedule jobs in this batch's tank since brew day, matching a pattern.
const jobsDone = (ctx, re) => ctx.jobs.filter((e) => e.done && re.test(e.text ?? '') && (!ctx.batch.date_brewed || e.entry_date >= ctx.batch.date_brewed) && e.entry_date <= ctx.date)
const actionsDone = (ctx, key) => ctx.actions.filter((a) => a.action === key && a.done_on <= ctx.date)

// The recipe's fermenter hop additions by timing: "Day 3-4" ones (an early dry hop) and terminal ones.
function dryHopGroups(batch) {
  const adds = batch.recipes?.recipe_fermenter_additions ?? []
  const early = [], terminal = []
  for (const a of adds) {
    const t = a.timing_notes ?? ''
    const day = /day\s*(\d+)(?:\s*-\s*(\d+))?/i.exec(t)
    if (day) early.push({ item: a.item_name, from: Number(day[1]), to: Number(day[2] ?? day[1]) })
    else if (/terminal|dry ?hop|\bdh\b/i.test(t)) terminal.push({ item: a.item_name })
  }
  return { early, terminal }
}
const added = (batch) => new Set((batch.tank_additions ?? []).filter((a) => a.added_on).map((a) => a.item_name))

export function cellarSteps(ctx) {
  const { batch, tank, date, template } = ctx
  if (!batch || tank.tank_type === 'BBT') return []
  const out = []
  const day = batch.date_brewed ? daysBetween(batch.date_brewed, date) + 1 : null
  const readings = (batch.fermentation_readings ?? [])
    .filter((r) => r.reading_date <= date)
    .sort((a, b) => a.reading_date.localeCompare(b.reading_date) || String(a.created_at).localeCompare(String(b.created_at)))
  const grav = readings.filter((r) => n(r.gravity_plato) != null)
  const last = grav[grav.length - 1]
  const g = last ? n(last.gravity_plato) : null
  const fg = n(batch.recipes?.target_fg)
  const og = actualOg(batch) ?? n(batch.recipes?.target_og)

  const chillJob = jobsDone(ctx, /chill|crash/i)[0]
  const chillAct = actionsDone(ctx, 'chill')[0]
  const chilled = batch.status !== 'fermenting' || !!chillJob || !!chillAct
  const chillDate = chillAct?.done_on ?? chillJob?.entry_date ?? null

  if (!chilled) {
    // Daily gravity.
    if (!last) out.push({ key: 'reading', text: 'Take a gravity reading', why: 'No gravity reading yet.', level: 'info', link: 'cellar' })
    else if (last.reading_date < date) out.push({ key: 'reading', text: "Take today's gravity reading", why: `Last ${fmtP(g)} on ${fmtD(last.reading_date)}.`, level: 'info', link: 'cellar' })

    const { early, terminal } = dryHopGroups(batch)
    const inTank = added(batch)
    const hopNotes = readings.some((r) => /\bDH\b|dry ?hop/i.test(r.notes ?? ''))
    const termDone = !terminal.length || terminal.every((h) => inTank.has(h.item)) || actionsDone(ctx, 'dry_hop').length > 0
      || jobsDone(ctx, /dry ?hop|\bdh\b/i).some((e) => !/#\s*1\b/.test(e.text)) || (hopNotes && !early.length)

    const spunded = jobsDone(ctx, /spund/i).length > 0 || actionsDone(ctx, 'spund').length > 0
    // Trub off on days 3 and 5, until it's dry hopped (or spunded, for beers without a dry hop).
    const trubs = jobsDone(ctx, /trub/i).length + actionsDone(ctx, 'trub_off').length
    if (day != null && !(terminal.length ? termDone : spunded)) {
      const due = (day >= 3 ? 1 : 0) + (day >= 5 ? 1 : 0)
      if (trubs < due) out.push({ key: 'trub_off', text: trubs === 0 && due === 2 ? 'Trub off (two due)' : 'Trub off', why: `Day ${day}: trub off on days 3 and 5 (${trubs} done).`, level: 'soon' })
    }

    // Free rise once half attenuated.
    const risen = jobsDone(ctx, /20\s*°?\s*c|free ?rise/i).length > 0 || actionsDone(ctx, 'free_rise').length > 0
      || readings.some((r) => n(r.temp_panel) >= FREE_RISE_TEMP)
    const half = og != null && fg != null ? (og + fg) / 2 : null
    if (!risen && !spunded && g != null && half != null && g <= half)
      out.push({ key: 'free_rise', text: 'Free rise to 20°C', why: `About half attenuated: ${fmtP(g)} (OG ${fmtP(og)}, target FG ${fmtP(fg)}).`, level: 'soon' })

    // Early ("Day 3-4") dry hop on its days.
    if (early.length && day != null) {
      const from = Math.min(...early.map((h) => h.from)), to = Math.max(...early.map((h) => h.to))
      const done = early.every((h) => inTank.has(h.item)) || actionsDone(ctx, 'dry_hop_early').length > 0 || jobsDone(ctx, /dry ?hop\s*#?\s*1\b/i).length > 0
      if (!done && day >= from) out.push({ key: 'dry_hop_early', text: 'Dry hop #1', why: `Day ${day}: the recipe's day ${from}${to !== from ? `-${to}` : ''} dry hop. Ingredients on the Cellar tab.`, level: day > to ? 'warn' : 'soon' })
    }

    // Stable: today's reading is the same as, or higher than, the previous day's.
    const prevDay = last ? [...grav].reverse().find((r) => r.reading_date < last.reading_date) : null
    const stable = !!prevDay && g >= n(prevDay.gravity_plato)
    const stableWhy = stable ? `Stable: ${fmtP(prevDay.gravity_plato)} on ${fmtD(prevDay.reading_date)}, ${fmtP(g)} on ${fmtD(last.reading_date)}.` : ''

    // Terminal dry hop and close & spund within 1°P of FG (or once it's stable, if it finished
    // higher); beers without a dry hop just spund.
    const nearFg = g != null && fg != null && g <= fg + DRY_HOP_WITHIN
    const hopWhy = nearFg ? `Within 1°P of target FG: ${fmtP(g)}, target ${fmtP(fg)}.` : stableWhy
    if ((nearFg || stable) && terminal.length && !termDone)
      out.push({ key: 'dry_hop', text: spunded ? 'Dry hop' : 'Dry hop + close & spund', why: `${hopWhy} Ingredients on the Cellar tab.`, level: 'soon', also: spunded ? null : 'spund' })
    else if ((nearFg || stable) && !spunded && (termDone || !terminal.length))
      out.push({ key: 'spund', text: 'Close & spund', why: hopWhy, level: 'soon' })

    const vdks = [...actionsDone(ctx, 'vdk')].sort((a, b) => a.done_on.localeCompare(b.done_on) || a.created_at.localeCompare(b.created_at))
    const vdkJob = jobsDone(ctx, /vdk|diacetyl/i).length > 0
    const lastVdk = vdks[vdks.length - 1]
    const vdkPass = lastVdk?.result === 'pass' || (!lastVdk && vdkJob)
    if (stable && termDone) {
      if (vdkPass) out.push({ key: 'chill', text: 'Chill', why: `VDK negative${lastVdk ? ` (${fmtD(lastVdk.done_on)})` : ''}.`, level: 'go' })
      else if (lastVdk?.result === 'fail') out.push({ key: 'vdk', text: 'Recheck VDK', why: `Failed on ${fmtD(lastVdk.done_on)}. Recheck before chilling.`, level: 'warn', vdk: true })
      else out.push({ key: 'vdk', text: 'VDK check', why: stableWhy, level: 'go', vdk: true })
    }
    return out
  }

  // On chill in the FV: the template's steps after Chill, dated from the actual chill day.
  const steps = template ? stepsForTank(template, tank) : []
  const chillStep = steps.find((s) => /chill|crash/i.test(s.task))
  const after = chillStep ? steps.filter((s) => Number(s.day) > Number(chillStep.day) || (Number(s.day) === Number(chillStep.day) && s.slot === 'PM' && chillStep.slot === 'AM')).filter((s) => !/can|keg/i.test(s.task) || /dump/i.test(s.task)) : []
  for (const s of after.filter((x) => !/biofine/i.test(x.task))) {
    const key = `tpl:${s.task.trim().toLowerCase()}`
    const re = new RegExp(`^\\s*${s.task.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
    const done = actionsDone(ctx, key).length > 0 || ctx.jobs.some((e) => e.done && re.test(e.text ?? '') && (!chillDate || e.entry_date >= chillDate))
    if (done) continue
    const dueOn = chillDate ? addDays(chillDate, Number(s.day) - Number(chillStep.day)) : null
    if (dueOn && dueOn > date) continue
    const filter = /filter|transfer/i.test(s.task)
    out.push({ key, text: s.task, why: dueOn ? `${Number(s.day) - Number(chillStep.day)} day${Number(s.day) - Number(chillStep.day) === 1 ? '' : 's'} after chill (${fmtD(chillDate)}).${filter ? ' Transfer from the Cellar tab.' : ''}` : 'After chill.', level: dueOn && dueOn < date ? 'warn' : 'soon', link: filter ? 'cellar' : null, noDone: filter })
  }
  // Biofine the day after chill (it's ticked off when marked added on the Cellar tab).
  const bioDue = chillDate ? addDays(chillDate, 1) : null
  if ((batch.tank_additions ?? []).some((a) => /biofine/i.test(a.item_name ?? '') && !a.added_on) && (!bioDue || bioDue <= date))
    out.push({ key: 'biofine', text: 'Biofine', why: `${bioDue ? `Day after chill (${fmtD(chillDate)}). ` : ''}Amount on the Cellar tab.`, level: bioDue && bioDue < date ? 'warn' : 'soon', link: 'cellar', noDone: true })
  return out
}

// Tick a step off (or log a VDK result). Chill also puts the batch on chill.
export async function recordCellarAction(batch, action, result = null) {
  const { error } = await supabase.from('cellar_actions').insert({ batch_id: batch.id, action, result })
  if (error) throw error
  if (action === 'chill') {
    const { error: e2 } = await supabase.from('batches').update({ status: 'chilling' }).eq('id', batch.id).eq('status', 'fermenting')
    if (e2) throw e2
  }
}

// Which schedule cells the steps above already cover (so they aren't listed twice).
export const COVERED_JOB = /trub|20\s*°?\s*c|free ?rise|dry ?hop|\bdh\b|spund|vdk|diacetyl|chill|crash|dump|psi|filter|biofine/i
