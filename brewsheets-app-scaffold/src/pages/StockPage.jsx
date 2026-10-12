import { useEffect, useMemo, useState } from 'react'
import { listStock, refreshStock, mapStockProduct, guessFormat, kegSize, SOURCE_LABEL } from '../lib/stock'
import { loadIncoming, beerMatch, weeksOfCover } from '../lib/incoming'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Perth', dateStyle: 'medium', timeStyle: 'short' }) : 'never')
const num = (n) => (n ? Math.round(n).toLocaleString() : '')
const DAY = 86400000
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
const isLmWholesale = (customer) => /liquid\s*mix.*wholesale/i.test(customer ?? '')
// Unleashed's own "Liquid Mix 3PL" warehouse mirrors the LM 3PL report; count LM's figures only.
const mirrorsLm = (it) => it.source === 'unleashed' && /liquid mix/i.test(it.location)

// Columns: each Unleashed warehouse, then the two Liquid Mix accounts.
const locationKey = (it) => (it.source === 'unleashed' ? `unleashed|${it.location}` : it.source)
const locationLabel = (key) => (key.startsWith('unleashed|') ? key.slice(10).replace(/ MRBC Brewery$/, '') : SOURCE_LABEL[key])

// Core range if Unleashed can't be read for the sub-group.
const CORE_FALLBACK = ['ITP', 'Kolsch', 'Lager', 'Draught', 'Megsy', 'Mermid', 'Pale Ale', 'Red IPA', 'River Dog', 'Stout', 'Brown', 'Drift XPA']

const FORMATS = [
  { key: 'cube', title: 'Cubes', note: '16 × 375 mL' },
  { key: 'keg', title: 'Kegs', note: '20 / 30 / 50 L' },
]

// Settings kept in this browser.
function useSetting(name, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem('stock.' + name); return s == null ? initial : JSON.parse(s) } catch { return initial }
  })
  const set = (x) => { setV(x); try { localStorage.setItem('stock.' + name, JSON.stringify(x)) } catch { /* not saved */ } }
  return [v, set]
}

function coverClass(weeks, target) {
  if (weeks == null) return 'none'
  if (weeks < target) return 'low'
  if (weeks < target + 2) return 'mid'
  return 'ok'
}

export default function StockPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showUnmapped, setShowUnmapped] = useState(false)
  const [windowWeeks, setWindowWeeks] = useSetting('window', 8)
  const [target, setTarget] = useSetting('target', 3)

  const [incoming, setIncoming] = useState([])
  const load = () => listStock().then(setData).catch((e) => setError(e.message))
  // Packaging already on the schedule counts towards cover from its day.
  useEffect(() => { loadIncoming().then(setIncoming).catch(() => setIncoming([])) }, [])
  useEffect(() => { load() }, [])

  async function refresh() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await refreshStock()
      const bad = Object.entries(r.results).filter(([, v]) => /error|failed/.test(v))
      setMsg(bad.length ? { bad: true, text: bad.map(([k, v]) => `${SOURCE_LABEL[k] ?? k}: ${v}`).join(' · ') } : { bad: false, text: 'Stock and sales refreshed.' })
    } catch (e) {
      setMsg({ bad: true, text: e.message })
    }
    setBusy(false)
    load()
  }

  const view = useMemo(() => {
    if (!data) return null
    const link = new Map(data.products.map((p) => [`${p.source}|${p.code.toLowerCase()}`, p]))
    const find = (source, code, alt) => link.get(`${source}|${String(code).toLowerCase()}`) ?? (alt ? link.get(`${source}|${String(alt).toLowerCase()}`) : null)
    const counted = data.items.filter((it) => !mirrorsLm(it))
    const locations = [...new Set(counted.map(locationKey))].sort((a, b) => {
      const rank = (k) => (k.startsWith('unleashed|') ? 0 : k === 'lm_3pl' ? 1 : 2)
      return rank(a) - rank(b) || a.localeCompare(b)
    })

    // Stock per beer and format (kegs split by size), by location.
    const rows = new Map() // "beer|format|size" -> row
    const lineKey = (p, code, description) => `${p.beer}|${p.format}|${p.format === 'keg' ? kegSize(code, description) : ''}`
    const rowOf = (k) => {
      if (!rows.has(k)) {
        const [beer, format, size] = k.split('|')
        rows.set(k, { key: k, beer, format, size: size ? Number(size) : null, at: {}, total: 0, sold: 0, toLm: 0, lmDep: null })
      }
      return rows.get(k)
    }
    const unmapped = []
    for (const it of counted) {
      const p = find(it.source, it.code, it.alt_code)
      if (!p) { if (it.available || it.on_hand) unmapped.push(it); continue }
      const r = rowOf(lineKey(p, it.code, it.description ?? ''))
      const loc = locationKey(it)
      r.at[loc] = (r.at[loc] ?? 0) + Number(it.available)
      r.total += Number(it.available)
    }

    // Sales over the chosen window: everyone but LM Wholesale (their onward sales come from depletion).
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const from = new Date(Date.parse(today) - windowWeeks * 7 * DAY).toISOString().slice(0, 10)
    const toLmByDay = new Map() // "beer|format" -> [{ date, qty }]
    for (const s of data.sales) {
      if (s.sale_date <= from) continue
      const p = find('unleashed', s.code)
      if (!p) continue
      const k = lineKey(p, s.code)
      const r = rowOf(k)
      if (isLmWholesale(s.customer)) {
        r.toLm += Number(s.qty)
        toLmByDay.set(k, [...(toLmByDay.get(k) ?? []), { date: s.sale_date, qty: Number(s.qty) }])
      } else r.sold += Number(s.qty)
    }

    // LM Wholesale depletion from daily snapshots: yesterday's stock + what we sold them - today's.
    const snaps = new Map() // "beer|format" -> Map(date -> qty)
    for (const h of data.history) {
      if (h.snap_date <= from) continue
      const p = find('lm_wholesale', h.code, h.alt_code)
      if (!p) continue
      // LM Wholesale's number codes don't carry a size: they're 50 L kegs.
      const k = lineKey(p, h.code)
      const m = snaps.get(k) ?? new Map()
      m.set(h.snap_date, (m.get(h.snap_date) ?? 0) + Number(h.available))
      snaps.set(k, m)
    }
    let historyDays = 0
    for (const [k, m] of snaps) {
      const dates = [...m.keys()].sort()
      if (dates.length < 2) continue
      const span = daysBetween(dates[0], dates[dates.length - 1])
      historyDays = Math.max(historyDays, span)
      if (span < 14) continue
      let dep = 0
      for (let i = 1; i < dates.length; i++) {
        const inflow = (toLmByDay.get(k) ?? []).filter((x) => x.date > dates[i - 1] && x.date <= dates[i]).reduce((a, x) => a + x.qty, 0)
        dep += Math.max(0, m.get(dates[i - 1]) + inflow - m.get(dates[i]))
      }
      rowOf(k).lmDep = (dep / span) * 7
    }

    const list = [...rows.values()].map((r) => {
      // Until there's enough snapshot history, what we sell LM Wholesale stands in for what they sell on.
      const lmWeekly = r.lmDep ?? r.toLm / windowWeeks
      const weekly = r.sold / windowWeeks + lmWeekly
      const coming = incoming.filter((i) => i.format === r.format && (r.format !== 'keg' || i.size === r.size) && beerMatch(i.beer) === beerMatch(r.beer))
      return {
        ...r,
        weekly,
        coming,
        lmEstimated: r.lmDep == null && r.toLm > 0,
        cover: weeksOfCover(r.total, weekly, coming),
      }
    }).filter((r) => r.total || r.weekly || r.coming.length)

    // Weeks of cover is for the core range only: a beer is core if any of its Unleashed codes is.
    const coreBeers = new Set(
      data.core?.size
        ? data.products.filter((p) => p.source === 'unleashed' && data.core.has(p.code.toLowerCase())).map((p) => p.beer)
        : CORE_FALLBACK
    )
    for (const r of list) r.core = coreBeers.has(r.beer)

    const beerNames = [...new Set(data.products.map((p) => p.beer))].sort()
    return { locations, list, unmapped, beerNames, historyDays }
  }, [data, windowWeeks, incoming])

  const lastRun = data?.runs?.[0]
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Stock on hand</h1>
        <button onClick={refresh} disabled={busy}>{busy ? 'Pulling stock and sales… (up to a minute)' : 'Refresh stock'}</button>
      </div>
      <p style={{ color: 'var(--ink2)', marginTop: 4 }}>
        Available stock from Unleashed and Liquid Mix, and sales from Unleashed (read-only). Last refresh: {when(lastRun?.finished_at ?? lastRun?.started_at)}
      </p>
      {msg && <p style={{ color: msg.bad ? '#b00020' : '#1b6e2e' }}>{msg.text}</p>}
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {!view && !error && <p>Loading…</p>}

      {view && (
        <>
          <div className="stock-controls">
            <label>Sales rate over
              <select value={windowWeeks} onChange={(e) => setWindowWeeks(Number(e.target.value))}>
                {[4, 8, 13].map((w) => <option key={w} value={w}>last {w} weeks</option>)}
              </select>
            </label>
            <label>Flag under
              <input type="number" min="1" max="12" value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))} /> weeks
            </label>
            <span className="stock-legend">
              <span className="stock-pill low">under {target} wks</span>
              <span className="stock-pill mid">{target} to {target + 2} wks</span>
              <span className="stock-pill ok">{target + 2}+ wks</span>
            </span>
          </div>

          {FORMATS.map((f) => {
            const all = view.list.filter((r) => r.format === f.key)
            const core = all.filter((r) => r.core).sort((a, b) => (a.cover ?? 1e9) - (b.cover ?? 1e9))
            const other = all.filter((r) => !r.core).sort((a, b) => a.beer.localeCompare(b.beer) || b.size - a.size)
            const rows = [...core, ...other]
            const locs = view.locations.filter((l) => rows.some((r) => r.at[l]))
            return (
              <section key={f.key} className={`stock-card stock-${f.key}`}>
                <h2>{f.title} <span>{f.note}</span></h2>
                <div className="stock-scroll">
                  <table className="stock-table">
                    <thead>
                      <tr>
                        <th className="stock-beer">Beer</th>
                        {locs.map((l) => <th key={l}>{locationLabel(l)}</th>)}
                        <th className="stock-total">Total</th>
                        <th>Sold / wk</th>
                        <th>Packaging</th>
                        <th className="stock-cover-h">Weeks of cover</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const c = coverClass(r.cover, target)
                        return [
                          r === other[0] && (
                            <tr key="other" className="stock-divider"><td colSpan={locs.length + 5}>Seasonal &amp; other</td></tr>
                          ),
                          <tr key={r.key} className={r.core ? '' : 'stock-other'}>
                            <td className="stock-beer">{r.beer}{r.size && <span className={`stock-size s${r.size}`}>{r.size} L</span>}</td>
                            {locs.map((l) => <td key={l} className={r.at[l] < 0 ? 'stock-neg' : ''}>{num(r.at[l])}</td>)}
                            <td className={'stock-total' + (r.total < 0 ? ' stock-neg' : '')}>{num(r.total) || '0'}</td>
                            <td title={r.lmEstimated ? 'LM Wholesale part estimated from our sales to them' : undefined}>
                              {r.weekly ? r.weekly.toFixed(r.weekly < 10 ? 1 : 0) : ''}{r.lmEstimated ? '*' : ''}
                            </td>
                            <td className="stock-coming">
                              {r.coming.slice(0, 2).map((i) => (
                                <div key={i.date}>+{i.qty.toLocaleString()} <span>{new Date(`${i.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
                              ))}
                              {r.coming.length > 2 && <div className="stock-muted">+{r.coming.length - 2} more</div>}
                            </td>
                            <td className="stock-cover">
                              {!r.core ? null : r.cover == null ? <span className="stock-muted">no sales</span> : (
                                <div className={`stock-bar ${c}`}>
                                  <div style={{ width: `${Math.min(100, (r.cover / (target * 3)) * 100)}%` }} />
                                  <span>{r.cover >= 26 ? '26+' : r.cover < 10 ? r.cover.toFixed(1) : Math.round(r.cover)}</span>
                                </div>
                              )}
                            </td>
                          </tr>,
                        ]
                      })}
                      {!rows.length && <tr><td colSpan={locs.length + 5} className="stock-muted">No {f.title.toLowerCase()} in stock.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}

          <p className="stock-muted" style={{ fontSize: '0.8rem' }}>
            Weeks of cover is shown for the core range. Sold / wk = Unleashed sales to everyone except LM Wholesale, plus what leaves LM Wholesale.
            Weeks of cover counts packaging on the schedule from its day (canning counts are cubes, kegging counts are kegs).
            {view.historyDays < 14
              ? ` * LM Wholesale's part is estimated from what we sell them until there are 2 weeks of daily stock snapshots (${view.historyDays} day${view.historyDays === 1 ? '' : 's'} so far).`
              : ''}
            {' '}Unleashed's Liquid Mix 3PL warehouse is left out so it isn't counted twice.
          </p>

          {view.unmapped.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <button className="secondary" onClick={() => setShowUnmapped((s) => !s)}>
                {showUnmapped ? 'Hide' : 'Show'} {view.unmapped.length} product{view.unmapped.length === 1 ? '' : 's'} not linked to a beer
              </button>
              {showUnmapped && <UnmappedList items={view.unmapped} beerNames={view.beerNames} onMapped={load} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Stock lines whose code isn't linked to a beer yet: pick the beer (or type a new one) to count them.
function UnmappedList({ items, beerNames, onMapped }) {
  const [err, setErr] = useState(null)
  const sorted = [...items].sort((a, b) => a.source.localeCompare(b.source) || a.code.localeCompare(b.code))
  return (
    <>
      {err && <p style={{ color: '#b00020' }}>{err}</p>}
      <table className="stock-table" style={{ marginTop: '0.5rem' }}>
        <thead><tr><th>Source</th><th>Code</th><th>Description</th><th>Available</th><th>Beer</th><th>Format</th><th></th></tr></thead>
        <tbody>
          {sorted.map((it) => <UnmappedRow key={it.source + it.location + it.code} it={it} beerNames={beerNames} onMapped={onMapped} onError={setErr} />)}
        </tbody>
      </table>
      <datalist id="stock-beers">{beerNames.map((b) => <option key={b} value={b} />)}</datalist>
    </>
  )
}

function UnmappedRow({ it, onMapped, onError }) {
  const [beer, setBeer] = useState('')
  const [format, setFormat] = useState(guessFormat(it) ?? 'cube')
  return (
    <tr>
      <td>{SOURCE_LABEL[it.source]}{it.source === 'unleashed' ? ` · ${it.location}` : ''}</td>
      <td>{it.code}</td>
      <td style={{ color: 'var(--ink2)' }}>{it.description}</td>
      <td>{num(it.available)}</td>
      <td><input list="stock-beers" value={beer} onChange={(e) => setBeer(e.target.value)} placeholder="Beer…" style={{ width: 150 }} /></td>
      <td>
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="cube">Cube</option>
          <option value="keg">Keg</option>
        </select>
      </td>
      <td>
        <button disabled={!beer.trim()} onClick={() => mapStockProduct({ beer: beer.trim(), format, source: it.source, code: it.code }).then(onMapped).catch((e) => onError(e.message))}>Link</button>
      </td>
    </tr>
  )
}
