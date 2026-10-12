// Lactic acid (88%) to lower pH, and target pH for a batch's remaining turns.
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

// Buffering: mL of 88% lactic acid per hL per 0.1 pH drop. Shared settings (brew_settings),
// starting from rule-of-thumb figures; adjust on the Calculators page to match what you see.
export const DEFAULT_BUFFER = { mash: 8, wort: 10 }
const KEYS = { mash: 'lactic_mash_ml_per_hl_per_0_1ph', wort: 'lactic_wort_ml_per_hl_per_0_1ph' }

export async function loadBuffer() {
  const { data } = await supabase.from('brew_settings').select('key, value').in('key', Object.values(KEYS))
  const get = (k) => Number(data?.find((r) => r.key === KEYS[k])?.value) || DEFAULT_BUFFER[k]
  return { mash: get('mash'), wort: get('wort') }
}

export async function saveBuffer(stage, value) {
  const { error } = await supabase.from('brew_settings').upsert({ key: KEYS[stage], value, updated_at: new Date().toISOString() })
  if (error) throw error
}

export function useBuffer() {
  const [b, setB] = useState(DEFAULT_BUFFER)
  useEffect(() => { loadBuffer().then(setB).catch(() => {}) }, [])
  return [b, setB]
}

// mL of 88% lactic acid to take `volumeL` from `fromPh` down to `toPh`; 0 if already there.
export function lacticMl(volumeL, fromPh, toPh, mlPerHlPer01) {
  if (!(volumeL > 0) || !(fromPh > 0) || !(toPh > 0) || !(mlPerHlPer01 > 0)) return null
  return Math.max(0, mlPerHlPer01 * (volumeL / 100) * ((fromPh - toPh) / 0.1))
}

// The KO pH the turns still to come need, so the whole batch (volume-weighted) lands on
// `targetPh`. done: [{ volumeL, ph }] already knocked out; remainingL: volume still to brew.
export function remainingTurnsPh(done, remainingL, targetPh) {
  const ok = done.filter((d) => d.volumeL > 0 && d.ph > 0)
  if (!(remainingL > 0) || !(targetPh > 0)) return null
  const doneL = ok.reduce((a, d) => a + d.volumeL, 0)
  const donePh = doneL ? ok.reduce((a, d) => a + d.ph * d.volumeL, 0) / doneL : null
  const need = (targetPh * (doneL + remainingL) - (donePh ?? 0) * doneL) / remainingL
  return { doneL, donePh, need }
}
