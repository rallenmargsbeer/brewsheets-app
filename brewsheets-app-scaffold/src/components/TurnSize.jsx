import { useState } from 'react'

// The most a brewhouse turn knocks out at normal gravity. A bigger turn is brewed high gravity:
// the kettle is filled past its normal level and the wort is diluted to the turn size at KO.
export const BREWHOUSE_MAX_L = 2500
export const DEFAULT_KETTLE_FILL_L = 3300
export const isHighGravity = (turnL) => Number(turnL) > BREWHOUSE_MAX_L

// Turn size: the usual sizes as buttons, or Other (any litres). Over 25 HL also asks for the
// kettle fill.
export default function TurnSize({ sizes, value, onChange, kettleFill, onKettleFill, disabled }) {
  const [picked, setOther] = useState(false)
  // Other is showing when picked, or when the value (e.g. from a booking) isn't one of the sizes.
  const other = picked || (value != null && !sizes.includes(Number(value)))
  const hg = isHighGravity(value)
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        {sizes.map((v) => (
          <button key={v} type="button" disabled={disabled} className={!other && Number(value) === v ? '' : 'secondary'}
            onClick={() => { setOther(false); onChange(v) }}>{v / 100}HL</button>
        ))}
        <button type="button" disabled={disabled} className={other ? '' : 'secondary'} onClick={() => setOther(true)}>Other</button>
        {other && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" inputMode="numeric" min="100" step="50" value={value ?? ''} disabled={disabled}
              onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} style={{ width: 90 }} /> L per turn
          </label>
        )}
      </div>
      {hg && (
        <div style={{ marginTop: 6, fontSize: '0.85rem', color: 'var(--ink2)' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            High gravity: fill the kettle to
            <input type="number" inputMode="numeric" min="0" step="50" value={kettleFill ?? ''} disabled={disabled}
              onChange={(e) => onKettleFill(e.target.value === '' ? null : Number(e.target.value))} style={{ width: 80 }} /> L
          </label>
          <div>Ingredients are for {Number(value).toLocaleString()} L a turn; the wort is diluted to that at knockout (the last turn shows how much water).</div>
        </div>
      )}
    </div>
  )
}
