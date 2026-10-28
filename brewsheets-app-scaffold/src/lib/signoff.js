import { supabase } from '../supabaseClient'

// The latest brite tank sensory sign-off for each production batch (by its sensory batch, linked
// by id or batch number): { decision: 'green' | 'red', date, notes } or null when none is logged.
export async function loadSignOffs(batches) {
  const out = new Map(batches.map((b) => [b.id, null]))
  if (!batches.length) return out
  const { data, error } = await supabase
    .from('sensory_batches')
    .select('batch_number, production_batch_id, sensory_brite_checks(decision, date, notes, created_at)')
    .in('batch_number', batches.map((b) => String(b.batch_number)))
  if (error) throw error
  for (const b of batches) {
    const s = (data ?? []).find((x) => x.production_batch_id === b.id) ?? (data ?? []).find((x) => x.batch_number === String(b.batch_number))
    const latest = [...(s?.sensory_brite_checks ?? [])].sort((a, c) => c.created_at.localeCompare(a.created_at))[0]
    out.set(b.id, latest ?? null)
  }
  return out
}

// What to tell packers: nothing once it's green-lit, else a warning.
export function signOffWarning(check) {
  if (check?.decision === 'green') return null
  if (check?.decision === 'red') return `Red light on the sensory sign off (${check.date})${check.notes ? `: ${check.notes}` : ''}. Check with QA before packaging.`
  return 'No sensory sign off yet. Get it tasted and green-lit (Packaging sign off) before packaging.'
}
