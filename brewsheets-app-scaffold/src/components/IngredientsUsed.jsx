import { useState } from 'react'

const SECTION_ORDER = ['grist', 'water', 'kettle', 'whirlpool', 'fermenter']

// Brew-sheet quantities are stored in grams (ml for liquids, 1:1); convert to the Unleashed
// product's unit. Malt and hops with no unit set in Unleashed are Kg (their stock is held in
// Kg). EA products and anything else unknown can't be converted.
function unleashedUnit(ing) {
  const u = (ing?.base_unit ?? '').trim().toLowerCase()
  if (u) return u
  return /^(malt|hops?)$/i.test((ing?.unleashed_group ?? '').trim()) ? 'kg' : ''
}
function toUnleashed(grams, ing) {
  const u = unleashedUnit(ing)
  if (u === 'kg') return { qty: grams / 1000, unit: 'Kg' }
  if (u === 'g') return { qty: grams, unit: 'g' }
  if (u === 'ml') return { qty: grams, unit: 'ml' }
  if (u === 'l' || u === 'litre' || u === 'litres' || u === 'liter') return { qty: grams / 1000, unit: 'Litre' }
  return null
}

// Same display units as the brew sheet: kg for malt and hops, g for salts and other small additions.
// kg or g following the Unleashed product's unit; otherwise kg for malt and hops,
// g for salts and other small additions (same as the brew sheet).
const showQty = (grams, sections, unit) => {
  if (unit === 'ml') return `${fmt(grams, 1)} ml`
  if (['l', 'litre', 'litres', 'liter'].includes(unit)) return `${fmt(grams / 1000)} L`
  const kg = unit === 'kg' || (unit !== 'g' && sections.some((s) => ['grist', 'kettle', 'whirlpool'].includes(s)))
  return kg ? `${fmt(grams / 1000)} kg` : `${fmt(grams, 1)} g`
}

const fmt = (n, dp = 3) => (n == null ? '—' : Number(n.toFixed(dp)).toLocaleString(undefined, { maximumFractionDigits: dp }))

// Everything that actually went into the beer, summed across all turns, so the
// Unleashed assembly can be built from real usage (substitutions and shortages included).
export default function IngredientsUsed({ batch, ingredients }) {
  const [copied, setCopied] = useState(false)
  const byName = new Map(ingredients.map((i) => [i.name, i]))

  const totals = new Map()
  for (const run of batch.brew_runs ?? []) {
    for (const it of run.brew_run_ingredients ?? []) {
      // One line per ingredient, even if it went in at more than one stage (e.g. kettle and dry hop).
      const row = totals.get(it.item_name) ?? { name: it.item_name, sections: [], planned: 0, actual: 0 }
      if (!row.sections.includes(it.section)) row.sections.push(it.section)
      row.planned += Number(it.planned_qty) || 0
      // The sheet starts each actual at the planned amount, so a blank actual means it was
      // cleared (none went in), not "as planned".
      row.actual += Number(it.actual_qty) || 0
      totals.set(it.item_name, row)
    }
  }
  // Dry hops and other additions made in the cellar (only once actually added).
  for (const a of batch.tank_additions ?? []) {
    if (!a.added_on) continue
    const row = totals.get(a.item_name) ?? { name: a.item_name, sections: [], planned: 0, actual: 0 }
    if (!row.sections.includes('fermenter')) row.sections.push('fermenter')
    row.planned += Number(a.planned_qty) || 0
    row.actual += Number(a.actual_qty) || 0
    totals.set(a.item_name, row)
  }
  const rows = [...totals.values()]
    .map((r) => {
      const ing = byName.get(r.name)
      return { ...r, code: ing?.unleashed_code ?? null, unleashed: toUnleashed(r.actual, ing), baseUnit: ing?.base_unit ?? null, unit: unleashedUnit(ing) }
    })
    .sort((a, b) => SECTION_ORDER.indexOf(a.sections[0]) - SECTION_ORDER.indexOf(b.sections[0]) || a.name.localeCompare(b.name))

  async function copy() {
    // Plain numbers (no thousands separators) so they paste cleanly. A line whose unit can't be
    // worked out gets no quantity rather than a gram figure that could be read as Kg or EA.
    const lines = rows.map((r) => [r.code ?? '', r.name, r.unleashed ? String(+r.unleashed.qty.toFixed(3)) : '', r.unleashed?.unit ?? `CHECK UNIT (${fmt(r.actual, 1)} g on the brew sheet)`].join('\t'))
    try {
      await navigator.clipboard.writeText(['Code\tIngredient\tQty\tUnit', ...lines].join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>Ingredients used</h2>
        {rows.length > 0 && (
          <button className="secondary" onClick={copy}>{copied ? '✓ Copied' : 'Copy for Unleashed'}</button>
        )}
      </div>
      <p style={{ color: 'var(--ink2)', marginTop: '0.25rem' }}>
        Actual amounts from every turn on the brew sheet, totalled per ingredient. Use these to build the assembly in Unleashed.
      </p>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--ink2)' }}>No brew-sheet ingredients recorded for this batch.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th style={{ textAlign: 'right' }}>Actual</th>
                <th style={{ textAlign: 'right' }}>Unleashed qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const changed = Math.abs(r.actual - r.planned) > 0.5
                return (
                  <tr key={r.name}>
                    <td>
                      {r.name}
                      {!r.code && <span style={{ color: 'crimson', fontSize: '0.8rem' }}> · not in Unleashed</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: changed ? 700 : 400, color: changed ? '#d9561f' : undefined }} title={changed ? `Planned ${showQty(r.planned, r.sections, r.unit)}` : undefined}>
                      {showQty(r.actual, r.sections, r.unit)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.unleashed ? (
                        <strong>{fmt(r.unleashed.qty)} {r.unleashed.unit}</strong>
                      ) : (
                        <span style={{ color: '#d9561f' }}>check unit ({r.baseUnit ?? 'none'})</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
