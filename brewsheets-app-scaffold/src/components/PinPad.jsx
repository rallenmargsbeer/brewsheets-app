import { useEffect } from 'react'

// Four dots and a 0-9 keypad. Also takes the keyboard's number keys.
export default function PinPad({ value, onChange, onComplete, disabled }) {
  useEffect(() => {
    function onKey(e) {
      if (disabled || e.target.tagName === 'INPUT') return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') onChange(value.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  function press(d) {
    if (disabled || value.length >= 4) return
    const next = value + d
    onChange(next)
    if (next.length === 4) onComplete?.(next)
  }
  return (
    <div className="pinpad">
      <div className="pin-dots" aria-label={`${value.length} of 4 digits`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < value.length ? 'on' : ''} />)}
      </div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button type="button" key={d} disabled={disabled} onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="pin-clear" disabled={disabled || !value} onClick={() => onChange('')}>Clear</button>
        <button type="button" disabled={disabled} onClick={() => press('0')}>0</button>
        <button type="button" className="pin-clear" disabled={disabled || !value} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete">⌫</button>
      </div>
    </div>
  )
}
