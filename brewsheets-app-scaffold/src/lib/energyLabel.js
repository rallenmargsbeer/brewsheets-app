// Energy statement for a beer label (Food Standards Code Standard 2.7.1 / Schedule 11), worked out
// the same way as FSANZ's online alcohol energy calculator
// (foodstandards.gov.au/business/labelling/alcohol-energy-content-calculator):
//   alcohol g/100 g = %ABV × 0.791 ÷ specific gravity
//   kJ/100 g        = Σ component g/100 g × its Schedule 11 energy factor
//   kJ/100 mL       = kJ/100 g × specific gravity
//   kJ per serving  = kJ/100 mL × serving mL ÷ 100
// Label values: energy to 3 significant figures; standard drinks to 1 decimal place.

export const ALCOHOL_G_PER_ML = 0.791 // FSANZ calculator: %ABV to g alcohol
export const STD_DRINK_FACTOR = 0.789 // standard drinks = L × %ABV × 0.789
export const ALCOHOL_KJ_PER_G = 29

// Schedule 11 energy factors (kJ/g), as used by the FSANZ calculator. Beer is usually just
// alcohol, carbohydrate and protein; the rest are there so nothing is missed.
export const COMPONENTS = [
  { key: 'carbohydrate', label: 'Available carbohydrate', kj: 17, main: true },
  { key: 'protein', label: 'Protein', kj: 17, main: true },
  { key: 'fat', label: 'Fat', kj: 37, main: true },
  { key: 'unavailableCarb', label: 'Fibre (and unavailable carbohydrate)', kj: 8 },
  { key: 'organicAcids', label: 'Organic acids', kj: 13 },
  { key: 'glycerol', label: 'Glycerol', kj: 18 },
  { key: 'dAllulose', label: 'D-allulose', kj: 2 },
  { key: 'erythritol', label: 'Erythritol', kj: 1 },
  { key: 'isomalt', label: 'Isomalt', kj: 11 },
  { key: 'lactitol', label: 'Lactitol', kj: 11 },
  { key: 'maltitol', label: 'Maltitol', kj: 13 },
  { key: 'mannitol', label: 'Mannitol', kj: 9 },
  { key: 'polydextrose', label: 'Polydextrose', kj: 5 },
  { key: 'sorbitol', label: 'Sorbitol', kj: 14 },
  { key: 'dTagatose', label: 'D-tagatose', kj: 11 },
  { key: 'xylitol', label: 'Xylitol', kj: 14 },
]

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
export const sig3 = (n) => (n ? Number(Number(n).toPrecision(3)) : 0)
export const oneDp = (n) => Math.round(n * 10) / 10
// FSANZ carries each step forward rounded to 3 decimal places.
const r3 = (n) => parseFloat(Number(n).toFixed(3))

export function energyLabel({ abv, sg, components = {}, servingMl, servings }) {
  const ABV = num(abv), SG = num(sg), serving = num(servingMl), count = num(servings)
  const alcohol = ABV && SG ? r3((ABV * ALCOHOL_G_PER_ML) / SG) : 0
  const per100g = r3(alcohol * ALCOHOL_KJ_PER_G + COMPONENTS.reduce((a, c) => a + num(components[c.key]) * c.kj, 0))
  const per100mL = r3(per100g * SG)
  const perServing = (per100mL * serving) / 100
  const stdPerServing = (serving / 1000) * ABV * STD_DRINK_FACTOR
  return {
    alcohol, per100g, per100mL, perServing,
    stdPerServing, stdPerPackage: stdPerServing * count,
    ok: ABV > 0 && SG >= 0.8 && SG <= 1.4 && serving > 0 && count > 0,
  }
}
