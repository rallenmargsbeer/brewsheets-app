import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getBatch,
  upsertBatch,
  listPackagingSessions,
  upsertPackagingSession,
  deletePackagingSession,
  addDoCheck,
  deleteDoCheck,
} from '../lib/api'
import { tankLabel, statusLabel } from '../lib/tanks'
import { KEG_SIZES, CANS_PER_CUBE, sumSessions } from '../lib/packaging'

const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd, local time
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const field = { display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 110px', minWidth: 0 }
const box = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }

// The canner has 6 fill heads; each DO check samples one can from every head.
const HEADS = [1, 2, 3, 4, 5, 6]
const headValues = (c) => HEADS.map((h) => c[`head_${h}`]).filter((v) => v != null).map(Number)
const avg = (vs) => (vs.length ? vs.reduce((a, v) => a + v, 0) / vs.length : null)

function DoChecks({ session, onChanged }) {
  const blank = Object.fromEntries(HEADS.map((h) => [h, '']))
  const [heads, setHeads] = useState(blank)
  const [initials, setInitials] = useState('')
  const [error, setError] = useState(null)
  const checks = [...(session.packaging_do_checks ?? [])].sort((a, b) => a.checked_at.localeCompare(b.checked_at))
  const all = checks.flatMap(headValues)
  const anyEntered = HEADS.some((h) => heads[h] !== '')

  async function add() {
    if (!anyEntered) return
    setError(null)
    try {
      await addDoCheck({
        session_id: session.id,
        initials: initials || null,
        ...Object.fromEntries(HEADS.map((h) => [`head_${h}`, heads[h] === '' ? null : Number(heads[h])])),
      })
      setHeads(blank)
      onChanged()
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(c) {
    if (!window.confirm(`Delete the ${timeOf(c.checked_at)} DO check?`)) return
    await deleteDoCheck(c.id)
    onChanged()
  }

  return (
    <div className="pk-group pk-do">
      <div className="pk-group-head">
        <h4>DO checks · 6 fill heads</h4>
        {all.length > 0 && (
          <span className="pk-chip">Avg {avg(all).toFixed(0)} · Max {Math.max(...all)} ppb</span>
        )}
      </div>
      {checks.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: '0.5rem' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                {HEADS.map((h) => <th key={h}>H{h}</th>)}
                <th>Avg</th>
                <th>Initials</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => {
                const vs = headValues(c)
                return (
                  <tr key={c.id}>
                    <td>{timeOf(c.checked_at)}</td>
                    {HEADS.map((h) => <td key={h}>{c[`head_${h}`] ?? '—'}</td>)}
                    <td><strong>{vs.length ? avg(vs).toFixed(0) : '—'}</strong></td>
                    <td>{c.initials ?? ''}</td>
                    <td><button className="secondary" onClick={() => remove(c)} aria-label="Delete DO check" style={{ padding: '0.2rem 0.5rem' }}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="pk-heads">
        {HEADS.map((h) => (
          <label key={h} style={field}>
            Head {h} (ppb)
            <input type="number" inputMode="decimal" value={heads[h]} onChange={(e) => setHeads({ ...heads, [h]: e.target.value })} />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.5rem' }}>
        <label style={{ ...field, flex: '0 1 110px' }}>Initials<input value={initials} onChange={(e) => setInitials(e.target.value)} /></label>
        <button onClick={add} disabled={!anyEntered}>+ Add DO check (now)</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  )
}

function SessionCard({ number, session, batch, onChanged }) {
  const [s, setS] = useState(session)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  // Only reset the form when it's a different session, so adding a DO check mid-run
  // (which refreshes the page) doesn't wipe counts typed in but not yet saved.
  useEffect(() => setS(session), [session.id])
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const t = sumSessions([s])

  async function save() {
    if (s.tank_empty && !session.tank_empty &&
        !window.confirm(`Tank empty: mark #${batch.batch_number} as Packaged? ${tankLabel(batch.tanks?.name)} will show as empty.`)) return
    setSaving(true)
    setError(null)
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v))
      const int = (v) => Number(v) || 0
      await upsertPackagingSession({
        id: s.id,
        package_date: s.package_date,
        operator: s.operator || null,
        kegs_20: int(s.kegs_20),
        kegs_30: int(s.kegs_30),
        kegs_50: int(s.kegs_50),
        cubes: int(s.cubes),
        co2_vols: num(s.co2_vols),
        do_ppb: num(s.do_ppb),
        tank_empty: !!s.tank_empty,
        notes: s.notes || null,
      })
      if (s.tank_empty && !session.tank_empty) {
        await upsertBatch({ id: batch.id, status: 'packaged', package_date: s.package_date })
      }
      setMsg('Saved')
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete pack-off session ${number} (${s.package_date})?`)) return
    await deletePackagingSession(s.id)
    onChanged()
  }

  return (
    <div className="pk-session">
      <div className="pk-session-head">
        <h3>Session {number}{s.package_date ? ` · ${s.package_date}` : ''}</h3>
        <span className="pk-litres">{Math.round(t.litres).toLocaleString()} L</span>
      </div>

      <div className="pk-session-body">
        <div className="pk-group pk-tank">
          <div className="pk-group-head"><h4>In tank</h4></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label style={field}>Date<input type="date" value={s.package_date ?? ''} onChange={set('package_date')} /></label>
            <label style={field}>Operator<input value={s.operator ?? ''} onChange={set('operator')} /></label>
            <label style={field}>CO₂ (vols)<input type="number" inputMode="decimal" step="0.01" value={s.co2_vols ?? ''} onChange={set('co2_vols')} /></label>
            <label style={field}>DO (ppb)<input type="number" inputMode="decimal" value={s.do_ppb ?? ''} onChange={set('do_ppb')} /></label>
          </div>
        </div>

        <div className="pk-group pk-pack">
          <div className="pk-group-head">
            <h4>Packed</h4>
            <span className="pk-chip">{t.kegs} kegs · {t.cubes} cubes ({(t.cubes * CANS_PER_CUBE).toLocaleString()} cans)</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {KEG_SIZES.map((size) => (
              <label key={size} style={field}>{size} L kegs<input type="number" inputMode="numeric" min="0" value={s[`kegs_${size}`] ?? 0} onChange={set(`kegs_${size}`)} /></label>
            ))}
            <label style={field}>Cubes ({CANS_PER_CUBE} × 375 mL)<input type="number" inputMode="numeric" min="0" value={s.cubes ?? 0} onChange={set('cubes')} /></label>
          </div>
          <label style={{ ...field, marginTop: '0.5rem' }}>Notes<input value={s.notes ?? ''} onChange={set('notes')} /></label>
        </div>

        <DoChecks session={session} onChanged={onChanged} />

        <div className="pk-group pk-finish">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600, color: 'var(--ink)' }}>
            <input type="checkbox" checked={!!s.tank_empty} onChange={set('tank_empty')} /> Tank empty (batch fully packaged)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save session'}</button>
            <button className="secondary" onClick={remove}>Delete</button>
            {msg && <span style={{ color: '#11603f', fontWeight: 600 }}>✓ {msg}</span>}
          </div>
        </div>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </div>
    </div>
  )
}

export default function PackagingBatchPage() {
  const { id } = useParams()
  const [batch, setBatch] = useState(null)
  const [sessions, setSessions] = useState([])
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)

  function refresh() {
    Promise.all([getBatch(id), listPackagingSessions(id)])
      .then(([b, s]) => {
        setBatch(b)
        setSessions(s)
      })
      .catch((e) => setError(e.message))
  }

  useEffect(refresh, [id])

  async function startSession() {
    setStarting(true)
    try {
      await upsertPackagingSession({ batch_id: id, tank_id: batch.tank_id, package_date: today() })
      refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setStarting(false)
    }
  }

  if (error) return <p style={{ color: 'crimson' }}>{error}</p>
  if (!batch) return <p>Loading…</p>

  const t = sumSessions(sessions)
  const target = Number(batch.fv_to_bbt_l) || null
  return (
    <div style={{ maxWidth: 820 }}>
      <p style={{ margin: 0 }}><Link to="/packaging">← Packaging</Link></p>
      <h1>{batch.beer_style} #{batch.batch_number}</h1>
      <p style={{ color: 'var(--ink2)', marginTop: '-0.5rem' }}>
        {tankLabel(batch.tanks?.name)} · <span className={'pill pill-' + batch.status}>{statusLabel(batch.status)}</span> ·{' '}
        <Link to={`/batches/${batch.id}`}>Batch sheet</Link>
      </p>

      <div style={{ ...box, display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
        {KEG_SIZES.map((size) => (
          <div key={size}><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>{size} L kegs</div><strong style={{ fontSize: '1.3rem' }}>{t[`kegs_${size}`]}</strong></div>
        ))}
        <div><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Cubes</div><strong style={{ fontSize: '1.3rem' }}>{t.cubes}</strong> <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>({(t.cubes * CANS_PER_CUBE).toLocaleString()} cans)</span></div>
        <div><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Packaged</div><strong style={{ fontSize: '1.3rem' }}>{Math.round(t.litres).toLocaleString()} L</strong>{target ? <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}> of {target.toLocaleString()} L to BBT</span> : null}</div>
      </div>

      {sessions.map((s, i) => (
        <SessionCard key={s.id} number={i + 1} session={s} batch={batch} onChanged={refresh} />
      ))}

      {batch.status !== 'packaged' && (
        <button onClick={startSession} disabled={starting} style={{ fontSize: '1.05rem', padding: '0.75rem 1.5rem' }}>
          {starting ? '…' : sessions.length ? '+ Start another pack-off session' : '+ Start pack-off session'}
        </button>
      )}
    </div>
  )
}
