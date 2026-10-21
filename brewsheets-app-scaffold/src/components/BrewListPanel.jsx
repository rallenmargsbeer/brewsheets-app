import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { tankLabel } from '../lib/tanks'
import { listBookings, listScheduleEntries, BREW_LANES, todayIso, addDays } from '../lib/schedule'
import { beerMatch } from '../lib/incoming'

const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

// Admin: the brews scheduled between two dates, with each beer's Finished Beer code in
// Unleashed and the litres, to enter as forecast assemblies there (for a reorder report).
// Booked brews, plus brew cells on the schedule with no booking (one turn per cell, 25 HL).
export default function BrewListPanel() {
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(addDays(todayIso(), 27))
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!from || !to || to < from) return
    setRows(null); setError(null)
    Promise.all([
      listBookings({ fromIso: from, toIso: to }),
      listScheduleEntries(from, to),
      supabase.from('unl_dataset').select('data').eq('key', 'boms').maybeSingle(),
    ]).then(([bookings, cells, boms]) => {
      const fb = new Map((boms.data?.data ?? []).filter((b) => /^FB-/i.test(b.code ?? '')).map((b) => [beerMatch(b.code.replace(/^FB-\s*/i, '')), b.code]))
      const fbFor = (...names) => names.map((n) => fb.get(beerMatch(n))).find(Boolean) ?? null
      const out = bookings.map((b) => {
        const turns = Number(b.turn_quantity) || 0
        const turnL = Number(b.turn_volume_l) || 2500
        return { key: b.id, date: b.brew_date, beer: b.beer_name ?? b.recipes?.name, code: fbFor(b.beer_name, b.recipes?.name), turns, litres: turns * turnL, tank: b.tanks?.name, started: !!b.batch_id }
      })
      // Brew cells without a booking: group by day and beer.
      const loose = new Map()
      for (const e of cells.filter((c) => BREW_LANES.includes(c.lane) && !c.booking_id && (c.text ?? '').trim())) {
        const k = `${e.entry_date}|${e.text.trim().toLowerCase()}`
        loose.set(k, { ...(loose.get(k) ?? { key: k, date: e.entry_date, beer: e.text.trim(), turns: 0, tank: null, unbooked: true }), turns: (loose.get(k)?.turns ?? 0) + 1 })
      }
      for (const r of loose.values()) out.push({ ...r, code: fbFor(r.beer), litres: r.turns * 2500 })
      setRows(out.sort((a, b) => a.date.localeCompare(b.date) || a.beer.localeCompare(b.beer)))
    }).catch((e) => setError(e.message))
  }, [from, to])

  const total = (rows ?? []).reduce((a, r) => a + r.litres, 0)
  function copy() {
    const lines = [['Date', 'Beer', 'Unleashed product', 'Litres', 'Turns', 'Tank'].join('\t'),
      ...rows.map((r) => [r.date, r.beer, r.code ?? '', r.litres, r.turns, r.tank ? tankLabel(r.tank) : ''].join('\t'))]
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <section className="stock-card" style={{ margin: '0.75rem 0' }}>
      <h2 style={{ marginTop: 0 }}>Brews for Unleashed</h2>
      <p className="stock-muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Scheduled brews in a date range, to enter as forecast assemblies in Unleashed (Finished Beer code × litres brewed). Booked brews use their turns and turn size; brew cells with no booking count as one 25 HL turn each.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="secondary" onClick={copy} disabled={!rows?.length}>{copied ? '✓ Copied' : 'Copy table'}</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {to < from && <p className="stock-muted">The To date is before the From date.</p>}
      {!rows && !error && to >= from && <p>Loading…</p>}
      {rows && (
        <div style={{ overflowX: 'auto' }}>
          <table className="stock-table">
            <thead><tr><th>Date</th><th>Beer</th><th>Unleashed product</th><th className="pm-num">Litres</th><th className="pm-num">Turns</th><th>Tank</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{fmt(r.date)}</td>
                  <td>{r.beer}</td>
                  <td>{r.code ?? <span className="stock-muted">No FB match</span>}</td>
                  <td className="pm-num">{r.litres.toLocaleString()}</td>
                  <td className="pm-num">{r.turns}</td>
                  <td>{r.tank ? tankLabel(r.tank) : ''}</td>
                  <td className="stock-muted" style={{ fontSize: '0.8rem' }}>{r.unbooked ? 'not booked' : r.started ? 'started' : ''}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="stock-muted">No brews scheduled in this range.</td></tr>}
            </tbody>
            {rows.length > 0 && <tfoot><tr><td colSpan={3}><strong>{rows.length} brew{rows.length === 1 ? '' : 's'}</strong></td><td className="pm-num"><strong>{total.toLocaleString()}</strong></td><td colSpan={3}></td></tr></tfoot>}
          </table>
        </div>
      )}
    </section>
  )
}
