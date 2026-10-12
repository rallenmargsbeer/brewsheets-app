// Dilution with water. Gravity works in SG points ((SG - 1) x 1000), which scale with
// dissolved extract, so mixing is linear in points x volume; ABV scales the same way.

export const platoToSg = (p) => 1 + p / (258.6 - (p / 258.2) * 227.1)
export const sgToPlato = (sg) => -616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3
const points = (plato) => (platoToSg(plato) - 1) * 1000
const fromPoints = (pts) => sgToPlato(1 + pts / 1000)

// Water (L) to bring `volumeL` from `fromPlato` down to `toPlato`. 0 if already at or under.
export function waterForGravity(volumeL, fromPlato, toPlato) {
  if (!(volumeL > 0) || !(fromPlato > 0) || !(toPlato > 0)) return null
  return Math.max(0, volumeL * (points(fromPlato) / points(toPlato) - 1))
}

// Gravity (°P) after adding `waterL` to `volumeL` at `plato`.
export function gravityAfter(volumeL, plato, waterL) {
  if (!(volumeL > 0) || !(plato > 0)) return null
  return fromPoints((points(plato) * volumeL) / (volumeL + (waterL || 0)))
}

// Volume-weighted gravity of several lots of wort: [{ volumeL, plato }].
export function blendGravity(lots) {
  const ok = lots.filter((l) => l.volumeL > 0 && l.plato > 0)
  const vol = ok.reduce((a, l) => a + l.volumeL, 0)
  if (!vol) return null
  return { volumeL: vol, plato: fromPoints(ok.reduce((a, l) => a + points(l.plato) * l.volumeL, 0) / vol) }
}

export function waterForAbv(volumeL, fromAbv, toAbv) {
  if (!(volumeL > 0) || !(fromAbv > 0) || !(toAbv > 0)) return null
  return Math.max(0, volumeL * (fromAbv / toAbv - 1))
}

export function abvAfter(volumeL, abv, waterL) {
  if (!(volumeL > 0) || !(abv > 0)) return null
  return (abv * volumeL) / (volumeL + (waterL || 0))
}
