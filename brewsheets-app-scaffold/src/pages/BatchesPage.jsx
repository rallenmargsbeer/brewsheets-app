import { useEffect, useState } from 'react'
import { tankLabel } from '../lib/tanks'
import { Link } from 'react-router-dom'
import { listBatches, deleteBatch } from '../lib/api'
import { isScheduleEditor } from '../lib/schedule'

// The most recent batches show; older ones are in the archive below.
const RECENT = 50

export default function BatchesPage() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchive, setShowArchive] = useState(false)
  const [error, setError] = useState(null)
  const [editor, setEditor] = useState(false)
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Batches</h1>
        <Link to="/batches/new">
          <button>+ Add Brew</button>
        </Link>
      </div>

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
            {(showArchive ? batches : batches.slice(0, RECENT)).map((b, i) => [
              i === RECENT && <tr key="archive" className="batches-archive-head"><td colSpan={7}>Archive</td></tr>,
              <tr key={b.id}>
                <td>
                  <Link to={`/batches/${b.id}`}>{b.batch_number}</Link>
                </td>
                <td>{b.beer_style || b.recipes?.name}</td>
                <td><span className={'pill pill-' + b.status}>{b.status}</span></td>
                <td>{tankLabel(b.tanks?.name)}</td>
                <td>{b.date_brewed ?? '—'}</td>
                <td>{b.package_date ?? '—'}</td>
                <td>{editor && <button className="secondary batch-delete" onClick={() => remove(b)} aria-label={`Delete batch ${b.batch_number}`} title="Delete batch">Delete</button>}</td>
              </tr>,
            ])}
            {batches.length === 0 && (
              <tr>
                <td colSpan={7}>No batches yet — click "+ Add Brew" to start today's brew day.</td>
              </tr>
            )}
          </tbody>
        </table>
        {batches.length > RECENT && (
          <button className="secondary" style={{ marginTop: '0.75rem' }} onClick={() => setShowArchive(!showArchive)}>
            {showArchive ? 'Hide the archive' : `Show the archive (${batches.length - RECENT} older batches)`}
          </button>
        )}
        </>
      )}
    </div>
  )
}
