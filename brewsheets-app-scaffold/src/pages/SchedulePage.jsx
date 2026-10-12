import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listTanks, listRecipes } from '../lib/api'
import { tankLabel } from '../lib/tanks'
import {
  todayIso,
  addDays,
  mondayOf,
  daysBetween,
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
  cancelBooking,
  suggestBrightTank,
  moveToBrightTank,
  getEntriesByIds,
  updateEntries,
  insertEntries,
  deleteEntries,
  restoreEntries,
  listBeerColours,
  syncBookingDates,
  listBookingEntries,
  setBookingDates,
  saveBeerColour,
  deleteBeerColour,
} from '../lib/schedule'
import BookBrewDialog from '../components/BookBrewDialog.jsx'
import { planMove, stayRows, brewGroup, brewDayClashes, daysToNextFreeDay } from '../lib/push'
import { assignBeers, beerStyle, beerInTank, stayAt, slotKey, packBeer, setBeerColours, hasSavedColours } from '../lib/beerColours'

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

function CellEditor({ cell, column, entries, beer, beerChoices = [], brightTanks, allEntries, fvLitres, act, onMoveBooking, onClose, onChanged }) {
  const [rows, setRows] = useState(entries.map((e) => ({ ...e })))
  const [newText, setNewText] = useState('')
  // Canning / kegging: which beer (blank = let the app work it out).
  const isPack = column.group === 'pack'
  const [packBeerName, setPackBeerName] = useState(entries.find((e) => e.beer_name)?.beer_name ?? '')
  // Cell colours: by default the beer's; tick "Own colours" to pick this cell's fill and font.
  const style = beerStyle(beer) ?? { bg: '#ffffff', fg: '#1d2421' }
  const [ownColours, setOwnColours] = useState(entries.some((e) => e.cell_bg || e.cell_fg))
  const [cellBg, setCellBg] = useState(entries.find((e) => e.cell_bg)?.cell_bg ?? style.bg)
  const [cellFg, setCellFg] = useState(entries.find((e) => e.cell_fg)?.cell_fg ?? style.fg)
  const colourFields = ownColours ? { cell_bg: cellBg, cell_fg: cellFg } : { cell_bg: null, cell_fg: null }
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
      // A cleared box is removed, unless it's only there to hold the cell's own colours.
      if (!r.text.trim() && !ownColours) await deleteScheduleEntry(r.id)
      else
        await saveScheduleEntry({ id: r.id, text: r.text.trim(), done: r.done, ...colourFields, ...(isPack ? { beer_name: packBeerName || null } : {}) })
    }
    if (newText.trim()) {
      created.push(await saveScheduleEntry({
        entry_date: cell.date,
        slot: cell.slot,
        lane: column.lane,
        tank_id: column.tankId ?? null,
        text: newText.trim(),
        ...colourFields,
        ...(isPack ? { beer_name: packBeerName || null } : {}),
      }))
    } else if (!rows.length && ownColours) {
      // An empty cell can still have its own colours.
      created.push(await saveScheduleEntry({ entry_date: cell.date, slot: cell.slot, lane: column.lane, tank_id: column.tankId ?? null, text: '', ...colourFields }))
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
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={ownColours} onChange={(e) => setOwnColours(e.target.checked)} /> Own colours
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: ownColours ? 1 : 0.4 }}>
            Cell <input type="color" value={cellBg} disabled={!ownColours} onChange={(e) => setCellBg(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: ownColours ? 1 : 0.4 }}>
            Font <input type="color" value={cellFg} disabled={!ownColours} onChange={(e) => setCellFg(e.target.value)} />
          </label>
          <span className="sc-chip" style={{ background: ownColours ? cellBg : style.bg, color: ownColours ? cellFg : style.fg }}>Preview</span>
        </div>
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
              <button className="secondary" disabled={!moveTo || moveTo === booking.brew_date} onClick={() => { onClose(); onMoveBooking(booking, moveTo) }}>
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

// Sorts out a move's knock-on effects one at a time: each brew day it overfills (more than
// 3 turns) or pushes onto a weekend is put to you, then everything moving is summarised.
function MoveResolver({ resolver: r, plan, runs, tankName, groupBeer, onChange, onSave, onClose }) {
  const clashes = useMemo(() => brewDayClashes(r.all, plan, { maxTurns: 3, accepted: r.accepted }), [r, plan])
  const c = clashes[0]
  const showDay = (date) => document.querySelector(`tr[data-day="${date}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  useEffect(() => { if (c) showDay(c.date) }, [c?.date])
  const choose = (text, move, acceptDate) =>
    onChange({
      ...r,
      moves: move ? [...r.moves, move] : r.moves,
      accepted: acceptDate ? new Set([...r.accepted, acceptDate]) : r.accepted,
      choices: [...r.choices, text],
    })

  // How far a brew is moving under the current plan (a later push can outdo an earlier one).
  const shiftNow = (rows) => Math.max(0, ...rows.map((x) => plan.shiftOf.get(x.id) ?? 0))
  let options = []
  if (c) {
    const beer = groupBeer(c.group.rows)
    const moveBy = (k) => ({ rows: c.group.rows, days: shiftNow(c.group.rows) + k, toTankId: c.group.toTankId })
    // The next weekday, busy or not (you then sort out the brews already there)...
    const kNext = daysToNextFreeDay(r.all, plan, c.group, { maxTurns: Infinity })
    if (kNext) options.push({ text: `Brew ${beer} on ${fmtDay(addDays(c.date, kNext))}`, move: moveBy(kNext) })
    // ...and the first weekday with room for all its turns, if that's later.
    const kFree = daysToNextFreeDay(r.all, plan, c.group, { maxTurns: 3 })
    if (kFree && kFree !== kNext) options.push({ text: `Brew ${beer} on ${fmtDay(addDays(c.date, kFree))} (first day with room)`, move: moveBy(kFree) })
    // The brew(s) already on that day, unless it's the brew you're moving.
    const rootIds = new Set(plan.groups.filter((g) => g.root).flatMap((g) => g.rows.map((x) => x.id)))
    const ownIds = new Set(c.group.rows.map((x) => x.id))
    const seen = new Set()
    for (const row of c.others) {
      if (ownIds.has(row.id) || seen.has(row.id)) continue
      const rows = brewGroup(r.all, runs, row)
      rows.forEach((x) => seen.add(x.id))
      if (rows.some((x) => rootIds.has(x.id) || ownIds.has(x.id))) continue
      const k2 = daysToNextFreeDay(r.all, plan, { rows }, { maxTurns: 3 })
      if (k2) options.push({ text: `Push ${groupBeer(rows)} back to ${fmtDay(addDays(c.date, k2))}`, move: { rows, days: shiftNow(rows) + k2 } })
    }
    if (c.reason === 'full' && c.total <= 4) options.push({ text: `Brew all 4 turns on ${fmtDay(c.date)}`, accept: c.date })
    if (c.reason === 'weekend') options.push({ text: `Brew ${beer} on ${fmtDay(c.date)} anyway`, accept: c.date })
  }

  const lines = [
    ...plan.pushed.map((p) => `${p.beer} in ${tankName(p.tankId)} (from ${fmtDay(p.from)}) moves ${p.days} day${p.days === 1 ? '' : 's'} later`),
    ...plan.blocked.map((b) => `Overlaps ${b.beer} in ${tankName(b.tankId)} (from ${fmtDay(b.from)}), not moved`),
    ...r.choices,
  ]

  return (
    <div className="sc-floating">
      <div className="sc-dialog">
        <h3 style={{ margin: '0 0 0.25rem' }}>{r.label}</h3>
        <div style={{ color: 'var(--ink2)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>The schedule behind shows the moves so far (dashed cells). Scroll it to check before choosing.</div>
        {c ? (
          <>
            <p className="sc-warn" style={{ marginTop: 0 }}>
              {c.reason === 'full'
                ? `${fmtDay(c.date)} would have ${c.total} brew turns (${groupBeer(c.group.rows)} plus ${[...new Set(c.others.map((o) => groupBeer([o])))].join(', ') || 'others'}). The usual max is 3.`
                : `${groupBeer(c.group.rows)} would be pushed to brew on ${fmtDay(c.date)}, a weekend.`}
              {' '}<a href="#" onClick={(e) => { e.preventDefault(); showDay(c.date) }}>Show</a>
            </p>
            {clashes.length > 1 && <div style={{ color: 'var(--ink2)', fontSize: '0.85rem', marginBottom: 6 }}>{clashes.length - 1} more brew day{clashes.length === 2 ? '' : 's'} to sort out after this.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {options.map((o) => (
                <button key={o.text} onClick={() => choose(o.text, o.move, o.accept)}>{o.text}</button>
              ))}
              {!options.length && <div className="sc-warn">No free weekday found in the next 60 days. Cancel and move it by hand.</div>}
              <button className="secondary" onClick={onClose}>Cancel the move</button>
            </div>
          </>
        ) : (
          <>
            {lines.length > 0 && (
              <>
                <div>This also changes:</div>
                <ul style={{ margin: '0.3rem 0 0.75rem', paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                  {lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => onSave(r, plan)} disabled={!plan.updates.length}>Save</button>
              <button className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// A date picker in the right-click menu: pick the day and Move shifts the jobs there.
function MoveToDate({ label = 'Move to', from, onMove }) {
  const [to, setTo] = useState(from)
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(to) && to !== from
  return (
    <div className="sc-menu-row sc-menu-date">
      <span>{label}</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && onMove(to)} />
      <button onClick={() => onMove(to)} disabled={!ok}>Move</button>
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
  const [colourRows, setColourRows] = useState([]) // beer_colours, kept in state so the grid re-renders on change
  const [colourEdit, setColourEdit] = useState(null) // { beer, bg, fg, x, y }
  function loadColours() {
    listBeerColours().then((rows) => { setBeerColours(rows); setColourRows(rows) }).catch(() => {})
  }
  useEffect(loadColours, [])
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
    perform(last.undo).then(loadColours)
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
  // The jobs that make up a beer's stay: a booked brew's own cells, else the tank's jobs inside it.
  const stayEntries = (c, stay) => stayRows(entries, c.tankId, stay)
  const tankName = (id) => tankLabel(tanks.find((t) => t.id === id)?.name)

  // Moves go through the resolver: it plans the move and every brew it pushes, asks how to
  // sort out brew days that end up over 3 turns (or pushed onto a weekend), then shows a
  // summary before saving it all as one undo step.
  const [resolver, setResolver] = useState(null) // { label, moves, all, accepted: Set, choices: [] }
  function applyMove(label, move, extraRows = []) {
    const known = new Set(entries.map((e) => e.id))
    const all = [...entries, ...extraRows.filter((e) => !known.has(e.id))]
    const r = { label, moves: [move], all, accepted: new Set(), choices: [] }
    const plan = planMove(all, planRuns, r.moves)
    if (!plan.updates.length) return
    if (!plan.pushed.length && !plan.blocked.length && !brewDayClashes(all, plan, { accepted: r.accepted }).length) return saveMove(r, plan)
    setResolver(r)
  }
  function saveMove(r, plan) {
    setResolver(null)
    const { updates, pushed } = plan
    const ids = updates.map((u) => u.id)
    const bookingIds = [...new Set(r.all.filter((e) => ids.includes(e.id) && e.booking_id).map((e) => e.booking_id))]
    const fullLabel = pushed.length ? `${r.label} (+${pushed.length} pushed)` : r.label
    perform(async () => {
      const before = await getEntriesByIds(ids)
      await updateEntries(updates)
      const prevDates = await syncBookingDates(bookingIds)
      pushUndo(fullLabel, async () => {
        await restoreEntries(before)
        await setBookingDates(prevDates)
      })
    })
  }
  const groupBeer = (rows) => {
    const r = rows.find((x) => beerOf.get(x.id)) ?? rows.find((x) => x.lane === 'brew_1' || x.lane === 'brew_2')
    return (r && beerOf.get(r.id)) ?? r?.text?.replace(/\s*-?\s*\d+\s*L$/i, '').trim() ?? 'brew'
  }
  function shift(label, rows, days) {
    if (!rows.length || !days) return
    applyMove(label, { rows, days })
  }
  function moveStayToTank(c, stay, toTank) {
    const rows = entries.filter((e) => e.lane === 'tank' && e.tank_id === c.tankId && slotKey(e.entry_date, e.slot) >= stay.start && slotKey(e.entry_date, e.slot) <= stay.end)
    applyMove(`Move ${stay.beer} to ${tankLabel(toTank.name)}`, { rows, days: 0, toTankId: toTank.id })
  }
  // All of a booked brew's cells, even ones beyond the loaded weeks, move together.
  async function moveBookingTo(booking, newDate) {
    const days = daysBetween(booking.brew_date, newDate)
    if (!days) return
    const rows = await listBookingEntries(booking.id)
    if (!rows.length) return
    applyMove(`Move ${booking.beer_name} brew ${days > 0 ? '+' : ''}${days} day${Math.abs(days) === 1 ? '' : 's'}`, { rows, days }, rows)
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

  // Planning always works from the saved schedule; while a move is being sorted out the
  // grid shows the schedule as it would be, with the moved cells marked.
  const saved = useMemo(
    () => assignBeers(entries, { knownBeers: templates.map((t) => t.name), bookingBeer }),
    [entries, templates, bookingBeer]
  )
  const planRuns = saved.runs
  const resolverPlan = useMemo(() => (resolver ? planMove(resolver.all, planRuns, resolver.moves) : null), [resolver, planRuns])
  const shown = useMemo(() => {
    if (!resolverPlan) return entries
    const u = new Map(resolverPlan.updates.map((x) => [x.id, x]))
    return entries.map((e) => (u.has(e.id) ? { ...e, ...u.get(e.id) } : e))
  }, [entries, resolverPlan])
  const movedIds = useMemo(() => new Set(resolverPlan?.updates.map((u) => u.id) ?? []), [resolverPlan])
  const { beerOf, runs } = useMemo(
    () => (shown === entries ? saved : assignBeers(shown, { knownBeers: templates.map((t) => t.name), bookingBeer })),
    [shown, entries, saved, templates, bookingBeer]
  )

  const byCell = useMemo(() => {
    const m = new Map()
    for (const e of shown) {
      const k = `${e.entry_date}|${e.slot}|${e.lane === 'tank' ? e.tank_id : e.lane}`
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return m
  }, [shown])

  const dayCount = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
  const days = Array.from({ length: dayCount }, (_, i) => addDays(range.from, i))
  // Beers on the loaded schedule, for the colour key.
  const weekBeers = [...new Set(shown.filter((e) => e.entry_date >= range.from && beerOf.get(e.id)).map((e) => beerOf.get(e.id)))].sort()
  const today = todayIso()

  // A cell's beer: its own job's beer, or for a tank, whatever is sitting in the tank then.
  function cellBeer(c, list, d, slot) {
    if (list[0] && beerOf.get(list[0].id)) return beerOf.get(list[0].id)
    if (c.lane === 'tank') return beerInTank(runs, c.tankId, d, slot)
    if (c.group === 'pack' && list.length) return packBeer(list, d, slot, { entries: shown, beerOf, runs, brightTankIds })
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
            <span
              key={b}
              className={'sc-chip' + (editor ? ' sc-chip-edit' : '')}
              style={{ background: beerStyle(b).bg, color: beerStyle(b).fg }}
              title={editor ? `Change ${b}'s colours` : b}
              onClick={editor ? (e) => setColourEdit({ beer: b, ...beerStyle(b), x: e.clientX, y: e.clientY }) : undefined}
            >
              {b}
            </span>
          ))}
        </div>
      )}

      <div className={'sc-scroll' + (resolver ? ' sc-previewing' : '')} ref={scrollRef} onScroll={onScroll}>
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
                  data-day={slot === 'AM' ? d : undefined}
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
                        className={'sc-cell' + (list.some((e) => isBrew(e.text)) ? ' sc-brewday' : '') + (editor ? ' sc-editable' : '') + (movedIds.size && list.some((e) => movedIds.has(e.id)) ? ' sc-moved' : '')}
                        style={(() => {
                          // A cell's own colours win over its beer's.
                          const own = list.find((x) => x.cell_bg || x.cell_fg)
                          const bs = beerStyle(beer)
                          const bg = own?.cell_bg ?? bs?.bg
                          const fg = own?.cell_fg ?? bs?.fg
                          if (!bg && !fg) return undefined
                          return {
                            ...(bg ? { background: bg } : {}),
                            ...(fg ? { color: fg } : {}),
                            ...(edges ? { boxShadow: edges, borderBottomColor: stay.end === k ? undefined : bg } : {}),
                          }
                        })()}
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

      {colourEdit && (
        <div className="sc-menu-back" onClick={() => setColourEdit(null)}>
          <div className="sc-menu" style={{ left: Math.min(colourEdit.x, window.innerWidth - 290), top: colourEdit.y + 12, padding: '0.6rem' }} onClick={(e) => e.stopPropagation()}>
            <div className="sc-menu-title" style={{ padding: '0 0 0.4rem' }}>{colourEdit.beer} colours (everywhere)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Cell <input type="color" value={colourEdit.bg} onChange={(e) => setColourEdit({ ...colourEdit, bg: e.target.value })} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Font <input type="color" value={colourEdit.fg} onChange={(e) => setColourEdit({ ...colourEdit, fg: e.target.value })} /></label>
              <span className="sc-chip" style={{ background: colourEdit.bg, color: colourEdit.fg }}>{colourEdit.beer}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem' }}>
              <button
                onClick={() => {
                  const { beer, bg, fg } = colourEdit
                  const prev = colourRows.find((r) => r.beer_name.toLowerCase() === beer.toLowerCase())
                  setColourEdit(null)
                  perform(async () => {
                    await saveBeerColour(prev?.beer_name ?? beer, bg, fg)
                    pushUndo(`${beer} colours`, () => (prev ? saveBeerColour(prev.beer_name, prev.bg, prev.fg) : deleteBeerColour(beer)))
                  }).then(loadColours)
                }}
              >
                Save
              </button>
              <button className="secondary" onClick={() => setColourEdit(null)}>Cancel</button>
            </div>
            {!hasSavedColours(colourEdit.beer) && <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--ink2)' }}>No colours saved for this beer yet; it's using a stand-in.</p>}
          </div>
        </div>
      )}

      {menu && (
        <div className="sc-menu-back" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}>
          <div
            className="sc-menu"
            style={{ left: Math.min(menu.x, window.innerWidth - 290), top: Math.min(menu.y, window.innerHeight - 400) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sc-menu-title">{menu.column.label} · {fmtDay(menu.cell.date)} {menu.cell.slot}</div>
            <button className="sc-menu-item" onClick={() => { setMenu(null); setEditing({ cell: menu.cell, column: menu.column, list: menu.list, beer: menu.beer }) }}>Edit…</button>
            {menu.stay && (() => {
              const all = stayEntries(menu.column, menu.stay)
              const k = slotKey(menu.cell.date, menu.cell.slot)
              const fromHere = all.filter((e) => slotKey(e.entry_date, e.slot) >= k)
              const stayStart = menu.stay.start.split('|')[0]
              const close = (fn) => () => { setMenu(null); fn() }
              const others = tanks.filter((t) => t.id !== menu.column.tankId && (t.tank_type === 'BBT') === (menu.column.group === 'bbt'))
              return (
                <>
                  <div className="sc-menu-title">{menu.stay.beer}</div>
                  <div className="sc-menu-row">
                    <span>This job and later ({fromHere.length})</span>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} from ${fmtDay(menu.cell.date)} −1 day`, fromHere, -1))}>−1</button>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} from ${fmtDay(menu.cell.date)} +1 day`, fromHere, 1))}>+1</button>
                  </div>
                  <MoveToDate from={menu.cell.date} onMove={(to) => close(() => shift(`Move ${menu.stay.beer} from ${fmtDay(menu.cell.date)} to ${fmtDay(to)}`, fromHere, daysBetween(menu.cell.date, to)))()} />
                  <div className="sc-menu-row">
                    <span>Whole stay ({all.length})</span>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} −1 day`, all, -1))}>−1</button>
                    <button onClick={close(() => shift(`Shift ${menu.stay.beer} +1 day`, all, 1))}>+1</button>
                  </div>
                  <MoveToDate label="Starts" from={stayStart} onMove={(to) => close(() => shift(`Move ${menu.stay.beer} to start ${fmtDay(to)}`, all, daysBetween(stayStart, to)))()} />
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
          onMoveBooking={moveBookingTo}
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
      {resolver && (
        <MoveResolver
          resolver={resolver}
          plan={resolverPlan}
          runs={planRuns}
          tankName={tankName}
          groupBeer={groupBeer}
          onChange={setResolver}
          onSave={saveMove}
          onClose={() => setResolver(null)}
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
