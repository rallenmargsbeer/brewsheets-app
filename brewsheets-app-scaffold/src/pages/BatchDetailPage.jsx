import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getBatch,
  upsertBatch,
  deleteBatch,
  listTanks,
  upsertBrewRun,
  snapshotBrewRunIngredients,
  updateBrewRunIngredient,
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

// One tank (100HL) can hold up to 4 turns total for a batch — this is the cap
// "+ Add another turn" below stops at (matches MAX_TURNS_PER_TANK in
// AddBrewPage.jsx, which now also offers all 4 turns from the wizard itself).
const MAX_TURNS_PER_TANK = 4

// The 4 gated brew-day stages, in order. Each one's confirmedField is a
// brew_runs timestamp column — set it and the stage locks (read-only) and the
// next stage unlocks; null it out again ("Reopen") and it's editable again.
// Unlike the old version, this is metadata only — every stage now has its own
// hand-written block below (targets, time buttons, ingredient tables differ
// too much per stage for one generic field-list renderer to cover cleanly).
const STAGES = [
  { key: 'mash', confirmedField: 'mash_confirmed_at', label: 'Mash' },
  { key: 'lauter', confirmedField: 'lauter_confirmed_at', label: 'Lauter / Vorlauf' },
  { key: 'boil', confirmedField: 'boil_confirmed_at', label: 'Boil' },
  { key: 'knockout', confirmedField: 'knockout_confirmed_at', label: 'Knockout' },
]

function seedForm(batchId, runNumber, run) {
  return {
    run_number: runNumber,
    batch_id: batchId,
    ...run,
  }
}

// Small read-only "aim for X" display, pulled straight from the recipe —
// never editable here, the recipe screen is where targets get set.
function TargetValue({ label, value, unit }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: '#888' }}>{label}</div>
      <div style={{ fontWeight: 600 }}>
        {value != null && value !== '' ? `${value}${unit ? ' ' + unit : ''}` : '—'}
      </div>
    </div>
  )
}

// Replaces the old "type a timestamp" datetime-local inputs. Unset: a single
// tap stamps now() (and, when this button is paired with an end field via
// autoFillKey/durationMin, pre-fills that end field off the recipe's stage
// duration too). Set: shows the formatted time — click it to reveal a normal
// datetime-local input for a correction. Every press/edit saves immediately
// (a single-field partial update through upsertBrewRun, which routes to a
// real .update() so it's safe even mid-brew) rather than waiting for
// "Confirm & Continue", so a dropped connection never loses the stamp — and
// it stays editable even after its stage is confirmed/locked, since a brewer
// may need to correct a time after the fact.
function TimeButton({ runId, fieldKey, label, value, onSaved, autoFillKey, durationMin }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  async function stamp() {
    setSaving(true)
    try {
      const nowIso = new Date().toISOString()
      const payload = { id: runId, [fieldKey]: nowIso }
      if (autoFillKey && durationMin != null) {
        payload[autoFillKey] = new Date(Date.now() + durationMin * 60000).toISOString()
      }
      onSaved(await upsertBrewRun(payload))
    } finally {
      setSaving(false)
    }
  }

  async function saveEdited(localValue) {
    setSaving(true)
    try {
      onSaved(await upsertBrewRun({ id: runId, [fieldKey]: fromLocalInput(localValue) }))
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  const display = value
    ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <label style={{ display: 'inline-block', marginRight: '0.75rem', marginBottom: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#555' }}>{label}</div>
      {editing ? (
        <input
          type="datetime-local"
          defaultValue={toLocalInput(value)}
          autoFocus
          onBlur={(e) => saveEdited(e.target.value)}
          style={{ width: 190 }}
        />
      ) : value ? (
        <button className="secondary" onClick={() => setEditing(true)} disabled={saving}>
          {display}
        </button>
      ) : (
        <button onClick={stamp} disabled={saving || !runId}>
          {saving ? '…' : 'Tap to stamp'}
        </button>
      )}
    </label>
  )
}

// Formats an already-computed absolute gram amount from brew_run_ingredients
// (planned_qty/actual_qty) — distinct from formatMass below, which multiplies
// a per-litre recipe rate by a volume first.
function formatQty(qty) {
  if (qty == null) return '—'
  return qty >= 1000 ? `${(qty / 1000).toFixed(2)} kg` : `${qty.toFixed(1)} g`
}

// The per-turn planned/actual ingredient list a brewer actually works from.
// planned_qty is a fixed snapshot from the recipe (never edited here); name
// and actual_qty are editable on the fly for a substitution or a shortage.
// Always editable regardless of whether the stage it's shown under is
// confirmed/locked — ingredient edits are deliberately decoupled from stage
// gating. Saves trigger a full page refresh (onSaved) rather than local
// state patching, same as everywhere else on this page.
function IngredientList({ title, items, onSaved }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ marginTop: '0.75rem' }}>
      {title && (
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#333', marginBottom: '0.25rem' }}>{title}</div>
      )}
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Item</th>
            <th style={{ textAlign: 'left' }}>When</th>
            <th style={{ textAlign: 'left' }}>Planned</th>
            <th style={{ textAlign: 'left' }}>Actual</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <IngredientRow key={item.id} item={item} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IngredientRow({ item, onSaved }) {
  const [name, setName] = useState(item.item_name)
  const [actual, setActual] = useState(item.actual_qty ?? '')
  const [saving, setSaving] = useState(false)

  async function saveName() {
    if (name === item.item_name) return
    setSaving(true)
    try {
      await updateBrewRunIngredient(item.id, { item_name: name })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function saveActual() {
    const value = actual === '' ? null : Number(actual)
    if (value === item.actual_qty) return
    setSaving(true)
    try {
      await updateBrewRunIngredient(item.id, { actual_qty: value })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const changed = item.actual_qty !== item.planned_qty

  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} style={{ width: 160 }} disabled={saving} />
      </td>
      <td style={{ color: '#666', fontSize: '0.85rem' }}>{item.timing_note ?? '—'}</td>
      <td style={{ color: '#666' }}>{formatQty(item.planned_qty)}</td>
      <td>
        <input
          type="number"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          onBlur={saveActual}
          style={{ width: 90, ...(changed ? { borderColor: '#a66a00' } : {}) }}
          disabled={saving}
        />
      </td>
    </tr>
  )
}

function TurnStepper({ batchId, runNumber, run, recipe, turnVolumeL, onSaved }) {
  const [form, setForm] = useState(() => seedForm(batchId, runNumber, run))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function applySaved(saved) {
    setForm((f) => ({ ...f, ...saved }))
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

  async function confirmStage(stage, fieldKeys) {
    setSaving(true)
    setError(null)
    try {
      const payload = blankToNull({
        id: form.id,
        ...Object.fromEntries(fieldKeys.map((k) => [k, form[k]])),
      })
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

  // This turn's snapshotted ingredient lines, split out by where each one
  // belongs on the brew sheet.
  const ingredients = form.brew_run_ingredients ?? []
  const gristItems = ingredients.filter((i) => i.section === 'grist')
  const mashWaterItems = ingredients.filter((i) => i.section === 'water' && i.addition_stage === 'mash')
  const kettleItems = ingredients.filter((i) => i.section === 'kettle')
  const kettleWaterItems = ingredients.filter((i) => i.section === 'water' && i.addition_stage === 'kettle')
  const whirlpoolItems = ingredients.filter((i) => i.section === 'whirlpool')
  const fermenterItems = ingredients.filter((i) => i.section === 'fermenter')

  // Target Strike Volume isn't a stored number — it's the grist bill for
  // this turn (already snapshotted at turn volume) times the recipe's own
  // liquor:grist ratio (defaults to 3:1, editable per recipe).
  const gristKg = gristItems.reduce((sum, i) => sum + (i.planned_qty ?? 0), 0) / 1000
  const strikeVolumeL =
    recipe?.liquor_grist_ratio != null && gristKg > 0 ? gristKg * recipe.liquor_grist_ratio : null

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

        const fld = (key, label, type = 'text', width = 110) =>
          confirmed ? (
            <span key={key} style={{ display: 'inline-block', marginRight: '1.25rem', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', color: '#555' }}>{label}</div>
              <div>{form[key] || '—'}</div>
            </span>
          ) : (
            <span key={key}>{field(key, label, type, width)}</span>
          )

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
              {s.key === 'mash' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      gap: '1.5rem',
                      flexWrap: 'wrap',
                      marginBottom: '0.75rem',
                      padding: '0.6rem 0.75rem',
                      background: '#f7f6f3',
                      borderRadius: 4,
                    }}
                  >
                    <TargetValue label="Target Strike Temp" value={recipe?.target_strike_temp} unit="°C" />
                    <TargetValue
                      label="Target Strike Volume"
                      value={strikeVolumeL != null ? strikeVolumeL.toFixed(0) : null}
                      unit="L"
                    />
                    <TargetValue label="Mash Step 1" value={recipe?.mash_step_1_temp} unit="°C" />
                    <TargetValue label="Mash Step 2" value={recipe?.mash_step_2_temp} unit="°C" />
                    <TargetValue label="Mash Step 3" value={recipe?.mash_step_3_temp} unit="°C" />
                    <TargetValue label="Mash Out" value={recipe?.mash_out_temp} unit="°C" />
                  </div>
                  {fld('strike_temp', 'Strike Temp', 'number', 110)}
                  {fld('mash_water_l', 'Mash H2O (L)', 'number', 120)}
                  {fld('mash_temp', 'Mash Temp', 'number', 110)}
                  {fld('mash_ph', 'Mash pH', 'number', 100)}
                  {fld('flowmeter_target_l', 'Flowmeter Target (L)', 'number', 140)}
                  {fld('flowmeter_actual_l', 'Flowmeter Actual (L)', 'number', 140)}
                  <div style={{ marginTop: '0.5rem' }}>
                    <TimeButton
                      runId={form.id}
                      fieldKey="mash_in_time"
                      label="Mash In"
                      value={form.mash_in_time}
                      onSaved={applySaved}
                      autoFillKey="mash_end_time"
                      durationMin={recipe?.mash_duration_min}
                    />
                    <TimeButton
                      runId={form.id}
                      fieldKey="mash_end_time"
                      label="Mash End"
                      value={form.mash_end_time}
                      onSaved={applySaved}
                    />
                  </div>
                  <IngredientList title="Grist" items={gristItems} onSaved={onSaved} />
                  <IngredientList title="Water (Mash)" items={mashWaterItems} onSaved={onSaved} />
                </>
              )}

              {s.key === 'lauter' && (
                <>
                  <div style={{ marginTop: '0.5rem' }}>
                    <TimeButton
                      runId={form.id}
                      fieldKey="vorlauf_start_time"
                      label="Vorlauf Start"
                      value={form.vorlauf_start_time}
                      onSaved={applySaved}
                    />
                    <TimeButton
                      runId={form.id}
                      fieldKey="lauter_start_time"
                      label="Lauter Start"
                      value={form.lauter_start_time}
                      onSaved={applySaved}
                      autoFillKey="lauter_end_time"
                      durationMin={recipe?.lauter_duration_min}
                    />
                    <TimeButton
                      runId={form.id}
                      fieldKey="lauter_end_time"
                      label="Lauter End"
                      value={form.lauter_end_time}
                      onSaved={applySaved}
                    />
                  </div>
                  {fld('first_runnings_gravity', '1st Runnings Grav.', 'number', 140)}
                  {fld('last_runnings_gravity', 'Last Runnings Grav.', 'number', 140)}
                </>
              )}

              {s.key === 'boil' && (
                <>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <TargetValue label="Target Pre-Boil Gravity" value={recipe?.target_preboil_gravity} unit="" />
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <TimeButton
                      runId={form.id}
                      fieldKey="boil_start_time"
                      label="Boil Start"
                      value={form.boil_start_time}
                      onSaved={applySaved}
                      autoFillKey="boil_end_time"
                      durationMin={recipe?.boil_duration_min}
                    />
                    <TimeButton
                      runId={form.id}
                      fieldKey="boil_end_time"
                      label="Boil End"
                      value={form.boil_end_time}
                      onSaved={applySaved}
                    />
                  </div>
                  {fld('preboil_volume_l', 'Pre-Boil Vol (L)', 'number', 130)}
                  {fld('preboil_gravity', 'Pre-Boil Grav. (actual)', 'number', 130)}
                  {fld('postboil_volume_l', 'Post-Boil Vol (L)', 'number', 130)}
                  {fld('postboil_gravity', 'Post-Boil Grav.', 'number', 120)}
                  <IngredientList title="Kettle" items={kettleItems} onSaved={onSaved} />
                  <IngredientList title="Water (Kettle)" items={kettleWaterItems} onSaved={onSaved} />
                </>
              )}

              {s.key === 'knockout' && (
                <>
                  {recipe?.ko_temp != null && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <TargetValue label="Target KO Temp" value={recipe.ko_temp} unit="°C" />
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem' }}>
                    <TimeButton
                      runId={form.id}
                      fieldKey="ko_start_time"
                      label="KO Start"
                      value={form.ko_start_time}
                      onSaved={applySaved}
                      autoFillKey="ko_end_time"
                      durationMin={recipe?.knockout_duration_min}
                    />
                    <TimeButton
                      runId={form.id}
                      fieldKey="ko_end_time"
                      label="KO End"
                      value={form.ko_end_time}
                      onSaved={applySaved}
                    />
                  </div>
                  {fld('ko_flowmeter_l', 'Flowmeter (L)', 'number', 120)}
                  {fld('correction_l', 'Correction (L)', 'number', 120)}
                  {fld('whirlpool_gravity', 'Gravity', 'number', 110)}
                  {fld('whirlpool_ph', 'pH', 'number', 100)}
                  {fld('brewhouse_efficiency', 'Brewhouse Efficiency %', 'number', 160)}
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
                  <IngredientList title="Whirlpool Additions" items={whirlpoolItems} onSaved={onSaved} />
                </>
              )}
            </div>

            {!confirmed && (
              <button
                onClick={() =>
                  confirmStage(
                    s,
                    s.key === 'mash'
                      ? ['strike_temp', 'mash_water_l', 'mash_temp', 'mash_ph', 'flowmeter_target_l', 'flowmeter_actual_l']
                      : s.key === 'lauter'
                      ? ['first_runnings_gravity', 'last_runnings_gravity']
                      : s.key === 'boil'
                      ? ['preboil_volume_l', 'preboil_gravity', 'postboil_volume_l', 'postboil_gravity']
                      : [
                          'ko_flowmeter_l',
                          'correction_l',
                          'whirlpool_gravity',
                          'whirlpool_ph',
                          'brewhouse_efficiency',
                          'whirlpool_o2_check',
                        ]
                  )
                }
                disabled={saving}
                style={{ marginTop: '0.5rem' }}
              >
                {saving ? 'Saving…' : `Confirm ${s.label} & Continue`}
              </button>
            )}
          </div>
        )
      })}

      {allConfirmed && <p style={{ color: '#1a7a1a', fontWeight: 600 }}>✓ Turn {runNumber} complete</p>}

      {/* Not gated to a stage — fermentation isn't time-tracked on this sheet, but
          pitching/dry-hopping happens right around knockout so it's worth showing here. */}
      {fermenterItems.length > 0 && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
          <strong>Fermenter Additions</strong>
          <p style={{ color: '#666', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
            Not gated to a stage — visible any time so you can see what's coming, or confirm what got pitched.
          </p>
          <IngredientList items={fermenterItems} onSaved={onSaved} />
        </div>
      )}

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

function formatMass(gPerL, volumeL) {
  if (gPerL == null || volumeL == null) return null
  const totalG = gPerL * volumeL
  return totalG >= 1000 ? `${(totalG / 1000).toFixed(2)} kg` : `${totalG.toFixed(1)} g`
}

// Whole-batch (all turns combined) ingredient reference — kept as-is,
// unchanged, alongside the new per-turn view above: still useful for
// procurement/prep at a glance, distinct from the per-turn editable list.
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
    const newRun = await upsertBrewRun({ batch_id: batch.id, run_number: nextNumber })
    // Snapshot this new turn's planned ingredients from the recipe too, same as
    // the Add Brew wizard does — otherwise a manually-added turn would show no
    // ingredient list at all.
    if (batch.recipes && batch.turn_volume_l) {
      await snapshotBrewRunIngredients(newRun.id, batch.recipes, batch.turn_volume_l)
    }
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
          <TurnStepper
            batchId={batch.id}
            runNumber={n}
            run={runsByNumber[n]}
            recipe={batch.recipes}
            turnVolumeL={batch.turn_volume_l}
            onSaved={refresh}
          />
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
    </div>
  )
}
