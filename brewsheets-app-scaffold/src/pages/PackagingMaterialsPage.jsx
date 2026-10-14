import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, todayIso } from '../lib/schedule'
import { packagingMaterials } from '../lib/packMaterials'
import BeerDot from '../components/BeerDot.jsx'

const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
const num = (n) => (Math.round(n * 100) / 100).toLocaleString()
const itemLabel = (r) => (r.fmt === 'cube' ? `${r.qty.toLocaleString()} cubes` : `${r.qty} × ${r.size} L kegs`)

// Packaging materials needed for the packaging on the schedule, from the Unleashed BOMs.
export default function PackagingMaterialsPage() {
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(addDays(todayIso(), 27))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!from || !to || to < from) return
    setData(null)
    setError(null)
    packagingMaterials(from, to).then(setData).catch((e) => setError(e.message))
  }, [from, to])

  function downloadCsv() {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const rows = [['Code', 'Description', 'Quantity', 'Unit'], ...data.materials.map((m) => [m.code, m.description, Math.round(m.qty * 100) / 100, m.unit ?? ''])]
    const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `packaging-materials-${from}-to-${to}.csv`
    a.click()
  }

  const missing = data?.runs.filter((r) => !r.product) ?? []
  return (
    <div className="pm-page">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Packaging materials</h1>
        <div className="pm-noprint" style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/schedule"><button className="secondary">Back to schedule</button></Link>
          <button className="secondary" onClick={() => window.print()} disabled={!data}>Print</button>
          <button onClick={downloadCsv} disabled={!data?.materials.length}>Download CSV</button>
        </div>
      </div>
      <div className="stock-controls">
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="pm-noprint" style={{ display: 'flex', gap: '0.3rem' }}>
          {[2, 4, 8, 13].map((w) => (
            <button key={w} className="secondary" onClick={() => { setFrom(todayIso()); setTo(addDays(todayIso(), w * 7 - 1)) }}>{w} weeks</button>
          ))}
        </span>
      </div>
      <p className="stock-muted" style={{ fontSize: '0.85rem' }}>
        From the Canning and Kegging cells on the schedule, {fmt(from)} to {fmt(to)}, times each product's bill of materials in Unleashed (beer itself left out).
        {data?.bomsUpdated ? ` BOMs copied from Unleashed ${new Date(data.bomsUpdated).toLocaleDateString('en-AU')}.` : ''}
      </p>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && (
        <>
          <section className="stock-card">
            <h2>Materials needed</h2>
            {data.materials.length ? (
              <table className="stock-table pm-table">
                <thead><tr><th>Code</th><th>Description</th><th className="pm-num">Quantity</th><th>Unit</th></tr></thead>
                <tbody>
                  {data.materials.map((m) => (
                    <tr key={m.code}><td>{m.code}</td><td>{m.description}</td><td className="pm-num">{num(m.qty)}</td><td>{m.unit ?? ''}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="stock-muted">No packaging with a matching BOM in these dates.</p>}
          </section>
          {missing.length > 0 && (
            <p className="sc-warn">
              {missing.length} packaging run{missing.length === 1 ? '' : 's'} aren't counted because there's no matching BOM in Unleashed (or the beer isn't clear):{' '}
              {missing.map((r) => `${fmt(r.date)} ${r.beer ?? 'unknown beer'} ${itemLabel(r)}`).join('; ')}.
            </p>
          )}
          <section className="stock-card">
            <h2>Packaging runs included</h2>
            <table className="stock-table pm-table">
              <thead><tr><th>Day</th><th>Beer</th><th>Packaging</th><th>Product (BOM)</th></tr></thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{fmt(r.date)} {r.slot}</td>
                    <td>{r.beer ? <><BeerDot name={r.beer} />{r.beer}</> : <span className="stock-muted">Unknown</span>}</td>
                    <td>{itemLabel(r)}</td>
                    <td>{r.product ?? <span className="stock-muted">No BOM</span>}</td>
                  </tr>
                ))}
                {!data.runs.length && <tr><td colSpan={4} className="stock-muted">No packaging scheduled in these dates.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
