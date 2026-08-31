import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listBatches, listRecipes, upsertBatch } from '../lib/api'

export default function BatchesPage() {
  const [batches, setBatches] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newBatch, setNewBatch] = useState({ recipe_id: '', batch_number: '', target_volume_l: '' })
  const navigate = useNavigate()

  function refresh() {
    Promise.all([listBatches(), listRecipes()])
      .then(([b, r]) => {
        setBatches(b)
        setRecipes(r)
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  async function createBatch() {
    if (!newBatch.recipe_id || !newBatch.batch_number) return
    const recipe = recipes.find((r) => r.id === newBatch.recipe_id)
    const batch = await upsertBatch({
      recipe_id: newBatch.recipe_id,
      batch_number: newBatch.batch_number,
      beer_style: recipe?.name,
      status: 'planned',
      target_volume_l: newBatch.target_volume_l || null,
    })
    navigate(`/batches/${batch.id}`)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Batches</h1>
        <button onClick={() => setShowNew((s) => !s)}>+ New Batch</button>
      </div>

      {showNew && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '1.5rem', padding: '1rem', background: '#fff', border: '1px solid #ddd', borderRadius: 6 }}>
          <label>
            Recipe
            <br />
            <select
              value={newBatch.recipe_id}
              onChange={(e) => setNewBatch({ ...newBatch, recipe_id: e.target.value })}
            >
              <option value="">Select…</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Batch #
            <br />
            <input
              value={newBatch.batch_number}
              onChange={(e) => setNewBatch({ ...newBatch, batch_number: e.target.value })}
            />
          </label>
          <label>
            Target volume (L)
            <br />
            <input
              type="number"
              value={newBatch.target_volume_l}
              onChange={(e) => setNewBatch({ ...newBatch, target_volume_l: e.target.value })}
              style={{ width: 120 }}
            />
          </label>
          <button onClick={createBatch}>Create</button>
        </div>
      )}

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
                <td colSpan={7}>No batches yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
