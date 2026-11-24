import { useState } from 'react'
import { toSg } from '../lib/beerCalcs'
import { COMPONENTS, energyLabel, sig3, oneDp } from '../lib/energyLabel'

// The energy statement for this recipe's label, calculated like FSANZ's online calculator.
// Inputs are kept on the recipe (recipes.energy_label). ABV and specific gravity default to the
// recipe's target ABV and target FG until a value is typed in.
const PACKS = [
  { label: '375 mL can', ml: 375, n: 1 },
  { label: '4-pack', ml: 375, n: 4 },
  { label: 'Cube (16 × 375 mL)', ml: 375, n: 16 },
]

export default function EnergyLabel({ recipe, value, onChange }) {
  const v = value ?? {}
  const set = (k, x) => onChange({ ...v, [k]: x === '' ? null : x })
  const setComp = (k, x) => onChange({ ...v, components: { ...(v.components ?? {}), [k]: x === '' ? null : x } })
  const [more, setMore] = useState(() => COMPONENTS.some((c) => !c.main && Number(v.components?.[c.key]) > 0))

  const fgSg = toSg(recipe.target_fg)
  const abv = v.abv ?? recipe.target_abv ?? ''
  const sg = v.sg ?? (fgSg ? Number(fgSg.toFixed(3)) : '')
  const servingMl = v.serving_ml ?? 375
  const servings = v.servings ?? 1
  const r = energyLabel({ abv, sg, components: v.components ?? {}, servingMl, servings })
  const kj = (x) => `${sig3(x).toLocaleString()} kJ`

  const field = (label, val, onCh, placeholder, unit, width = 110) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.85rem', color: '#444' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="number" inputMode="decimal" step="any" min="0" value={val ?? ''} placeholder={placeholder} onChange={(e) => onCh(e.target.value)} style={{ width }} />
        {unit && <span style={{ color: '#666' }}>{unit}</span>}
      </span>
    </label>
  )
  const comp = (c) => field(`${c.label} (${c.kj} kJ/g)`, v.components?.[c.key], (x) => setComp(c.key, x), '0', 'g/100 g', 90)
  const row = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }
  const box = { border: '2px solid #222', maxWidth: 380, fontSize: '0.9rem', background: '#fff' }
  const cell = { padding: '4px 8px', borderTop: '1px solid #222' }
  const statement = r.ok
    ? `ENERGY INFORMATION\nServings per package: ${servings}\nServing size: ${servingMl} mL (${oneDp(r.stdPerServing)} standard drinks)\nAverage quantity per serving: ${kj(r.perServing)}\nAverage quantity per 100 mL: ${kj(r.per100mL)}`
    : ''

  return (
    <div>
      <div style={row}>
        {field('Alcohol', v.abv, (x) => set('abv', x), recipe.target_abv ?? '', '% ABV')}
        {field('Specific gravity', v.sg, (x) => set('sg', x), fgSg ? fgSg.toFixed(3) : '1.010', fgSg ? `(target FG ${recipe.target_fg} °P)` : '0.8 to 1.4')}
      </div>
      <div style={row}>
        {comp(COMPONENTS[0])}{comp(COMPONENTS[1])}{comp(COMPONENTS[2])}
      </div>
      <button type="button" className="secondary" onClick={() => setMore(!more)} style={{ marginBottom: '0.75rem' }}>
        {more ? 'Hide other components' : 'Other components (fibre, organic acids, glycerol, sugar alcohols)'}
      </button>
      {more && <div style={row}>{COMPONENTS.filter((c) => !c.main).map(comp)}</div>}

      <div style={{ ...row, alignItems: 'flex-end' }}>
        {field('Serving size', v.serving_ml, (x) => set('serving_ml', x), '375', 'mL', 90)}
        {field('Servings per package', v.servings, (x) => set('servings', x), '1', '', 80)}
        {PACKS.map((p) => (
          <button key={p.label} type="button" className={Number(servingMl) === p.ml && Number(servings) === p.n ? '' : 'secondary'} onClick={() => onChange({ ...v, serving_ml: p.ml, servings: p.n })}>{p.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
        <table style={{ fontSize: '0.9rem' }}>
          <tbody>
            <tr><td>Alcohol</td><td style={{ textAlign: 'right' }}>{r.alcohol ? `${r.alcohol.toFixed(3)} g/100 g` : '—'}</td></tr>
            <tr><td>Energy per 100 g</td><td style={{ textAlign: 'right' }}>{r.per100g ? `${r.per100g.toFixed(1)} kJ` : '—'}</td></tr>
            <tr><td>Energy per 100 mL</td><td style={{ textAlign: 'right' }}>{r.per100mL ? `${r.per100mL.toFixed(1)} kJ` : '—'}</td></tr>
            <tr><td>Energy per serving</td><td style={{ textAlign: 'right' }}>{r.perServing ? `${r.perServing.toFixed(1)} kJ` : '—'}</td></tr>
            <tr><td>Standard drinks per serving</td><td style={{ textAlign: 'right' }}>{r.stdPerServing ? oneDp(r.stdPerServing) : '—'}</td></tr>
            <tr><td>Standard drinks per package</td><td style={{ textAlign: 'right' }}>{r.stdPerPackage ? oneDp(r.stdPerPackage) : '—'}</td></tr>
          </tbody>
        </table>

        {r.ok ? (
          <div>
            <div style={box}>
              <div style={{ padding: '6px 8px', fontWeight: 700, letterSpacing: 2, textAlign: 'center', background: '#eee' }}>ENERGY INFORMATION</div>
              <div style={cell}>Servings per package: {servings}</div>
              <div style={cell}>Serving size: {servingMl} mL ({oneDp(r.stdPerServing)} standard drinks)</div>
              <div style={{ ...cell, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center', fontSize: '0.8rem' }}>
                <span /><span>Average quantity per serving</span><span>Average quantity per 100 mL</span>
              </div>
              <div style={{ ...cell, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, textAlign: 'center' }}>
                <span style={{ textAlign: 'left' }}>Energy</span><span>{kj(r.perServing)}</span><span>{kj(r.per100mL)}</span>
              </div>
            </div>
            <button type="button" className="secondary" style={{ marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(statement).catch(() => {})}>Copy for the label designer</button>
          </div>
        ) : (
          <p style={{ color: '#666', margin: 0 }}>Enter ABV, specific gravity (0.8 to 1.4), serving size and servings per package.</p>
        )}
      </div>
      <p style={{ color: '#666', fontSize: '0.8rem', marginBottom: 0 }}>
        Same method as FSANZ's alcohol energy calculator. Components are average grams per 100 g of beer (leave 0 if not present).
        The label also needs the package's total standard drinks shown separately ("Contains approximately {r.stdPerPackage ? oneDp(r.stdPerPackage) : 'X.X'} standard drinks" or the logo).
        Not needed if the label has a nutrition information panel.
      </p>
    </div>
  )
}
