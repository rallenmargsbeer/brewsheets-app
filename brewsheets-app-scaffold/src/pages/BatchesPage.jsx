import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listBatches } from '../lib/api'

export default function BatchesPage() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)

  function refresh() {
    listBatches()
      .then(setBatches)
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

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Batch #</th>
              <th>Recipe</th>
              <th>Status</th>
              <th>Tank</th>
              <th>Target Vol (L)</th>
              <th>Date Brewed</th>
              <th>Package Date</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link to={`/batches/${b.id}`}>{b.batch_number}</Link>
                </td>
                <td>{b.recipes?.name}</td>
                <td>{b.status}</td>
                <td>{b.tanks?.name ?? '—'}</td>
                <td>{b.target_volume_l ?? '—'}</td>
                <td>{b.date_brewed ?? '—'}</td>
                <td>{b.package_date ?? '—'}</td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td colSpan={7}>No batches yet — click "+ Add Brew" to start today's brew day.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
