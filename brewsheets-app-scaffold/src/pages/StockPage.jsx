import { useEffect, useMemo, useState } from 'react'
import { listStock, refreshStock, mapStockProduct, guessFormat, SOURCE_LABEL } from '../lib/stock'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Perth', dateStyle: 'medium', timeStyle: 'short' }) : 'never')
const num = (n) => (n ? Math.round(n).toLocaleString() : '')

// Columns: each Unleashed warehouse, then the two Liquid Mix accounts.
function locationKey(item) {
  return item.source === 'unleashed' ? `unleashed|${item.location}` : item.source
}
function locationLabel(key) {
  return key.startsWith('unleashed|') ? key.slice(10) : SOURCE_LABEL[key]
}

export default function StockPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showUnmapped, setShowUnmapped] = useState(false)

  const load = () => listStock().then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  async function refresh() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await refreshStock()
      setMsg({ bad: !r.ok, text: Object.entries(r.results).map(([k, v]) => `${SOURCE_LABEL[k] ?? k}: ${v}`).join(' · ') })
    } catch (e) {
      setMsg({ bad: true, text: e.message })
    }
    setBusy(false)
    load()
  }

  const view = useMemo(() => {
    if (!data) return null
    const map = new Map(data.products.map((p) => [`${p.source}|${p.code.toLowerCase()}`, p]))
    const counted = data.items.filter((it) => !(it.source === 'unleashed' && /liquid mix/i.test(it.location)))
    const locations = [...new Set(counted.map(locationKey))].sort((a, b) => {
      const rank = (k) => (k.startsWith('unleashed|') ? 0 : k === 'lm_3pl' ? 1 : 2)
      return rank(a) - rank(b) || a.localeCompare(b)
    })
    const beers = new Map() // beer -> { cube: {loc: qty}, keg: {loc: qty} }
    const unmapped = []
    for (const it of data.items) {
      // Unleashed's own "Liquid Mix 3PL" warehouse mirrors the LM 3PL report; count LM's figures only.
      if (it.source === 'unleashed' && /liquid mix/i.test(it.location)) continue
      const p = map.get(`${it.source}|${it.code.toLowerCase()}`) ?? (it.alt_code ? map.get(`${it.source}|${it.alt_code.toLowerCase()}`) : null)
      if (!p) {
        if (it.available || it.on_hand) unmapped.push(it)
        continue
      }
      const b = beers.get(p.beer) ?? { cube: {}, keg: {} }
      const loc = locationKey(it)
      b[p.format][loc] = (b[p.format][loc] ?? 0) + Number(it.available)
      beers.set(p.beer, b)
    }
    const total = (o) => Object.values(o).reduce((a, b) => a + b, 0)
    const rows = [...beers].map(([beer, b]) => ({ beer, ...b, cubes: total(b.cube), kegs: total(b.keg) }))
      .filter((r) => r.cubes || r.kegs)
      .sort((a, b) => b.cubes + b.kegs - (a.cubes + a.kegs))
    const beerNames = [...new Set(data.products.map((p) => p.beer))].sort()
    return { locations, rows, unmapped, beerNames }
  }, [data])

  const lastRun = data?.runs?.[0]
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Stock on hand</h1>
        <button onClick={refresh} disabled={busy}>{busy ? 'Pulling stock… (up to a minute)' : 'Refresh stock'}</button>
      </div>
      <p style={{ color: 'var(--ink2)', marginTop: 4 }}>
        Available cubes and kegs from Unleashed and Liquid Mix (read-only). Last refresh: {when(lastRun?.finished_at ?? lastRun?.started_at)}
        {lastRun?.status && lastRun.status !== 'ok' ? ` (${lastRun.status})` : ''}
      </p>
      {msg && <p style={{ color: msg.bad ? '#b00020' : '#1b6e2e' }}>{msg.text}</p>}
      {lastRun?.status && lastRun.status !== 'ok' && lastRun.detail && !msg && <p className="sc-warn">{lastRun.detail}</p>}
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {!view && !error && <p>Loading…</p>}

      {view && (
        <>
          <div className="stock-scroll">
            <table className="stock-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Beer</th>
                  <th colSpan={view.locations.length + 1} className="stock-grp">Cubes</th>
                  <th colSpan={view.locations.length + 1} className="stock-grp">Kegs</th>
                </tr>
                <tr>
                  {['cube', 'keg'].map((f) => [
                    ...view.locations.map((l) => <th key={f + l}>{locationLabel(l)}</th>),
                    <th key={f + 'total'} className="stock-total">Total</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.beer}>
                    <td className="stock-beer">{r.beer}</td>
                    {['cube', 'keg'].map((f) => [
                      ...view.locations.map((l) => <td key={f + l}>{num(r[f][l])}</td>),
                      <td key={f + 'total'} className="stock-total">{num(f === 'cube' ? r.cubes : r.kegs)}</td>,
                    ])}
                  </tr>
                ))}
                {!view.rows.length && (
                  <tr><td colSpan={2 * view.locations.length + 3} style={{ color: 'var(--ink2)' }}>No stock pulled yet. Press Refresh stock.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {view.unmapped.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <button className="secondary" onClick={() => setShowUnmapped((s) => !s)}>
                {showUnmapped ? 'Hide' : 'Show'} {view.unmapped.length} product{view.unmapped.length === 1 ? '' : 's'} not linked to a beer
              </button>
              {showUnmapped && (
                <UnmappedList items={view.unmapped} beerNames={view.beerNames} onMapped={load} />
              )}
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
