// Tanks are named "1".."9" on the Tanks page; show those as FV1..FV9 everywhere else.
export function tankLabel(name) {
  if (name == null) return '—'
  return /^\d+$/.test(name) ? `FV${name}` : name
}

// Batches in these statuses are still physically sitting in their tank.
export const IN_TANK_STATUSES = ['planned', 'brewing', 'fermenting', 'chilling', 'conditioning']
// What the Cellar shows in a tank: a beer moves into the cellar once its brew day is completed
// (status fermenting), so a brew sheet made ahead doesn't hide the beer still in the tank.
export const CELLAR_STATUSES = ['fermenting', 'chilling', 'conditioning']

// Statuses are stored lower-case; show them capitalised.
export const statusLabel = (s) => (s === 'chilling' ? 'On chill' : s === 'barrelled' ? 'In barrels' : s ? s[0].toUpperCase() + s.slice(1) : '')
