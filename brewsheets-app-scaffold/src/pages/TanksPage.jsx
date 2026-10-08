import { useEffect, useState } from 'react'
import { listTanks, upsertTank } from '../lib/api'

// Natural order so 2 sorts before 10 and "BT 1" before "BT 2".
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })

export default function TanksPage() {
  const [tanks, setTanks] = useState([])
  const [loading, setLoading] = useState(true)

  function refresh() {
    listTanks().then((t) => setTanks(t.sort(byName))).finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  const [newTank, setNewTank] = useState({ name: '', tank_type: 'FV', capacity_l: '' })

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
      <p style={{ color: 'var(--ink2)', marginTop: '-0.5rem' }}>Your tank list. What's in each tank is on the Cellar tab.</p>
      {loading ? <p>Loading…</p> : (
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
        <label>
          Name
          <br />
          <input value={newTank.name} onChange={(e) => setNewTank({ ...newTank, name: e.target.value })} />
        </label>
        <label>
          Type
          <br />
          <select value={newTank.tank_type} onChange={(e) => setNewTank({ ...newTank, tank_type: e.target.value })}>
            <option value="FV">FV</option>
            <option value="BBT">BBT</option>
          </select>
        </label>
        <label>
          Capacity (L)
          <br />
          <input type="number" value={newTank.capacity_l} onChange={(e) => setNewTank({ ...newTank, capacity_l: e.target.value })} />
        </label>
        <button onClick={addTank}>Add</button>
      </div>
    </div>
  )
}
