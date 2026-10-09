import { useState } from 'react'

const SECTION_ORDER = ['grist', 'water', 'kettle', 'whirlpool', 'fermenter']

// Brew-sheet quantities are stored in grams; convert to the Unleashed product's unit
// where that's a weight. Litre / ml / EA products can't be converted from grams.
function toUnleashed(grams, baseUnit) {
  const u = (baseUnit ?? '').toLowerCase()
  if (u === 'kg') return { qty: grams / 1000, unit: 'Kg' }
  if (u === 'g') return { qty: grams, unit: 'g' }
  return null
}

// Same display units as the brew sheet: kg for malt and hops, g for salts and other small additions.
// kg or g following the Unleashed product's unit; otherwise kg for malt and hops,
// g for salts and other small additions (same as the brew sheet).
const showQty = (grams, sections, baseUnit) => {
  const u = (baseUnit ?? '').toLowerCase()
  const kg = u === 'kg' || (u !== 'g' && sections.some((s) => ['grist', 'kettle', 'whirlpool'].includes(s)))
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
      row.actual += Number(it.actual_qty ?? it.planned_qty) || 0
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
      return { ...r, code: ing?.unleashed_code ?? null, unleashed: toUnleashed(r.actual, ing?.base_unit), baseUnit: ing?.base_unit ?? null }
    })
    .sort((a, b) => SECTION_ORDER.indexOf(a.sections[0]) - SECTION_ORDER.indexOf(b.sections[0]) || a.name.localeCompare(b.name))

  async function copy() {
    const lines = rows.map((r) => [r.code ?? '', r.name, r.unleashed ? fmt(r.unleashed.qty) : `${fmt(r.actual, 1)} g`, r.unleashed?.unit ?? r.baseUnit ?? ''].join('\t'))
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
                    <td style={{ textAlign: 'right', fontWeight: changed ? 700 : 400, color: changed ? '#a66a00' : undefined }} title={changed ? `Planned ${showQty(r.planned, r.sections, r.baseUnit)}` : undefined}>
                      {showQty(r.actual, r.sections, r.baseUnit)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.unleashed ? (
                        <strong>{fmt(r.unleashed.qty)} {r.unleashed.unit}</strong>
                      ) : (
                        <span style={{ color: '#a66a00' }}>check unit ({r.baseUnit ?? 'none'})</span>
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
