import { useState } from 'react'
import { deleteFermentationReading, updateFermentationReading } from '../lib/api'
import { useAutoSave, SaveStatus } from '../lib/useAutoSave.jsx'
import AbvFlag from './AbvFlag.jsx'
import { useBatchJobs, JobsCell } from './BatchJobs.jsx'
import { gravityAdvice, isChilled } from '../lib/dayTasks'
import { withinExcise, ABV_TOLERANCE } from '../lib/batchFigures'
import { sgToPlato } from '../lib/dilution'

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

// FG (°P) that gives this ABV from the OG, inverting the tracker formula.
const fgForAbv = (ogPlato, abv) => sgToPlato(sg(Number(ogPlato)) - abv / 131.25)

// One series (°P over fermentation day), so no legend: the heading names it. band: the FG
// range that finishes the beer within its excise ABV range, shaded behind the line.
function GravityChart({ points, events = [], band = null }) {
  const [hover, setHover] = useState(null)
  const W = 640, H = 220, L = 40, R = 12, T = 12, B = 28
  const xs = points.map((p) => p.day)
  const ys = points.map((p) => p.plato)
  const xMax = Math.max(1, ...xs, ...events.map((e) => e.day))
  const yMax = Math.ceil(Math.max(...ys, ...(band ? [band.hi] : [])) + 0.5)
  const yMin = Math.max(0, Math.floor(Math.min(...ys, ...(band ? [band.lo] : [])) - 0.5))
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
        {band && (
          <g>
            <rect x={L} width={W - L - R} y={y(band.hi)} height={Math.max(1, y(band.lo) - y(band.hi))} fill="#11603f" opacity="0.12" />
            <text x={L + 4} y={y(band.hi) - 4} textAnchor="start" fontSize="11" fill="var(--ink2)">In spec: FG {band.lo.toFixed(1)} to {band.hi.toFixed(1)} °P (ABV {band.abvLo.toFixed(1)} to {band.abvHi.toFixed(1)}%)</text>
          </g>
        )}
        {h && <line x1={x(h.day)} x2={x(h.day)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
        {/* Tank additions (dry hops etc.): a marker line per day, labelled with what went in */}
        {events.map((e) => (
          <g key={e.day}>
            <line x1={x(e.day)} x2={x(e.day)} y1={T} y2={H - B} stroke="#11603f" strokeWidth="1.5" strokeDasharray="4 3" />
            {/* Labels near the right edge sit to the left of the line so they aren't cut off */}
            <text x={x(e.day) > W * 0.65 ? x(e.day) - 4 : x(e.day) + 4} textAnchor={x(e.day) > W * 0.65 ? 'end' : 'start'} y={T + 10} fontSize="11" fill="var(--ink)">{e.label}</text>
          </g>
        ))}
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

// One reading's cells as inputs; each saves as it's typed.
function EditRow({ r, onDone, onChanged }) {
  const [v, setV] = useState({ gravity_plato: r.gravity_plato ?? '', temp_panel: r.temp_panel ?? '', ph: r.ph ?? '', notes: r.notes ?? '', initials: r.initials ?? '', reading_date: r.reading_date })
  const NUM = ['gravity_plato', 'temp_panel', 'ph']
  const { saveSoon, saveNow, status } = useAutoSave(async (k, val) => {
    if (k === 'reading_date' && !val) return // a reading always has a date
    await updateFermentationReading(r.id, { [k]: val === '' ? null : NUM.includes(k) ? Number(val) : val })
    onChanged()
  })
  const box = (k, props = {}) => (
    <input value={v[k]} {...props}
      onChange={(e) => { setV({ ...v, [k]: e.target.value }); saveSoon(k, e.target.value) }}
      onBlur={(e) => saveNow(k, e.target.value)} />
  )
  const num = { type: 'number', inputMode: 'decimal', style: { width: 64 } }
  return (
    <tr className="reading-edit">
      <td>{box('reading_date', { type: 'date', style: { width: 130 } })}</td>
      <td></td>
      <td>{box('gravity_plato', { ...num, step: '0.1' })}</td>
      <td>{box('temp_panel', { ...num, step: '0.1' })}</td>
      <td>{box('ph', { ...num, step: '0.01' })}</td>
      <td><SaveStatus status={status} /></td>
      <td>{box('notes', { style: { width: 140 } })}</td>
      <td>{box('initials', { style: { width: 50 } })}</td>
      <td></td>
      <td><button onClick={onDone} style={{ padding: '0.2rem 0.5rem' }}>Done</button></td>
    </tr>
  )
}

export default function FermentationSection({ batch, og = batch.actual_og, check, onChanged }) {
  const readings = [...(batch.fermentation_readings ?? [])].sort(
    (a, b) => (a.reading_date ?? '').localeCompare(b.reading_date ?? '') || (a.created_at ?? '').localeCompare(b.created_at ?? '')
  )
  const points = readings
    .filter((r) => r.gravity_plato != null && dayOf(r, batch.date_brewed) != null)
    .map((r) => ({ day: dayOf(r, batch.date_brewed), plato: Number(r.gravity_plato), date: r.reading_date }))

  // Tank additions logged on the Cellar tab, grouped by day for the chart.
  const added = (batch.tank_additions ?? [])
    .filter((a) => a.added_on)
    .map((a) => ({ ...a, day: dayOf({ reading_date: a.added_on }, batch.date_brewed) }))
    .sort((a, b) => a.added_on.localeCompare(b.added_on))
  const byDay = new Map()
  for (const a of added) if (a.day != null) byDay.set(a.day, [...(byDay.get(a.day) ?? []), a.item_name])
  const events = [...byDay].map(([day, names]) => ({ day, label: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] }))

  const [editing, setEditing] = useState(null)
  async function remove(r) {
    if (!window.confirm(`Delete this ${r.reading_date} reading${r.gravity_plato != null ? ` (${r.gravity_plato} °P)` : ''}?`)) return
    await deleteFermentationReading(r.id)
    onChanged()
  }

  // Jobs (schedule or cellar template) sit in the readings table, on their date's row.
  const { rows: jobRows, refresh: refreshJobs } = useBatchJobs(batch)
  const todayIso = new Date().toLocaleDateString('en-CA')
  const advice = gravityAdvice(batch, todayIso, { chilled: isChilled(batch, jobRows.map((j) => ({ ...j.task, entry_date: j.date })), todayIso) })
  const jobsByDate = jobRows.reduce((m, j) => m.set(j.date, [...(m.get(j.date) ?? []), j]), new Map())
  const dates = [...new Set([...readings.map((r) => r.reading_date), ...jobsByDate.keys()])].filter(Boolean).sort()
  const lines = dates.flatMap((d) => {
    const rs = readings.filter((r) => r.reading_date === d)
    const jobs = jobsByDate.get(d) ?? []
    return rs.length ? rs.map((r, i) => ({ date: d, r, jobs: i === 0 ? jobs : [] })) : [{ date: d, r: null, jobs }]
  })

  // Several readings on one day show their time too.
  const sameDay = readings.reduce((m, r) => m.set(r.reading_date, (m.get(r.reading_date) ?? 0) + 1), new Map())
  const target = batch.recipes?.target_abv != null ? Number(batch.recipes.target_abv) : null
  const band = og != null && target != null ? (() => {
    const abvLo = target - ABV_TOLERANCE, abvHi = target + ABV_TOLERANCE
    return { lo: fgForAbv(og, abvHi), hi: fgForAbv(og, abvLo), abvLo, abvHi }
  })() : null
  const abvClass = (abv) => (abv == null || target == null ? '' : withinExcise(abv, target) ? 'abv-cell ok' : 'abv-cell bad')
  const box = { marginBottom: '2rem', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '1rem' }
  return (
    <>
      <AbvFlag check={check} />
      <div style={box}>
        {advice.map((a, i) => <div key={'a' + i} className={`day-advice ${a.level}`} style={{ marginBottom: '0.4rem' }}>{a.text}</div>)}
        {lines.length === 0 ? (
          <p style={{ color: 'var(--ink2)', margin: 0 }}>No readings yet. Log them from the Cellar tab: tap this batch's tank.</p>
        ) : (
          <>
            {points.length >= 2 && (
              <>
                <h3 style={{ marginTop: 0 }}>Gravity (°P)</h3>
                <GravityChart points={points} events={events} band={band} />
              </>
            )}
            {added.length > 0 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--ink2)', margin: '0.5rem 0 0' }}>
                <strong style={{ color: '#11603f' }}>Tank additions:</strong>{' '}
                {added.map((a) => `Day ${a.day ?? '?'} ${a.item_name} ${a.actual_qty != null ? `${+(a.actual_qty / 1000).toFixed(3)} kg` : ''}${a.initials ? ` (${a.initials})` : ''}`).join(' · ')}
              </p>
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
                    <th>Jobs</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(({ date, r, jobs }) => {
                    if (!r) return (
                      <tr key={'j' + date} className={'jobs-only' + (date === todayIso ? ' today' : '')}>
                        <td>{date}</td>
                        <td>{dayOf({ reading_date: date }, batch.date_brewed) ?? '—'}</td>
                        <td colSpan={6}></td>
                        <td><JobsCell jobs={jobs} onChanged={refreshJobs} /></td>
                        <td></td>
                      </tr>
                    )
                    if (editing === r.id) return <EditRow key={r.id} r={r} onDone={() => setEditing(null)} onChanged={onChanged} />
                    const abv = abvTracker(og, r.gravity_plato)
                    return (
                      <tr key={r.id} className={date === todayIso ? 'today' : ''}>
                        <td>{r.reading_date}{sameDay.get(r.reading_date) > 1 && r.created_at ? ` ${new Date(r.created_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}` : ''}</td>
                        <td>{dayOf(r, batch.date_brewed) ?? '—'}</td>
                        <td>{fmt(r.gravity_plato, 1)}</td>
                        <td>{fmt(r.temp_panel, 1)}</td>
                        <td>{fmt(r.ph, 2)}</td>
                        <td className={abvClass(abv)}>{abv == null ? '—' : `${abv.toFixed(2)}%`}</td>
                        <td>{r.notes ?? ''}</td>
                        <td>{r.initials ?? ''}</td>
                        <td>{jobs.length > 0 && <JobsCell jobs={jobs} onChanged={refreshJobs} />}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="secondary" onClick={() => setEditing(r.id)} aria-label="Edit reading" style={{ padding: '0.2rem 0.5rem', marginRight: 4 }}>✎</button>
                          <button className="secondary" onClick={() => remove(r)} aria-label="Delete reading" style={{ padding: '0.2rem 0.5rem' }}>✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {og == null && (
              <p style={{ color: 'var(--ink2)', fontSize: '0.85rem', marginBottom: 0 }}>The ABV tracker starts once a KO gravity is entered on Brew Day.</p>
            )}
          </>
        )}
      </div>
    </>
  )
}
