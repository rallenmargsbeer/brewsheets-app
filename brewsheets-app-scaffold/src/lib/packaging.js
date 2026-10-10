// Pack formats: kegs by size, and cubes of 16 x 375 mL cans (6 L each).
export const KEG_SIZES = [20, 30, 50]
export const CANS_PER_CUBE = 16
export const LITRES_PER_CUBE = (CANS_PER_CUBE * 375) / 1000
// Canning is scheduled in whole pallets of empty cans.
export const CANS_PER_PALLET = 3456
export const CUBES_PER_PALLET = CANS_PER_PALLET / CANS_PER_CUBE // 216
export const LITRES_PER_PALLET = (CANS_PER_PALLET * 375) / 1000 // 1296

export function sumSessions(sessions) {
  const t = { kegs_20: 0, kegs_30: 0, kegs_50: 0, cubes: 0 }
  for (const s of sessions) for (const k of Object.keys(t)) t[k] += Number(s[k]) || 0
  t.kegs = t.kegs_20 + t.kegs_30 + t.kegs_50
  t.litres = t.kegs_20 * 20 + t.kegs_30 * 30 + t.kegs_50 * 50 + t.cubes * LITRES_PER_CUBE
  return t
}
