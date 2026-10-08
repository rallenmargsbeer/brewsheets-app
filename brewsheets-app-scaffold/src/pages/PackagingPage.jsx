import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listBatchesInTanks, listPackagingTotals } from '../lib/api'
import { tankLabel, IN_TANK_STATUSES } from '../lib/tanks'
import { sumSessions } from '../lib/packaging'

// Conditioning first, then anything else still sitting in a BBT.
const ORDER = { conditioning: 0, fermenting: 1, brewing: 2, planned: 3 }

export default function PackagingPage() {
  const [batches, setBatches] = useState([])
  const [totals, setTotals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listBatchesInTanks(IN_TANK_STATUSES)
      .then(async (b) => {
        // We only ever package out of bright tanks, never straight from an FV.
        const inBbt = b.filter((x) => x.tanks?.tank_type === 'BBT')
        setBatches([...inBbt].sort((x, y) => ORDER[x.status] - ORDER[y.status]))
        const rows = await listPackagingTotals(inBbt.map((x) => x.id))
        const byBatch = {}
        for (const r of rows) (byBatch[r.batch_id] ??= []).push(r)
        setTotals(Object.fromEntries(Object.entries(byBatch).map(([id, s]) => [id, sumSessions(s)])))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1>Packaging</h1>
      <p style={{ color: 'var(--ink2)', marginTop: '-0.5rem' }}>Pick the batch you're packaging.</p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : batches.length === 0 ? (
        <p style={{ color: 'var(--ink2)' }}>No batches in bright tanks right now. Transfer one from the Cellar tab first.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          {batches.map((b) => {
            const t = totals[b.id]
            return (
              <Link key={b.id} to={`/packaging/${b.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '0.75rem', height: '100%', boxSizing: 'border-box' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong style={{ fontSize: '1.05rem' }}>{b.beer_style}</strong>
                    <span style={{ color: 'var(--ink2)' }}>#{b.batch_number}</span>
                  </div>
                  <div style={{ color: 'var(--ink2)', margin: '4px 0' }}>{tankLabel(b.tanks?.name)}</div>
                  <span className={'pill pill-' + b.status}>{b.status}</span>
                  <div style={{ marginTop: 6, fontSize: '0.85rem', color: 'var(--ink2)' }}>
                    {t ? `Packaged so far: ${t.kegs} kegs · ${t.cubes} cubes · ${Math.round(t.litres).toLocaleString()} L` : 'Nothing packaged yet'}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
