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
import BeerDot from '../components/BeerDot.jsx'
import AbvFlag from '../components/AbvFlag.jsx'
import { abvCheck, dawLitres, dawAim } from '../lib/batchFigures'
import { useAutoSave, SaveStatus } from '../lib/useAutoSave.jsx'
import { loadIncoming, beerMatch } from '../lib/incoming'
import { addDays, todayIso } from '../lib/schedule'

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

function SessionCard({ number, session, batch, onChanged, startOpen }) {
  const [s, setS] = useState(session)
  // Only today's latest session starts open; the rest fold up so nothing is typed into the wrong one.
  const [open, setOpen] = useState(startOpen)
  useEffect(() => setOpen(startOpen), [startOpen])
  // Only reset the form when it's a different session, so a refresh (e.g. after a DO check)
  // never wipes what's being typed.
  useEffect(() => setS(session), [session.id])
  const t = sumSessions([s])

  // Every box saves as it's filled in; there's no Save button to forget.
  const num = (v) => (v === '' || v == null ? null : Number(v))
  const int = (v) => Number(v) || 0
  const FORMAT = { kegs_20: int, kegs_30: int, kegs_50: int, cubes: int, co2_vols: num, do_ppb: num }
  const { saveSoon, saveNow, status } = useAutoSave(async (k, v) => {
    await upsertPackagingSession({ id: s.id, [k]: FORMAT[k] ? FORMAT[k](v) : v === '' ? null : v })
    onChanged()
  })
  const typed = (k) => ({
    onChange: (e) => { setS((x) => ({ ...x, [k]: e.target.value })); saveSoon(k, e.target.value) },
    onBlur: (e) => saveNow(k, e.target.value),
  })

  // Ticking Tank empty also marks the batch Packaged, so it asks first.
  async function setTankEmpty(checked) {
    if (checked && !window.confirm(`Tank empty: mark #${batch.batch_number} as Packaged? ${tankLabel(batch.tanks?.name)} will show as empty.`)) return
    setS((x) => ({ ...x, tank_empty: checked }))
    await saveNow('tank_empty', checked)
    if (checked) {
      await upsertBatch({ id: batch.id, status: 'packaged', package_date: s.package_date })
      onChanged()
    }
  }

  async function remove() {
    if (!window.confirm(`Delete pack-off session ${number} (${s.package_date})?`)) return
    await deletePackagingSession(s.id)
    onChanged()
  }

  return (
    <div className={'pk-session' + (open ? '' : ' pk-closed')}>
      <div className="pk-session-head">
        <h3>Session {number}{s.package_date ? ` · ${s.package_date}` : ''}</h3>
        <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="pk-litres">{Math.round(t.litres).toLocaleString()} L</span>
          <button className="secondary pk-toggle" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>
        </span>
      </div>

      {!open && (
        <div className="pk-summary">
          {[...KEG_SIZES.filter((k) => Number(s[`kegs_${k}`]) > 0).map((k) => `${s[`kegs_${k}`]} × ${k} L kegs`), ...(Number(s.cubes) > 0 ? [`${s.cubes} cubes`] : [])].join(' · ') || 'Nothing packed'}
          {s.operator ? ` · ${s.operator}` : ''}{s.tank_empty ? ' · tank empty' : ''}
        </div>
      )}

      {open && <div className="pk-session-body">
        <div className="pk-group pk-tank">
          <div className="pk-group-head"><h4>In tank</h4></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label style={field}>Date<input type="date" value={s.package_date ?? ''} {...typed('package_date')} /></label>
            <label style={field}>Operator<input value={s.operator ?? ''} {...typed('operator')} /></label>
            <label style={field}>CO₂ (vols)<input type="number" inputMode="decimal" step="0.01" value={s.co2_vols ?? ''} {...typed('co2_vols')} /></label>
            <label style={field}>DO (ppb)<input type="number" inputMode="decimal" value={s.do_ppb ?? ''} {...typed('do_ppb')} /></label>
          </div>
        </div>

        <div className="pk-group pk-pack">
          <div className="pk-group-head">
            <h4>Packed</h4>
            <span className="pk-chip">{t.kegs} kegs · {t.cubes} cubes ({(t.cubes * CANS_PER_CUBE).toLocaleString()} cans)</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {KEG_SIZES.map((size) => (
              <label key={size} style={field}>{size} L kegs<input type="number" inputMode="numeric" min="0" value={s[`kegs_${size}`] ?? 0} {...typed(`kegs_${size}`)} /></label>
            ))}
            <label style={field}>Cubes ({CANS_PER_CUBE} × 375 mL)<input type="number" inputMode="numeric" min="0" value={s.cubes ?? 0} {...typed('cubes')} /></label>
          </div>
          <label style={{ ...field, marginTop: '0.5rem' }}>Notes<input value={s.notes ?? ''} {...typed('notes')} /></label>
        </div>

        <DoChecks session={session} onChanged={onChanged} />

        <div className="pk-group pk-finish">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600, color: 'var(--ink)' }}>
            <input type="checkbox" checked={!!s.tank_empty} onChange={(e) => setTankEmpty(e.target.checked)} /> Tank empty (batch fully packaged)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <SaveStatus status={status} />
            <button onClick={() => setOpen(false)}>Done</button>
            <button className="secondary" onClick={remove}>Delete</button>
          </div>
        </div>
      </div>}
    </div>
  )
}

// What the schedule has this beer down for (Canning / Kegging cells), from the brite tank
// transfer to three weeks out, beside what's been packed so far.
function ScheduledPack({ batch, packed }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    const since = [batch.bbt_transfer_date ?? addDays(todayIso(), -14), addDays(todayIso(), -30)].sort()[1]
    const until = addDays(todayIso(), 21)
    loadIncoming({ since, days: 60 })
      .then((all) => setRows(all.filter((r) => beerMatch(r.beer) === beerMatch(batch.beer_style) && r.date <= until)))
      .catch(() => setRows([]))
  }, [batch.id, batch.beer_style, batch.bbt_transfer_date])
  if (!rows?.length) return null
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const cubes = rows.filter((r) => r.format === 'cube').reduce((a, r) => a + r.qty, 0)
  const kegs = rows.filter((r) => r.format === 'keg').reduce((a, r) => a + r.qty, 0)
  return (
    <div style={box}>
      <h3 style={{ marginTop: 0 }}>Scheduled</h3>
      <table>
        <thead><tr><th>Day</th><th>Line</th><th>On the schedule</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{fmt(r.date)} {r.slot}</td>
              <td>{r.lane.startsWith('canning') ? 'Canning' : 'Kegging'}</td>
              <td>{r.text}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.format === 'cube' ? `${r.qty} cubes` : `${r.qty} × ${r.size} L kegs`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: '0.5rem 0 0', color: 'var(--ink2)', fontSize: '0.9rem' }}>
        {cubes > 0 && <>Cubes: <strong>{packed.cubes}</strong> packed of <strong>{cubes}</strong> scheduled. </>}
        {kegs > 0 && <>Kegs: <strong>{packed.kegs}</strong> packed of <strong>{kegs}</strong> scheduled.</>}
      </p>
    </div>
  )
}

// Confirm the DAW (de-aerated water) that went into the BBT; Batch Details then shows the
// ABV after dilution. Suggested amount is the Cellar transfer's: litres to BBT down to target + 0.2%.
function DawConfirm({ batch, onChanged }) {
  const check = abvCheck(batch)
  const beerL = Number(batch.fv_to_bbt_l) || 0
  const raw = check.rawAbv
  const suggested = raw != null && check.target != null ? Math.round(dawLitres(beerL, raw, check.target)) : 0
  const added = Number(batch.daw_added_l) || 0
  const [litres, setLitres] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(null)
  if (!added && !suggested && !editing) return null

  async function save(v) {
    setError(null)
    try {
      await upsertBatch({ id: batch.id, daw_added_l: v, daw_added_at: v ? new Date().toISOString() : null })
      setEditing(false)
      onChanged()
    } catch (e) { setError(e.message) }
  }

  const after = (l) => (raw != null && beerL > 0 ? (raw * beerL) / (beerL + l) : null)
  if (added && !editing) {
    return (
      <div style={box}>
        <h3 style={{ marginTop: 0 }}>DAW</h3>
        <p style={{ margin: '0 0 0.5rem' }}>✓ <strong>{Math.round(added).toLocaleString()} L of DAW added</strong>{after(added) != null ? `: ${raw.toFixed(2)}% down to ${after(added).toFixed(2)}% ABV.` : '.'}</p>
        <AbvFlag check={check} compact />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="secondary" onClick={() => { setLitres(String(Math.round(added))); setEditing(true) }}>Change</button>
          <button className="secondary" onClick={() => window.confirm('Remove the DAW confirmation?') && save(null)}>Undo</button>
        </div>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </div>
    )
  }
  const L = litres === '' ? suggested : Number(litres)
  return (
    <div style={box}>
      <h3 style={{ marginTop: 0 }}>DAW</h3>
      {suggested > 0 && <p style={{ margin: '0 0 0.5rem' }}>Add <strong>{suggested.toLocaleString()} L of DAW</strong> to {beerL.toLocaleString()} L at {raw.toFixed(2)}% for {dawAim(check.target).toFixed(1)}% (target {check.target}% + 0.2%).</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
        <label style={{ ...field, flex: '0 1 160px' }}>DAW added (L)<input type="number" inputMode="numeric" value={litres} placeholder={suggested ? String(suggested) : ''} onChange={(e) => setLitres(e.target.value)} /></label>
        <button onClick={() => save(L)} disabled={!(L > 0)}>Confirm DAW added</button>
        {editing && <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
      {L > 0 && after(L) != null && <p style={{ color: 'var(--ink2)', fontSize: '0.85rem', margin: '0.4rem 0 0' }}>ABV after {L.toLocaleString()} L DAW: {after(L).toFixed(2)}%</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
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
      <h1><BeerDot name={batch.beer_style} />{batch.beer_style} #{batch.batch_number}</h1>
      <p style={{ color: 'var(--ink2)', marginTop: '-0.5rem' }}>
        {tankLabel(batch.tanks?.name)} · <span className={'pill pill-' + batch.status}>{statusLabel(batch.status)}</span> ·{' '}
        <Link to={`/batches/${batch.id}`}>Batch sheet</Link>
      </p>

      <DawConfirm batch={batch} onChanged={refresh} />

      <div style={{ ...box, display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
        {KEG_SIZES.map((size) => (
          <div key={size}><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>{size} L kegs</div><strong style={{ fontSize: '1.3rem' }}>{t[`kegs_${size}`]}</strong></div>
        ))}
        <div><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Cubes</div><strong style={{ fontSize: '1.3rem' }}>{t.cubes}</strong> <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>({(t.cubes * CANS_PER_CUBE).toLocaleString()} cans)</span></div>
        <div><div style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>Packaged</div><strong style={{ fontSize: '1.3rem' }}>{Math.round(t.litres).toLocaleString()} L</strong>{target ? <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}> of {target.toLocaleString()} L to BBT</span> : null}</div>
      </div>

      <ScheduledPack batch={batch} packed={t} />

      {sessions.map((s, i) => (
        <SessionCard key={s.id} number={i + 1} session={s} batch={batch} onChanged={refresh} startOpen={i === sessions.length - 1 && s.package_date === today()} />
      ))}

      {batch.status !== 'packaged' && (
        <button onClick={startSession} disabled={starting} style={{ fontSize: '1.05rem', padding: '0.75rem 1.5rem' }}>
          {starting ? '…' : sessions.length ? '+ Start another pack-off session' : '+ Start pack-off session'}
        </button>
      )}
    </div>
  )
}
