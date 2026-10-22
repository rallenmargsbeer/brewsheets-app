import { useEffect, useState } from 'react'
import { harvestYeast, listYeastBank, tipYeast, yeastGen, yeastName, MAX_YEAST_GEN } from '../lib/api'
import { tankLabel } from '../lib/tanks'

const today = () => new Date().toLocaleDateString('en-CA')
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
const daysAgo = (d) => Math.round((new Date(`${today()}T00:00:00`) - new Date(`${d}T00:00:00`)) / 86400000)

// Cellar tank panel: harvest this batch's yeast into kegs for the yeast bank.
export function HarvestForm({ batch, ingredients, onSaved }) {
  const [kegs, setKegs] = useState('1')
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const gen = yeastGen(batch) + 1
  const yeast = yeastName(batch, ingredients)
  if (gen > MAX_YEAST_GEN) return <p className="stock-muted" style={{ margin: 0 }}>This yeast is gen {yeastGen(batch)}, our max. Don’t harvest it.</p>
  async function save() {
    setSaving(true); setError(null)
    try {
      await harvestYeast(batch, { kegs: Number(kegs), harvestedOn: date, notes, yeast })
      onSaved(`Harvested ${kegs} keg${Number(kegs) === 1 ? '' : 's'} of ${yeast ?? 'yeast'} into the yeast bank (gen ${gen}).`)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  return (
    <div>
      <p className="stock-muted" style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>{yeast ?? 'Yeast'} goes in the bank as gen {gen}.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
        <label>Kegs <input type="number" inputMode="decimal" min="0.5" step="0.5" value={kegs} onChange={(e) => setKegs(e.target.value)} style={{ width: 70 }} /></label>
        <label>Harvested <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 140 }}>Notes <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} /></label>
      </div>
      <button onClick={save} disabled={saving || !(Number(kegs) > 0) || !date} style={{ marginTop: '0.5rem' }}>{saving ? '…' : 'Harvest yeast'}</button>
      {error && <p style={{ color: 'crimson', margin: '0.25rem 0 0' }}>{error}</p>}
    </div>
  )
}

// What's in the yeast bank: kegs still holding yeast, with gen and age. Tip one to clear it.
export default function YeastBank({ refreshKey }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const load = () => listYeastBank().then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, [refreshKey])
  async function tip(r) {
    if (!window.confirm(`Tip the ${r.yeast_name ?? 'yeast'} (gen ${r.generation}) harvested ${fmt(r.harvested_on)}?`)) return
    try { await tipYeast(r.id); load() } catch (e) { setError(e.message) }
  }
  return (
    <>
      <h3 style={{ marginTop: '1.5rem' }}>Yeast bank</h3>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {rows && !rows.length && <p className="stock-muted">Nothing banked. Harvest from a fermenter (tap the tank).</p>}
      {rows?.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="stock-table">
            <thead><tr><th>Yeast</th><th>Gen</th><th>Harvested</th><th>From</th><th className="pm-num">Kegs left</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.yeast_name ?? <span className="stock-muted">Unknown</span>}</td>
                  <td>{r.generation}</td>
                  <td>{fmt(r.harvested_on)} <span className="stock-muted">({daysAgo(r.harvested_on)}d)</span></td>
                  <td>{r.batches ? `${r.batches.beer_style} #${r.batches.batch_number}${r.batches.tanks ? ` · ${tankLabel(r.batches.tanks.name)}` : ''}` : ''}</td>
                  <td className="pm-num">{Number(r.kegs_left)}{Number(r.kegs_left) !== Number(r.kegs) ? <span className="stock-muted"> of {Number(r.kegs)}</span> : ''}</td>
                  <td>{r.notes}</td>
                  <td><button className="secondary" onClick={() => tip(r)} style={{ padding: '0.2rem 0.5rem' }}>Tip</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
