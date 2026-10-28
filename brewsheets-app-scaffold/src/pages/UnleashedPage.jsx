import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { tankLabel } from '../lib/tanks'
import { KEG_SIZES, sumSessions } from '../lib/packaging'
import { parseProduct, nameKey, directName } from '../lib/packMaterials'
import { bbtLitres } from '../lib/batchFigures'
import BeerDot from '../components/BeerDot.jsx'

const fmt = (d) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const doneOn = (ts) => new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

// What has gone into the brite tanks and into kegs and cubes, so the matching assemblies can be
// entered in Unleashed by hand, then ticked off here. Nothing is sent to Unleashed.
async function load() {
  const [withBbt, sessions, boms, products] = await Promise.all([
    supabase.from('batches').select('id').not('bbt_transfer_date', 'is', null),
    supabase.from('packaging_sessions').select('id, batch_id, package_date, kegs_20, kegs_30, kegs_50, cubes, tank_empty, unl_done_at'),
    supabase.from('unl_dataset').select('data').eq('key', 'pack_boms').maybeSingle(),
    supabase.from('unl_dataset').select('data').eq('key', 'products').maybeSingle(),
  ])
  for (const r of [withBbt, sessions, boms]) if (r.error) throw r.error
  const ids = [...new Set([...withBbt.data.map((b) => b.id), ...sessions.data.map((s) => s.batch_id)])]
  const batches = ids.length
    ? await supabase.from('batches').select('id, batch_number, beer_style, bbt_transfer_date, fv_to_bbt_l, daw_added_l, unl_bbt_done_at, tanks(name)').in('id', ids)
    : { data: [] }
  if (batches.error) throw batches.error

  // Unleashed product per (format, size, beer), and the beer's Finished Beer code.
  // Products come from the full product list (so ones without a bill of materials, like the Margs
  // Draught kegs, still match); a product named for the beer beats one reached through an alias.
  const product = new Map()
  const finished = new Map()
  for (const { code } of [...(products.data?.data ?? []), ...(boms.data?.data ?? [])]) {
    const p = parseProduct(code)
    if (!p) continue
    const k = `${p.fmt}|${p.size}|${p.beer}`
    const rank = directName(code.replace(/^.*?(cube|keg)\s*-\s*/i, '')) ? 2 : 1
    if (!product.has(k) || product.get(k).rank < rank) product.set(k, { code, rank })
  }
  for (const [k, v] of product) product.set(k, v.code)
  for (const b of boms.data?.data ?? []) {
    const p = parseProduct(b.code)
    if (!p) continue
    const fb = b.lines?.find((l) => /finished beer/i.test(l.group ?? '') || /^FB[- ]/i.test(l.code ?? ''))
    if (fb && !finished.has(p.beer)) finished.set(p.beer, fb)
  }

  const rows = []
  for (const b of batches.data) {
    const beer = nameKey(b.beer_style)
    if (b.bbt_transfer_date) {
      const fb = finished.get(beer)
      rows.push({ key: 'b' + b.id, kind: 'bbt', id: b.id, date: b.bbt_transfer_date, batch: b, litres: bbtLitres(b), daw: Number(b.daw_added_l) || 0, products: fb ? [`${fb.code}${fb.description ? ` (${fb.description})` : ''}`] : [], done: b.unl_bbt_done_at })
    }
    for (const s of sessions.data.filter((x) => x.batch_id === b.id)) {
      const items = [
        ...KEG_SIZES.filter((k) => Number(s[`kegs_${k}`]) > 0).map((k) => ({ label: `${s[`kegs_${k}`]} × ${k} L kegs`, code: product.get(`keg|${k}|${beer}`) })),
        ...(Number(s.cubes) > 0 ? [{ label: `${s.cubes} cubes`, code: product.get(`cube|null|${beer}`) }] : []),
      ]
      rows.push({ key: 's' + s.id, kind: 'pack', id: s.id, date: s.package_date, batch: b, items, litres: sumSessions([s]).litres, tankEmpty: s.tank_empty, done: s.unl_done_at })
    }
  }
  rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.batch.batch_number - b.batch.batch_number || (a.kind === 'bbt' ? -1 : 1))
  return rows
}

export default function UnleashedPage() {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState('todo')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  const refresh = () => load().then(setRows).catch((e) => setError(e.message))
  useEffect(() => { refresh() }, [])

  async function mark(r, done) {
    setBusy(r.key)
    setError(null)
    const at = done ? new Date().toISOString() : null
    const q = r.kind === 'bbt'
      ? supabase.from('batches').update({ unl_bbt_done_at: at }).eq('id', r.id)
      : supabase.from('packaging_sessions').update({ unl_done_at: at }).eq('id', r.id)
    const { error } = await q
    if (error) setError(error.message)
    else setRows(rows.map((x) => (x.key === r.key ? { ...x, done: at } : x)))
    setBusy(null)
  }

  const list = rows?.filter((r) => show === 'all' || !r.done) ?? []
  const todo = rows?.filter((r) => !r.done).length ?? 0
  return (
    <div className="pm-page">
      <h1 style={{ marginBottom: '0.25rem' }}>Unleashed</h1>
      <p className="stock-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        Beer into the brite tanks and into kegs and cubes, from the Cellar transfers and pack-off sessions. Enter the assemblies in Unleashed, then mark each one done here.
      </p>
      <div className="stock-controls">
        <button className={show === 'todo' ? '' : 'secondary'} onClick={() => setShow('todo')}>To do{rows ? ` (${todo})` : ''}</button>
        <button className={show === 'all' ? '' : 'secondary'} onClick={() => setShow('all')}>All</button>
      </div>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {!rows && !error && <p>Loading…</p>}
      {rows && (
        <section className="stock-card">
          <table className="stock-table pm-table unl-table">
            <thead><tr><th>Date</th><th>Batch</th><th>What</th><th className="pm-num">Litres</th><th>Unleashed product</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.key} className={r.done ? 'unl-done' : ''}>
                  <td>{fmt(r.date)}</td>
                  <td>
                    <BeerDot name={r.batch.beer_style} />{r.batch.beer_style}{' '}
                    <Link to={r.kind === 'bbt' ? `/batches/${r.batch.id}` : `/packaging/${r.batch.id}`}>#{r.batch.batch_number}</Link>
                  </td>
                  <td>
                    {r.kind === 'bbt'
                      ? <>Into brite tank {tankLabel(r.batch.tanks?.name)}</>
                      : <>Packed: {r.items.length ? r.items.map((i) => i.label).join(', ') : <span className="stock-muted">nothing counted yet</span>}{r.tankEmpty ? ' (tank empty)' : ''}</>}
                  </td>
                  <td className="pm-num">{r.litres == null ? <span className="stock-muted">Not entered</span> : Math.round(r.litres).toLocaleString()}{r.daw > 0 && <div className="stock-muted" style={{ fontSize: '0.75rem' }}>incl. {Math.round(r.daw).toLocaleString()} L DAW</div>}</td>
                  <td>
                    {r.kind === 'bbt'
                      ? (r.products[0] ?? <span className="stock-muted">No match</span>)
                      : r.items.map((i) => <div key={i.label}>{i.code ?? <span className="stock-muted">No match for {i.label}</span>}</div>)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.done
                      ? <>✓ Done {doneOn(r.done)} <button className="secondary" disabled={busy === r.key} onClick={() => mark(r, false)}>Undo</button></>
                      : <button disabled={busy === r.key || r.litres == null || (r.kind === 'pack' && !r.items.length)} onClick={() => mark(r, true)}>Mark done</button>}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="stock-muted">{show === 'todo' ? 'All done. Nothing waiting to go into Unleashed.' : 'No transfers or pack-offs recorded yet.'}</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
