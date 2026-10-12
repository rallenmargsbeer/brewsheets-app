import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { tankLabel, statusLabel } from '../lib/tanks'
import FermentationSection from '../components/FermentationSection.jsx'
import IngredientPicker from '../components/IngredientPicker.jsx'
import IngredientsUsed from '../components/IngredientsUsed.jsx'
import {
  getBatch,
  upsertBatch,
  deleteBatch,
  listTanks,
  listIngredients,
  upsertBrewRun,
  snapshotBrewRunIngredients,
  updateBrewRunIngredient,
  listPackagingSessions,
} from '../lib/api'
import { batchFigures, actualOg } from '../lib/batchFigures'
import { blendGravity, waterForGravity, gravityAfter } from '../lib/dilution'

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

// Fixed total water (strike + sparge combined) per turn size — a brewhouse constant tied to
// equipment losses, not something that depends on the recipe. Ryan supplied these directly;
// update here if the brewhouse's water balance changes or a new turn size is added.
const TOTAL_WATER_L = { 1000: 1360, 1500: 2040, 2500: 3400 }

// Metric-to-imperial constants — these two calculators (Mash Efficiency, IBU) are built on
// brewing-industry formulas that are conventionally expressed in lb/gallon; the app itself
// stays metric everywhere else, so the conversion only happens inside the math below and is
// never shown to Ryan.
const KG_TO_LB = 2.20462
const L_TO_GAL = 0.264172

// Mash/kettle efficiency (Brewer's Friend convention): what fraction of the grain bill's
// potential extract actually made it into the kettle, judged from pre-boil gravity/volume.
// potentialPpgByName maps a grist item's name (as typed on the recipe) to the Potential PPG
// entered for it on the Ingredients page — only items with a match contribute; if none of a
// turn's grist items have a Potential PPG on file, this returns null (shown as "—") rather
// than a misleadingly partial number.
function calcMashEfficiency(gristItems, potentialPpgByName, preboilGravity, preboilVolumeL) {
  if (preboilGravity == null || preboilGravity === '' || !preboilVolumeL) return null
  let potentialPoints = 0
  let matchedAny = false
  for (const item of gristItems) {
    const kg = (item.actual_qty ?? item.planned_qty ?? 0) / 1000
    const ppg = potentialPpgByName.get(item.item_name)
    if (kg > 0 && ppg != null) {
      potentialPoints += kg * KG_TO_LB * ppg
      matchedAny = true
    }
  }
  if (!matchedAny || potentialPoints === 0) return null
  const actualPoints = 1000 * (Number(preboilGravity) - 1) * (Number(preboilVolumeL) * L_TO_GAL)
  return (actualPoints / potentialPoints) * 100
}

// Tinseth IBU estimate. hopItems is kettle + whirlpool brew_run_ingredients rows; alphaAcidByName
// maps an ingredient's name (as entered on the recipe line) to the Alpha Acid % set for it on
// the Ingredients page — only items with a match contribute (Irish Moss/whirlfloc-type rows
// have no Alpha Acid % on file and are correctly skipped). Whirlpool hops use the same formula
// with their (shorter) stand time in the boil-time factor, which is what gives them reduced
// utilization relative to a full boil — no separate whirlpool-specific temperature model, per
// how this was scoped with Ryan.
function calcIBU(hopItems, alphaAcidByName, boilGravity, batchVolumeL) {
  if (boilGravity == null || boilGravity === '' || !batchVolumeL) return null
  const volumeGal = Number(batchVolumeL) * L_TO_GAL
  let total = 0
  let matchedAny = false
  for (const item of hopItems) {
    const weightG = item.actual_qty ?? item.planned_qty
    const alphaAcidPct = alphaAcidByName.get(item.item_name)
    if (!weightG || alphaAcidPct == null || item.time_min == null) continue
    const weightOz = (weightG / 1000) * KG_TO_LB * 16
    const aaDecimal = alphaAcidPct / 100
    const bignessFactor = 1.65 * Math.pow(0.000125, Number(boilGravity) - 1)
    const boilTimeFactor = (1 - Math.exp(-0.04 * Number(item.time_min))) / 4.15
    const utilization = bignessFactor * boilTimeFactor
    total += (weightOz * aaDecimal * utilization * 7489) / volumeGal
    matchedAny = true
  }
  return matchedAny ? total : null
}

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
    ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
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

// Sparge water is added periodically through the lauter rather than in one go, so this is a
// simple "top up a running total" control rather than a plain editable number — type an
// amount, hit Add, and it's added to whatever's already been recorded (never overwrites it).
// Saves immediately via upsertBrewRun, same pattern as TimeButton.
function AddSpargeControl({ runId, addedSoFar, onSaved }) {
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  async function add() {
    const value = Number(amount)
    if (!value) return
    setSaving(true)
    try {
      const saved = await upsertBrewRun({ id: runId, sparge_added_l: (addedSoFar || 0) + value })
      setAmount('')
      onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <label style={{ display: 'inline-block', marginRight: '0.75rem', marginBottom: '0.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: '#555' }}>Add Sparge (L)</div>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 80 }}
          disabled={saving}
        />
        <button onClick={add} disabled={saving || !amount}>
          {saving ? '…' : 'Add'}
        </button>
      </div>
      {addedSoFar > 0 && (
        <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.15rem' }}>{addedSoFar}L added so far</div>
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
function IngredientList({ title, items, ingredients, onSaved }) {
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
            <IngredientRow key={item.id} item={item} ingredients={ingredients} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Malt (grist) and hop additions (kettle/whirlpool) are entered/edited in Kg
// rather than grams — everything else (water chemistry, fermenter additions)
// stays in grams, since those are typically trace amounts. planned_qty/
// actual_qty are always stored in grams underneath either way.
function usesKg(section) {
  return section === 'grist' || section === 'kettle' || section === 'whirlpool'
}

function IngredientRow({ item, ingredients, onSaved }) {
  const kg = usesKg(item.section)
  const toDisplay = (g) => (g == null ? '' : kg ? +(g / 1000).toFixed(3) : g)

  const [actual, setActual] = useState(toDisplay(item.actual_qty))
  const [saving, setSaving] = useState(false)

  async function saveName(name) {
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
    const value = actual === '' ? null : Number(actual) * (kg ? 1000 : 1)
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
        <IngredientPicker value={item.item_name} section={item.section} ingredients={ingredients ?? []} onCommit={saveName} disabled={saving} width={180} />
      </td>
      <td style={{ color: '#666', fontSize: '0.85rem' }}>{item.timing_note ?? '—'}</td>
      <td style={{ color: '#666' }}>
        {item.bag_count != null
          ? `${item.bag_count} bag${item.bag_count === 1 ? '' : 's'} (${formatQty(item.planned_qty)})`
          : formatQty(item.planned_qty)}
      </td>
      <td>
        <input
          type="number"
          step={kg ? '0.001' : '1'}
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          onBlur={saveActual}
          style={{ width: 90, ...(changed ? { borderColor: '#a66a00' } : {}) }}
          disabled={saving}
        />
        <span style={{ marginLeft: '0.25rem', fontSize: '0.75rem', color: '#888' }}>{kg ? 'kg' : 'g'}</span>
      </td>
    </tr>
  )
}

function TurnStepper({ batchId, runNumber, run, recipe, turnVolumeL, masterIngredients, onSaved, isLastTurn, otherRuns = [] }) {
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

  // Sparge Water Required = this turn's fixed total water budget, minus whatever strike water
  // actually went in (falling back to the computed Target Strike Volume above until the brewer
  // records an actual), minus however much sparge has already been added. Counts down as
  // AddSpargeControl tops up sparge_added_l.
  const totalWaterL = TOTAL_WATER_L[turnVolumeL] ?? null
  const actualStrikeL = form.mash_water_l !== '' && form.mash_water_l != null ? Number(form.mash_water_l) : null
  const strikeForSparge = actualStrikeL ?? strikeVolumeL
  const spargeAddedL = Number(form.sparge_added_l) || 0
  const spargeRequiredL =
    totalWaterL != null && strikeForSparge != null ? totalWaterL - strikeForSparge - spargeAddedL : null

  // Mash Efficiency: pre-boil gravity/volume vs. the grain bill's potential extract (Potential
  // PPG, set per-ingredient on the Ingredients page). Whichever's typed into the Boil fields
  // right now, before Confirm & Continue — same "live as you type" treatment as Target Strike
  // Volume/Sparge Water Required above.
  const potentialPpgByName = new Map(masterIngredients.map((i) => [i.name, i.potential_ppg]).filter(([, ppg]) => ppg != null))
  const mashEfficiencyPct = calcMashEfficiency(gristItems, potentialPpgByName, form.preboil_gravity, form.preboil_volume_l)

  // IBU (Tinseth estimate): kettle + whirlpool hops, using post-boil gravity/volume as the
  // batch reference point. Alpha Acid % is looked up live from the Ingredients master list,
  // same as Potential PPG above — it's an ingredient property, not a recipe-line one.
  const alphaAcidByName = new Map(masterIngredients.map((i) => [i.name, i.alpha_acid_pct]).filter(([, aa]) => aa != null))
  const estimatedIBU = calcIBU([...kettleItems, ...whirlpoolItems], alphaAcidByName, form.postboil_gravity, form.postboil_volume_l)

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
                    <TargetValue label="Target Mash pH" value={recipe?.target_mash_ph} unit="" />
                    <TargetValue label="Mash Step 1" value={recipe?.mash_step_1_temp} unit="°C" />
                    <TargetValue label="Mash Step 2" value={recipe?.mash_step_2_temp} unit="°C" />
                    <TargetValue label="Mash Step 3" value={recipe?.mash_step_3_temp} unit="°C" />
                    <TargetValue label="Mash Out" value={recipe?.mash_out_temp} unit="°C" />
                  </div>
                  {fld('strike_temp', 'Strike Temp', 'number', 110)}
                  {fld('mash_water_l', 'Actual Strike Volume (L)', 'number', 140)}
                  {fld('mash_temp', 'Mash Temp', 'number', 110)}
                  {fld('mash_ph', 'Mash pH', 'number', 100)}
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
                  <IngredientList title="Grist" items={gristItems} ingredients={masterIngredients} onSaved={onSaved} />
                  <IngredientList title="Water (Mash)" items={mashWaterItems} ingredients={masterIngredients} onSaved={onSaved} />
                </>
              )}

              {s.key === 'lauter' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      gap: '1.5rem',
                      flexWrap: 'wrap',
                      alignItems: 'flex-end',
                      marginBottom: '0.75rem',
                      padding: '0.6rem 0.75rem',
                      background: '#f7f6f3',
                      borderRadius: 4,
                    }}
                  >
                    <TargetValue
                      label="Sparge Water Required"
                      value={spargeRequiredL != null ? spargeRequiredL.toFixed(0) : null}
                      unit="L"
                    />
                    <AddSpargeControl runId={form.id} addedSoFar={spargeAddedL} onSaved={applySaved} />
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
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
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    <TargetValue label="Target Pre-Boil Gravity" value={recipe?.target_preboil_gravity} unit="" />
                    <TargetValue
                      label="Mash Efficiency (est.)"
                      value={mashEfficiencyPct != null ? mashEfficiencyPct.toFixed(0) : null}
                      unit="%"
                    />
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
                  <IngredientList title="Kettle" items={kettleItems} ingredients={masterIngredients} onSaved={onSaved} />
                  <IngredientList title="Water (Kettle)" items={kettleWaterItems} ingredients={masterIngredients} onSaved={onSaved} />
                </>
              )}

              {s.key === 'knockout' && (
                <>
                  {(recipe?.ko_temp != null || estimatedIBU != null) && (
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                      {recipe?.ko_temp != null && <TargetValue label="Target KO Temp" value={recipe.ko_temp} unit="°C" />}
                      <TargetValue
                        label="IBU (est., Tinseth)"
                        value={estimatedIBU != null ? estimatedIBU.toFixed(0) : null}
                        unit=""
                      />
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
                  {fld('whirlpool_gravity', 'Gravity', 'number', 110)}
                  {fld('whirlpool_ph', 'pH', 'number', 100)}
                  {isLastTurn && (
                    <DilutionPrompt
                      turns={[...otherRuns, { ...form, run_number: runNumber }]}
                      targetPlato={recipe?.target_og}
                      water={form.correction_l}
                      onWater={(v) => set('correction_l', v)}
                      locked={confirmed}
                    />
                  )}
                  <IngredientList title="Whirlpool Additions" items={whirlpoolItems} ingredients={masterIngredients} onSaved={onSaved} />
                </>
              )}
            </div>

            {!confirmed && (
              <button
                onClick={() =>
                  confirmStage(
                    s,
                    s.key === 'mash'
                      ? ['strike_temp', 'mash_water_l', 'mash_temp', 'mash_ph']
                      : s.key === 'lauter'
                      ? ['first_runnings_gravity', 'last_runnings_gravity']
                      : s.key === 'boil'
                      ? ['preboil_volume_l', 'preboil_gravity', 'postboil_volume_l', 'postboil_gravity']
                      : ['ko_flowmeter_l', 'whirlpool_gravity', 'whirlpool_ph', ...(isLastTurn ? ['correction_l'] : [])]
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
          <IngredientList items={fermenterItems} ingredients={masterIngredients} onSaved={onSaved} />
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
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)

  function refresh() {
    Promise.all([getBatch(id), listTanks(), listIngredients()])
      .then(([b, t, i]) => {
        setBatch(b)
        setTanks(t)
        setIngredients(i)
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [id])

  async function remove() {
    if (!confirm(`Delete batch ${batch.batch_number}? This cannot be undone.`)) return
    await deleteBatch(batch.id)
    navigate('/batches')
  }

  if (loading || !batch) return <p>Loading…</p>

  return (
    <BatchDetailContent
      batch={batch}
      tanks={tanks}
      ingredients={ingredients}
      remove={remove}
      refresh={refresh}
    />
  )
}

function BatchDetailContent({ batch, tanks, ingredients, remove, refresh }) {
  const runsByNumber = Object.fromEntries((batch.brew_runs ?? []).map((r) => [r.run_number, r]))
  const existingRunNumbers = Object.keys(runsByNumber).map(Number)
  // How many turn tabs to show: the turn_quantity set by the Add Brew wizard, or
  // (for older batches created before this existed) however many brew_runs rows
  // already exist, or at least 1.
  const turnCount = batch.turn_quantity || Math.max(existingRunNumbers.length, 1)
  const turnNumbers = Array.from({ length: turnCount }, (_, i) => i + 1)

  const [activeTurn, setActiveTurn] = useState(1)

  // Brew day ends with the last knockout: once every turn's Knockout is confirmed,
  // a batch still marked Brewing moves to Fermenting on its own.
  const allKnockedOut = turnNumbers.every((n) => runsByNumber[n]?.knockout_confirmed_at)
  useEffect(() => {
    if (batch.status !== 'brewing' || !allKnockedOut) return
    upsertBatch({ id: batch.id, status: 'fermenting' }).then(() => refresh())
  }, [batch.id, batch.status, allKnockedOut])
  // Sheet opens on Fermentation; the Add Brew wizard links straight to ?view=brewday.
  const [searchParams, setSearchParams] = useSearchParams()
  const view = ['brewday', 'details'].includes(searchParams.get('view')) ? searchParams.get('view') : 'fermentation'
  const brewDay = view === 'brewday'

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
      {/* Fixed to the viewport (not the page) — stays halfway up the screen as you
          scroll, so a turn is always one tap away regardless of where you are on the
          brewsheet. Labelled with the turn they'd take you to; hidden at either end. */}
      {brewDay && activeTurn > 1 && (
        <button
          onClick={() => setActiveTurn(activeTurn - 1)}
          style={{ position: 'fixed', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}
        >
          ← Turn {activeTurn - 1}
        </button>
      )}
      {brewDay && activeTurn < turnCount && (
        <button
          onClick={() => setActiveTurn(activeTurn + 1)}
          style={{ position: 'fixed', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}
        >
          Turn {activeTurn + 1} →
        </button>
      )}

      <h1>Batch {batch.batch_number}</h1>
      <p style={{ color: '#666' }}>
        {batch.recipes?.name} — {batch.recipes?.style}
        {batch.turn_volume_l && batch.turn_quantity
          ? ` · ${turnCount} turn${turnCount === 1 ? '' : 's'} × ${batch.turn_volume_l}L = ${batch.target_volume_l ?? batch.turn_volume_l * turnCount}L total`
          : ''}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid var(--line)', marginBottom: '1rem' }}>
        {[['fermentation', 'Fermentation'], ['brewday', 'Brew Day'], ['details', 'Batch Details']].map(([key, label]) => (
          <button
            key={key}
            className={view === key ? '' : 'secondary'}
            onClick={() => setSearchParams(key === 'fermentation' ? {} : { view: key }, { replace: true })}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, marginBottom: -2 }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'fermentation' && <FermentationSection batch={batch} og={actualOg(batch)} onChanged={refresh} />}

      {brewDay && (
      <>
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
            masterIngredients={ingredients}
            onSaved={refresh}
            isLastTurn={n === turnCount}
            otherRuns={(batch.brew_runs ?? []).filter((r) => r.run_number !== n)}
          />
        </div>
      ))}
      </>
      )}

      {view === 'details' && <BatchDetails batch={batch} tanks={tanks} ingredients={ingredients} remove={remove} />}

      {brewDay && (
        <div style={{ marginBottom: '2rem', background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '1rem' }}>
          <ScaledIngredients recipe={batch.recipes} volumeL={batch.target_volume_l} />
        </div>
      )}
    </div>
  )
}

// Batch Details: a read-only summary of what's been recorded on Brew Day, Fermentation,
// Cellar and Packaging. Nothing here is typed in.
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null)
const fx = (v, dp, unit = '') => (v == null || Number.isNaN(Number(v)) ? null : `${Number(v).toFixed(dp)}${unit}`)

function Fact({ label, value, from }) {
  return (
    <div className="bd-fact">
      <div className="bd-label">{label}</div>
      <div className={'bd-value' + (value == null ? ' bd-empty' : '')}>{value ?? 'Not yet'}</div>
      {from && <div className="bd-from">{from}</div>}
    </div>
  )
}

function BatchDetails({ batch, tanks, ingredients, remove }) {
  const [sessions, setSessions] = useState([])
  useEffect(() => { listPackagingSessions(batch.id).then(setSessions).catch(() => setSessions([])) }, [batch.id])
  const f = batchFigures(batch, sessions)
  const tank = tanks.find((t) => t.id === batch.tank_id)
  const turns = batch.turn_quantity || (batch.brew_runs ?? []).length
  const p = f.packed
  const packedText = [p.cubes && `${p.cubes} cubes`, p.kegs_50 && `${p.kegs_50} × 50 L`, p.kegs_30 && `${p.kegs_30} × 30 L`, p.kegs_20 && `${p.kegs_20} × 20 L`].filter(Boolean).join(', ')
  const packDate = f.packFrom ? (f.packFrom === f.packTo ? fmtDate(f.packFrom) : `${fmtDate(f.packFrom)} to ${fmtDate(f.packTo)}`) : null

  return (
    <>
      <section className="bd-card">
        <h3>Batch</h3>
        <div className="bd-grid">
          <Fact label="Status" value={statusLabel(batch.status)} from="Moves on with Brew Day, knockout and packaging" />
          <Fact label="Beer" value={batch.recipes?.name} from={batch.recipes?.style} />
          <Fact label="Date brewed" value={fmtDate(batch.date_brewed)} from="Add Brew" />
          <Fact label="Tank" value={tank ? tankLabel(tank.name) : null} from="Brew Day tank step / Cellar transfer" />
          <Fact label="Turns" value={turns ? `${f.turnsDone} of ${turns} knocked out` : null} from={batch.turn_volume_l ? `${batch.turn_volume_l} L each` : null} />
          <Fact label="Target volume" value={fx(batch.target_volume_l, 0, ' L')} from="Add Brew" />
        </div>
      </section>

      <section className="bd-card">
        <h3>Gravity &amp; ABV</h3>
        <div className="bd-grid">
          <Fact label="Actual OG" value={fx(f.og, 1, ' °P')} from={(turns > 1 ? 'KO gravity, turns weighted by volume' : 'KO gravity on Brew Day') + (f.dilutionL ? ', after dilution' : '')} />
          <Fact label="Actual FG" value={fx(f.fg?.plato, 1, ' °P')} from={f.fg ? `Latest fermentation reading, ${fmtDate(f.fg.date)}` : 'Fermentation readings'} />
          <Fact label="ABV" value={fx(f.abv, 2, '%')} from="From actual OG and FG" />
          <Fact label="Target ABV" value={fx(f.targetAbv, 1, '%')} from={f.targetAbv != null ? `Recipe${f.targetOg != null ? `: OG ${f.targetOg} °P, FG ${f.targetFg ?? '?'} °P` : ''}` : 'Set on the recipe'} />
        </div>
      </section>

      <section className="bd-card">
        <h3>Volumes</h3>
        <div className="bd-grid">
          <Fact label="Brewhouse yield" value={fx(f.yieldL, 0, ' L')} from={f.dilutionL ? `Knockout flowmeter + ${Math.round(f.dilutionL)} L dilution water` : 'Knockout flowmeter, all turns'} />
          <Fact label="FV to BBT" value={fx(batch.fv_to_bbt_l, 0, ' L')} from={batch.bbt_transfer_date ? `Cellar transfer, ${fmtDate(batch.bbt_transfer_date)}` : 'Cellar transfer'} />
          <Fact label="Packaged" value={f.packedLitres ? `${f.packedLitres.toLocaleString()} L` : null} from={packedText || 'Packaging sessions'} />
          <Fact label="Package date" value={packDate} from="Packaging sessions" />
        </div>
      </section>

      <PackagedTable sessions={sessions} />

      <IngredientsUsed batch={batch} ingredients={ingredients} />

      <div style={{ margin: '1.5rem 0 2rem' }}>
        <button className="secondary" onClick={remove}>Delete batch</button>
      </div>
    </>
  )
}

// What was packed, session by session, for building the packaging assemblies in Unleashed.
const PACK_COLS = [
  ['cubes', 'Cubes', 6],
  ['kegs_50', '50 L kegs', 50],
  ['kegs_30', '30 L kegs', 30],
  ['kegs_20', '20 L kegs', 20],
]

// Can DO readings from a session's checks: every fill-head reading (heads 1 to 6, or the
// single reading on older checks).
function canDos(session) {
  const out = []
  for (const c of session.packaging_do_checks ?? []) {
    const heads = [1, 2, 3, 4, 5, 6].map((h) => c[`head_${h}`]).filter((v) => v != null && v !== '')
    out.push(...(heads.length ? heads : c.do_ppb != null ? [c.do_ppb] : []).map(Number))
  }
  return out
}
const dash = (v, dp = 0) => (v == null || v === '' ? '—' : Number(v).toFixed(dp))

function PackagedTable({ sessions }) {
  const cols = PACK_COLS.filter(([k]) => sessions.some((s) => Number(s[k])))
  const litres = (s) => PACK_COLS.reduce((a, [k, , l]) => a + (Number(s[k]) || 0) * l, 0)
  const total = Object.fromEntries(PACK_COLS.map(([k]) => [k, sessions.reduce((a, s) => a + (Number(s[k]) || 0), 0)]))
  return (
    <section className="bd-card">
      <h3>Packaged &amp; QC</h3>
      {!sessions.length ? (
        <p className="bd-empty" style={{ margin: 0 }}>Nothing packaged yet. Pack-off sessions on the Packaging tab show here.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="bd-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Date</th>
                <th>Operator</th>
                {cols.map(([k, label]) => <th key={k} className="num">{label}</th>)}
                <th className="num">Litres</th>
                <th className="num bd-qc">Tank CO₂ (vols)</th>
                <th className="num bd-qc">Tank DO (ppb)</th>
                <th className="num bd-qc">Can DO avg / max (ppb)</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td>{fmtDate(s.package_date) ?? '—'}</td>
                  <td>{s.operator || '—'}</td>
                  {cols.map(([k]) => <td key={k} className="num">{Number(s[k]) ? Number(s[k]).toLocaleString() : ''}</td>)}
                  <td className="num">{litres(s).toLocaleString()}</td>
                  <td className="num bd-qc">{dash(s.co2_vols, 2)}</td>
                  <td className="num bd-qc">{dash(s.do_ppb)}</td>
                  <td className="num bd-qc">{(() => {
                    const d = canDos(s)
                    if (!d.length) return '—'
                    const avg = d.reduce((a, x) => a + x, 0) / d.length
                    return `${Math.round(avg)} / ${Math.round(Math.max(...d))}`
                  })()}<span className="bd-n">{canDos(s).length ? ` (${(s.packaging_do_checks ?? []).length} check${(s.packaging_do_checks ?? []).length === 1 ? '' : 's'})` : ''}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                {cols.map(([k]) => <td key={k} className="num">{total[k].toLocaleString()}</td>)}
                <td className="num">{litres(total).toLocaleString()}</td>
                <td colSpan={2} className="bd-qc" />
                <td className="num bd-qc">{(() => {
                  const d = sessions.flatMap(canDos)
                  return d.length ? `${Math.round(d.reduce((a, x) => a + x, 0) / d.length)} / ${Math.round(Math.max(...d))}` : ''
                })()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

// Last turn's knockout: how much water takes the whole batch down to the recipe's target OG.
function DilutionPrompt({ turns, targetPlato, water, onWater, locked }) {
  const target = Number(targetPlato)
  const sorted = [...turns].sort((a, b) => a.run_number - b.run_number)
  const missing = sorted.filter((t) => !(Number(t.ko_flowmeter_l) > 0 && Number(t.whirlpool_gravity) > 0)).map((t) => t.run_number)
  const blend = blendGravity(sorted.map((t) => ({ volumeL: Number(t.ko_flowmeter_l), plato: Number(t.whirlpool_gravity) })))
  const need = blend && target > 0 ? waterForGravity(blend.volumeL, blend.plato, target) : null
  const added = Number(water) || 0
  const after = blend && added ? gravityAfter(blend.volumeL, blend.plato, added) : null
  return (
    <div className="dil-box">
      <div className="dil-title">Dilution to target OG</div>
      {!(target > 0) ? (
        <p>Set a Target OG on the recipe to get a dilution suggestion.</p>
      ) : !blend ? (
        <p>Enter this turn's flowmeter and gravity to see the dilution.</p>
      ) : (
        <>
          <p>
            All turns: <strong>{Math.round(blend.volumeL).toLocaleString()} L at {blend.plato.toFixed(2)} °P</strong> · target {target} °P
            {missing.length > 0 && <span className="dil-warn"> (turn {missing.join(', ')} has no KO volume / gravity yet)</span>}
          </p>
          {need > 0.5 ? (
            <p className="dil-answer">
              Add <strong>{Math.round(need).toLocaleString()} L</strong> of water → {Math.round(blend.volumeL + need).toLocaleString()} L at {target} °P
            </p>
          ) : (
            <p className="dil-answer ok">At or under target ({(blend.plato - target).toFixed(2)} °P): no dilution needed.</p>
          )}
        </>
      )}
      <div className="dil-row">
        <label>Dilution water added (L)
          <input type="number" min="0" value={water ?? ''} onChange={(e) => onWater(e.target.value)} disabled={locked} style={{ width: 110 }} />
        </label>
        {!locked && need > 0.5 && <button className="secondary" onClick={() => onWater(String(Math.round(need)))}>Use {Math.round(need)} L</button>}
        {after != null && <span className="dil-after">→ batch OG {after.toFixed(2)} °P, {Math.round(blend.volumeL + added).toLocaleString()} L</span>}
      </div>
    </div>
  )
}
