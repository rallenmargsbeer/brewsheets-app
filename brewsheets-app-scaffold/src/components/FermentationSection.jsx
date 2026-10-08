import { useState } from 'react'
import { deleteFermentationReading } from '../lib/api'

// °Plato -> specific gravity (standard approximation).
const sg = (p) => 1 + p / (258.6 - (p / 258.2) * 227.1)

// Same "ABV tracker" the Google brewsheets used: (OG - current) in SG x 131.25.
export function abvTracker(ogPlato, plato) {
  if (ogPlato == null || plato == null || ogPlato === '' || plato === '') return null
  return (sg(Number(ogPlato)) - sg(Number(plato))) * 131.25
}

const dayOf = (r, brewed) =>
  r.fermentation_day ?? (brewed && r.reading_date ? Math.round((Date.parse(r.reading_date) - Date.parse(brewed)) / 86400000) : null)

const fmt = (v, dp) => (v == null || v === '' ? '—' : Number(v).toFixed(dp))

// One series (°P over fermentation day), so no legend: the heading names it.
function GravityChart({ points }) {
  const [hover, setHover] = useState(null)
  const W = 640, H = 220, L = 40, R = 12, T = 12, B = 28
  const xs = points.map((p) => p.day)
  const ys = points.map((p) => p.plato)
  const xMax = Math.max(1, ...xs)
  const yMax = Math.ceil(Math.max(...ys) + 0.5)
  const yMin = Math.max(0, Math.floor(Math.min(...ys) - 0.5))
  const x = (d) => L + (d / xMax) * (W - L - R)
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B)
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4)
  const xStep = Math.max(1, Math.ceil(xMax / 8))
  const xTicks = Array.from({ length: Math.floor(xMax / xStep) + 1 }, (_, i) => i * xStep)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.plato)}`).join(' ')

  function onMove(e) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    let best = 0
    points.forEach((p, i) => { if (Math.abs(x(p.day) - px) < Math.abs(x(points[best].day) - px)) best = i })
    setHover(best)
  }

  const h = hover != null ? points[hover] : null
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Gravity in degrees Plato by fermentation day">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t.toFixed(1)}</text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{d}</text>
        ))}
        {h && <line x1={x(h.day)} x2={x(h.day)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.day)} cy={y(p.plato)} r={hover === i ? 5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        ))}
      </svg>
      {h && (
        <div style={{ position: 'absolute', top: 4, left: `${Math.min(80, (x(h.day) / W) * 100)}%`, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: '0.8rem', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          Day {h.day} · {h.date}<br />
          <strong>{h.plato.toFixed(1)} °P</strong>
        </div>
      )}
      <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--muted)' }}>Fermentation day</div>
    </div>
  )
}

export default function FermentationSection({ batch, onChanged }) {
  const readings = [...(batch.fermentation_readings ?? [])].sort(
    (a, b) => (a.reading_date ?? '').localeCompare(b.reading_date ?? '') || (a.created_at ?? '').localeCompare(b.created_at ?? '')
  )
  const points = readings
    .filter((r) => r.gravity_plato != null && dayOf(r, batch.date_brewed) != null)
    .map((r) => ({ day: dayOf(r, batch.date_brewed), plato: Number(r.gravity_plato), date: r.reading_date }))

  async function remove(r) {
    if (!window.confirm(`Delete the ${r.reading_date} reading?`)) return
    await deleteFermentationReading(r.id)
    onChanged()
  }

  const box = { marginBottom: '2rem', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '1rem' }
  return (
    <>
      <h2>Fermentation</h2>
      <div style={box}>
        {readings.length === 0 ? (
          <p style={{ color: 'var(--ink2)', margin: 0 }}>No readings yet. Log them from the Tanks board: tap this batch's tank.</p>
        ) : (
          <>
            {points.length >= 2 && (
              <>
                <h3 style={{ marginTop: 0 }}>Gravity (°P)</h3>
                <GravityChart points={points} />
              </>
            )}
            <div style={{ overflowX: 'auto', marginTop: points.length >= 2 ? '1rem' : 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>°P</th>
                    <th>Temp °C</th>
                    <th>pH</th>
                    <th>ABV tracker</th>
                    <th>Notes</th>
                    <th>Initials</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => {
                    const abv = abvTracker(batch.actual_og, r.gravity_plato)
                    return (
                      <tr key={r.id}>
                        <td>{r.reading_date}</td>
                        <td>{dayOf(r, batch.date_brewed) ?? '—'}</td>
                        <td>{fmt(r.gravity_plato, 1)}</td>
                        <td>{fmt(r.temp_panel, 1)}</td>
                        <td>{fmt(r.ph, 2)}</td>
                        <td>{abv == null ? '—' : `${abv.toFixed(2)}%`}</td>
                        <td>{r.notes ?? ''}</td>
                        <td>{r.initials ?? ''}</td>
                        <td><button className="secondary" onClick={() => remove(r)} aria-label="Delete reading" style={{ padding: '0.2rem 0.5rem' }}>✕</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {batch.actual_og == null && (
              <p style={{ color: 'var(--ink2)', fontSize: '0.85rem', marginBottom: 0 }}>Enter Actual OG (°P) in Batch Details to see the ABV tracker.</p>
            )}
          </>
        )}
      </div>
    </>
  )
}
