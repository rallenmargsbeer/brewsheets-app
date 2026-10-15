import { ABV_TOLERANCE } from '../lib/batchFigures'

// Excise check: ABV (from actual OG and latest gravity) against the recipe's target ABV.
export default function AbvFlag({ check, compact }) {
  if (!check || check.abv == null) return null
  if (check.target == null) return compact ? null : <div className="abv-flag ok">ABV {check.abv.toFixed(2)}%. No target ABV set on the recipe, so it can't be checked for excise.</div>
  const range = `${(check.target - ABV_TOLERANCE).toFixed(1)}% to ${(check.target + ABV_TOLERANCE).toFixed(1)}%`
  if (check.ok) return <div className="abv-flag ok">ABV {check.abv.toFixed(2)}% is within excise range of the {check.target}% target ({range}).</div>
  return (
    <div className="abv-flag bad" role="alert">
      ⚠ ABV {check.abv.toFixed(2)}% is outside the excise range for a {check.target}% target ({range}): {check.diff > 0 ? 'over' : 'under'} by {Math.abs(check.diff).toFixed(2)}%.
    </div>
  )
}
