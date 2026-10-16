import { useEffect, useState } from 'react'
import { upsertBatch, upsertBlendItems } from '../lib/api'
import { tankLabel } from '../lib/tanks'
import AbvFlag from './AbvFlag.jsx'
import { abvCheck, blendAbv } from '../lib/batchFigures'

const qty = (v, unit) => {
  if (v == null || v === '') return '—'
  const x = Number(v)
  return `${x >= 100 ? Math.round(x).toLocaleString() : +x.toFixed(x >= 1 ? 2 : 4)} ${unit ?? ''}`.trim()
}

// RTD blend sheet: the recipe's ingredients scaled to the blend volume in the brite tank.
// Tick each one as it goes in and record what actually went in; ABV comes from the alcohol added.
export default function BlendSheet({ batch, onChanged }) {
  const perL = new Map((batch.recipes?.recipe_blend_items ?? []).map((r) => [r.ingredient_name, Number(r.qty_per_l)]))
  const [items, setItems] = useState([])
  const [volume, setVolume] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    setItems([...(batch.batch_blend_items ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ ...i, actual_qty: i.actual_qty ?? '' })))
    setVolume(String(batch.fv_to_bbt_l ?? batch.target_volume_l ?? ''))
  }, [batch.id, batch.batch_blend_items, batch.fv_to_bbt_l, batch.target_volume_l])

  const V = Number(volume) || 0
  const planned = (i) => (perL.has(i.ingredient_name) && V ? perL.get(i.ingredient_name) * V : Number(i.planned_qty) || 0)
  const set = (idx, k, v) => setItems(items.map((x, j) => (j === idx ? { ...x, [k]: v } : x)))
  const preview = { ...batch, fv_to_bbt_l: V, batch_blend_items: items.map((i) => ({ ...i, planned_qty: planned(i), actual_qty: i.actual_qty === '' ? null : i.actual_qty })) }
  const abv = blendAbv(preview)

  async function save() {
    setSaving(true); setError(null); setMsg(null)
    try {
      if (V && V !== Number(batch.fv_to_bbt_l)) await upsertBatch({ id: batch.id, fv_to_bbt_l: V, brewhouse_yield_l: V, target_volume_l: V })
      await upsertBlendItems(items.map(({ created_at: _c, ...i }) => ({ ...i, planned_qty: planned(i), actual_qty: i.actual_qty === '' ? null : Number(i.actual_qty) })))
      setMsg('Blend saved')
      onChanged()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const box = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }
  return (
    <>
      <div style={box}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <div><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Brite tank</div><strong>{tankLabel(batch.tanks?.name)}</strong></div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.85rem', color: 'var(--ink2)' }}>
            Blend volume (L)<input type="number" inputMode="numeric" value={volume} onChange={(e) => setVolume(e.target.value)} style={{ width: 120 }} />
          </label>
          <div><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>ABV (calculated)</div><strong style={{ fontSize: '1.2rem' }}>{abv == null ? '—' : `${abv.toFixed(2)}%`}</strong></div>
        </div>
      </div>
      <AbvFlag check={abvCheck(preview)} />
      <div style={{ ...box, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Added</th><th>Ingredient</th><th style={{ textAlign: 'right' }}>Per L</th><th style={{ textAlign: 'right' }}>Planned</th><th>Actual</th><th>Alcohol %</th></tr></thead>
          <tbody>
            {items.map((i, idx) => (
              <tr key={i.id}>
                <td><input type="checkbox" checked={!!i.added} onChange={(e) => set(idx, 'added', e.target.checked)} aria-label={`${i.ingredient_name} added`} /></td>
                <td>{i.ingredient_name}</td>
                <td style={{ textAlign: 'right' }}>{perL.has(i.ingredient_name) ? qty(perL.get(i.ingredient_name), i.unit) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{qty(planned(i), i.unit)}</td>
                <td><input type="number" inputMode="decimal" value={i.actual_qty} placeholder={String(+planned(i).toFixed(3))} onChange={(e) => set(idx, 'actual_qty', e.target.value)} style={{ width: 100 }} /> {i.unit}</td>
                <td>{i.abv_pct != null ? `${i.abv_pct}%` : ''}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="stock-muted">No blend ingredients. Add them on the recipe.</td></tr>}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save blend'}</button>
          {msg && <span style={{ color: '#11603f', fontWeight: 600 }}>✓ {msg}</span>}
          {error && <span style={{ color: 'crimson' }}>{error}</span>}
          <span className="stock-muted" style={{ fontSize: '0.85rem' }}>Leave Actual blank if it went in as planned.</span>
        </div>
      </div>
    </>
  )
}
