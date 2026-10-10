import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tankLabel } from '../lib/tanks'
import { listBookings, todayIso, addDays } from '../lib/schedule'

const fmt = (isoDate) => new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })

export default function BrewDayPage() {
  const [bookings, setBookings] = useState([])

  // Booked brews not started yet, from a few days back (in case one slipped) to a week ahead.
  useEffect(() => {
    const today = todayIso()
    listBookings({ unbrewedOnly: true, fromIso: addDays(today, -3), toIso: addDays(today, 7) })
      .then(setBookings)
      .catch(() => setBookings([]))
  }, [])

  const today = todayIso()
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
      <h1>Brew Day</h1>

      {bookings.length > 0 && (
        <div style={{ maxWidth: 520, margin: '0 auto 2rem', textAlign: 'left' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Booked brews</h3>
          {bookings.map((b) => (
            <div key={b.id} className={'bd-booking' + (b.brew_date === today ? ' bd-today' : '')}>
              <div>
                <strong>{b.beer_name}</strong>
                <div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>
                  {b.brew_date === today ? 'Today' : fmt(b.brew_date)} · {tankLabel(b.tanks?.name)}
                  {b.turn_quantity ? ` · ${b.turn_quantity} × ${b.turn_volume_l / 100}HL` : ''}
                </div>
              </div>
              <Link to={`/batches/new?booking=${b.id}`}><button>Start</button></Link>
            </div>
          ))}
        </div>
      )}

      <p style={{ color: 'var(--ink2)', marginBottom: '1.5rem' }}>
        {bookings.length ? 'Or start one that isn\'t booked:' : 'Pick a recipe, set the turn volume and number of turns, then fill in the brew sheet.'}
      </p>
      <Link to="/batches/new">
        <button className={bookings.length ? 'secondary' : ''} style={{ fontSize: '1.25rem', padding: '1rem 2.5rem' }}>Start brew</button>
      </Link>
    </div>
  )
}
