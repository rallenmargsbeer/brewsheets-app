import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { abvCheck } from '../lib/batchFigures'

const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// Fully packaged batches for the accounts team: batch #, SKU, packaged date, ABV, beer or RTD.
// A batch shows once it's packaged (Tank empty ticked on its last pack-off).
export default function ExcisePage() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    supabase
      .from('batches')
      .select('id, batch_number, beer_style, package_date, abv, fv_to_bbt_l, daw_added_l, og_override, recipes(name, target_abv, is_rtd), brew_runs(whirlpool_gravity, ko_flowmeter_l, correction_l), fermentation_readings(gravity_plato, reading_date, created_at)')
      .eq('status', 'packaged')
      .not('package_date', 'is', null)
      .order('package_date', { ascending: false })
      .then(({ data, error }) => {
        if (error) return setError(error.message)
        setRows(data.map((b) => ({
          id: b.id,
          num: b.batch_number,
          sku: b.beer_style || b.recipes?.name || '',
          date: b.package_date,
          abv: abvCheck(b).abv ?? (b.abv != null ? Number(b.abv) : null),
          type: b.recipes?.is_rtd ? 'RTD' : 'Beer',
        })))
      })
  }, [])

  const shown = (rows ?? []).filter((r) => (!from || r.date >= from) && (!to || r.date <= to))

  function downloadCsv() {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const lines = [['Batch #', 'SKU', 'Packaged', 'ABV %', 'Type'], ...shown.map((r) => [r.num, r.sku, r.date, r.abv == null ? '' : r.abv.toFixed(2), r.type])]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map(q).join(',')).join('\n')], { type: 'text/csv' }))
    a.download = `excise${from ? `-from-${from}` : ''}${to ? `-to-${to}` : ''}.csv`
    a.click()
  }

  return (
    <div>
      <h1>Excise</h1>
      <p className="stock-muted" style={{ marginTop: '-0.5rem' }}>Every batch once it's fully packaged, newest first.</p>
      <div className="batch-search">
        <label>Packaged from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="secondary" onClick={downloadCsv} disabled={!shown.length}>Download CSV</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!rows && !error && <p>Loading…</p>}
      {rows && (
        <table className="batches-table">
          <thead><tr><th>Batch #</th><th>SKU</th><th>Packaged</th><th style={{ textAlign: 'right' }}>ABV</th><th>Beer / RTD</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.num}</td>
                <td>{r.sku}</td>
                <td>{fmt(r.date)}</td>
                <td style={{ textAlign: 'right' }}>{r.abv == null ? '—' : `${r.abv.toFixed(2)}%`}</td>
                <td>{r.type}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={5} className="stock-muted">No packaged batches{from || to ? ' in these dates' : ' yet'}.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}
