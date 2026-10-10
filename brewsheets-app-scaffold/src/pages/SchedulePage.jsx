import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listTanks, listRecipes } from '../lib/api'
import { tankLabel } from '../lib/tanks'
import {
  todayIso,
  addDays,
  mondayOf,
  BREW_LANES,
  PACK_LANES,
  LANE_LABEL,
  isScheduleEditor,
  listScheduleEntries,
  saveScheduleEntry,
  deleteScheduleEntry,
  listCellarTemplates,
  getBooking,
  listBookings,
  moveBooking,
  cancelBooking,
} from '../lib/schedule'
import BookBrewDialog from '../components/BookBrewDialog.jsx'
import { assignBeers, beerColour, beerInTank } from '../lib/beerColours'

// How far back to look for the brew that started each tank's run of jobs (a lager runs ~4 weeks).
const LOOKBACK_DAYS = 42
// The schedule is one continuous list of days: it opens a week before today and loads
// another four weeks each time you scroll near the bottom (or tap Load earlier at the top).
const CHUNK_DAYS = 28

const DAY_FMT = { weekday: 'short', day: 'numeric', month: 'short' }
const fmtDay = (isoDate) => new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-AU', DAY_FMT)

// Cell colour comes from the beer; brew days are also bold.
const isBrew = (text) => text.trim().toLowerCase() === 'brew'

// Fermenters (numbered) first, then other non-BBT vessels like YP, then bright tanks.
function orderTanks(tanks) {
  const rank = (t) => (t.tank_type === 'BBT' ? 2 : /^\d+$/.test(t.name) ? 0 : 1)
  return tanks
    .filter((t) => t.is_active !== false)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }))
}

function CellEditor({ cell, column, entries, onClose, onChanged }) {
  const [rows, setRows] = useState(entries.map((e) => ({ ...e })))
  const [newText, setNewText] = useState('')
  const [booking, setBooking] = useState(null)
  const [moveTo, setMoveTo] = useState('')
  const [error, setError] = useState(null)
  const bookingId = entries.find((e) => e.booking_id)?.booking_id

  useEffect(() => {
    if (bookingId) getBooking(bookingId).then((b) => { setBooking(b); setMoveTo(b.brew_date) }).catch(() => {})
  }, [bookingId])

  async function run(fn) {
    setError(null)
    try {
      await fn()
      onChanged()
      onClose()
    } catch (e) {
      setError(e.message)
    }
  }

  async function saveAll() {
    for (const r of rows) {
      const orig = entries.find((e) => e.id === r.id)
      if (!r.text.trim()) await deleteScheduleEntry(r.id)
      else if (orig.text !== r.text || orig.done !== r.done) await saveScheduleEntry({ id: r.id, text: r.text.trim(), done: r.done })
    }
    if (newText.trim()) {
      await saveScheduleEntry({
        entry_date: cell.date,
        slot: cell.slot,
        lane: column.lane,
        tank_id: column.tankId ?? null,
        text: newText.trim(),
      })
    }
  }

  return (
    <div className="sc-overlay" onClick={onClose}>
      <div className="sc-dialog" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{column.label} · {fmtDay(cell.date)} {cell.slot}</h3>
          <button className="secondary" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {rows.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem' }}>
            <input value={r.text} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} style={{ flex: 1 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={!!r.done} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} /> Done
            </label>
          </div>
        ))}
        <input
          placeholder={rows.length ? 'Add another…' : 'e.g. Trub Off'}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: '0.6rem' }}
        />
        <p style={{ color: 'var(--ink2)', fontSize: '0.8rem', margin: '0.3rem 0 0' }}>Clear a box to remove it.</p>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button onClick={() => run(saveAll)}>Save</button>
          <button className="secondary" onClick={onClose}>Cancel</button>
        </div>

        {booking && (
          <div className="sc-booking">
            <strong>Booked brew: {booking.beer_name}</strong>
            <div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>
              {tankLabel(booking.tanks?.name)} · brew day {fmtDay(booking.brew_date)}
              {booking.turn_quantity ? ` · ${booking.turn_quantity} × ${booking.turn_volume_l / 100}HL` : ''}
              {booking.batch_id ? ' · brewed' : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
              <input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
              <button className="secondary" disabled={!moveTo || moveTo === booking.brew_date} onClick={() => run(() => moveBooking(booking, moveTo))}>
                Move whole brew
              </button>
              <button
                className="secondary"
                onClick={() => {
                  if (window.confirm(`Cancel the ${booking.beer_name} booking? All its schedule cells will be removed.`)) run(() => cancelBooking(booking.id))
                }}
              >
                Cancel booking
              </button>
            </div>
          </div>
        )}
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </div>
    </div>
  )
}

export default function SchedulePage() {
  const [range, setRange] = useState(() => ({ from: mondayOf(addDays(todayIso(), -7)), to: addDays(todayIso(), CHUNK_DAYS * 2) }))
  const scrollRef = useRef(null)
  const prependFrom = useRef(null) // scroll height before loading earlier days, to keep the view still
  const scrolledToToday = useRef(false)
  const [tanks, setTanks] = useState([])
  const [recipes, setRecipes] = useState([])
  const [templates, setTemplates] = useState([])
  const [entries, setEntries] = useState([])
  const [editor, setEditor] = useState(false)
  const [editing, setEditing] = useState(null) // { cell, column }
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState(null)
  const [bookingBeer, setBookingBeer] = useState({})

  useEffect(() => {
    listCellarTemplates().then(setTemplates).catch(() => {})
    listTanks().then((t) => setTanks(orderTanks(t))).catch((e) => setError(e.message))
    isScheduleEditor().then(setEditor)
  }, [])
  useEffect(() => {
    if (!editor) return
    listRecipes().then(setRecipes).catch(() => {})
  }, [editor])

  function refresh() {
    const from = addDays(range.from, -LOOKBACK_DAYS)
    listScheduleEntries(from, range.to).then(setEntries).catch((e) => setError(e.message))
    listBookings({ fromIso: from, toIso: range.to })
      .then((b) => setBookingBeer(Object.fromEntries(b.map((x) => [x.id, x.beer_name]))))
      .catch(() => {})
  }
  useEffect(refresh, [range.from, range.to])

  // Endless scroll: near the bottom, add the next four weeks.
  function onScroll(e) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
      setRange((r) => (r.loadingMore ? r : { ...r, to: addDays(r.to, CHUNK_DAYS), loadingMore: true }))
    }
  }
  useEffect(() => {
    if (range.loadingMore) setRange((r) => ({ ...r, loadingMore: false }))
  }, [entries])
  function loadEarlier() {
    prependFrom.current = scrollRef.current?.scrollHeight ?? null
    setRange((r) => ({ ...r, from: addDays(r.from, -CHUNK_DAYS) }))
  }
  // Keep the same rows on screen after adding days above them.
  useLayoutEffect(() => {
    if (prependFrom.current != null && scrollRef.current) {
      scrollRef.current.scrollTop += scrollRef.current.scrollHeight - prependFrom.current
      prependFrom.current = null
    }
  }, [range.from])
  function scrollToToday() {
    scrollRef.current?.querySelector('.sc-today')?.scrollIntoView({ block: 'start' })
    // The sticky header covers the top row; nudge back down by its height.
    if (scrollRef.current) scrollRef.current.scrollTop -= 34
  }
  useEffect(() => {
    if (!scrolledToToday.current && tanks.length) {
      scrolledToToday.current = true
      requestAnimationFrame(scrollToToday)
    }
  }, [tanks])

  const columns = useMemo(
    () => [
      ...BREW_LANES.map((l) => ({ key: l, lane: l, label: LANE_LABEL[l], group: 'brew' })),
      ...tanks.map((t) => ({ key: t.id, lane: 'tank', tankId: t.id, label: tankLabel(t.name), group: t.tank_type === 'BBT' ? 'bbt' : 'fv' })),
      ...PACK_LANES.map((l) => ({ key: l, lane: l, label: LANE_LABEL[l], group: 'pack' })),
      { key: 'notes', lane: 'notes', label: 'Notes', group: 'notes' },
    ],
    [tanks]
  )

  const { beerOf, runs } = useMemo(
    () => assignBeers(entries, { knownBeers: templates.map((t) => t.name), bookingBeer }),
    [entries, templates, bookingBeer]
  )

  const byCell = useMemo(() => {
    const m = new Map()
    for (const e of entries) {
      const k = `${e.entry_date}|${e.slot}|${e.lane === 'tank' ? e.tank_id : e.lane}`
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return m
  }, [entries])

  const dayCount = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
  const days = Array.from({ length: dayCount }, (_, i) => addDays(range.from, i))
  // Beers on the loaded schedule, for the colour key.
  const weekBeers = [...new Set(entries.filter((e) => e.entry_date >= range.from && beerOf.get(e.id)).map((e) => beerOf.get(e.id)))].sort()
  const today = todayIso()

  // A cell's beer: its own job's beer, or for a tank, whatever is sitting in the tank then.
  function cellBeer(c, list, d, slot) {
    if (list[0] && beerOf.get(list[0].id)) return beerOf.get(list[0].id)
    if (c.lane === 'tank') return beerInTank(runs, c.tankId, d, slot)
    return null
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Schedule</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {editor ? (
            <>
              <button onClick={() => setBooking(true)}>+ Book a brew</button>
              <Link to="/schedule/templates"><button className="secondary">Cellar templates</button></Link>
            </>
          ) : (
            <Link to="/login" state={{ from: '/schedule' }} style={{ fontSize: '0.9rem' }}>Sign in to edit</Link>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.75rem 0' }}>
        <button className="secondary" onClick={scrollToToday}>Today</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {weekBeers.length > 0 && (
        <div className="sc-legend">
          {weekBeers.map((b) => (
            <span key={b} className="sc-chip" style={{ background: beerColour(b) }}>{b}</span>
          ))}
        </div>
      )}

      <div className="sc-scroll" ref={scrollRef} onScroll={onScroll}>
        <table className="sc-grid">
          <thead>
            <tr>
              <th className="sc-day">Day</th>
              {columns.map((c) => (
                <th key={c.key} className={`sc-h-${c.group}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length + 1} className="sc-more">
                <button className="secondary" onClick={loadEarlier}>↑ Load earlier</button>
              </td>
            </tr>
            {days.map((d) =>
              ['AM', 'PM'].map((slot) => (
                <tr
                  key={d + slot}
                  className={(d === today && slot === 'AM' ? 'sc-today ' : '') + (d === today ? 'sc-todayrow ' : '') + (slot === 'PM' ? 'sc-pm ' : '') + (new Date(`${d}T00:00:00`).getDay() === 0 && slot === 'PM' ? 'sc-weekend' : '')}
                >
                  <td className="sc-day">
                    {slot === 'AM' ? <strong>{fmtDay(d)}</strong> : null} <span className="sc-slot">{slot}</span>
                  </td>
                  {columns.map((c) => {
                    const list = byCell.get(`${d}|${slot}|${c.key}`) ?? []
                    const beer = cellBeer(c, list, d, slot)
                    return (
                      <td
                        key={c.key}
                        className={'sc-cell' + (list.some((e) => isBrew(e.text)) ? ' sc-brewday' : '') + (editor ? ' sc-editable' : '')}
                        style={beer ? { background: beerColour(beer) } : undefined}
                        title={beer ?? undefined}
                        onClick={editor ? () => setEditing({ cell: { date: d, slot }, column: c, list }) : undefined}
                      >
                        {list.map((e) => (
                          <div key={e.id} className={e.done ? 'sc-done' : ''}>{e.text}</div>
                        ))}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <CellEditor
          key={editing.cell.date + editing.cell.slot + editing.column.key}
          cell={editing.cell}
          column={editing.column}
          entries={editing.list}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
      {booking && (
        <BookBrewDialog
          tanks={tanks.filter((t) => t.tank_type !== 'BBT')}
          recipes={recipes}
          templates={templates}
          onClose={() => setBooking(false)}
          onBooked={(b) => {
            setBooking(false)
            // Make sure the whole booked brew is loaded, then show it.
            setRange((r) => ({ from: b.brew_date < r.from ? mondayOf(b.brew_date) : r.from, to: addDays(b.brew_date, 35) > r.to ? addDays(b.brew_date, 35) : r.to }))
            refresh()
          }}
        />
      )}
    </div>
  )
}
