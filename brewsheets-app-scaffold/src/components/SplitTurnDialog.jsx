import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { applySplit, carriedByDefault, listReceivingBatches, qtyOf, splitShares } from '../lib/split'

const SECTION = { grist: 'Grist', water: 'Water', kettle: 'Kettle', whirlpool: 'Whirlpool', fermenter: 'Fermenter' }
// Quantities are stored in grams (mL for liquids); show kg from 1,000.
const fmt = (g) => (g >= 1000 ? `${(g / 1000).toFixed(g >= 10000 ? 1 : 2)} kg` : `${g.toFixed(g < 10 ? 2 : 0)} g`)

// Split part of a turn's wort into another scheduled batch, sharing the ticked ingredients by volume.
export default function SplitTurnDialog({ batch, run, onClose, onDone }) {
  const lines = run?.brew_run_ingredients ?? []
  const [splitL, setSplitL] = useState('500')
  const [turnL, setTurnL] = useState(String(Number(run?.ko_flowmeter_l) || Number(batch.turn_volume_l) || ''))
  const [carried, setCarried] = useState(() => new Set(lines.filter(carriedByDefault).map((l) => l.id)))
  const [batches, setBatches] = useState(null)
  const [recvId, setRecvId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  useEffect(() => { listReceivingBatches(batch.id).then(setBatches).catch((e) => setError(e.message)) }, [batch.id])

  const s = Number(splitL) || 0
  const t = Number(turnL) || 0
  const shares = useMemo(() => splitShares(lines, carried, s, t), [lines, carried, s, t])
  const pct = t > 0 ? Math.round((s / t) * 1000) / 10 : 0
  const receiving = batches?.find((b) => b.id === recvId)
  const ok = s > 0 && t > 0 && s < t && receiving && shares.length > 0

  const toggle = (id) => {
    const next = new Set(carried)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCarried(next)
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const r = await applySplit({ donorBatch: batch, donorRun: run, shares, splitL: s, receiving })
      setDone({ ...r, receiving })
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="split-overlay" onClick={onClose}>
      <div className="split-dialog" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Split turn {run.run_number} · {batch.beer_style ?? batch.recipes?.name} #{batch.batch_number}</h3>
          <button className="secondary" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {done ? (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ color: '#1b6e2e', fontWeight: 600 }}>
              Split {s} L to batch #{done.receiving.batch_number} ({done.receiving.beer_style}), turn {done.targetRunNumber}.
              This turn's ingredients now show what stays.
            </p>
            <Link to={`/batches/${done.receiving.id}?view=brewday`} onClick={onClose}><button>Open batch #{done.receiving.batch_number}</button></Link>{' '}
            <button className="secondary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <div className="split-row">
              <label>Volume to split off (L)<input type="number" min="0" value={splitL} onChange={(e) => setSplitL(e.target.value)} autoFocus /></label>
              <label>Turn volume (L)<input type="number" min="0" value={turnL} onChange={(e) => setTurnL(e.target.value)} /></label>
              <div className="split-pct">{pct ? `${pct}% of the turn goes to the split` : ''}</div>
            </div>

            <label className="split-recv">Receiving batch (already scheduled)
              <select value={recvId} onChange={(e) => setRecvId(e.target.value)}>
                <option value="">{batches ? (batches.length ? 'Choose a batch…' : 'No scheduled batches') : 'Loading…'}</option>
                {(batches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>#{b.batch_number} · {b.beer_style}{b.tanks?.name ? ` · ${b.tanks.name}` : ''}{b.date_brewed ? ` · ${b.date_brewed}` : ''}</option>
                ))}
              </select>
            </label>

            <table className="split-table">
              <thead><tr><th></th><th>Ingredient</th><th>Turn total</th><th>Stays</th><th>To split</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const sh = shares.find((x) => x.line.id === l.id)
                  return (
                    <tr key={l.id} className={sh ? '' : 'split-off'}>
                      <td><input type="checkbox" checked={carried.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Carry over ${l.item_name}`} /></td>
                      <td>{l.item_name} <span className="split-sec">{SECTION[l.section] ?? l.section}</span></td>
                      <td>{fmt(qtyOf(l))}</td>
                      <td>{sh ? fmt(sh.stay) : fmt(qtyOf(l))}</td>
                      <td className="split-move">{sh ? fmt(sh.move) : '—'}</td>
                    </tr>
                  )
                })}
                {!lines.length && <tr><td colSpan={5} className="stock-muted">This turn has no ingredient lines.</td></tr>}
              </tbody>
            </table>
            <p className="stock-muted" style={{ fontSize: '0.8rem' }}>
              Ticked ingredients are shared by volume. The receiving batch's own planned ingredients in the same sections
              (e.g. its grist) are replaced by the split's; its other additions, like its own yeast, stay.
            </p>
            {s >= t && t > 0 && <p style={{ color: '#b00020' }}>The split has to be smaller than the turn.</p>}
            {error && <p style={{ color: '#b00020' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={confirm} disabled={!ok || busy}>{busy ? 'Splitting…' : `Split ${s || ''} L to ${receiving ? `#${receiving.batch_number}` : '…'}`}</button>
              <button className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
