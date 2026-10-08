// Tanks are named "1".."9" on the Tanks page; show those as FV1..FV9 everywhere else.
export function tankLabel(name) {
  if (name == null) return '—'
  return /^\d+$/.test(name) ? `FV${name}` : name
}

// Batches in these statuses are still physically sitting in their tank.
export const IN_TANK_STATUSES = ['planned', 'brewing', 'fermenting', 'conditioning']
