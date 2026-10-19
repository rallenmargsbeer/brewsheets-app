// IBU (Tinseth) and colour (SRM, Morey) estimates. The formulas are conventionally in
// lb / oz / gallons and SG; the app is metric and °P everywhere else, so conversions stay in here.
import { platoToSg, sgToPlato } from './dilution'

const KG_TO_LB = 2.20462
const L_TO_GAL = 0.264172

// Gravity as SG whether it was entered in °P (e.g. 12) or SG (e.g. 1.048).
export const toSg = (g) => {
  const n = Number(g)
  if (g == null || g === '' || !n) return null
  return n < 1.5 ? n : platoToSg(n)
}

// Tinseth IBU. hops: [{ grams, alphaPct, minutes }]; volumeL: wort volume; gravity: °P or SG.
export function tinsethIbu(hops, gravity, volumeL) {
  const sg = toSg(gravity)
  if (!sg || !(volumeL > 0)) return null
  const gal = volumeL * L_TO_GAL
  const bigness = 1.65 * Math.pow(0.000125, sg - 1)
  let total = 0
  let any = false
  for (const h of hops) {
    if (!(h.grams > 0) || h.alphaPct == null || h.minutes == null) continue
    const oz = (h.grams / 1000) * KG_TO_LB * 16
    const util = bigness * ((1 - Math.exp(-0.04 * Number(h.minutes))) / 4.15)
    total += (oz * (h.alphaPct / 100) * util * 7489) / gal
    any = true
  }
  return any ? total : null
}

// Morey SRM. malts: [{ grams, lovibond }]; volumeL: final volume.
export function moreySrm(malts, volumeL) {
  if (!(volumeL > 0)) return null
  const gal = volumeL * L_TO_GAL
  let mcu = 0
  let any = false
  for (const m of malts) {
    if (!(m.grams > 0) || m.lovibond == null) continue
    mcu += ((m.grams / 1000) * KG_TO_LB * Number(m.lovibond)) / gal
    any = true
  }
  return any ? 1.4922 * Math.pow(mcu, 0.6859) : null
}

// Lookups from the Ingredients page by name.
export const byName = (ingredients, field) => new Map(ingredients.filter((i) => i[field] != null).map((i) => [i.name, Number(i[field])]))

// Estimated OG (°P) from grist in g/L: potential (PPG, from the Ingredients page) x brewhouse
// efficiency. 1 kg/L = 8.3454 lb/gal. Null if any malt has no PPG.
export function estimateOg(malts, effPct) {
  let points = 0
  let any = false
  for (const m of malts) {
    if (!(m.grams > 0)) continue
    if (m.ppg == null) return null
    points += (m.grams / 1000) * 8.3454 * m.ppg * (effPct / 100)
    any = true
  }
  return any ? sgToPlato(1 + points / 1000) : null
}

// ABV from OG and FG (°P or SG), same formula as the fermentation ABV tracker.
export function estimateAbv(og, fg) {
  const a = toSg(og), b = toSg(fg)
  return a && b ? (a - b) * 131.25 : null
}
