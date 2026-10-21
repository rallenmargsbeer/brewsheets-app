import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listTanks, listIngredients, listBatchesInTanks, upsertBatch, upsertFermentationReading } from '../lib/api'
import { tankLabel, statusLabel, IN_TANK_STATUSES } from '../lib/tanks'
import AddToTank from '../components/AddToTank.jsx'
import TankDay from '../components/TankDay.jsx'
import { loadDay } from '../lib/dayTasks'
import { isScheduleEditor } from '../lib/schedule'
import BeerDot, { useBeerColour } from '../components/BeerDot.jsx'
import AbvFlag from '../components/AbvFlag.jsx'
import { abvCheck, actualFg, dawLitres, dawAim, koLitres } from '../lib/batchFigures'

const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd, local time

// Whole days from a yyyy-mm-dd date to today (brew day = Day 0).
function daysSince(date) {
  if (!date) return null
  return Math.round((Date.parse(today()) - Date.parse(date)) / 86400000)
}

// In a BBT the clock restarts at the transfer; in an FV it runs from brew day.
const daysInTank = (batch, tank) =>
  daysSince(tank.tank_type === 'BBT' && batch.bbt_transfer_date ? batch.bbt_transfer_date : batch.date_brewed)

function TankTile({ tank, batch, day, onClick }) {
  const colour = useBeerColour(batch?.beer_style)
  const days = batch ? daysInTank(batch, tank) : null
  // Today's first job for the tile: scheduled, else the template's suggestion.
  const next = day ? [...day.scheduled.filter((t) => !t.done), ...day.fromTemplate][0] : null
  const alert = day?.advice.find((a) => a.level !== 'info')
  return (
    <button
      className="secondary"
      onClick={onClick}
      style={{ textAlign: 'left', padding: '0.9rem 1rem', minHeight: 175, display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 400, ...(colour ? { borderLeft: `5px solid ${colour.bg}` } : {}) }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '1.15rem' }}>{tankLabel(tank.name)}</strong>
        <small style={{ color: 'var(--ink2)' }}>
          {tank.capacity_l != null ? `${Number(tank.capacity_l).toLocaleString()} L` : ''}
        </small>
      </span>
      {batch ? (
        <>
          <span style={{ fontWeight: 600, fontSize: '1.05rem' }}><BeerDot name={batch.beer_style} />{batch.beer_style}</span>
          <span style={{ color: 'var(--ink2)' }}>#{batch.batch_number}{days != null ? ` · Day ${days}` : ''}</span>
          <span className={'pill pill-' + batch.status} style={{ alignSelf: 'flex-start' }}>{batch.status}</span>
          <TileReading batch={batch} />
        </>
      ) : (
        <span style={{ color: 'var(--ink2)' }}>Empty</span>
      )}
      {next && <span className="tile-task">Today: {next.text}</span>}
      {alert && <span className={`tile-alert ${alert.level}`}>{alert.label ?? (alert.level === 'warn' ? 'Check gravity' : alert.level === 'go' ? 'At FG' : 'Near FG')}</span>}
    </button>
  )
}

// Latest gravity and the ABV it gives (green within excise range of target, red outside).
function TileReading({ batch }) {
  const fg = actualFg(batch)
  if (!fg) return <span className="tile-reading muted">No gravity yet</span>
  const c = abvCheck(batch)
  return (
    <span className="tile-reading">
      <span><b>{fg.plato.toFixed(1)}</b> °P</span>
      {c.abv != null && <span className={'tile-abv' + (c.ok === true ? ' ok' : c.ok === false ? ' bad' : '')}>{c.abv.toFixed(2)}% ABV</span>}
      {c.target != null && <span className="tile-target">target {Number(c.target).toFixed(1)}%</span>}
    </span>
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

// DAW to bring the beer down to target ABV: an estimate from the knockout volume until the
// filtered litres are entered, then the exact amount.
function DawNote({ check: c, batch, litres }) {
  const check = { ...c, abv: c.rawAbv ?? c.abv }
  if (check.abv == null || check.target == null) return null
  const aim = dawAim(check.target).toFixed(1)
  if (check.abv <= dawAim(check.target)) return null
  const L = Number(litres)
  if (L > 0) {
    const daw = dawLitres(L, check.abv, check.target)
    return <p className="daw-note exact">Add <b>{Math.round(daw).toLocaleString()} L of DAW</b> to {L.toLocaleString()} L at {check.abv.toFixed(2)}% for {aim}% ({Math.round(L + daw).toLocaleString()} L in the BBT).</p>
  }
  const ko = koLitres(batch)
  if (!ko) return <p className="daw-note">ABV {check.abv.toFixed(2)}% is over {aim}% (target {check.target}% + 0.2%). Enter the litres to BBT for the DAW needed.</p>
  return <p className="daw-note">Make about <b>{Math.ceil(dawLitres(ko, check.abv, check.target) / 10) * 10} L of DAW</b>: enough to bring up to {Math.round(ko).toLocaleString()} L (the knockout volume) from {check.abv.toFixed(2)}% to {aim}% (target {check.target}% + 0.2%). The exact amount shows once the filtered litres are entered.</p>
}

function TransferForm({ batch, bbts, onSaved }) {
  const [bbtId, setBbtId] = useState('')
  const [litres, setLitres] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const check = abvCheck(batch)
  async function save() {
    // Over target is fixed with DAW; under target can't be, so confirm first.
    if (check.ok === false && check.diff < 0 && !window.confirm(`ABV ${check.abv.toFixed(2)}% is under the excise range (${check.target}% ± 0.2%), and DAW can't raise it. Transfer to filter anyway?`)) return
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
      const daw = dawLitres(Number(litres), check.abv, check.target)
      onSaved(`Transferred to ${tankLabel(bbts.find((t) => t.id === bbtId)?.name)}` + (daw ? `. Add ${Math.round(daw).toLocaleString()} L of DAW to bring ${check.abv.toFixed(2)}% down to ${dawAim(check.target).toFixed(1)}%.` : ''))
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  if (bbts.length === 0) return <><AbvFlag check={check} compact /><p style={{ color: 'var(--ink2)', margin: 0 }}>No empty BBT right now.</p></>
  return (
    <div>
      <AbvFlag check={check} compact />
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
      <DawNote check={check} batch={batch} litres={litres} />
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button onClick={save} disabled={!bbtId || saving} style={{ marginTop: '0.5rem' }}>{saving ? '…' : 'Transfer'}</button>
    </div>
  )
}

function TankPanel({ tank, batch, day, editor, emptyBbts, ingredients, onClose, onChanged }) {
  const [msg, setMsg] = useState(null)

  function done(text) {
    setMsg(text)
    onChanged()
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

        {day && (
          <div style={{ marginTop: '0.75rem' }}>
            <h4 style={{ margin: '0 0 0.4rem' }}>Today</h4>
            <TankDay day={day} editor={editor} onChanged={onChanged} />
          </div>
        )}

        {!batch ? (
          <p style={{ color: 'var(--ink2)' }}>This tank is empty. Start a brew from the Brew Day tab to fill it.</p>
        ) : (
          <>
            <p style={{ color: 'var(--ink2)', margin: '0.5rem 0 0' }}>
              Day {daysInTank(batch, tank)} · <span className={'pill pill-' + batch.status}>{statusLabel(batch.status)}</span> ·{' '}
              <Link to={`/batches/${batch.id}`}>Open batch sheet</Link>
            </p>

            <div style={section}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Log a reading</h4>
              <ReadingForm batch={batch} onSaved={done} />
            </div>

            <div style={section}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Add to tank</h4>
              <AddToTank batch={batch} ingredients={ingredients} />
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
  const [ingredients, setIngredients] = useState([])
  const [days, setDays] = useState(null)
  const [editor, setEditor] = useState(false)
  useEffect(() => { isScheduleEditor().then(setEditor) }, [])
  useEffect(() => {
    listIngredients().then(setIngredients).catch((e) => setError(e.message))
  }, [])

  function refresh() {
    Promise.all([listTanks(), listBatchesInTanks(IN_TANK_STATUSES)])
      .then(([t, b]) => {
        setTanks(t)
        setBatches(b)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    // Today's tasks per tank (schedule, template suggestion, gravity).
    loadDay(today()).then((d) => setDays(Object.fromEntries(d.tanks.map((x) => [x.tank.id, x])))).catch(() => setDays(null))
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
      <p style={{ color: 'var(--ink2)', marginTop: '-0.5rem' }}>Tap a tank for today’s tasks, to log a reading, add dry hops or transfer to a BBT. <Link to="/today">Everything on today →</Link></p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <h3>Fermenters</h3>
          <div style={{ ...grid, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '1rem' }}>
            {fvs.map((t) => <TankTile key={t.id} tank={t} batch={batchIn(t)} day={days?.[t.id]} onClick={() => setOpenTankId(t.id)} />)}
          </div>
          {bbts.length > 0 && (
            <>
              <h3 style={{ marginTop: '1.5rem' }}>Bright tanks</h3>
              <div style={grid}>
                {bbts.map((t) => <TankTile key={t.id} tank={t} batch={batchIn(t)} day={days?.[t.id]} onClick={() => setOpenTankId(t.id)} />)}
              </div>
            </>
          )}
        </>
      )}

      {openTank && (
        <TankPanel
          ingredients={ingredients}
          tank={openTank}
          batch={batchIn(openTank)}
          day={days?.[openTank.id]}
          editor={editor}
          emptyBbts={bbts.filter((t) => !batchIn(t))}
          onClose={() => setOpenTankId(null)}
          onChanged={refresh}
        />
      )}

    </div>
  )
}
