import { useState } from 'react'
import { waterForGravity, gravityAfter, waterForAbv, abvAfter } from '../lib/dilution'
import { useBuffer, saveBuffer, lacticMl, remainingTurnsPh } from '../lib/acid'

const MODES = [
  { key: 'plato', label: 'Gravity (°P)', unit: '°P', dp: 2 },
  { key: 'abv', label: 'ABV (%)', unit: '%', dp: 2 },
]

// Standalone dilution calculator: how much water to hit a target, or where a given amount of
// water lands you. Gravity in °P, or ABV.
export default function DilutionPage() {
  const [mode, setMode] = useState('plato')
  const [volume, setVolume] = useState('')
  const [current, setCurrent] = useState('')
  const [target, setTarget] = useState('')
  const [water, setWater] = useState('')
  const m = MODES.find((x) => x.key === mode)

  const v = Number(volume), c = Number(current), t = Number(target), w = Number(water)
  const need = mode === 'abv' ? waterForAbv(v, c, t) : waterForGravity(v, c, t)
  const after = !water ? null : mode === 'abv' ? abvAfter(v, c, w) : gravityAfter(v, c, w)
  const fmt = (x) => `${Number(x).toFixed(m.dp)}${m.unit ? ' ' + m.unit : ''}`
  const placeholder = mode === 'abv' ? '5.6' : '12.0'

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Calculators</h1>
      <h2 className="calc-h">Dilution</h2>
      <p style={{ color: 'var(--ink2)', marginTop: 0 }}>Work out how much water brings a tank of wort or beer down to a target, or what adding a set amount of water does.</p>

      <div className="dil-modes">
        {MODES.map((x) => (
          <button key={x.key} className={mode === x.key ? '' : 'secondary'} onClick={() => setMode(x.key)}>{x.label}</button>
        ))}
      </div>

      <section className="bd-card">
        <div className="dil-grid">
          <label>Current volume (L)<input type="number" min="0" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="5000" /></label>
          <label>Current {mode === 'abv' ? 'ABV (%)' : 'gravity (°P)'}<input type="number" step="any" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder={placeholder} /></label>
          <label>Target {mode === 'abv' ? 'ABV (%)' : 'gravity (°P)'}<input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
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
      <AcidCalculator />
      <PhPlanner />
      <p style={{ color: 'var(--ink2)', fontSize: '0.8rem' }}>Gravity dilution allows for °P not scaling exactly with volume (it's worked out from the extract in solution); ABV scales directly with volume.</p>
    </div>
  )
}

// Lactic acid (88%): mL to bring a mash or wort from one pH to another.
function AcidCalculator() {
  const [buffer, setBuffer] = useBuffer()
  const [stage, setStage] = useState('wort')
  const [volume, setVolume] = useState('')
  const [ph, setPh] = useState('')
  const [target, setTarget] = useState('')
  const [msg, setMsg] = useState(null)
  const ml = lacticMl(Number(volume), Number(ph), Number(target), buffer[stage])
  async function save(value) {
    setMsg(null)
    try { await saveBuffer(stage, value); setMsg('Saved for everyone.') } catch (e) { setMsg('Not saved: ' + e.message) }
  }
  return (
    <>
      <h2 className="calc-h">Lactic acid (88%)</h2>
      <div className="dil-modes">
        {[['mash', 'Mash'], ['wort', 'Kettle / KO wort']].map(([k, l]) => (
          <button key={k} className={stage === k ? '' : 'secondary'} onClick={() => setStage(k)}>{l}</button>
        ))}
      </div>
      <section className="bd-card">
        <div className="dil-grid">
          <label>{stage === 'mash' ? 'Mash liquor volume (L)' : 'Wort volume (L)'}<input type="number" min="0" value={volume} onChange={(e) => setVolume(e.target.value)} /></label>
          <label>Current pH<input type="number" step="0.01" value={ph} onChange={(e) => setPh(e.target.value)} placeholder="5.45" /></label>
          <label>Target pH<input type="number" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="5.20" /></label>
        </div>
        <div className="dil-result">
          {ml == null ? <span className="stock-muted">Enter the volume, current pH and target pH.</span>
            : ml === 0 ? <>Already at or under the target: no acid needed.</>
            : <>Add about <strong>{Math.round(ml).toLocaleString()} mL</strong> lactic acid (88%)</>}
        </div>
        <div className="calc-buffer">
          <label>
            Buffering: mL per hL per 0.1 pH ({stage === 'mash' ? 'mash' : 'wort'})
            <input type="number" step="0.5" min="0" value={buffer[stage]} onChange={(e) => setBuffer({ ...buffer, [stage]: Number(e.target.value) })} onBlur={(e) => save(Number(e.target.value))} />
          </label>
          <span>A starting estimate, shared with the Brew Day suggestions. If additions overshoot, lower it; if they fall short, raise it.{msg ? ` ${msg}` : ''}</span>
        </div>
      </section>
    </>
  )
}

// What pH the rest of a batch's turns need so the whole batch lands on a target.
function PhPlanner() {
  const [doneL, setDoneL] = useState('')
  const [donePh, setDonePh] = useState('')
  const [restL, setRestL] = useState('')
  const [target, setTarget] = useState('')
  const plan = remainingTurnsPh([{ volumeL: Number(doneL), ph: Number(donePh) }], Number(restL), Number(target))
  return (
    <>
      <h2 className="calc-h">KO pH for the remaining turns</h2>
      <section className="bd-card">
        <div className="dil-grid">
          <label>Already knocked out (L)<input type="number" min="0" value={doneL} onChange={(e) => setDoneL(e.target.value)} /></label>
          <label>Their KO pH<input type="number" step="0.01" value={donePh} onChange={(e) => setDonePh(e.target.value)} /></label>
          <label>Still to brew (L)<input type="number" min="0" value={restL} onChange={(e) => setRestL(e.target.value)} /></label>
          <label>Batch target KO pH<input type="number" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        </div>
        <div className="dil-result">
          {plan && Number(doneL) > 0 && Number(donePh) > 0 ? <>Remaining turns should knock out at <strong>{plan.need.toFixed(2)}</strong></> : <span className="stock-muted">Enter what's been brewed, what's left and the target.</span>}
        </div>
      </section>
    </>
  )
}
