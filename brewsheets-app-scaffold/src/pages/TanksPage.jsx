import { useEffect, useState } from 'react'
import { listTanks, upsertTank } from '../lib/api'

export default function TanksPage() {
  const [tanks, setTanks] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTank, setNewTank] = useState({ name: '', tank_type: 'FV', capacity_l: '' })

  function refresh() {
    listTanks().then(setTanks).finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  async function addTank() {
    if (!newTank.name) return
    await upsertTank({
      ...newTank,
      capacity_l: newTank.capacity_l || null,
    })
    setNewTank({ name: '', tank_type: 'FV', capacity_l: '' })
    refresh()
  }

  return (
    <div>
      <h1>Tanks</h1>
      <p style={{ color: '#666' }}>
        Just enough to tag batches with a vessel for now — full tank scheduling/availability
        comes in a later phase.
      </p>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Capacity (L)</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {tanks.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.tank_type}</td>
                <td>{t.capacity_l ?? '—'}</td>
                <td>{t.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: '1.5rem' }}>Add Tank</h3>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <label>
          Name
          <br />
          <input value={newTank.name} onChange={(e) => setNewTank({ ...newTank, name: e.target.value })} />
        </label>
        <label>
          Type
          <br />
          <select
            value={newTank.tank_type}
            onChange={(e) => setNewTank({ ...newTank, tank_type: e.target.value })}
          >
            <option value="FV">FV</option>
            <option value="BBT">BBT</option>
          </select>
        </label>
        <label>
          Capacity (L)
          <br />
          <input
            type="number"
            value={newTank.capacity_l}
            onChange={(e) => setNewTank({ ...newTank, capacity_l: e.target.value })}
          />
        </label>
        <button onClick={addTank}>Add</button>
      </div>
    </div>
  )
}
