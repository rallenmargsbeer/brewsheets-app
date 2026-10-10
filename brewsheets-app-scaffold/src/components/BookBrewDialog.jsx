import { useEffect, useMemo, useState } from 'react'
import { tankLabel } from '../lib/tanks'
import { addDays, todayIso, stepsForTank, splitAtFilter, suggestBrightTank, listScheduleEntries, createBooking, packDay, packTexts } from '../lib/schedule'
import { LITRES_PER_PALLET, CANS_PER_PALLET, CUBES_PER_PALLET } from '../lib/packaging'

const TURN_SIZES = [1000, 1500, 2500]
const fmt = (isoDate) => new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })

export default function BookBrewDialog({ tanks, brightTanks = [], recipes, templates, onClose, onBooked }) {
  const realRecipes = recipes.filter((r) => !r.name.startsWith('Historical import'))
  const [recipeId, setRecipeId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [beerName, setBeerName] = useState('')
  const [brewDate, setBrewDate] = useState(todayIso())
  const [tankId, setTankId] = useState('')
  const [turnVolume, setTurnVolume] = useState(2500)
  const [turns, setTurns] = useState(4)
  const [notes, setNotes] = useState('')
  const [pack, setPack] = useState({ pallets: '', kegs_50: '', kegs_30: '', kegs_20: '' })
  const [clashes, setClashes] = useState([])
  const [windowEntries, setWindowEntries] = useState([])
  const [btChoice, setBtChoice] = useState('auto') // 'auto' = use the suggestion, '' = none, or a tank id
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const template = templates.find((t) => t.id === templateId)
  const tank = tanks.find((t) => t.id === tankId)
  const steps = template && tank ? stepsForTank(template, tank) : []
  const lastDay = steps.reduce((m, s) => Math.max(m, s.day), 1)

  // Picking a recipe fills in its linked template and name; picking a template fills the name.
  function pickRecipe(id) {
    setRecipeId(id)
    const r = realRecipes.find((x) => x.id === id)
    if (r?.cellar_template_id) setTemplateId(r.cellar_template_id)
    if (r) setBeerName(r.name)
  }
  function pickTemplate(id) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t && !beerName) setBeerName(t.name)
  }

  // Warn if the tank already has anything on the schedule for the days this brew needs it.
  useEffect(() => {
    if (!tankId || !brewDate) return setClashes([])
    const until = addDays(brewDate, lastDay - 1)
    listScheduleEntries(brewDate, until)
      .then((rows) => {
        setWindowEntries(rows)
        setClashes(rows.filter((r) => r.tank_id === tankId).sort((a, b) => a.entry_date.localeCompare(b.entry_date)))
      })
      .catch(() => setClashes([]))
  }, [tankId, brewDate, lastDay])

  // Filter day moves the beer to a bright tank; suggest one that's empty for its stay there.
  const { filterStep, btSteps } = splitAtFilter(steps)
  const filterDate = filterStep ? addDays(brewDate, filterStep.day - 1) : null
  const btEnd = filterStep ? addDays(brewDate, Math.max(filterStep.day, ...btSteps.map((s) => s.day)) - 1) : null
  const suggestedBt = filterStep ? suggestBrightTank(brightTanks, windowEntries, filterDate, btEnd, turnVolume * turns) : null
  const brightTank = btChoice === 'auto' ? suggestedBt : brightTanks.find((t) => t.id === btChoice) ?? null

  // What goes where: FV jobs up to Filter, then (if a bright tank is set) the beer's arrival and BT jobs.
  const preview = useMemo(() => {
    const name = (s) => (s.task === template?.name ? beerName || s.task : s.task)
    const inFv = brightTank && filterStep ? splitAtFilter(steps).fvSteps : steps
    const rows = inFv.map((s, i) => ({ key: 'f' + i, date: addDays(brewDate, s.day - 1), slot: s.slot, text: name(s), where: tank ? tankLabel(tank.name) : '' }))
    if (brightTank && filterStep) {
      rows.push({ key: 'arr', date: filterDate, slot: filterStep.slot, text: `${beerName || 'beer'} in`, where: tankLabel(brightTank.name) })
      btSteps.forEach((s, i) => rows.push({ key: 'b' + i, date: addDays(brewDate, s.day - 1), slot: s.slot, text: s.task, where: tankLabel(brightTank.name) }))
    }
    return rows
  }, [steps, brewDate, beerName, template, brightTank, filterStep, filterDate, btSteps, tank])

  async function book() {
    setSaving(true)
    setError(null)
    try {
      const b = await createBooking({ brewDate, beerName: beerName.trim(), recipeId, template, tank, brightTank, turnVolumeL: turnVolume, turnQuantity: turns, notes, pack })
      onBooked(b)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const tooBig = tank?.capacity_l != null && turnVolume * turns > Number(tank.capacity_l)
  const ready = beerName.trim() && brewDate && tank && template && !tooBig
  const packLitres = Math.round((Number(pack.pallets) || 0) * LITRES_PER_PALLET + [50, 30, 20].reduce((t, l) => t + (Number(pack[`kegs_${l}`]) || 0) * l, 0))
  const overPacked = packLitres > turnVolume * turns
  const packWhen = filterStep ? packDay(brewDate, filterStep, btSteps) : null

  return (
    <div className="sc-overlay" onClick={onClose}>
      <div className="sc-dialog" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Book a brew</h3>
          <button className="secondary" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="sc-form">
          <label>Recipe (optional)
            <select value={recipeId} onChange={(e) => pickRecipe(e.target.value)}>
              <option value="">No recipe yet</option>
              {realRecipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label>Cellar template
            <select value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="">Pick a template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>Beer name on the schedule
            <input value={beerName} onChange={(e) => setBeerName(e.target.value)} placeholder="e.g. Drift XPA" />
          </label>
          <label>Brew day
            <input type="date" value={brewDate} onChange={(e) => setBrewDate(e.target.value)} />
          </label>
          <label>Tank
            <select value={tankId} onChange={(e) => setTankId(e.target.value)}>
              <option value="">Pick a tank…</option>
              {tanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {tankLabel(t.name)}{t.capacity_l != null ? ` (${Number(t.capacity_l).toLocaleString()} L)` : ''}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div>Turns</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: 2 }}>
              {TURN_SIZES.map((v) => (
                <button key={v} className={turnVolume === v ? '' : 'secondary'} onClick={() => setTurnVolume(v)}>{v / 100}HL</button>
              ))}
              <span style={{ width: 8 }} />
              {[1, 2, 3, 4].map((n) => (
                <button key={n} className={turns === n ? '' : 'secondary'} onClick={() => setTurns(n)}>{n}</button>
              ))}
            </div>
            <div style={{ color: tooBig ? 'crimson' : 'var(--ink2)', fontSize: '0.85rem', marginTop: 4 }}>
              {(turnVolume * turns).toLocaleString()} L{tooBig ? ` is more than ${tankLabel(tank.name)} holds` : ''}
            </div>
          </div>
          {filterStep && (
            <label>Bright tank on filter day ({fmt(filterDate)})
              <select value={btChoice} onChange={(e) => setBtChoice(e.target.value)}>
                <option value="auto">{suggestedBt ? `${tankLabel(suggestedBt.name)} (suggested, free ${fmt(filterDate)} to ${fmt(btEnd)})` : 'No free bright tank found'}</option>
                {brightTanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {tankLabel(t.name)}{t.capacity_l != null ? ` (${Number(t.capacity_l).toLocaleString()} L)` : ''}
                  </option>
                ))}
                <option value="">Leave in the FV for now</option>
              </select>
            </label>
          )}
          {filterStep && btChoice === 'auto' && !suggestedBt && (
            <p className="sc-warn" style={{ margin: 0 }}>No bright tank is empty and big enough from {fmt(filterDate)} to {fmt(btEnd)}. Pick one anyway, or leave it in the FV and move it later.</p>
          )}
          <div>
            <div>Packaging plan</div>
            <div className="sc-pack-grid">
              <label>Can pallets<input type="number" inputMode="numeric" min="0" step="1" value={pack.pallets} onChange={(e) => setPack({ ...pack, pallets: e.target.value.replace(/\D/g, '') })} /></label>
              {[50, 30, 20].map((l) => (
                <label key={l}>{l} L kegs<input type="number" inputMode="numeric" min="0" value={pack[`kegs_${l}`]} onChange={(e) => setPack({ ...pack, [`kegs_${l}`]: e.target.value })} /></label>
              ))}
            </div>
            <div style={{ color: overPacked ? 'crimson' : 'var(--ink2)', fontSize: '0.85rem', marginTop: 4 }}>
              {packLitres.toLocaleString()} L packaged of {(turnVolume * turns).toLocaleString()} L brewed
              {overPacked ? ' (more than the batch)' : ''}
              {packWhen ? ` · ${fmt(packWhen.date)} ${packWhen.slot}` : ''}
            </div>
            {Number(pack.pallets) > 0 && (
              <div style={{ color: 'var(--ink2)', fontSize: '0.8rem' }}>
                {pack.pallets} pallet{Number(pack.pallets) === 1 ? '' : 's'} = {(Number(pack.pallets) * CANS_PER_PALLET).toLocaleString()} cans = {Number(pack.pallets) * CUBES_PER_PALLET} cubes
              </div>
            )}
            <div style={{ color: 'var(--ink2)', fontSize: '0.8rem' }}>Split depends on SKU and demand; enter what this batch needs.</div>
          </div>
          <label>Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        {clashes.length > 0 && (
          <p className="sc-warn">
            ⚠ {tankLabel(tank?.name)} already has {clashes.length} job{clashes.length === 1 ? '' : 's'} on the schedule between {fmt(brewDate)} and {fmt(addDays(brewDate, lastDay - 1))}
            {' '}(first: {fmt(clashes[0].entry_date)} “{clashes[0].text}”). You can still book it.
          </p>
        )}

        {preview.length > 0 && (
          <details style={{ marginTop: '0.5rem' }}>
            <summary style={{ cursor: 'pointer' }}>Cellar plan ({preview.length} jobs, to {fmt(preview[preview.length - 1].date)})</summary>
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
              {preview.map((p) => <li key={p.key}>{fmt(p.date)} {p.slot} · {p.where} · {p.text}</li>)}
              {packWhen && Object.entries(packTexts(pack)).filter(([, t]) => t).map(([lane, t]) => (
                <li key={lane}>{fmt(packWhen.date)} {packWhen.slot} · {lane === 'canning' ? 'Canning' : 'Kegging'} · {t}</li>
              ))}
            </ul>
          </details>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button onClick={book} disabled={!ready || saving} style={{ marginTop: '0.75rem' }}>{saving ? 'Booking…' : 'Book it'}</button>
      </div>
    </div>
  )
}
