import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadDay } from '../lib/dayTasks'
import { addDays, todayIso, isScheduleEditor, listBeerColours, LANE_LABEL } from '../lib/schedule'
import { beerStyle, setBeerColours } from '../lib/beerColours'
import { tankLabel } from '../lib/tanks'
import TankDay, { TaskLine } from '../components/TankDay.jsx'

const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
const byName = (a, b) => a.tank.name.localeCompare(b.tank.name, undefined, { numeric: true })

function BeerChip({ beer }) {
  if (!beer) return null
  const s = beerStyle(beer)
  return <span className="day-beer" style={{ background: s?.bg, color: s?.fg }}>{beer}</span>
}

// Day at a glance: everything the schedule has for one day, plus cellar suggestions.
export default function TodayPage() {
  const [date, setDate] = useState(todayIso())
  const [day, setDay] = useState(null)
  const [error, setError] = useState(null)
  const [editor, setEditor] = useState(false)
  const load = () => loadDay(date).then(setDay).catch((e) => setError(e.message))
  useEffect(() => { isScheduleEditor().then(setEditor) }, [])
  useEffect(() => { listBeerColours().then(setBeerColours).catch(() => {}) }, [])
  useEffect(() => { setDay(null); setError(null); load() }, [date])

  const tanks = day ? day.tanks.filter((d) => d.scheduled.length || d.fromTemplate.length || d.advice.length) : []
  const fvs = tanks.filter((d) => d.tank.tank_type !== 'BBT').sort(byName)
  const bts = tanks.filter((d) => d.tank.tank_type === 'BBT').sort(byName)
  const empty = day && !day.brewhouse.length && !tanks.length && !day.packaging.length && !day.other.length

  const tankRows = (list) => list.map((d) => (
    <div key={d.tank.id} className="day-row">
      <div className="day-tank">
        <strong>{tankLabel(d.tank.name)}</strong>
        <BeerChip beer={d.beer} />
        {d.batch && <Link to={`/batches/${d.batch.id}`} className="day-batch">#{d.batch.batch_number}</Link>}
      </div>
      <TankDay day={d} editor={editor} />
    </div>
  ))

  return (
    <div className="day-page">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>{date === todayIso() ? 'Today' : 'Day at a glance'}</h1>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button className="secondary" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="secondary" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
          {date !== todayIso() && <button className="secondary" onClick={() => setDate(todayIso())}>Today</button>}
        </div>
      </div>
      <p style={{ color: 'var(--ink2)', marginTop: 4 }}>{fmtDay(date)} · from the <Link to="/schedule">schedule</Link>{editor ? ' · tick tasks off as they’re done' : ''}</p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!day && !error && <p>Loading…</p>}
      {empty && <p className="stock-muted">Nothing on the schedule for this day.</p>}

      {day && day.brewhouse.length > 0 && (
        <section className="day-card">
          <h2>Brewhouse</h2>
          {day.brewhouse.map((t) => (
            <div key={t.id} className="day-row">
              <div className="day-tank"><strong>{LANE_LABEL[t.lane]}</strong><BeerChip beer={t.beer} /></div>
              <TaskLine task={t} editor={editor} />
            </div>
          ))}
        </section>
      )}

      {fvs.length > 0 && <section className="day-card"><h2>Fermenters</h2>{tankRows(fvs)}</section>}
      {bts.length > 0 && <section className="day-card"><h2>Bright tanks</h2>{tankRows(bts)}</section>}

      {day && day.packaging.length > 0 && (
        <section className="day-card">
          <h2>Packaging</h2>
          {day.packaging.map((p, i) => (
            <div key={i} className="day-row">
              <div className="day-tank"><strong>{p.kind}</strong><BeerChip beer={p.beer} />{p.qty > 0 && <span className="stock-muted">{p.qty.toLocaleString()} {p.kind === 'Canning' ? 'cubes' : 'kegs'}</span>}</div>
              <div className="tank-day">{p.tasks.map((t) => <TaskLine key={t.id} task={t} editor={editor} />)}</div>
            </div>
          ))}
        </section>
      )}

      {day && day.other.length > 0 && (
        <section className="day-card">
          <h2>Notes, casuals &amp; deliveries</h2>
          {day.other.map((t) => (
            <div key={t.id} className="day-row">
              <div className="day-tank"><strong>{LANE_LABEL[t.lane]}</strong></div>
              <TaskLine task={t} editor={editor} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
