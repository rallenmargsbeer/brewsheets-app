import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listTanks, listBatchesInTanks, upsertBatch, upsertFermentationReading } from '../lib/api'
import { tankLabel, IN_TANK_STATUSES } from '../lib/tanks'

const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd, local time

// Whole days from a yyyy-mm-dd date to today (brew day = Day 0).
function daysSince(date) {
  if (!date) return null
  return Math.round((Date.parse(today()) - Date.parse(date)) / 86400000)
}

// In a BBT the clock restarts at the transfer; in an FV it runs from brew day.
const daysInTank = (batch, tank) =>
  daysSince(tank.tank_type === 'BBT' && batch.bbt_transfer_date ? batch.bbt_transfer_date : batch.date_brewed)

function TankTile({ tank, batch, onClick }) {
  const days = batch ? daysInTank(batch, tank) : null
  return (
    <button
      className="secondary"
      onClick={onClick}
      style={{ textAlign: 'left', padding: '0.75rem', minHeight: 120, display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 400 }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '1.15rem' }}>{tankLabel(tank.name)}</strong>
        <small style={{ color: 'var(--ink2)' }}>
          {tank.capacity_l != null ? `${Number(tank.capacity_l).toLocaleString()} L` : ''}
        </small>
      </span>
      {batch ? (
        <>
          <span style={{ fontWeight: 600 }}>{batch.beer_style}</span>
          <span style={{ color: 'var(--ink2)' }}>#{batch.batch_number}{days != null ? ` · Day ${days}` : ''}</span>
          <span className={'pill pill-' + batch.status} style={{ alignSelf: 'flex-start' }}>{batch.status}</span>
        </>
      ) : (
        <span style={{ color: 'var(--ink2)' }}>Empty</span>
      )}
    </button>
  )
}

function ReadingForm({ batch, onSaved }) {
  const blank = { gravity_plato: '', temp_panel: '', ph: '', notes: '', initials: '' }
  const [r, setR] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setR({ ...r, [k]: e.target.value })
  const num = (v) => (v === '' ? null : Number(v))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await upsertFermentationReading({
        batch_id: batch.id,
        reading_date: today(),
        fermentation_day: daysSince(batch.date_brewed),
        gravity_plato: num(r.gravity_plato),
        temp_panel: num(r.temp_panel),
        ph: num(r.ph),
        notes: r.notes || null,
        initials: r.initials || null,
      })
      setR(blank)
      onSaved('Reading saved')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const field = { display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 90px' }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <label style={field}>Gravity (°P)<input type="number" inputMode="decimal" step="0.1" value={r.gravity_plato} onChange={set('gravity_plato')} /></label>
        <label style={field}>Temp (°C)<input type="number" inputMode="decimal" step="0.1" value={r.temp_panel} onChange={set('temp_panel')} /></label>
        <label style={field}>pH<input type="number" inputMode="decimal" step="0.01" value={r.ph} onChange={set('ph')} /></label>
        <label style={field}>Initials<input value={r.initials} onChange={set('initials')} /></label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: '0.5rem' }}>
        Notes<input value={r.notes} onChange={set('notes')} placeholder="e.g. DH#1 added" />
      </label>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button onClick={save} disabled={saving} style={{ marginTop: '0.5rem' }}>{saving ? '…' : 'Save reading'}</button>
    </div>
  )
}

function TransferForm({ batch, bbts, onSaved }) {
  const [bbtId, setBbtId] = useState('')
  const [litres, setLitres] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await upsertBatch({
        id: batch.id,
        tank_id: bbtId,
        status: 'conditioning',
        bbt_transfer_date: today(),
        fv_to_bbt_l: litres === '' ? null : Number(litres),
      })
      onSaved(`Transferred to ${tankLabel(bbts.find((t) => t.id === bbtId)?.name)}`)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  if (bbts.length === 0) return <p style={{ color: 'var(--ink2)', margin: 0 }}>No empty BBT right now.</p>
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {bbts.map((t) => (
          <button key={t.id} className={bbtId === t.id ? '' : 'secondary'} onClick={() => setBbtId(t.id)}>
            {tankLabel(t.name)}
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: '0.5rem', maxWidth: 200 }}>
        Litres to BBT<input type="number" inputMode="numeric" value={litres} onChange={(e) => setLitres(e.target.value)} />
      </label>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button onClick={save} disabled={!bbtId || saving} style={{ marginTop: '0.5rem' }}>{saving ? '…' : 'Transfer'}</button>
    </div>
  )
}

function TankPanel({ tank, batch, emptyBbts, onClose, onChanged }) {
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  function done(text) {
    setMsg(text)
    onChanged()
  }

  async function setStatus(status) {
    if (status === 'packaged' && !window.confirm(`Mark #${batch.batch_number} as packaged? ${tankLabel(tank.name)} will show as empty.`)) return
    setError(null)
    try {
      await upsertBatch({ id: batch.id, status, ...(status === 'packaged' ? { package_date: today() } : {}) })
      if (status === 'packaged') onClose()
      done(`Status set to ${status}`)
    } catch (e) {
      setError(e.message)
    }
  }

  const section = { borderTop: '1px solid var(--line)', paddingTop: '0.75rem', marginTop: '0.75rem' }
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '2rem 16px', overflowY: 'auto', zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--surface, #fff)', borderRadius: 8, padding: '1rem', width: '100%', maxWidth: 520 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>
            {tankLabel(tank.name)}
            {batch && ` · ${batch.beer_style} #${batch.batch_number}`}
          </h3>
          <button className="secondary" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {msg && <p style={{ color: '#1a7a1a', marginBottom: 0 }}>{msg}</p>}
        {error && <p style={{ color: 'crimson', marginBottom: 0 }}>{error}</p>}

        {!batch ? (
          <p style={{ color: 'var(--ink2)' }}>This tank is empty. Start a brew from the Brew Day tab to fill it.</p>
        ) : (
          <>
            <p style={{ color: 'var(--ink2)', margin: '0.5rem 0 0' }}>
              Day {daysInTank(batch, tank)} · <span className={'pill pill-' + batch.status}>{batch.status}</span> ·{' '}
              <Link to={`/batches/${batch.id}`}>Open batch sheet</Link>
            </p>

            <div style={section}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Log a reading</h4>
              <ReadingForm batch={batch} onSaved={done} />
            </div>

            <div style={section}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Change status</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {['fermenting', 'conditioning', 'packaged'].map((s) => (
                  <button key={s} className={batch.status === s ? '' : 'secondary'} onClick={() => setStatus(s)}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {tank.tank_type !== 'BBT' && (
              <div style={section}>
                <h4 style={{ margin: '0 0 0.5rem' }}>Transfer to BBT</h4>
                <TransferForm batch={batch} bbts={emptyBbts} onSaved={(t) => { onClose(); done(t) }} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Natural order so FV2 sorts before FV10 and "BT 1" before "BT 2".
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })

export default function CellarPage() {
  const [tanks, setTanks] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openTankId, setOpenTankId] = useState(null)

  function refresh() {
    Promise.all([listTanks(), listBatchesInTanks(IN_TANK_STATUSES)])
      .then(([t, b]) => {
        setTanks(t)
        setBatches(b)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  // Newest batch wins if a tank somehow has more than one unfinished batch.
  const batchIn = (tank) => batches.find((b) => b.tank_id === tank.id)
  const active = tanks.filter((t) => t.is_active !== false)
  const fvs = active.filter((t) => t.tank_type !== 'BBT').sort(byName)
  const bbts = active.filter((t) => t.tank_type === 'BBT').sort(byName)
  const openTank = tanks.find((t) => t.id === openTankId)

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }
  return (
    <div>
      <h1>Cellar</h1>
      <p style={{ color: 'var(--ink2)', marginTop: '-0.5rem' }}>Tap a tank to log a reading, change status or transfer to a BBT.</p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <h3>Fermenters</h3>
          <div style={grid}>
            {fvs.map((t) => <TankTile key={t.id} tank={t} batch={batchIn(t)} onClick={() => setOpenTankId(t.id)} />)}
          </div>
          {bbts.length > 0 && (
            <>
              <h3 style={{ marginTop: '1.5rem' }}>Bright tanks</h3>
              <div style={grid}>
                {bbts.map((t) => <TankTile key={t.id} tank={t} batch={batchIn(t)} onClick={() => setOpenTankId(t.id)} />)}
              </div>
            </>
          )}
        </>
      )}

      {openTank && (
        <TankPanel
          tank={openTank}
          batch={batchIn(openTank)}
          emptyBbts={bbts.filter((t) => !batchIn(t))}
          onClose={() => setOpenTankId(null)}
          onChanged={refresh}
        />
      )}

    </div>
  )
}
