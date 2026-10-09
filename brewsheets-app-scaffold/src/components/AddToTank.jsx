import { useEffect, useState } from 'react'
import { listTankAdditions, saveTankAddition, deleteTankAddition } from '../lib/api'
import IngredientPicker from './IngredientPicker.jsx'

const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd, local time

// Enter in the Unleashed product's unit: grams for 'g' products, kg for everything else.
export function unitFor(name, ingredients) {
  const base = ingredients.find((i) => i.name === name)?.base_unit
  return (base ?? '').toLowerCase() === 'g' ? 'g' : 'kg'
}
const toUnit = (grams, unit) => (grams == null ? '' : unit === 'kg' ? +(grams / 1000).toFixed(3) : +Number(grams).toFixed(1))
const toGrams = (v, unit) => (v === '' || v == null ? null : Number(v) * (unit === 'kg' ? 1000 : 1))

function PlannedRow({ a, unit, initials, onChanged }) {
  const [qty, setQty] = useState(toUnit(a.planned_qty, unit))
  const [saving, setSaving] = useState(false)
  async function added() {
    setSaving(true)
    try {
      await saveTankAddition({ id: a.id, actual_qty: toGrams(qty, unit), added_on: today(), initials: initials || null })
      onChanged()
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="ta-row">
      <div style={{ flex: '1 1 160px' }}>
        <strong>{a.item_name}</strong>
        <div style={{ color: 'var(--ink2)', fontSize: '0.8rem' }}>
          {a.timing_note ? `${a.timing_note} · ` : ''}planned {a.planned_qty != null ? `${toUnit(a.planned_qty, unit)} ${unit}` : '—'}
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 90 }} />
        {unit}
      </label>
      <button onClick={added} disabled={saving || qty === ''}>{saving ? '…' : '✓ Added'}</button>
    </div>
  )
}

export default function AddToTank({ batch, ingredients, onAdded }) {
  const [additions, setAdditions] = useState([])
  const [initials, setInitials] = useState('')
  const [extraName, setExtraName] = useState('')
  const [extraQty, setExtraQty] = useState('')
  const [error, setError] = useState(null)

  function refresh() {
    listTankAdditions(batch.id).then(setAdditions).catch((e) => setError(e.message))
  }
  useEffect(refresh, [batch.id])

  function changed() {
    refresh()
    onAdded?.()
  }

  async function undo(a) {
    if (!window.confirm(`Undo ${a.item_name} added on ${a.added_on}?`)) return
    if (a.planned_qty == null) await deleteTankAddition(a.id)
    else await saveTankAddition({ id: a.id, added_on: null, actual_qty: null, initials: null })
    changed()
  }

  async function addExtra() {
    setError(null)
    try {
      await saveTankAddition({
        batch_id: batch.id,
        item_name: extraName,
        actual_qty: toGrams(extraQty, unitFor(extraName, ingredients)),
        added_on: today(),
        initials: initials || null,
        sort_order: 999,
      })
      setExtraName('')
      setExtraQty('')
      changed()
    } catch (e) {
      setError(e.message)
    }
  }

  const planned = additions.filter((a) => !a.added_on)
  const done = additions.filter((a) => a.added_on)
  const extraUnit = extraName ? unitFor(extraName, ingredients) : 'kg'

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem' }}>
        Your initials <input value={initials} onChange={(e) => setInitials(e.target.value)} style={{ width: 80 }} />
      </label>

      {planned.length > 0 && (
        <div className="ta-list">
          {planned.map((a) => (
            <PlannedRow key={a.id} a={a} unit={unitFor(a.item_name, ingredients)} initials={initials} onChanged={changed} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="ta-list" style={{ marginTop: '0.5rem' }}>
          {done.map((a) => {
            const unit = unitFor(a.item_name, ingredients)
            return (
              <div key={a.id} className="ta-row ta-done">
                <span style={{ flex: '1 1 160px' }}>✓ <strong>{a.item_name}</strong> {toUnit(a.actual_qty, unit)} {unit}</span>
                <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>{a.added_on}{a.initials ? ` · ${a.initials}` : ''}</span>
                <button className="secondary" onClick={() => undo(a)} style={{ padding: '0.2rem 0.6rem' }}>Undo</button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
        <IngredientPicker value={extraName} section="fermenter" ingredients={ingredients} onCommit={setExtraName} width={200} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="number" inputMode="decimal" value={extraQty} onChange={(e) => setExtraQty(e.target.value)} style={{ width: 90 }} placeholder="Qty" />
          {extraUnit}
        </label>
        <button className="secondary" onClick={addExtra} disabled={!extraName || extraQty === ''}>+ Add something else</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  )
}
