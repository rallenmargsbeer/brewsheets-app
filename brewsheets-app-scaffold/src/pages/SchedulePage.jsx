import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listTanks, listRecipes } from '../lib/api'
import { useAuth } from '../auth.jsx'
import BrewListPanel from '../components/BrewListPanel.jsx'
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
  addWorkdays,
  nextWorkday,
  freePackLane,
  nextFreeCell,
  freePackSlots,
  addDays as plusDays,
  isWeekend,
  moveToBrightTank,
  getEntriesByIds,
  updateEntries,
  insertEntries,
  deleteEntries,
  restoreEntries,
  findBooking,
  moveBookingToTank,
  restoreBooking,
  listBeerColours,
  syncBookingDates,
  listBookingEntries,
  bookingBrewDay,
  setBookingDates,
  getBookingDates,
  saveBeerColour,
  deleteBeerColour,
} from '../lib/schedule'
import BookBrewDialog from '../components/BookBrewDialog.jsx'
import { SchedulePlanPanel } from '../components/BrewPlan.jsx'
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
  const packDate = addWorkdays(cell.date, 1)
  const alreadyInBt = filterEntry && beer && allEntries.some((e) => brightTanks.some((t) => t.id === e.tank_id) && e.entry_date === cell.date && e.text === beer)
  const suggestedBt = filterEntry && beer && !alreadyInBt ? suggestBrightTank(brightTanks, allEntries, cell.date, packDate, fvLitres) : null
  const [btId, setBtId] = useState('')
  const chosenBt = btId ? brightTanks.find((t) => t.id === btId) : suggestedBt

  useEffect(() => {
    if (bookingId) getBooking(bookingId).then(async (b) => {
      // Show (and move from) the brew day its cells are actually on.
      const day = bookingBrewDay(b, await listBookingEntries(b.id).catch(() => []))
      setBooking({ ...b, brew_date: day })
      setMoveTo(day)
    }).catch(() => {})
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
              Adds {beer} to the BT on {fmtDay(cell.date)} {cell.slot}, then Can &amp; Keg.
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

// Desktop browsers zoom with CSS zoom (keeps the sticky headers). Phones and tablets scale with a
// transform instead, which every mobile browser applies reliably.
const CSS_ZOOM = typeof CSS !== 'undefined' && CSS.supports?.('zoom', '0.5') && !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)

export default function SchedulePage() {
  const liveRange = () => ({ from: monthStart(todayIso()), to: addDays(todayIso(), CHUNK_DAYS * 2) })
  const [range, setRange] = useState(liveRange)
  const [archive, setArchive] = useState('') // 'YYYY-MM' when viewing a past month
  const scrollRef = useRef(null)
  // The grid scrolls inside its own box, sized to end at the bottom of the screen, so its header
  // row (the tank names) stays in view instead of the page scrolling it away.
  const [boxHeight, setBoxHeight] = useState(null)
  useEffect(() => {
    const fit = () => { const el = scrollRef.current; if (el) setBoxHeight(Math.max(320, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 12)) }
    fit()
    window.addEventListener('resize', fit)
    const t = setTimeout(fit, 500) // after the legend and banners settle
    return () => { window.removeEventListener('resize', fit); clearTimeout(t) }
  })
  const gridRef = useRef(null)
  // Zoom out to see more of the grid (phones especially); remembered on this device.
  const ZOOMS = [1, 0.85, 0.7, 0.55, 0.4, 0.3]
  const [zoom, setZoomState] = useState(() => { try { return Number(localStorage.getItem('sched-zoom')) || 1 } catch { return 1 } })
  const setZoom = (z) => { const v = Math.max(0.15, Math.min(1, Math.round(z * 100) / 100)); setZoomState(v); try { localStorage.setItem('sched-zoom', String(v)) } catch { /* private mode */ } }
  const zoomStep = (dir) => { const next = dir < 0 ? ZOOMS.find((z) => z < zoom - 0.001) : [...ZOOMS].reverse().find((z) => z > zoom + 0.001); if (next) setZoom(next) }
  // CSS zoom where the browser has it (keeps the sticky headers); otherwise a transform, with the
  // wrapper taking the scaled size so the scroll area shrinks with it.
  const [gridSize, setGridSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const t = gridRef.current
    if (!t || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setGridSize((g) => (g.w === t.offsetWidth && g.h === t.offsetHeight ? g : { w: t.offsetWidth, h: t.offsetHeight })))
    ro.observe(t)
    return () => ro.disconnect()
  }, [gridRef.current])
  const zoomFit = () => { const t = gridRef.current, w = scrollRef.current?.clientWidth; const full = t ? (CSS_ZOOM ? t.getBoundingClientRect().width / zoom : t.offsetWidth) : 0; if (full && w) setZoom(Math.floor((w / full) * 100) / 100) }
  const scrolledToToday = useRef(false)
  const [tanks, setTanks] = useState([])
  const [recipes, setRecipes] = useState([])
  const [templates, setTemplates] = useState([])
  // From the Forecast page's Book button: /schedule?book=1&beer=ITP&date=2026-10-20&litres=10000
  const [params, setParams] = useSearchParams()
  // From a suggested swap's Book swap button: move the booked brew to the later slot, then
  // book the more urgent beer in the slot that frees up.
  useEffect(() => {
    if (params.get('swap') !== '1' || !templates.length || !recipes.length || !tanks.length) return
    const p = Object.fromEntries(params)
    setParams({}, { replace: true })
    const name = (id) => tankLabel(tanks.find((t) => t.id === id)?.name ?? '')
    if (!window.confirm(`Move ${p.swapBeer} (${name(p.swapTank)}, ${fmtDay(p.swapStart)}) to ${name(p.swapToTank)} on ${fmtDay(p.swapTo)}, then book ${p.beer} in ${name(p.swapTank)} on ${fmtDay(p.swapStart)}?`)) return
    perform(async () => {
      const bk = await findBooking(p.swapTank, p.swapStart)
      if (!bk) throw new Error(`Couldn't find the ${p.swapBeer} booking in ${name(p.swapTank)} on ${fmtDay(p.swapStart)}. Move it by hand.`)
      const before = await listBookingEntries(bk.id)
      await moveBookingToTank(bk, p.swapTo, p.swapToTank || null)
      pushUndo(`Swap: move ${p.swapBeer}`, async () => { await restoreEntries(before, []); await restoreBooking(bk) })
      setBooking({ date: bk.brew_date, tankId: bk.tank_id, beer: p.beer, litres: Number(p.litres) || null })
    })
  }, [params, templates, recipes, tanks])
  useEffect(() => {
    if (params.get('book') !== '1' || !templates.length || !recipes.length) return
    setBooking({ date: params.get('date') || todayIso(), tankId: params.get('tank') || '', beer: params.get('beer') || '', litres: Number(params.get('litres')) || null })
    setParams({}, { replace: true })
  }, [params, templates, recipes])
  const [entries, setEntries] = useState([])
  const [editor, setEditor] = useState(false)
  const [editing, setEditing] = useState(null) // { cell, column }
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState(null)
  const [bookingBeer, setBookingBeer] = useState({})
  const [undoStack, setUndoStack] = useState([]) // [{ label, undo }]
  const [colourRows, setColourRows] = useState([]) // beer_colours, kept in state so the grid re-renders on change
  const [colourEdit, setColourEdit] = useState(null) // { beer, bg, fg, x, y }
  const [packClash, setPackClash] = useState([]) // moved packaging with both columns taken: [{ id, kind, text, date, slot }]
  function loadColours() {
    listBeerColours().then((rows) => { setBeerColours(rows); setColourRows(rows) }).catch(() => {})
  }
  useEffect(loadColours, [])
  const [menu, setMenu] = useState(null) // right-click menu
  // Spreadsheet-style selection: a block of cells from anchor a to focus f. Rows count
  // half-days (rowOf), columns index into `columns`.
  const [sel, setSel] = useState(null) // { a: { r, c }, f: { r, c } }
  const selecting = useRef(false)
  const [clip, setClip] = useState(null) // { mode: 'cut' | 'copy', r0, c0, h, w, items: [{ dr, dc, e }] }
  const [busy, setBusy] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const { isAdmin } = useAuth()
  const [showBrewList, setShowBrewList] = useState(false)
  const [planKey, setPlanKey] = useState(0) // bumped after a booking so the brew plan reloads

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
  // Re-apply the frozen-row offsets when the zoom changes.
  useEffect(() => { if (scrollRef.current) onScroll({ currentTarget: scrollRef.current }) }, [zoom])
  function onScroll(e) {
    const el = e.currentTarget
    // When zoom is done by scaling (iPad), sticky offsets are in unscaled pixels: shift the frozen
    // header row and day column by the difference so they stay at the edge of the box.
    if (gridRef.current) {
      const f = zoom !== 1 && !CSS_ZOOM ? 1 / zoom - 1 : 0
      gridRef.current.style.setProperty('--sc-stick-y', `${el.scrollTop * f}px`)
      gridRef.current.style.setProperty('--sc-stick-x', `${el.scrollLeft * f}px`)
    }
    if (archive) return
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
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || editing || booking || colourEdit || packClash.length
      if (e.key === 'Escape') { setMenu(null); setClip(null) }
      if (typing) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') { e.preventDefault(); return undoLast() }
      if (!sel) return
      const canEdit = editor && !archive
      if (mod && k === 'c') { e.preventDefault(); copySel('copy') }
      else if (mod && k === 'x' && canEdit) { e.preventDefault(); copySel('cut') }
      else if (mod && k === 'v' && canEdit) { e.preventDefault(); pasteAt() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) { e.preventDefault(); clearSel() }
      else if (e.key === 'Enter' && canEdit) { e.preventDefault(); editCell(sel.f.r, sel.f.c) }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
        const f = { r: sel.f.r + dr, c: Math.max(0, Math.min(columns.length - 1, sel.f.c + dc)) }
        setSel(e.shiftKey ? { a: sel.a, f } : { a: f, f })
        document.querySelector(`[data-cell="${f.r}|${f.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
    const onUp = () => { selecting.current = false; if (dragging.current) finishDrag() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onUp) }
  })

  // ---- Selection, cut / copy / paste ----
  const rowOf = (d, slot) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000) * 2 + (slot === 'PM' ? 1 : 0)
  const cellAt = (r) => ({ date: new Date(Math.floor(r / 2) * 86400000).toISOString().slice(0, 10), slot: r % 2 ? 'PM' : 'AM' })
  const rectOf = (s) => s && { r0: Math.min(s.a.r, s.f.r), r1: Math.max(s.a.r, s.f.r), c0: Math.min(s.a.c, s.f.c), c1: Math.max(s.a.c, s.f.c) }
  const colOf = (e) => colIndex.get(e.lane === 'tank' ? e.tank_id : e.lane) ?? -1
  // A canning / kegging cell spans AM and PM, so either row of a selection reaches it.
  const entriesIn = (q) => entries.filter((e) => {
    const r = rowOf(e.entry_date, e.slot), c = colOf(e)
    const hit = PACK_LANES.includes(e.lane) ? r + 1 >= q.r0 && r <= q.r1 : r >= q.r0 && r <= q.r1
    return hit && c >= q.c0 && c <= q.c1
  })
  const cellTarget = (c, r) => ({ entry_date: cellAt(r).date, slot: cellAt(r).slot, lane: c.lane, tank_id: c.tankId ?? null })
  const rectLabel = (q) => {
    const from = cellAt(q.r0), to = cellAt(q.r1)
    return `${fmtDay(from.date)} ${from.slot}${q.r1 > q.r0 ? ` to ${fmtDay(to.date)} ${to.slot}` : ''}`
  }

  // What a block holds: its jobs, plus the empty cells shaded by a tank stay, as blank cells in
  // that beer's colour, so a stay can be copied into a bright tank.
  function blockItems(q) {
    const items = entriesIn(q).map((e) => ({ dr: rowOf(e.entry_date, e.slot) - q.r0, dc: colOf(e) - q.c0, e }))
    for (let ci = q.c0; ci <= q.c1; ci++) {
      const c = columns[ci]
      if (c?.lane !== 'tank') continue
      for (let r = q.r0; r <= q.r1; r++) {
        const { date, slot } = cellAt(r)
        if ((byCell.get(`${date}|${slot}|${c.key}`) ?? []).length) continue
        const stay = stayAt(runs, c.tankId, date, slot)
        const style = stay && beerStyle(stay.beer)
        if (style) items.push({ dr: r - q.r0, dc: ci - q.c0, e: { text: '', beer_name: null, cell_bg: style.bg, cell_fg: style.fg }, shade: true })
      }
    }
    return items
  }
  function copySel(mode) {
    const q = rectOf(sel)
    const items = blockItems(q)
    setClip({ mode, r0: q.r0, c0: q.c0, h: q.r1 - q.r0 + 1, w: q.c1 - q.c0 + 1, items })
  }
  // Pastes the copied / cut block with its top-left on the selected cell, overwriting what's there.
  function pasteAt() {
    if (!clip || !sel) return
    const q = rectOf(sel)
    // Like a spreadsheet: a copy pasted into a bigger selection repeats to fill it (one cell
    // copied fills every selected cell).
    const nR = clip.mode === 'copy' ? Math.max(1, Math.floor((q.r1 - q.r0 + 1) / clip.h)) : 1
    const nC = clip.mode === 'copy' ? Math.max(1, Math.floor((q.c1 - q.c0 + 1) / clip.w)) : 1
    if (nR === 1 && nC === 1) return placeBlock(clip, q)
    const items = []
    for (let i = 0; i < nR; i++) for (let j = 0; j < nC; j++) for (const it of clip.items) items.push({ ...it, dr: it.dr + i * clip.h, dc: it.dc + j * clip.w })
    placeBlock({ ...clip, h: clip.h * nR, w: clip.w * nC, items }, q)
  }
  // Drag: press on a selected block that has jobs in it and drag it somewhere else (a move,
  // same as cut and paste).
  const dragging = useRef(null) // { q, start }
  const [dropAt, setDropAt] = useState(null) // { r, c } under the pointer while dragging
  function finishDrag() {
    const d = dragging.current
    dragging.current = null
    setDropAt(null)
    if (!d || !dropAt) return
    const dr = dropAt.r - d.start.r, dc = dropAt.c - d.start.c
    if (!dr && !dc) return
    const q = d.q
    const items = blockItems(q)
    const c0 = Math.max(0, Math.min(columns.length - 1, q.c0 + dc))
    placeBlock({ mode: 'cut', r0: q.r0, c0: q.c0, h: q.r1 - q.r0 + 1, w: q.c1 - q.c0 + 1, items }, { r0: q.r0 + dr, c0 })
  }
  function placeBlock(clip, q) {
    const target = { r0: q.r0, c0: q.c0, r1: q.r0 + clip.h - 1, c1: Math.min(columns.length - 1, q.c0 + clip.w - 1) }
    if (clip.mode === 'cut' && target.r0 === clip.r0 && target.c0 === clip.c0) return setClip(null)
    const fits = clip.items.filter((it) => q.c0 + it.dc < columns.length)
    const where = (it) => cellTarget(columns[q.c0 + it.dc], q.r0 + it.dr)
    // Shaded stay cells have no job to move: they're added as blank coloured cells.
    const shadeIns = fits.filter((it) => it.shade).map((it) => ({ ...where(it), text: '', done: false, cell_bg: it.e.cell_bg, cell_fg: it.e.cell_fg }))
    const real = fits.filter((it) => !it.shade)
    const movingIds = new Set(clip.mode === 'cut' ? real.map((it) => it.e.id) : [])
    const del = entriesIn(target).filter((e) => !movingIds.has(e.id))
    const label = `${clip.mode === 'cut' ? 'Move' : 'Copy'} ${clip.items.length} job${clip.items.length === 1 ? '' : 's'} to ${rectLabel(target)}`
    if (clip.mode === 'cut') {
      const upd = real.map((it) => ({ id: it.e.id, ...where(it) }))
      const { extra: followers, clashes } = filterFollowers(upd)
      const bt = packFollowers(upd, new Set([...upd, ...followers].map((m) => m.id)))
      const note = followers.length ? ' (packaging follows)' : bt.extra.length || bt.ins.length ? ' (bright tank stay extended)' : ''
      applyCells(label + note, { del, upd: [...upd, ...followers, ...bt.extra], ins: [...bt.ins, ...shadeIns] })
      if (clashes.length) setPackClash(clashes)
      setClip(null)
    } else {
      applyCells(label, { del, ins: [...real.map((it) => ({ ...where(it), text: it.e.text, done: false, beer_name: it.e.beer_name ?? null, cell_bg: it.e.cell_bg ?? null, cell_fg: it.e.cell_fg ?? null })), ...shadeIns] })
    }
    setSel({ a: { r: target.r0, c: target.c0 }, f: { r: target.r1, c: target.c1 } })
  }
  // The bright tank follows packaging: moving a Canning / Kegging cell to a later day moves
  // that beer's packaging job in its bright tank (Can & Keg) to that day too, or adds one, so
  // its stay in the BT stretches to cover it. Only ever later. A booked brew's BT is found by
  // its booking; otherwise by the beer's stay in a BT that began in the 10 days before.
  function packFollowers(upd, moving) {
    const extra = []
    const ins = []
    const isPackJob = (x) => /can|keg|packag/i.test(x.text ?? '')
    const dateOf = (k) => k.split('|')[0]
    const want = new Map() // job id or tank|stay -> { job, tankId, bookingId, date }
    for (const u of upd) {
      const e = entries.find((x) => x.id === u.id)
      if (!e || !PACK_LANES.includes(e.lane) || !(u.entry_date > e.entry_date)) continue
      const beer = e.beer_name || bookingBeer[e.booking_id] || cellBeer({ group: 'pack', lane: e.lane }, [e], e.entry_date, e.slot)
      let jobs = []
      let key = null
      if (e.booking_id) jobs = entries.filter((x) => x.booking_id === e.booking_id && brightTankIds.includes(x.tank_id))
      if (!jobs.length && beer) {
        let best = null
        for (const t of brightTankIds) {
          for (const st of runs.get(t) ?? []) {
            const start = dateOf(st.start)
            if (st.beer === beer && start <= e.entry_date && start >= plusDays(e.entry_date, -10) && (!best || start > best.start)) best = { tankId: t, start, end: dateOf(st.end) }
          }
        }
        if (best) jobs = entries.filter((x) => x.tank_id === best.tankId && x.entry_date >= best.start && x.entry_date <= best.end)
      }
      if (!jobs.length) continue
      const job = jobs.filter(isPackJob).sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0] ?? null
      key = job ? job.id : `${jobs[0].tank_id}|${jobs[0].entry_date}`
      const cur = want.get(key)
      if (!cur || u.entry_date > cur.date) want.set(key, { job, tankId: jobs[0].tank_id, bookingId: e.booking_id ?? null, date: u.entry_date })
    }
    for (const w of want.values()) {
      if (w.job && (moving.has(w.job.id) || w.date <= w.job.entry_date)) continue
      const at = nextFreeCell(entries.filter((y) => !moving.has(y.id)), { lane: 'tank', tankId: w.tankId }, w.date, 'AM', new Set(w.job ? [w.job.id] : []))
      if (w.job) extra.push({ id: w.job.id, entry_date: at.date, slot: at.slot })
      else ins.push({ entry_date: at.date, slot: at.slot, lane: 'tank', tank_id: w.tankId, text: 'Can & Keg', booking_id: w.bookingId })
    }
    return { extra, ins }
  }

  // Packaging follows Filter: when a Filter is moved, its beer's bright tank arrival, BT jobs
  // and Canning / Kegging cells move the same number of days (kept off weekends). A booked
  // brew's cells are found by its booking; otherwise by the beer, within a week of the Filter.
  function filterFollowers(upd) {
    const moving = new Set(upd.map((u) => u.id))
    const extra = []
    const clashes = []
    const isPackJob = (x) => /can|keg|packag/i.test(x.text ?? '')
    for (const u of upd) {
      const e = entries.find((x) => x.id === u.id)
      if (!e || e.lane !== 'tank' || brightTankIds.includes(e.tank_id) || !/^filter\b/i.test(e.text?.trim() ?? '')) continue
      const delta = daysBetween(e.entry_date, u.entry_date)
      if (!delta && e.slot === u.slot) continue
      const weekOn = plusDays(e.entry_date, 7)
      const inWindow = (x) => x.entry_date >= e.entry_date && x.entry_date <= weekOn
      let follow
      if (e.booking_id) {
        follow = entries.filter((x) => x.booking_id === e.booking_id && x.entry_date >= e.entry_date && (PACK_LANES.includes(x.lane) || brightTankIds.includes(x.tank_id)))
      } else {
        const beer = beerOf.get(e.id) ?? beerInTank(runs, e.tank_id, e.entry_date, e.slot)
        if (!beer) continue
        const arrival = entries.find((x) => brightTankIds.includes(x.tank_id) && x.entry_date === e.entry_date && x.text?.trim() === beer)
        const btJobs = []
        if (arrival) {
          for (const x of entries.filter((y) => y.tank_id === arrival.tank_id && y.id !== arrival.id && inWindow(y)).sort((a, b) => rowOf(a.entry_date, a.slot) - rowOf(b.entry_date, b.slot))) {
            if (rowOf(x.entry_date, x.slot) < rowOf(arrival.entry_date, arrival.slot)) continue
            btJobs.push(x)
            if (isPackJob(x)) break
          }
        }
        const pack = entries.filter((x) => PACK_LANES.includes(x.lane) && inWindow(x) && (x.beer_name ?? beerOf.get(x.id)) === beer)
        follow = [...(arrival ? [arrival] : []), ...btJobs, ...pack]
      }
      for (const x of follow) {
        if (moving.has(x.id)) continue
        moving.add(x.id)
        // The arrival in the BT is at the Filter itself; the rest keep their gap.
        const isArrival = brightTankIds.includes(x.tank_id) && x.entry_date === e.entry_date && x.slot === e.slot
        let d = isArrival ? u.entry_date : nextWorkday(plusDays(x.entry_date, delta))
        if (d < u.entry_date) d = u.entry_date
        const slot = isArrival ? u.slot : x.slot
        // Canning / Kegging: into whichever of the two columns is free there.
        let lane = x.lane
        if (PACK_LANES.includes(x.lane)) {
          const landed = [...upd, ...extra].map((m) => ({ ...entries.find((y) => y.id === m.id), ...m }))
          const there = [...entries.filter((y) => !moving.has(y.id)), ...landed]
          const free = freePackLane(x.lane.split('_')[0], d, slot, there)
          if (!free) clashes.push({ id: x.id, kind: x.lane.split('_')[0], text: x.text, beer: x.beer_name ?? beerOf.get(x.id), date: d, slot })
          lane = free ?? x.lane
        }
        // A bright tank job never lands on a cell that's already taken: next free half-day.
        let at = { date: d, slot }
        if (!isArrival && brightTankIds.includes(x.tank_id)) {
          const landed = [...upd, ...extra].map((m) => ({ ...entries.find((y) => y.id === m.id), ...m }))
          at = nextFreeCell([...entries.filter((y) => !moving.has(y.id)), ...landed], { lane: 'tank', tankId: x.tank_id }, d, slot)
        }
        extra.push({ id: x.id, entry_date: at.date, slot: at.slot, lane })
      }
    }
    return { extra, clashes }
  }
  // Delete clears the selected cells. In a bright tank, a stay that started before the
  // selection ends just before it: its packaging job (Can & Keg) after the selection moves up
  // to the half-day before (or goes, when that's the beer's arrival), so the cleared cells
  // really are empty.
  function clearSel() {
    const q = rectOf(sel)
    const del = entriesIn(q)
    const delIds = new Set(del.map((e) => e.id))
    const upd = []
    for (let ci = q.c0; ci <= q.c1; ci++) {
      const c = columns[ci]
      if (c?.group !== 'bbt') continue
      for (const st of runs.get(c.tankId) ?? []) {
        const [sd, ss] = st.start.split('|')
        const [ed, es] = st.end.split('|')
        const startR = rowOf(sd, ss === '0' ? 'AM' : 'PM')
        const endR = rowOf(ed, es === '0' ? 'AM' : 'PM')
        if (!(startR < q.r0 && endR > q.r1)) continue
        const closing = (byCell.get(`${ed}|${es === '0' ? 'AM' : 'PM'}|${c.key}`) ?? []).find((e) => !delIds.has(e.id) && /can|keg|packag/i.test(e.text ?? ''))
        if (!closing) continue
        if (q.r0 - 1 === startR) { del.push(closing); delIds.add(closing.id); continue }
        // The half-day before: a painted (blank) cell there gives way; a job there means the
        // stay can't end sooner, so it's left as it is.
        const before = cellAt(q.r0 - 1)
        const there = (byCell.get(`${before.date}|${before.slot}|${c.key}`) ?? []).filter((e) => !delIds.has(e.id))
        if (there.some((e) => (e.text ?? '').trim())) continue
        for (const e of there) { del.push(e); delIds.add(e.id) }
        upd.push({ id: closing.id, entry_date: before.date, slot: before.slot })
      }
    }
    if (del.length || upd.length) applyCells(`Clear ${rectLabel(q)}`, { del, upd })
  }
  // One undo step for deletes, moves and inserts; booked brews' dates follow their brew cells.
  function applyCells(label, { del = [], upd = [], ins = [], bookingDate = null }) {
    perform(async () => {
      const before = await getEntriesByIds([...del.map((e) => e.id), ...upd.map((u) => u.id)])
      await deleteEntries(del.map((e) => e.id))
      if (upd.length) await updateEntries(upd)
      const created = ins.length ? await insertEntries(ins) : []
      const bookingIds = before.filter((b) => b.booking_id && upd.some((u) => u.id === b.id) && b.booking_id !== bookingDate?.id).map((b) => b.booking_id)
      const prevDates = bookingIds.length ? await syncBookingDates(bookingIds) : []
      // A whole-brew move sets that booking's date to the day picked.
      if (bookingDate) {
        const [old] = await getBookingDates([bookingDate.id])
        await setBookingDates([{ id: bookingDate.id, brew_date: bookingDate.to }])
        if (old) prevDates.push(old)
      }
      pushUndo(label, async () => {
        await restoreEntries(before, created)
        if (prevDates.length) await setBookingDates(prevDates)
      })
    })
  }
  function editCell(r, ci) {
    const c = columns[ci]
    const { date, slot } = cellAt(r)
    const list = byCell.get(`${date}|${slot}|${c.key}`) ?? []
    setEditing({ cell: { date, slot }, column: c, list, beer: cellBeer(c, list, date, slot) })
  }
  // Double-click: an empty tank or brewhouse cell books a brew there (date, and tank or
  // first turn, filled in); anything else opens the cell editor.
  function dblClickCell(r, ci) {
    const c = columns[ci]
    const { date, slot } = cellAt(r)
    const list = byCell.get(`${date}|${slot}|${c.key}`) ?? []
    if (!list.length && (c.group === 'fv' || c.group === 'brew')) {
      setBooking({ date, tankId: c.group === 'fv' ? c.tankId : '', firstTurn: c.group === 'brew' ? { date, slot, lane: c.lane } : null })
    } else if (!list.length && c.group === 'bbt' && !stayAt(runs, c.tankId, date, slot)) {
      // An empty bright tank: book a mix (Megsy) there.
      setBooking({ date, mix: true, btId: c.tankId })
    } else editCell(r, ci)
  }

  // All of a booked brew's cells, even ones beyond the loaded weeks, move together, measured from
  // the brew day its cells are on. Anything already in the cells it lands on is listed first.
  async function moveBookingTo(booking, newDate) {
    const rows = await listBookingEntries(booking.id)
    if (!rows.length) return
    const from = bookingBrewDay(booking, rows)
    const days = daysBetween(from, newDate)
    if (!days) return
    const moved = rows.map((r) => ({ ...r, entry_date: addDays(r.entry_date, days) }))
    const dates = moved.map((r) => r.entry_date).sort()
    const there = await listScheduleEntries(dates[0], dates[dates.length - 1])
    const at = (r) => `${r.entry_date}|${r.slot}|${r.lane}|${r.tank_id ?? ''}`
    const targets = new Set(moved.map(at))
    const clashes = there.filter((e) => e.booking_id !== booking.id && (e.text ?? '').trim() && targets.has(at(e)))
    if (clashes.length) {
      const list = clashes.slice(0, 8).map((e) => `${fmtDay(e.entry_date)} ${e.slot} ${e.tank_id ? tankLabel(tanks.find((t) => t.id === e.tank_id)?.name) : e.lane}: ${e.text}`).join('\n')
      if (!window.confirm(`Moving ${booking.beer_name} to ${fmtDay(newDate)} lands on ${clashes.length} cell${clashes.length === 1 ? '' : 's'} already in use:\n\n${list}${clashes.length > 8 ? '\n…' : ''}\n\nMove it anyway?`)) return
    }
    applyCells(`Move ${booking.beer_name} brew ${days > 0 ? '+' : ''}${days} day${Math.abs(days) === 1 ? '' : 's'}`, {
      upd: moved.map((r) => ({ id: r.id, entry_date: r.entry_date })),
      bookingDate: { id: booking.id, to: newDate },
    })
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

  // Packaging only: just the Canning / Kegging columns and Notes (e.g. for whoever orders
  // cans and kegs). Remembered on this device.
  const [packOnly, setPackOnly] = useState(() => { try { return localStorage.getItem('schedulePackOnly') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('schedulePackOnly', packOnly ? '1' : '0') } catch { /* private mode */ } }, [packOnly])
  const allColumns = useMemo(
    () => [
      ...BREW_LANES.map((l) => ({ key: l, lane: l, label: LANE_LABEL[l], group: 'brew' })),
      ...tanks.map((t) => ({ key: t.id, lane: 'tank', tankId: t.id, label: tankLabel(t.name), group: t.tank_type === 'BBT' ? 'bbt' : 'fv' })),
      ...PACK_LANES.map((l) => ({ key: l, lane: l, label: LANE_LABEL[l], group: 'pack' })),
      { key: 'notes', lane: 'notes', label: 'Notes', group: 'notes' },
    ],
    [tanks]
  )
  const columns = useMemo(() => (packOnly ? allColumns.filter((c) => c.group === 'pack' || c.group === 'notes') : allColumns), [allColumns, packOnly])
  useEffect(() => { setSel(null); setClip(null) }, [packOnly])

  const colIndex = useMemo(() => new Map(columns.map((c, i) => [c.key, i])), [columns])
  const { beerOf, runs } = useMemo(
    () => assignBeers(entries, { knownBeers: templates.map((t) => t.name), bookingBeer }),
    [entries, templates, bookingBeer]
  )

  const byCell = useMemo(() => {
    const m = new Map()
    for (const e of entries) {
      // Canning / kegging: one cell a day (kept under AM).
      const k = `${e.entry_date}|${PACK_LANES.includes(e.lane) ? 'AM' : e.slot}|${e.lane === 'tank' ? e.tank_id : e.lane}`
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
  const selRect = rectOf(sel)

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
              <button className="secondary" onClick={() => setShowPlan((v) => !v)}>{showPlan ? 'Hide brew plan' : 'Brew plan'}</button>
              <Link to="/schedule/templates"><button className="secondary">Cellar templates</button></Link>
            </>
          ) : null}
          <button className={packOnly ? '' : 'secondary'} onClick={() => setPackOnly((v) => !v)} aria-pressed={packOnly}>{packOnly ? 'Packaging only ✓' : 'Packaging only'}</button>
          <Link to="/schedule/materials"><button className="secondary">Packaging materials</button></Link>
          {isAdmin && <button className={showBrewList ? '' : 'secondary'} onClick={() => setShowBrewList((v) => !v)}>{showBrewList ? 'Hide brews for Unleashed' : 'Brews for Unleashed'}</button>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.75rem 0' }}>
        {!archive && <button className="secondary" onClick={scrollToToday}>Today</button>}
        <select value={archive} onChange={(e) => openArchive(e.target.value)} aria-label="Archive">
          <option value="">{archive ? '← Back to the schedule' : 'Archive…'}</option>
          {pastMonths().map((ym) => <option key={ym} value={ym}>{fmtMonth(ym)}</option>)}
        </select>
        {archive && <strong>Archive: {fmtMonth(archive)} (view only)</strong>}
        {editor && !archive && <span className="sc-hint" style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Click and drag to select · drag a selection to move it · Ctrl+X / C / V to cut, copy, paste · Delete clears · double-click to edit (an empty tank or brew cell books a brew there)</span>}
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {showPlan && editor && <SchedulePlanPanel refreshKey={planKey} />}
      {showBrewList && isAdmin && <BrewListPanel />}

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

      <div className="sc-zoom">
        <button className="secondary" onClick={() => zoomStep(-1)} disabled={zoom <= ZOOMS[ZOOMS.length - 1]} aria-label="Zoom out">−</button>
        <button className="secondary" onClick={() => setZoom(1)} title="Back to 100%">{Math.round(zoom * 100)}%</button>
        <button className="secondary" onClick={() => zoomStep(1)} disabled={zoom >= 1} aria-label="Zoom in">+</button>
        <button className="secondary" onClick={zoomFit} title="Fit every column on screen">Fit width</button>
      </div>
      <div className="sc-scroll" ref={scrollRef} onScroll={onScroll} style={boxHeight ? { maxHeight: boxHeight } : undefined}>
        <div className="sc-zoomwrap" style={zoom !== 1 && !CSS_ZOOM && gridSize.w ? { width: gridSize.w * zoom, height: gridSize.h * zoom, overflow: 'clip' } : undefined}>
        <table className={'sc-grid' + (zoom !== 1 ? ' sc-zoomed' : '')} ref={gridRef} style={zoom === 1 ? undefined : CSS_ZOOM ? { zoom } : { transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
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
                  className={(d === today && slot === 'AM' ? 'sc-today ' : '') + (d === today ? 'sc-todayrow ' : '') + (slot === 'PM' ? 'sc-pm ' : '') + (new Date(`${d}T00:00:00`).getDay() === 0 && slot === 'PM' ? 'sc-weekend ' : '') + (isWeekend(d) ? 'sc-wkend' : '')}
                >
                  <td className="sc-day">
                    {slot === 'AM' ? <strong>{fmtDay(d)}</strong> : null} <span className="sc-slot">{slot}</span>
                  </td>
                  {columns.map((c, ci) => {
                    // Canning / kegging: one cell spanning AM and PM.
                    if (c.group === 'pack' && slot === 'PM') return null
                    const r = rowOf(d, slot)
                    const inSel = selRect && r >= selRect.r0 && r <= selRect.r1 && ci >= selRect.c0 && ci <= selRect.c1
                    const inClip = clip && r >= clip.r0 && r < clip.r0 + clip.h && ci >= clip.c0 && ci < clip.c0 + clip.w
                    const dq = dragging.current && dropAt ? dragging.current.q : null
                    const inDrop = dq && r - (dropAt.r - dragging.current.start.r) >= dq.r0 && r - (dropAt.r - dragging.current.start.r) <= dq.r1 && ci - (dropAt.c - dragging.current.start.c) >= dq.c0 && ci - (dropAt.c - dragging.current.start.c) <= dq.c1
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
                        rowSpan={c.group === 'pack' ? 2 : undefined}
                        className={'sc-cell' + (list.some((e) => isBrew(e.text)) ? ' sc-brewday' : '') + (editor ? ' sc-editable' : '') + (inSel ? ' sc-sel' : '') + (inClip ? ' sc-clip' : '') + (inDrop ? ' sc-drop' : '')}
                        data-cell={`${r}|${ci}`}
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
                        onMouseDown={(e) => {
                          if (e.button !== 0) return
                          e.preventDefault()
                          setMenu(null)
                          const here = { r, c: ci }
                          if (inSel && editor && !archive && !e.shiftKey && entriesIn(selRect).length) {
                            dragging.current = { q: selRect, start: here }
                            setDropAt(here)
                            return
                          }
                          setSel((s) => (e.shiftKey && s ? { a: s.a, f: here } : { a: here, f: here }))
                          selecting.current = true
                        }}
                        onMouseEnter={() => { if (dragging.current) setDropAt({ r, c: ci }); else if (selecting.current) setSel((s) => s && { a: s.a, f: { r, c: ci } }) }}
                        onDoubleClick={editor && !archive ? () => dblClickCell(r, ci) : undefined}
                        onContextMenu={editor && !archive ? (e) => {
                          e.preventDefault()
                          if (!inSel) setSel({ a: { r, c: ci }, f: { r, c: ci } })
                          setMenu({ x: e.clientX, y: e.clientY, r, ci })
                        } : undefined}
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
      </div>

      {packClash.length > 0 && (() => {
        const c = packClash[0]
        const opts = freePackSlots(c.kind, c.date, c.slot, entries, 8, new Set([c.id]))
        const next = () => setPackClash((l) => l.slice(1))
        return (
          <div className="sc-overlay">
            <div className="sc-dialog" style={{ maxWidth: 440 }}>
              <h3 style={{ marginTop: 0 }}>Both {c.kind} columns are full</h3>
              <p>{c.beer ? `${c.beer}'s ` : ''}{c.kind} ({c.text}) moved with its Filter to {fmtDay(c.date)} {c.slot}, but both {c.kind} columns are already booked then. When should it go?</p>
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                {opts.map((o) => (
                  <button key={o.date + o.slot + o.lane} className="secondary" onClick={() => {
                    next()
                    perform(async () => {
                      const before = await getEntriesByIds([c.id])
                      await updateEntries([{ id: c.id, entry_date: o.date, slot: o.slot, lane: o.lane }])
                      pushUndo(`Move ${c.kind} to ${fmtDay(o.date)} ${o.slot}`, () => restoreEntries(before, []))
                    })
                  }}>{fmtDay(o.date)} {o.slot} · {LANE_LABEL[o.lane]} column {o.lane.slice(-1)}</button>
                ))}
                <button className="secondary" onClick={next}>Leave it sharing the cell on {fmtDay(c.date)} {c.slot}</button>
              </div>
            </div>
          </div>
        )
      })()}
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
            {(() => {
              const q = rectOf(sel) ?? { r0: menu.r, r1: menu.r, c0: menu.ci, c1: menu.ci }
              const n = entriesIn(q).length
              const one = q.r0 === q.r1 && q.c0 === q.c1
              const run = (fn) => () => { setMenu(null); fn() }
              return (
                <>
                  <div className="sc-menu-title">{one ? `${columns[q.c0].label} · ${rectLabel(q)}` : `${q.r1 - q.r0 + 1} × ${q.c1 - q.c0 + 1} cells · ${n} job${n === 1 ? '' : 's'}`}</div>
                  {one && <button className="sc-menu-item" onClick={run(() => editCell(q.r0, q.c0))}>Edit…</button>}
                  <button className="sc-menu-item" onClick={run(() => copySel('cut'))}>Cut <span className="sc-kbd">Ctrl+X</span></button>
                  <button className="sc-menu-item" onClick={run(() => copySel('copy'))}>Copy <span className="sc-kbd">Ctrl+C</span></button>
                  <button className="sc-menu-item" disabled={!clip} onClick={run(pasteAt)}>Paste <span className="sc-kbd">Ctrl+V</span></button>
                  {n > 0 && <button className="sc-menu-item sc-menu-danger" onClick={run(clearSel)}>Clear {n} job{n === 1 ? '' : 's'} <span className="sc-kbd">Delete</span></button>}
                </>
              )
            })()}
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
      {booking && (
        <BookBrewDialog
          tanks={tanks.filter((t) => t.tank_type !== 'BBT')}
          brightTanks={tanks.filter((t) => t.tank_type === 'BBT')}
          recipes={recipes}
          templates={templates}
          initial={booking === true ? null : booking}
          onClose={() => setBooking(false)}
          onBooked={(b) => {
            setBooking(false)
            loadColours()
            setPlanKey((k) => k + 1)
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
