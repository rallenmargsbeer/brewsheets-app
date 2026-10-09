import { useState } from 'react'

const SECTION_ORDER = ['grist', 'water', 'kettle', 'whirlpool', 'fermenter']
const SECTION_LABEL = { grist: 'Grist', water: 'Water', kettle: 'Kettle', whirlpool: 'Whirlpool', fermenter: 'Fermenter' }

// Brew-sheet quantities are stored in grams; convert to the Unleashed product's unit
// where that's a weight. Litre / ml / EA products can't be converted from grams.
function toUnleashed(grams, baseUnit) {
  const u = (baseUnit ?? '').toLowerCase()
  if (u === 'kg') return { qty: grams / 1000, unit: 'Kg' }
  if (u === 'g') return { qty: grams, unit: 'g' }
  return null
}

// Same display units as the brew sheet: kg for malt and hops, g for salts and other small additions.
const showQty = (grams, section) =>
  ['grist', 'kettle', 'whirlpool'].includes(section) ? `${fmt(grams / 1000)} kg` : `${fmt(grams, 1)} g`

const fmt = (n, dp = 3) => (n == null ? '—' : Number(n.toFixed(dp)).toLocaleString(undefined, { maximumFractionDigits: dp }))

// Everything that actually went into the beer, summed across all turns, so the
// Unleashed assembly can be built from real usage (substitutions and shortages included).
export default function IngredientsUsed({ batch, ingredients }) {
  const [copied, setCopied] = useState(false)
  const byName = new Map(ingredients.map((i) => [i.name, i]))

  const totals = new Map()
  for (const run of batch.brew_runs ?? []) {
    for (const it of run.brew_run_ingredients ?? []) {
      const key = `${it.section}|${it.item_name}`
      const row = totals.get(key) ?? { section: it.section, name: it.item_name, planned: 0, actual: 0 }
      row.planned += Number(it.planned_qty) || 0
      row.actual += Number(it.actual_qty ?? it.planned_qty) || 0
      totals.set(key, row)
    }
  }
  const rows = [...totals.values()]
    .map((r) => {
      const ing = byName.get(r.name)
      return { ...r, code: ing?.unleashed_code ?? null, unleashed: toUnleashed(r.actual, ing?.base_unit), baseUnit: ing?.base_unit ?? null }
    })
    .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || a.name.localeCompare(b.name))

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
                <th>Section</th>
                <th>Code</th>
                <th>Ingredient</th>
                <th style={{ textAlign: 'right' }}>Planned</th>
                <th style={{ textAlign: 'right' }}>Actual</th>
                <th style={{ textAlign: 'right' }}>Unleashed qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const changed = Math.abs(r.actual - r.planned) > 0.5
                return (
                  <tr key={`${r.section}|${r.name}`}>
                    <td style={{ color: 'var(--ink2)' }}>{SECTION_LABEL[r.section] ?? r.section}</td>
                    <td style={{ color: 'var(--ink2)' }}>{r.code ?? <span style={{ color: 'crimson' }}>not in Unleashed</span>}</td>
                    <td>{r.name}</td>
                    <td style={{ textAlign: 'right', color: 'var(--ink2)' }}>{showQty(r.planned, r.section)}</td>
                    <td style={{ textAlign: 'right', fontWeight: changed ? 700 : 400, color: changed ? '#a66a00' : undefined }}>{showQty(r.actual, r.section)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.unleashed ? (
                        <strong>{fmt(r.unleashed.qty)} {r.unleashed.unit}</strong>
                      ) : (
                        <span style={{ color: '#a66a00' }}>{fmt(r.actual, 1)} g · check unit ({r.baseUnit ?? 'none'})</span>
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
