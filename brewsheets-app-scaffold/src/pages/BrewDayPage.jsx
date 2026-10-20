import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tankLabel } from '../lib/tanks'
import { listBookings, bookingBrewDates, todayIso } from '../lib/schedule'
import { listBatches } from '../lib/api'

const sheet = (id) => `/batches/${id}?view=brewday`

export default function BrewDayPage() {
  const [rows, setRows] = useState([])

  // Today's booked brews (a booking whose Brew cell has since moved to another day is left
  // out), each with its batch once it's been started, plus any brew in progress without a booking.
  useEffect(() => {
    const today = todayIso()
    Promise.all([listBookings({ fromIso: today, toIso: today }), listBatches()])
      .then(async ([bookings, batches]) => {
        const brewDates = await bookingBrewDates(bookings.map((b) => b.id))
        const brewCellMoved = (b) => brewDates.has(b.id) && !brewDates.get(b.id).includes(today)
        const started = (b) => batches.find((x) => x.id === b.batch_id) ?? batches.find((x) => x.tank_id === b.tank_id && x.date_brewed === today)
        const booked = bookings.filter((b) => !brewCellMoved(b)).map((b) => ({ key: b.id, name: b.beer_name, tank: b.tanks?.name, turns: b.turn_quantity, turnL: b.turn_volume_l, booking: b, batch: started(b) }))
        const shown = new Set(booked.map((r) => r.batch?.id).filter(Boolean))
        const loose = batches.filter((x) => x.status === 'brewing' && !shown.has(x.id))
          .map((x) => ({ key: x.id, name: `${x.beer_style ?? x.recipes?.name} #${x.batch_number}`, tank: x.tanks?.name, turns: x.turn_quantity, turnL: x.turn_volume_l, batch: x }))
        setRows([...booked, ...loose])
      })
      .catch(() => setRows([]))
  }, [])

  const todo = rows.filter((r) => !r.batch)
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
      <h1>Brew Day</h1>

      {rows.length > 0 && (
        <div style={{ maxWidth: 520, margin: '0 auto 2rem', textAlign: 'left' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Today</h3>
          {rows.map((r) => (
            <div key={r.key} className="bd-booking bd-today">
              <div>
                <strong>{r.name}</strong>
                <div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>
                  {r.batch ? `Started · #${r.batch.batch_number}` : 'Booked'} · {tankLabel(r.tank)}
                  {r.turns && r.turnL ? ` · ${r.turns} × ${r.turnL / 100}HL` : ''}
                </div>
              </div>
              {r.batch
                ? <Link to={sheet(r.batch.id)}><button>Go to sheet</button></Link>
                : <Link to={`/batches/new?booking=${r.booking.id}`}><button>Start</button></Link>}
            </div>
          ))}
        </div>
      )}

      <p style={{ color: 'var(--ink2)', marginBottom: '1.5rem' }}>
        {todo.length ? 'Or start one that isn\'t booked:' : 'Pick a recipe, set the turn volume and number of turns, then fill in the brew sheet.'}
      </p>
      <Link to="/batches/new">
        <button className={todo.length ? 'secondary' : ''} style={{ fontSize: '1.25rem', padding: '1rem 2.5rem' }}>Start brew</button>
      </Link>
      <p style={{ marginTop: '1.25rem' }}>
        <Link to="/brew-day/blend"><button className="secondary" style={{ fontSize: '1.05rem', padding: '0.75rem 1.75rem' }}>Start RTD blend</button></Link>
      </p>
    </div>
  )
}
