import { useEffect, useState } from 'react'
import { tankLabel } from '../lib/tanks'
import { Link } from 'react-router-dom'
import { listBatches, deleteBatch } from '../lib/api'
import { isScheduleEditor } from '../lib/schedule'
import BeerDot from '../components/BeerDot.jsx'

// The most recent batches show; older ones are in the archive below.
const RECENT = 50

export default function BatchesPage() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchive, setShowArchive] = useState(false)
  const [error, setError] = useState(null)
  const [editor, setEditor] = useState(false)
  const [q, setQ] = useState({ num: '', sku: '', from: '', to: '' })
  useEffect(() => { isScheduleEditor().then(setEditor) }, [])

  async function remove(b) {
    if (!window.confirm(`Delete batch ${b.batch_number}${b.beer_style || b.recipes?.name ? ` (${b.beer_style || b.recipes?.name})` : ''}? Its brew turns, readings and packaging records go too. This cannot be undone.`)) return
    try {
      await deleteBatch(b.id)
      setBatches((list) => list.filter((x) => x.id !== b.id))
    } catch (e) {
      setError(e.message)
    }
  }

  function refresh() {
    listBatches()
      .then((rows) => setBatches([...rows].sort((a, b) => String(b.batch_number).localeCompare(String(a.batch_number), undefined, { numeric: true }))))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  // Search: any mix of batch #, SKU and brew-date range; empty fields are ignored.
  const skuOf = (b) => b.beer_style || b.recipes?.name || ''
  const searching = Object.values(q).some((v) => v.trim())
  const shown = !searching ? batches : batches.filter((b) =>
    (!q.num.trim() || String(b.batch_number).toLowerCase().includes(q.num.trim().toLowerCase())) &&
    (!q.sku.trim() || skuOf(b).toLowerCase().includes(q.sku.trim().toLowerCase())) &&
    (!q.from || (b.date_brewed && b.date_brewed >= q.from)) &&
    (!q.to || (b.date_brewed && b.date_brewed <= q.to)))
  const skus = [...new Set(batches.map(skuOf).filter(Boolean))].sort()
  const setField = (k) => (e) => setQ({ ...q, [k]: e.target.value })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Batches</h1>
        <Link to="/batches/new">
          <button>+ Add Brew</button>
        </Link>
      </div>

      <div className="batch-search">
        <label>Batch #<input value={q.num} onChange={setField('num')} placeholder="e.g. 413" inputMode="numeric" /></label>
        <label>SKU<input value={q.sku} onChange={setField('sku')} placeholder="e.g. In The Pines" list="batch-skus" /></label>
        <datalist id="batch-skus">{skus.map((s) => <option key={s} value={s} />)}</datalist>
        <label>Brewed from<input type="date" value={q.from} onChange={setField('from')} /></label>
        <label>to<input type="date" value={q.to} onChange={setField('to')} /></label>
        {searching && <button className="secondary" onClick={() => setQ({ num: '', sku: '', from: '', to: '' })}>Clear</button>}
      </div>
      {searching && !loading && <p className="batch-search-count">{shown.length} batch{shown.length === 1 ? '' : 'es'} found</p>}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
        <table className="batches-table">
          <thead>
            <tr>
              <th>Batch #</th>
              <th>SKU</th>
              <th>Status</th>
              <th>Tank</th>
              <th>Date Brewed</th>
              <th>Package Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(searching || showArchive ? shown : shown.slice(0, RECENT)).map((b, i) => [
              !searching && i === RECENT && <tr key="archive" className="batches-archive-head"><td colSpan={7}>Archive</td></tr>,
              <tr key={b.id}>
                <td>
                  <Link to={`/batches/${b.id}`}>{b.batch_number}</Link>
                </td>
                <td><BeerDot name={b.beer_style || b.recipes?.name} />{b.beer_style || b.recipes?.name}</td>
                <td><span className={'pill pill-' + b.status}>{b.status}</span></td>
                <td>{tankLabel(b.tanks?.name)}</td>
                <td>{b.date_brewed ?? '—'}</td>
                <td>{b.package_date ?? '—'}</td>
                <td>{editor && <button className="secondary batch-delete" onClick={() => remove(b)} aria-label={`Delete batch ${b.batch_number}`} title="Delete batch">Delete</button>}</td>
              </tr>,
            ])}
            {searching && shown.length === 0 && batches.length > 0 && (
              <tr>
                <td colSpan={7}>No batches match. Try fewer search fields.</td>
              </tr>
            )}
            {batches.length === 0 && (
              <tr>
                <td colSpan={7}>No batches yet — click "+ Add Brew" to start today's brew day.</td>
              </tr>
            )}
          </tbody>
        </table>
        {!searching && batches.length > RECENT && (
          <button className="secondary" style={{ marginTop: '0.75rem' }} onClick={() => setShowArchive(!showArchive)}>
            {showArchive ? 'Hide the archive' : `Show the archive (${batches.length - RECENT} older batches)`}
          </button>
        )}
        </>
      )}
    </div>
  )
}
