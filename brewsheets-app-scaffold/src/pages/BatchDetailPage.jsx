import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getBatch,
  upsertBatch,
  deleteBatch,
  listTanks,
  upsertBrewRun,
  upsertFermentationReading,
  deleteFermentationReading,
  upsertCellarTask,
  deleteCellarTask,
} from '../lib/api'

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}
function fromLocalInput(str) {
  return str ? new Date(str).toISOString() : null
}
function blankToNull(obj) {
  const out = { ...obj }
  for (const k of Object.keys(out)) if (out[k] === '') out[k] = null
  return out
}

// One tank (100HL) can hold up to 4 turns total for a batch, accumulated
// across separate brew days if needed — a single brew day itself never
// creates more than 3 at once (see MAX_TURNS_PER_DAY in AddBrewPage.jsx). This
// is the cap "+ Add another turn" below stops at.
const MAX_TURNS_PER_TANK = 4

const RUN_TIME_FIELDS = [
  'mash_in_time',
  'mash_end_time',
  'vorlauf_start_time',
  'lauter_start_time',
  'lauter_end_time',
  'boil_start_time',
  'boil_end_time',
  'transfer_start_time',
  'transfer_end_time',
  'ko_start_time',
  'ko_end_time',
]

// The 5 gated brew-day stages, in order. Each one's confirmedField is a
// brew_runs timestamp column — set it and the stage locks (read-only) and the
// next stage unlocks; null it out again ("Reopen") and it's editable again.
// Field groupings match exactly what the old flat BrewRunForm already had.
const STAGES = [
  {
    key: 'mash',
    confirmedField: 'mash_confirmed_at',
    label: 'Mash',
    fields: [
      ['strike_temp', 'Strike Temp', 'number', 110],
      ['mash_water_l', 'Mash H2O (L)', 'number', 120],
      ['mash_temp', 'Mash Temp', 'number', 110],
      ['mash_ph', 'Mash pH', 'number', 100],
      ['flowmeter_target_l', 'Flowmeter Target (L)', 'number', 140],
      ['flowmeter_actual_l', 'Flowmeter Actual (L)', 'number', 140],
      ['mash_in_time', 'Mash In', 'datetime-local', 190],
      ['mash_end_time', 'Mash End', 'datetime-local', 190],
    ],
  },
  {
    key: 'lauter',
    confirmedField: 'lauter_confirmed_at',
    label: 'Lauter / Vorlauf',
    fields: [
      ['vorlauf_start_time', 'Vorlauf Start', 'datetime-local', 190],
      ['lauter_start_time', 'Lauter Start', 'datetime-local', 190],
      ['lauter_end_time', 'Lauter End', 'datetime-local', 190],
      ['first_runnings_gravity', '1st Runnings Grav.', 'number', 140],
      ['last_runnings_gravity', 'Last Runnings Grav.', 'number', 140],
      ['total_kettle_acid_ml', 'Total Kettle Acid (mL)', 'number', 150],
    ],
  },
  {
    key: 'boil',
    confirmedField: 'boil_confirmed_at',
    label: 'Boil',
    fields: [
      ['target_preboil_gravity', 'Target Pre-Boil Grav.', 'number', 150],
      ['boil_start_time', 'Boil Start', 'datetime-local', 190],
      ['boil_end_time', 'Boil End', 'datetime-local', 190],
      ['preboil_volume_l', 'Pre-Boil Vol (L)', 'number', 130],
      ['preboil_gravity', 'Pre-Boil Grav.', 'number', 120],
      ['postboil_volume_l', 'Post-Boil Vol (L)', 'number', 130],
      ['postboil_gravity', 'Post-Boil Grav.', 'number', 120],
    ],
  },
  {
    key: 'transfer',
    confirmedField: 'transfer_confirmed_at',
    label: 'Transfer / Knockout',
    fields: [
      ['transfer_start_time', 'Transfer Start', 'datetime-local', 190],
      ['transfer_end_time', 'Transfer End', 'datetime-local', 190],
      ['ko_start_time', 'KO Start', 'datetime-local', 190],
      ['ko_end_time', 'KO End', 'datetime-local', 190],
      ['ko_flowmeter_l', 'Flowmeter (L)', 'number', 120],
      ['correction_l', 'Correction (L)', 'number', 120],
    ],
  },
  {
    key: 'whirlpool',
    confirmedField: 'whirlpool_confirmed_at',
    label: 'Whirlpool',
    fields: [
      ['whirlpool_gravity', 'Gravity', 'number', 110],
      ['whirlpool_ph', 'pH', 'number', 100],
      ['brewhouse_efficiency', 'Brewhouse Efficiency %', 'number', 160],
    ],
  },
]

function seedForm(batchId, runNumber, run) {
  return {
    run_number: runNumber,
    batch_id: batchId,
    ...run,
    ...Object.fromEntries(RUN_TIME_FIELDS.map((f) => [f, toLocalInput(run?.[f])])),
  }
}

function TurnStepper({ batchId, runNumber, run, onSaved }) {
  const [form, setForm] = useState(() => seedForm(batchId, runNumber, run))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function applySaved(saved) {
    setForm({
      ...saved,
      ...Object.fromEntries(RUN_TIME_FIELDS.map((f) => [f, toLocalInput(saved[f])])),
    })
    onSaved(saved)
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // The first stage whose confirmed timestamp isn't set yet is the active,
  // editable one — everything before it is confirmed+locked, everything after
  // it isn't reachable yet.
  const activeIndex = STAGES.findIndex((s) => !form[s.confirmedField])
  const allConfirmed = activeIndex === -1

  async function confirmStage(stage) {
    setSaving(true)
    setError(null)
    try {
      const payload = blankToNull({ ...form })
      delete payload.created_at
      delete payload.updated_at
      for (const f of RUN_TIME_FIELDS) payload[f] = fromLocalInput(form[f])
      payload[stage.confirmedField] = new Date().toISOString()
      const saved = await upsertBrewRun(payload)
      applySaved(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function reopenStage(stage) {
    if (!form.id) return
    setSaving(true)
    setError(null)
    try {
      const saved = await upsertBrewRun({ id: form.id, [stage.confirmedField]: null })
      applySaved(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveNotes() {
    if (!form.id) return
    setSaving(true)
    try {
      const saved = await upsertBrewRun({ id: form.id, notes: form.notes || null })
      applySaved(saved)
    } finally {
      setSaving(false)
    }
  }

  const field = (key, label, type = 'text', width = 110) => (
    <label style={{ display: 'inline-block', marginRight: '0.75rem', marginBottom: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#555' }}>{label}</div>
      <input
        type={type}
        value={form[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
        style={{ width }}
      />
    </label>
  )

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '1rem' }}>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <div>
        {field('brew_date', 'Date', 'date', 140)}
        {field('brewer', 'Brewer', 'text', 140)}
      </div>

      {/* Progress strip — a glance at where this turn is at */}
      <div style={{ display: 'flex', gap: '0.4rem', margin: '0.75rem 0 1rem', flexWrap: 'wrap' }}>
        {STAGES.map((s, i) => {
          const confirmed = !!form[s.confirmedField]
          const isActive = i === activeIndex
          return (
            <div
              key={s.key}
              style={{
                padding: '0.3rem 0.6rem',
                borderRadius: 4,
                fontSize: '0.8rem',
                background: confirmed ? '#e6f4e6' : isActive ? '#1a1a1a' : '#f0efec',
                color: confirmed ? '#1a7a1a' : isActive ? '#fff' : '#999',
                border: `1px solid ${confirmed ? '#1a7a1a' : isActive ? '#1a1a1a' : '#ddd'}`,
              }}
            >
              {confirmed ? '✓ ' : ''}
              {s.label}
            </div>
          )
        })}
      </div>

      {STAGES.map((s, i) => {
        const confirmed = !!form[s.confirmedField]
        const isActive = i === activeIndex
        if (!confirmed && !isActive) return null // not reached yet — stays hidden/locked

        return (
          <div key={s.key} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{s.label}</strong>
              {confirmed && (
                <button className="secondary" onClick={() => reopenStage(s)} disabled={saving}>
                  Reopen
                </button>
              )}
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              {s.fields.map(([key, label, type, width]) =>
                confirmed ? (
                  <span key={key} style={{ display: 'inline-block', marginRight: '1.25rem', marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#555' }}>{label}</div>
                    <div>{form[key] || '—'}</div>
                  </span>
                ) : (
                  <span key={key}>{field(key, label, type, width)}</span>
                )
              )}
              {s.key === 'whirlpool' && (
                <label style={{ display: 'inline-block', marginRight: '0.75rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#555' }}>O2 Check</div>
                  {confirmed ? (
                    <div>
                      {form.whirlpool_o2_check === true
                        ? 'Yes'
                        : form.whirlpool_o2_check === false
                        ? 'No'
                        : '—'}
                    </div>
                  ) : (
                    <select
                      value={form.whirlpool_o2_check === true ? 'yes' : form.whirlpool_o2_check === false ? 'no' : ''}
                      onChange={(e) =>
                        set(
                          'whirlpool_o2_check',
                          e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null
                        )
                      }
                    >
                      <option value="">—</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  )}
                </label>
              )}
            </div>
            {!confirmed && (
              <button onClick={() => confirmStage(s)} disabled={saving} style={{ marginTop: '0.5rem' }}>
                {saving ? 'Saving…' : `Confirm ${s.label} & Continue`}
              </button>
            )}
          </div>
        )
      })}

      {allConfirmed && <p style={{ color: '#1a7a1a', fontWeight: 600 }}>✓ Turn {runNumber} complete</p>}

      <label style={{ display: 'block', marginTop: '0.5rem' }}>
        Notes
        <br />
        <textarea
          value={form.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          onBlur={saveNotes}
          rows={2}
          style={{ width: '100%' }}
        />
      </label>
    </div>
  )
}

function FermentationLog({ batchId, readings, onChange }) {
  const [form, setForm] = useState({ reading_date: '', fermentation_day: '' })

  async function addReading() {
    if (!form.reading_date) return
    await upsertFermentationReading(blankToNull({ ...form, batch_id: batchId }))
    setForm({ reading_date: '', fermentation_day: '' })
    onChange()
  }

  async function remove(id) {
    await deleteFermentationReading(id)
    onChange()
  }

  return (
    <div>
      <h3>Fermentation / Cellar Log</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Temp</th>
            <th>Gravity (P)</th>
            <th>pH</th>
            <th>Tank Pressure</th>
            <th>CO2 tank</th>
            <th>O2 tank</th>
            <th>Sensory OK?</th>
            <th>Initials</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {readings
            .sort((a, b) => (a.reading_date > b.reading_date ? 1 : -1))
            .map((r) => (
              <tr key={r.id}>
                <td>{r.reading_date}</td>
                <td>{r.fermentation_day ?? '—'}</td>
                <td>{r.temp_panel ?? '—'}</td>
                <td>{r.gravity_plato ?? '—'}</td>
                <td>{r.ph ?? '—'}</td>
                <td>{r.tank_pressure ?? '—'}</td>
                <td>{r.co2_in_tank ?? '—'}</td>
                <td>{r.o2_in_tank ?? '—'}</td>
                <td>{r.sensory_check === true ? 'Yes' : r.sensory_check === false ? 'No' : '—'}</td>
                <td>{r.initials ?? '—'}</td>
                <td>
                  <button className="secondary" onClick={() => remove(r.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.75rem', padding: '0.75rem', background: '#fff', border: '1px solid #ddd', borderRadius: 6 }}>
        {[
          ['reading_date', 'Date', 'date'],
          ['fermentation_day', 'Day', 'number'],
          ['temp_panel', 'Temp', 'number'],
          ['gravity_plato', 'Gravity (P)', 'number'],
          ['ph', 'pH', 'number'],
          ['tank_pressure', 'Tank Pressure', 'number'],
          ['co2_in_tank', 'CO2 tank', 'number'],
          ['o2_in_tank', 'O2 tank', 'number'],
          ['initials', 'Initials', 'text'],
        ].map(([key, label, type]) => (
          <label key={key}>
            <div style={{ fontSize: '0.8rem', color: '#555' }}>{label}</div>
            <input
              type={type}
              value={form[key] ?? ''}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              style={{ width: 100 }}
            />
          </label>
        ))}
        <label>
          <div style={{ fontSize: '0.8rem', color: '#555' }}>Sensory OK?</div>
          <select
            value={form.sensory_check ?? ''}
            onChange={(e) => setForm({ ...form, sensory_check: e.target.value === 'true' ? true : e.target.value === 'false' ? false : '' })}
          >
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <button onClick={addReading}>+ Add reading</button>
      </div>
    </div>
  )
}

function CellarTasks({ batchId, tasks, onChange }) {
  const [desc, setDesc] = useState('')
  const [date, setDate] = useState('')

  async function add() {
    if (!desc) return
    await upsertCellarTask({ batch_id: batchId, task_description: desc, scheduled_date: date || null })
    setDesc('')
    setDate('')
    onChange()
  }
  async function remove(id) {
    await deleteCellarTask(id)
    onChange()
  }
  async function toggleDone(task) {
    await upsertCellarTask({
      ...task,
      condition_status: task.condition_status === 'done' ? null : 'done',
      completed_at: task.condition_status === 'done' ? null : new Date().toISOString(),
    })
    onChange()
  }

  return (
    <div>
      <h3>Cellar Tasks</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {tasks.map((t) => (
          <li key={t.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.25rem 0' }}>
            <input type="checkbox" checked={t.condition_status === 'done'} onChange={() => toggleDone(t)} />
            <span style={{ textDecoration: t.condition_status === 'done' ? 'line-through' : 'none' }}>
              {t.task_description} {t.scheduled_date ? `(${t.scheduled_date})` : ''}
            </span>
            <button className="secondary" onClick={() => remove(t.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input placeholder="Task description" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 1 }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={add}>+ Add task</button>
      </div>
    </div>
  )
}

function formatMass(gPerL, volumeL) {
  if (gPerL == null || volumeL == null) return null
  const totalG = gPerL * volumeL
  return totalG >= 1000 ? `${(totalG / 1000).toFixed(2)} kg` : `${totalG.toFixed(1)} g`
}

function ScaledIngredients({ recipe, volumeL }) {
  if (!recipe) return null

  if (!volumeL) {
    return (
      <div>
        <h3>Scaled Ingredients</h3>
        <p style={{ color: '#666' }}>
          Set a target volume above to see this recipe's ingredient amounts scaled up for this
          batch (the recipe is stored per litre).
        </p>
      </div>
    )
  }

  const groups = [
    { title: 'Grist / Malt Bill', items: recipe.recipe_grist_items ?? [], nameKey: 'ingredient_name' },
    { title: 'Water Chemistry', items: recipe.recipe_water_additions ?? [], nameKey: 'additive_name' },
    { title: 'Kettle Additions', items: recipe.recipe_kettle_additions ?? [], nameKey: 'item_name' },
    { title: 'Whirlpool Additions', items: recipe.recipe_whirlpool_additions ?? [], nameKey: 'item_name' },
    { title: 'Fermenter Additions', items: recipe.recipe_fermenter_additions ?? [], nameKey: 'item_name' },
  ]

  return (
    <div>
      <h3>Scaled Ingredients <span style={{ fontWeight: 400, fontSize: '0.9rem', color: '#666' }}>(for {volumeL}L)</span></h3>
      {groups.map((g) => (
        <div key={g.title} style={{ marginBottom: '1rem' }}>
          <strong>{g.title}</strong>
          {g.items.length === 0 ? (
            <p style={{ color: '#666', margin: '0.25rem 0' }}>None on this recipe.</p>
          ) : (
            <table>
              <tbody>
                {g.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item[g.nameKey]}</td>
                    <td>{formatMass(item.qty_g_per_l, volumeL) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {recipe.biofine_ml_per_l != null && (
        <p>
          <strong>Biofine:</strong> {(recipe.biofine_ml_per_l * volumeL).toFixed(0)} mL
        </p>
      )}
    </div>
  )
}

export default function BatchDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [batch, setBatch] = useState(null)
  const [tanks, setTanks] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  function refresh() {
    Promise.all([getBatch(id), listTanks()])
      .then(([b, t]) => {
        setBatch(b)
        setTanks(t)
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [id])

  function set(key, value) {
    setBatch({ ...batch, [key]: value })
  }

  async function save() {
    setSaving(true)
    try {
      const payload = blankToNull({
        id: batch.id,
        recipe_id: batch.recipe_id,
        batch_number: batch.batch_number,
        beer_style: batch.beer_style,
        status: batch.status,
        tank_id: batch.tank_id,
        date_brewed: batch.date_brewed,
        package_date: batch.package_date,
        approved_by: batch.approved_by,
        ready_to_package: batch.ready_to_package,
        cip_by: batch.cip_by,
        cip_date: batch.cip_date,
        actual_og: batch.actual_og,
        actual_fg: batch.actual_fg,
        abv: batch.abv,
        target_abv: batch.target_abv,
        ready_for_excise: batch.ready_for_excise,
        brewhouse_yield_l: batch.brewhouse_yield_l,
        fv_to_bbt_l: batch.fv_to_bbt_l,
        target_volume_l: batch.target_volume_l,
        turn_volume_l: batch.turn_volume_l,
        turn_quantity: batch.turn_quantity,
        notes: batch.notes,
      })
      await upsertBatch(payload)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete batch ${batch.batch_number}? This cannot be undone.`)) return
    await deleteBatch(batch.id)
    navigate('/batches')
  }

  if (loading || !batch) return <p>Loading…</p>

  return <BatchDetailContent batch={batch} tanks={tanks} set={set} save={save} saving={saving} remove={remove} refresh={refresh} />
}

function BatchDetailContent({ batch, tanks, set, save, saving, remove, refresh }) {
  const runsByNumber = Object.fromEntries((batch.brew_runs ?? []).map((r) => [r.run_number, r]))
  const existingRunNumbers = Object.keys(runsByNumber).map(Number)
  // How many turn tabs to show: the turn_quantity set by the Add Brew wizard, or
  // (for older batches created before this existed) however many brew_runs rows
  // already exist, or at least 1.
  const turnCount = batch.turn_quantity || Math.max(existingRunNumbers.length, 1)
  const turnNumbers = Array.from({ length: turnCount }, (_, i) => i + 1)

  const [activeTurn, setActiveTurn] = useState(1)

  async function addAnotherTurn() {
    const nextNumber = turnCount + 1
    if (nextNumber > MAX_TURNS_PER_TANK) return
    await upsertBrewRun({ batch_id: batch.id, run_number: nextNumber })
    if (!batch.turn_quantity || batch.turn_quantity < nextNumber) {
      await upsertBatch({ id: batch.id, turn_quantity: nextNumber })
    }
    setActiveTurn(nextNumber)
    refresh()
  }

  return (
    <div>
      <h1>Batch {batch.batch_number}</h1>
      <p style={{ color: '#666' }}>
        {batch.recipes?.name} — {batch.recipes?.style}
        {batch.turn_volume_l && batch.turn_quantity
          ? ` · ${turnCount} turn${turnCount === 1 ? '' : 's'} × ${batch.turn_volume_l}L = ${batch.target_volume_l ?? batch.turn_volume_l * turnCount}L total`
          : ''}
      </p>

      <h2 style={{ marginBottom: '0.5rem' }}>Brew Day</h2>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {turnNumbers.map((n) => {
          const run = runsByNumber[n]
          const complete = run && STAGES.every((s) => !!run[s.confirmedField])
          return (
            <button
              key={n}
              className={activeTurn === n ? '' : 'secondary'}
              onClick={() => setActiveTurn(n)}
            >
              {complete ? '✓ ' : ''}Turn {n}
            </button>
          )
        })}
        {turnCount < MAX_TURNS_PER_TANK && (
          <button className="secondary" onClick={addAnotherTurn}>
            + Add another turn ({turnCount}/{MAX_TURNS_PER_TANK} used)
          </button>
        )}
      </div>
      {turnCount >= MAX_TURNS_PER_TANK && (
        <p style={{ color: '#666', fontSize: '0.85rem', marginTop: '-0.5rem' }}>
          This tank is at its 4-turn maximum.
        </p>
      )}

      {turnNumbers.map((n) => (
        <div key={n} style={{ display: activeTurn === n ? 'block' : 'none', marginBottom: '2rem' }}>
          <TurnStepper batchId={batch.id} runNumber={n} run={runsByNumber[n]} onSaved={refresh} />
        </div>
      ))}

      <h2>Batch Details</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem', background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '1rem' }}>
        <label>
          Status
          <br />
          <select value={batch.status} onChange={(e) => set('status', e.target.value)}>
            {['planned', 'brewing', 'fermenting', 'conditioning', 'packaged', 'archived'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Tank
          <br />
          <select value={batch.tank_id ?? ''} onChange={(e) => set('tank_id', e.target.value || null)}>
            <option value="">—</option>
            {tanks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label>
          Date Brewed
          <br />
          <input type="date" value={batch.date_brewed ?? ''} onChange={(e) => set('date_brewed', e.target.value)} />
        </label>
        <label>
          Package Date
          <br />
          <input type="date" value={batch.package_date ?? ''} onChange={(e) => set('package_date', e.target.value)} />
        </label>
        <label>
          Batch #
          <br />
          <input value={batch.batch_number ?? ''} onChange={(e) => set('batch_number', e.target.value)} />
        </label>
        <label>
          Turn Volume (L)
          <br />
          <input type="number" value={batch.turn_volume_l ?? ''} onChange={(e) => set('turn_volume_l', e.target.value)} />
        </label>
        <label>
          Turns
          <br />
          <input type="number" value={batch.turn_quantity ?? ''} onChange={(e) => set('turn_quantity', e.target.value)} />
        </label>
        <label>
          Target Volume (L)
          <br />
          <input type="number" value={batch.target_volume_l ?? ''} onChange={(e) => set('target_volume_l', e.target.value)} />
        </label>
        <label>
          Approved By
          <br />
          <input value={batch.approved_by ?? ''} onChange={(e) => set('approved_by', e.target.value)} />
        </label>
        <label>
          CIP By
          <br />
          <input value={batch.cip_by ?? ''} onChange={(e) => set('cip_by', e.target.value)} />
        </label>
        <label>
          CIP Date
          <br />
          <input type="date" value={batch.cip_date ?? ''} onChange={(e) => set('cip_date', e.target.value)} />
        </label>
        <label>
          Actual OG
          <br />
          <input value={batch.actual_og ?? ''} onChange={(e) => set('actual_og', e.target.value)} />
        </label>
        <label>
          Actual FG
          <br />
          <input value={batch.actual_fg ?? ''} onChange={(e) => set('actual_fg', e.target.value)} />
        </label>
        <label>
          ABV
          <br />
          <input value={batch.abv ?? ''} onChange={(e) => set('abv', e.target.value)} />
        </label>
        <label>
          Target ABV
          <br />
          <input value={batch.target_abv ?? ''} onChange={(e) => set('target_abv', e.target.value)} />
        </label>
        <label>
          Brewhouse Yield (L)
          <br />
          <input value={batch.brewhouse_yield_l ?? ''} onChange={(e) => set('brewhouse_yield_l', e.target.value)} />
        </label>
        <label>
          FV to BBT (L)
          <br />
          <input value={batch.fv_to_bbt_l ?? ''} onChange={(e) => set('fv_to_bbt_l', e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={!!batch.ready_to_package} onChange={(e) => set('ready_to_package', e.target.checked)} /> Ready to package
        </label>
        <label>
          <input type="checkbox" checked={!!batch.ready_for_excise} onChange={(e) => set('ready_for_excise', e.target.checked)} /> Ready for excise
        </label>
      </div>
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Notes
        <br />
        <textarea value={batch.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ width: '100%' }} />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Batch'}</button>
        <button className="secondary" onClick={remove}>Delete Batch</button>
      </div>

      <div style={{ marginBottom: '2rem', background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '1rem' }}>
        <ScaledIngredients recipe={batch.recipes} volumeL={batch.target_volume_l} />
      </div>

      <div style={{ marginTop: '2rem' }}>
        <FermentationLog batchId={batch.id} readings={batch.fermentation_readings ?? []} onChange={refresh} />
      </div>

      <div style={{ marginTop: '2rem' }}>
        <CellarTasks batchId={batch.id} tasks={batch.cellar_tasks ?? []} onChange={refresh} />
      </div>
    </div>
  )
}
