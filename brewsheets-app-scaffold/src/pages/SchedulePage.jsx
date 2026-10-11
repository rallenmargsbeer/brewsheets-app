import { useEffect, useMemo, useRef, useState } from 'react'
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
  suggestBrightTank,
  moveToBrightTank,
  getEntriesByIds,
  updateEntries,
  insertEntries,
  deleteEntries,
  restoreEntries,
} from '../lib/schedule'
import BookBrewDialog from '../components/BookBrewDialog.jsx'
import { assignBeers, beerColour, beerInTank, stayAt, slotKey, packBeer } from '../lib/beerColours'

// How far back to look for the brew that started each tank's run of jobs (a lager runs ~4 weeks).
const LOOKBACK_DAYS = 42
// The schedule is one continuous list of days from the 1st of this month, loading another
// four weeks each time you scroll near the bottom. Earlier months are in the Archive.
const CHUNK_DAYS = 28
const monthStart = (isoDate) => `${isoDate.slice(0, 7)}-01`
const monthEnd = (ym) => addDays(monthStart(addDays(`${ym}-28`, 7)), -1)
const FIRST_MONTH = '2026-08' // earliest month on the schedule
function pastMonths() {
  const out = []
  for (let m = monthStart(addDays(monthStart(todayIso()), -1)); m.slice(0, 7) >= FIRST_MONTH; m = monthStart(addDays(m, -1))) out.push(m.slice(0, 7))
  return out
}
const fmtMonth = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

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

function CellEditor({ cell, column, entries, beer, beerChoices = [], brightTanks, allEntries, fvLitres, act, pushUndo, onClose, onChanged }) {
  const [rows, setRows] = useState(entries.map((e) => ({ ...e })))
  const [newText, setNewText] = useState('')
  // Canning / kegging: which beer (blank = let the app work it out).
  const isPack = column.group === 'pack'
  const [packBeerName, setPackBeerName] = useState(entries.find((e) => e.beer_name)?.beer_name ?? '')
  const [booking, setBooking] = useState(null)
  const [moveTo, setMoveTo] = useState('')
  const [error, setError] = useState(null)
  const bookingId = entries.find((e) => e.booking_id)?.booking_id

  // A Filter in an FV: offer to move the beer into a free bright tank (unless it's already there).
  const filterEntry = column.group === 'fv' ? entries.find((e) => /^filter\b/i.test(e.text.trim()) && !/\?$/.test(e.text)) : null
  const btEnd = addDays(cell.date, 1)
  const alreadyInBt = filterEntry && beer && allEntries.some((e) => brightTanks.some((t) => t.id === e.tank_id) && e.entry_date === cell.date && e.text === beer)
  const suggestedBt = filterEntry && beer && !alreadyInBt ? suggestBrightTank(brightTanks, allEntries, cell.date, btEnd, fvLitres) : null
  const [btId, setBtId] = useState('')
  const chosenBt = btId ? brightTanks.find((t) => t.id === btId) : suggestedBt

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
    const created = []
    for (const r of rows) {
      const orig = entries.find((e) => e.id === r.id)
      if (!r.text.trim()) await deleteScheduleEntry(r.id)
      else if (orig.text !== r.text || orig.done !== r.done || (isPack && (orig.beer_name ?? '') !== packBeerName))
        await saveScheduleEntry({ id: r.id, text: r.text.trim(), done: r.done, ...(isPack ? { beer_name: packBeerName || null } : {}) })
    }
    if (newText.trim()) {
      created.push(await saveScheduleEntry({
        entry_date: cell.date,
        slot: cell.slot,
        lane: column.lane,
        tank_id: column.tankId ?? null,
        text: newText.trim(),
        ...(isPack ? { beer_name: packBeerName || null } : {}),
      }))
    }
    return created
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
        {isPack && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: '0.6rem' }}>
            Beer
            <select value={packBeerName} onChange={(e) => setPackBeerName(e.target.value)}>
              <option value="">{beer ? `Worked out: ${beer}` : 'Work it out from the tanks'}</option>
              {beerChoices.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button onClick={() => run(() => act(`Edit ${column.label} ${fmtDay(cell.date)} ${cell.slot}`, entries.map((e) => e.id), saveAll))}>Save</button>
          <button className="secondary" onClick={onClose}>Cancel</button>
        </div>

        {filterEntry && beer && !alreadyInBt && (
          <div className="sc-booking" style={{ background: '#e3edfa', borderLeftColor: '#1d4f91' }}>
            <strong>Move {beer} to a bright tank</strong>
            <div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>
              Adds {beer} to the BT on {fmtDay(cell.date)} {cell.slot}, then Carb and Can &amp; Keg.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
              <select value={btId} onChange={(e) => setBtId(e.target.value)}>
                <option value="">{suggestedBt ? `${tankLabel(suggestedBt.name)} (suggested, free)` : 'No free BT found, pick one'}</option>
                {brightTanks.map((t) => <option key={t.id} value={t.id}>{tankLabel(t.name)}{t.capacity_l != null ? ` (${Number(t.capacity_l).toLocaleString()} L)` : ''}</option>)}
              </select>
              <button
                disabled={!chosenBt}
                onClick={() => run(() => act(`Move ${beer} to ${tankLabel(chosenBt.name)}`, [], () => moveToBrightTank({ bt: chosenBt, beerName: beer, filterDate: cell.date, filterSlot: cell.slot, bookingId: filterEntry.booking_id ?? null })))}
              >
                Move to {chosenBt ? tankLabel(chosenBt.name) : 'BT'}
              </button>
            </div>
          </div>
        )}

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
              <button className="secondary" disabled={!moveTo || moveTo === booking.brew_date} onClick={() => run(async () => {
                  await moveBooking(booking, moveTo)
                  pushUndo(`Move ${booking.beer_name} brew`, () => moveBooking({ ...booking, brew_date: moveTo }, booking.brew_date))
                })}>
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
  const liveRange = () => ({ from: monthStart(todayIso()), to: addDays(todayIso(), CHUNK_DAYS * 2) })
  const [range, setRange] = useState(liveRange)
  const [archive, setArchive] = useState('') // 'YYYY-MM' when viewing a past month
  const scrollRef = useRef(null)
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
  const [undoStack, setUndoStack] = useState([]) // [{ label, undo }]
  const [menu, setMenu] = useState(null) // right-click menu
  const [dropKey, setDropKey] = useState(null) // cell being dragged over
  const dragged = useRef(null)
  const [busy, setBusy] = useState(false)

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
    if (archive) return
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
      setRange((r) => (r.loadingMore ? r : { ...r, to: addDays(r.to, CHUNK_DAYS), loadingMore: true }))
    }
  }
  useEffect(() => {
    if (range.loadingMore) setRange((r) => ({ ...r, loadingMore: false }))
  }, [entries])
  // ---- Undo ----
  function pushUndo(label, undo) {
    setUndoStack((st) => [...st.slice(-29), { label, undo }])
  }
  // Snapshots the rows a change will touch, runs it (it returns the ids it created), and
  // records how to put everything back.
  async function act(label, ids, op) {
    const before = await getEntriesByIds(ids)
    const created = (await op()) ?? []
    pushUndo(label, () => restoreEntries(before, Array.isArray(created) ? created : []))
  }
  async function perform(fn) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      refresh()
    }
  }
  function undoLast() {
    const last = undoStack[undoStack.length - 1]
    if (!last || busy) return
    setUndoStack((st) => st.slice(0, -1))
    perform(last.undo)
  }
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        undoLast()
      }
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- Drag and drop: move a cell's jobs; Ctrl / Cmd while dropping copies them ----
  const cellTarget = (c, d, slot) => ({ entry_date: d, slot, lane: c.lane, tank_id: c.tankId ?? null })
  function onDrop(e, c, d, slot) {
    e.preventDefault()
    setDropKey(null)
    const src = dragged.current
    dragged.current = null
    if (!src || (src.date === d && src.slot === slot && src.colKey === c.key)) return
    const copy = e.ctrlKey || e.metaKey || e.altKey
    const where = `${c.label} ${fmtDay(d)} ${slot}`
    const what = src.list.map((x) => x.text).join(', ')
    perform(() =>
      copy
        ? act(`Copy ${what} to ${where}`, [], () =>
            insertEntries(src.list.map((x) => ({ ...cellTarget(c, d, slot), text: x.text, done: false, beer_name: x.beer_name ?? null })))
          )
        : act(`Move ${what} to ${where}`, src.list.map((x) => x.id), () =>
            updateEntries(src.list.map((x) => ({ id: x.id, ...cellTarget(c, d, slot) }))).then(() => [])
          )
    )
  }

  // ---- Whole-beer moves (right-click) ----
  // The jobs that make up a beer's stay: a booked brew's own cells, else the tank's jobs
  // inside the stay.
  function stayEntries(c, stay) {
    const inStay = entries.filter((e) => e.lane === 'tank' && e.tank_id === c.tankId && slotKey(e.entry_date, e.slot) >= stay.start && slotKey(e.entry_date, e.slot) <= stay.end)
    const bookingId = inStay.find((e) => e.booking_id)?.booking_id
    return bookingId ? entries.filter((e) => e.booking_id === bookingId) : inStay
  }
  function shift(label, rows, days) {
    if (!rows.length || !days) return
    perform(() => act(label, rows.map((r) => r.id), () => updateEntries(rows.map((r) => ({ id: r.id, entry_date: addDays(r.entry_date, days) }))).then(() => [])))
  }
  function moveStayToTank(c, stay, toTank) {
    const rows = entries.filter((e) => e.lane === 'tank' && e.tank_id === c.tankId && slotKey(e.entry_date, e.slot) >= stay.start && slotKey(e.entry_date, e.slot) <= stay.end)
    const clash = entries.some((e) => e.tank_id === toTank.id && slotKey(e.entry_date, e.slot) >= stay.start && slotKey(e.entry_date, e.slot) <= stay.end)
    if (clash && !window.confirm(`${tankLabel(toTank.name)} already has jobs during ${stay.beer}'s stay. Move it there anyway?`)) return
    perform(() => act(`Move ${stay.beer} to ${tankLabel(toTank.name)}`, rows.map((r) => r.id), () => updateEntries(rows.map((r) => ({ id: r.id, tank_id: toTank.id }))).then(() => [])))
  }
  function askDays(verb) {
    const v = window.prompt(`${verb} by how many days? (negative = earlier)`, '1')
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }

  function openArchive(ym) {
    setArchive(ym)
    setRange(ym ? { from: `${ym}-01`, to: monthEnd(ym) } : liveRange())
    scrolledToToday.current = !!ym
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    if (!ym) requestAnimationFrame(() => requestAnimationFrame(scrollToToday))
  }
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
    if (c.group === 'pack' && list.length) return packBeer(list, d, slot, { entries, beerOf, runs, brightTankIds })
    return null
  }
  const brightTankIds = tanks.filter((t) => t.tank_type === 'BBT').map((t) => t.id)

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Schedule</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          {editor ? (
            <>
              <button
                className="secondary"
                disabled={!undoStack.length || busy}
                onClick={undoLast}
                title={undoStack.length ? `Undo: ${undoStack[undoStack.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'}
              >
                ↶ Undo{undoStack.length ? `: ${undoStack[undoStack.length - 1].label}` : ''}
              </button>
              <button onClick={() => setBooking(true)}>+ Book a brew</button>
              <Link to="/schedule/templates"><button className="secondary">Cellar templates</button></Link>
            </>
          ) : (
            <Link to="/login" state={{ from: '/schedule' }} style={{ fontSize: '0.9rem' }}>Sign in to edit</Link>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.75rem 0' }}>
        {!archive && <button className="secondary" onClick={scrollToToday}>Today</button>}
        <select value={archive} onChange={(e) => openArchive(e.target.value)} aria-label="Archive">
          <option value="">{archive ? '← Back to the schedule' : 'Archive…'}</option>
          {pastMonths().map((ym) => <option key={ym} value={ym}>{fmtMonth(ym)}</option>)}
        </select>
        {archive && <strong>Archive: {fmtMonth(archive)} (view only)</strong>}
        {editor && !archive && <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Drag a cell to move it · Ctrl-drag to copy · right-click for more</span>}
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
                    // Black outline round each tank stay as a block: sides always, top on its
                    // first half-day, bottom on its last; inner cell lines take the beer colour.
                    const stay = c.lane === 'tank' ? stayAt(runs, c.tankId, d, slot) : null
                    const k = slotKey(d, slot)
                    const edges = stay
                      ? ['inset 2px 0 0 #1a1a1a', 'inset -2px 0 0 #1a1a1a', ...(stay.start === k ? ['inset 0 2px 0 #1a1a1a'] : []), ...(stay.end === k ? ['inset 0 -2px 0 #1a1a1a'] : [])].join(', ')
                      : null
                    return (
                      <td
                        key={c.key}
                        className={'sc-cell' + (list.some((e) => isBrew(e.text)) ? ' sc-brewday' : '') + (editor ? ' sc-editable' : '')}
                        style={
                          beer
                            ? { background: beerColour(beer), ...(edges ? { boxShadow: edges, borderBottomColor: stay.end === k ? undefined : beerColour(beer) } : {}) }
                            : undefined
                        }
                        title={beer ?? undefined}
                        onClick={editor && !archive ? () => setEditing({ cell: { date: d, slot }, column: c, list, beer }) : undefined}
                        draggable={editor && !archive && list.length > 0}
                        onDragStart={(e) => {
                          dragged.current = { list, date: d, slot, colKey: c.key }
                          e.dataTransfer.effectAllowed = 'copyMove'
                          e.dataTransfer.setData('text/plain', list.map((x) => x.text).join(', '))
                        }}
                        onDragOver={editor && !archive ? (e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey || e.altKey ? 'copy' : 'move'
                          if (dropKey !== `${d}|${slot}|${c.key}`) setDropKey(`${d}|${slot}|${c.key}`)
                        } : undefined}
                        onDragLeave={() => setDropKey((k) => (k === `${d}|${slot}|${c.key}` ? null : k))}
                        onDrop={editor && !archive ? (e) => onDrop(e, c, d, slot) : undefined}
                        onContextMenu={editor && !archive ? (e) => {
                          e.preventDefault()
                          setMenu({ x: e.clientX, y: e.clientY, cell: { date: d, slot }, column: c, list, beer, stay })
                        } : undefined}
                        data-drop={dropKey === `${d}|${slot}|${c.key}` ? 'over' : undefined}
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

      {menu && (
        <div className="sc-menu-back" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}>
          <div
            className="sc-menu"
            style={{ left: Math.min(menu.x, window.innerWidth - 290), top: Math.min(menu.y, window.innerHeight - 330) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sc-menu-title">{menu.column.label} · {fmtDay(menu.cell.date)} {menu.cell.slot}</div>
            <button className="sc-menu-item" onClick={() => { setMenu(null); setEditing({ cell: menu.cell, column: menu.column, list: menu.list, beer: menu.beer }) }}>Edit…</button>
            {menu.stay && (() => {
              const all = stayEntries(menu.column, menu.stay)
              const k = slotKey(menu.cell.date, menu.cell.slot)
              const fromHere = all.filter((e) => slotKey(e.entry_date, e.slot) >= k)
              const close = (fn) => () => { setMenu(null); fn() }
              const others = tanks.filter((t) => t.id !== menu.column.tankId && (t.tank_type === 'BBT') === (menu.column.group === 'bbt'))
              return (
                <>
                  <div className="sc-menu-title">{menu.stay.beer}</div>
                  <div className="sc-menu-row">
                    <span>This job and later ({fromHere.length})</span>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} from ${fmtDay(menu.cell.date)} −1 day`, fromHere, -1))}>−1</button>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} from ${fmtDay(menu.cell.date)} +1 day`, fromHere, 1))}>+1</button>
                    <button onClick={close(() => { const n = askDays('Shift'); shift(`Shift ${menu.stay.beer} from ${fmtDay(menu.cell.date)} ${n > 0 ? '+' : ''}${n} days`, fromHere, n) })}>±…</button>
                  </div>
                  <div className="sc-menu-row">
                    <span>Whole stay ({all.length})</span>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} −1 day`, all, -1))}>−1</button>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} +1 day`, all, 1))}>+1</button>
                    <button onClick={close(() => { const n = askDays('Shift'); shift(`Shift ${menu.stay.beer} ${n > 0 ? '+' : ''}${n} days`, all, n) })}>±…</button>
                  </div>
                  <div className="sc-menu-row">
                    <span>Move stay to</span>
                    <select defaultValue="" onChange={(e) => { const t = others.find((x) => x.id === e.target.value); if (t) close(() => moveStayToTank(menu.column, menu.stay, t))() }}>
                      <option value="" disabled>tank…</option>
                      {others.map((t) => <option key={t.id} value={t.id}>{tankLabel(t.name)}</option>)}
                    </select>
                  </div>
                </>
              )
            })()}
            {menu.list.length > 0 && (
              <button
                className="sc-menu-item sc-menu-danger"
                onClick={() => {
                  const ids = menu.list.map((x) => x.id)
                  const label = `Delete ${menu.list.map((x) => x.text).join(', ')} (${menu.column.label} ${fmtDay(menu.cell.date)} ${menu.cell.slot})`
                  setMenu(null)
                  perform(() => act(label, ids, () => deleteEntries(ids).then(() => [])))
                }}
              >
                Delete {menu.list.length === 1 ? `“${menu.list[0].text}”` : `${menu.list.length} jobs`}
              </button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <CellEditor
          act={act}
          pushUndo={pushUndo}
          beer={editing.beer}
          beerChoices={weekBeers}
          brightTanks={tanks.filter((t) => t.tank_type === 'BBT')}
          allEntries={entries}
          // Sheet-imported brews don't record their size, so assume the FV was full.
          fvLitres={Number(tanks.find((t) => t.id === editing.column.tankId)?.capacity_l) || null}
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
          brightTanks={tanks.filter((t) => t.tank_type === 'BBT')}
          recipes={recipes}
          templates={templates}
          onClose={() => setBooking(false)}
          onBooked={(b) => {
            setBooking(false)
            pushUndo(`Book ${b.beer_name}`, () => cancelBooking(b.id))
            // Make sure the whole booked brew is loaded, then show it.
            setRange((r) => ({ from: b.brew_date < r.from ? mondayOf(b.brew_date) : r.from, to: addDays(b.brew_date, 35) > r.to ? addDays(b.brew_date, 35) : r.to }))
            refresh()
          }}
        />
      )}
    </div>
  )
}
