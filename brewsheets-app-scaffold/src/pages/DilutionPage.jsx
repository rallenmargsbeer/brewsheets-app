import { useState } from 'react'
import { platoToSg, sgToPlato, waterForGravity, gravityAfter, waterForAbv, abvAfter } from '../lib/dilution'

const MODES = [
  { key: 'plato', label: 'Gravity (°P)', unit: '°P', dp: 2 },
  { key: 'sg', label: 'Gravity (SG)', unit: '', dp: 4 },
  { key: 'abv', label: 'ABV (%)', unit: '%', dp: 2 },
]

// Standalone dilution calculator: how much water to hit a target, or where a given amount of
// water lands you. Gravity in °P or SG, or ABV.
export default function DilutionPage() {
  const [mode, setMode] = useState('plato')
  const [volume, setVolume] = useState('')
  const [current, setCurrent] = useState('')
  const [target, setTarget] = useState('')
  const [water, setWater] = useState('')
  const m = MODES.find((x) => x.key === mode)

  const v = Number(volume), c = Number(current), t = Number(target), w = Number(water)
  const toP = (x) => (mode === 'sg' ? sgToPlato(x) : x)
  const fromP = (x) => (mode === 'sg' ? platoToSg(x) : x)
  const need = mode === 'abv' ? waterForAbv(v, c, t) : waterForGravity(v, toP(c), toP(t))
  const after = !water ? null : mode === 'abv' ? abvAfter(v, c, w) : (() => { const g = gravityAfter(v, toP(c), w); return g == null ? null : fromP(g) })()
  const fmt = (x) => `${Number(x).toFixed(m.dp)}${m.unit ? ' ' + m.unit : ''}`
  const placeholder = mode === 'sg' ? '1.048' : mode === 'abv' ? '5.6' : '12.0'

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Dilution calculator</h1>
      <p style={{ color: 'var(--ink2)', marginTop: 0 }}>Work out how much water brings a tank of wort or beer down to a target, or what adding a set amount of water does.</p>

      <div className="dil-modes">
        {MODES.map((x) => (
          <button key={x.key} className={mode === x.key ? '' : 'secondary'} onClick={() => setMode(x.key)}>{x.label}</button>
        ))}
      </div>

      <section className="bd-card">
        <div className="dil-grid">
          <label>Current volume (L)<input type="number" min="0" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="5000" /></label>
          <label>Current {mode === 'abv' ? 'ABV (%)' : `gravity (${mode === 'sg' ? 'SG' : '°P'})`}<input type="number" step="any" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder={placeholder} /></label>
          <label>Target {mode === 'abv' ? 'ABV (%)' : `gravity (${mode === 'sg' ? 'SG' : '°P'})`}<input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        </div>
        <div className="dil-result">
          {need == null ? (
            <span className="stock-muted">Enter the volume, current and target to see how much water to add.</span>
          ) : need > 0 ? (
            <>Add <strong>{Math.round(need).toLocaleString()} L</strong> of water → {Math.round(v + need).toLocaleString()} L at {fmt(t)}</>
          ) : (
            <>Already at or under the target: no water needed.</>
          )}
        </div>
      </section>

      <section className="bd-card">
        <h3>Or: what does adding water do?</h3>
        <div className="dil-grid">
          <label>Water to add (L)<input type="number" min="0" value={water} onChange={(e) => setWater(e.target.value)} /></label>
        </div>
        <div className="dil-result">
          {after == null ? <span className="stock-muted">Uses the current volume and {mode === 'abv' ? 'ABV' : 'gravity'} above.</span> : <>→ <strong>{fmt(after)}</strong> at {Math.round(v + w).toLocaleString()} L</>}
        </div>
      </section>
      <p style={{ color: 'var(--ink2)', fontSize: '0.8rem' }}>Gravity is diluted in SG points ((SG − 1) × 1000), which scale with the extract in solution; ABV scales directly with volume.</p>
    </div>
  )
}
