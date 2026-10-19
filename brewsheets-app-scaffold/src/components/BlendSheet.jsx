import { useEffect, useState } from 'react'
import { upsertBatch, upsertBlendItems } from '../lib/api'
import { tankLabel } from '../lib/tanks'
import AbvFlag from './AbvFlag.jsx'
import { abvCheck, blendAbv } from '../lib/batchFigures'
import { useAutoSave, SaveStatus } from '../lib/useAutoSave.jsx'

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
  useEffect(() => {
    setItems([...(batch.batch_blend_items ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ ...i, actual_qty: i.actual_qty ?? '' })))
    setVolume(String(batch.fv_to_bbt_l ?? batch.target_volume_l ?? ''))
    // Only for a different batch: a refresh after a save must not wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id])

  const V = Number(volume) || 0
  const planned = (i) => (perL.has(i.ingredient_name) && V ? perL.get(i.ingredient_name) * V : Number(i.planned_qty) || 0)
  const preview = { ...batch, fv_to_bbt_l: V, batch_blend_items: items.map((i) => ({ ...i, planned_qty: planned(i), actual_qty: i.actual_qty === '' ? null : i.actual_qty })) }
  const abv = blendAbv(preview)

  // Saves as it's filled in: the blend volume (which rescales every planned amount), or one line.
  const { saveSoon, saveNow, status } = useAutoSave(async (key, value) => {
    if (key === 'volume') {
      const v = Number(value) || 0
      if (!v || v === Number(batch.fv_to_bbt_l)) return
      await upsertBatch({ id: batch.id, fv_to_bbt_l: v, brewhouse_yield_l: v, target_volume_l: v })
      await upsertBlendItems(items.map(({ created_at: _c, ...i }) => ({ ...i, planned_qty: perL.has(i.ingredient_name) ? perL.get(i.ingredient_name) * v : Number(i.planned_qty) || 0, actual_qty: i.actual_qty === '' ? null : Number(i.actual_qty) })))
    } else {
      const { created_at: _c, ...i } = value
      await upsertBlendItems([{ ...i, planned_qty: planned(i), actual_qty: i.actual_qty === '' ? null : Number(i.actual_qty) }])
    }
    onChanged()
  })
  const set = (idx, k, v, now = false) => {
    const next = items.map((x, j) => (j === idx ? { ...x, [k]: v } : x))
    setItems(next)
    ;(now ? saveNow : saveSoon)(next[idx].id, next[idx])
  }

  const box = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }
  return (
    <>
      <div style={box}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <div><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Brite tank</div><strong>{tankLabel(batch.tanks?.name)}</strong></div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.85rem', color: 'var(--ink2)' }}>
            Blend volume (L)<input type="number" inputMode="numeric" value={volume} onChange={(e) => { setVolume(e.target.value); saveSoon('volume', e.target.value) }} onBlur={(e) => saveNow('volume', e.target.value)} style={{ width: 120 }} />
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
                <td><input type="checkbox" checked={!!i.added} onChange={(e) => set(idx, 'added', e.target.checked, true)} aria-label={`${i.ingredient_name} added`} /></td>
                <td>{i.ingredient_name}</td>
                <td style={{ textAlign: 'right' }}>{perL.has(i.ingredient_name) ? qty(perL.get(i.ingredient_name), i.unit) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{qty(planned(i), i.unit)}</td>
                <td><input type="number" inputMode="decimal" value={i.actual_qty} placeholder={String(+planned(i).toFixed(3))} onChange={(e) => set(idx, 'actual_qty', e.target.value)} onBlur={() => saveNow(i.id, i)} style={{ width: 100 }} /> {i.unit}</td>
                <td>{i.abv_pct != null ? `${i.abv_pct}%` : ''}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="stock-muted">No blend ingredients. Add them on the recipe.</td></tr>}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <SaveStatus status={status} />
          <span className="stock-muted" style={{ fontSize: '0.85rem' }}>Leave Actual blank if it went in as planned.</span>
        </div>
      </div>
    </>
  )
}
