import { useEffect, useMemo, useState } from 'react'
import { tankLabel } from '../lib/tanks'
import { addDays, todayIso, stepsForTank, planSteps, suggestBrightTank, btFreeAfter, emptyingDays, listScheduleEntries, createBooking, packTexts, defaultTurnSlots, TURN_SLOTS, BREW_LANES, LANE_LABEL, isWeekend, nextWorkday, saveBeerColour, freePackLane } from '../lib/schedule'
import { beerStyle, savedBeerStyle } from '../lib/beerColours'
import { LITRES_PER_PALLET, CANS_PER_PALLET, CUBES_PER_PALLET } from '../lib/packaging'
import { loadForecast, forecastIndex, suggestPackSplit, YIELD } from '../lib/forecast'
import { listStock, stockByBeer } from '../lib/stock'

const TURN_SIZES = [1000, 1500, 2500]
const fmt = (isoDate) => new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })

export default function BookBrewDialog({ tanks, brightTanks = [], recipes, templates, initial, onClose, onBooked }) {
  const realRecipes = recipes.filter((r) => !r.name.startsWith('Historical import'))
  const [recipeId, setRecipeId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [beerName, setBeerName] = useState('')
  const [brewDate, setBrewDate] = useState(initial?.date ?? todayIso())
  const [tankId, setTankId] = useState(initial?.tankId ?? '')
  const [turnVolume, setTurnVolume] = useState(2500)
  const [turns, setTurns] = useState(4)
  const [notes, setNotes] = useState('')
  const [pack, setPack] = useState({ pallets: '', kegs_50: '', kegs_30: '', kegs_20: '' })
  const [windowEntries, setWindowEntries] = useState([])
  const [colours, setColours] = useState(null) // { bg, fg } for a beer with no colours yet
  const [picked, setPicked] = useState(null) // brewhouse turn slots picked by hand; null = suggested
  const [btChoice, setBtChoice] = useState('auto') // 'auto' = use the suggestion, '' = none, or a tank id
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Forecast and stock, for a suggested cubes / kegs split.
  const [demand, setDemand] = useState(null)
  useEffect(() => {
    Promise.all([loadForecast(), listStock()])
      .then(([f, st]) => setDemand({ fc: forecastIndex(f), stock: stockByBeer(st), weeks: f.coverWeeks }))
      .catch(() => setDemand(null))
  }, [])

  const template = templates.find((t) => t.id === templateId)
  const tank = tanks.find((t) => t.id === tankId)
  const steps = template && tank ? stepsForTank(template, tank) : []
  const lastDay = steps.reduce((m, s) => Math.max(m, s.day), 1)

  // Picking a recipe fills in its linked template and name; picking a template fills the name.
  function pickRecipe(id) {
    setRecipeId(id)
    const r = realRecipes.find((x) => x.id === id)
    if (r?.cellar_template_id) setTemplateId(r.cellar_template_id)
    // The schedule uses the template's short name (e.g. In The Pines is "ITP").
    if (r) setBeerName(templates.find((t) => t.id === r.cellar_template_id)?.name ?? r.name)
  }
  function pickTemplate(id) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t && !beerName) setBeerName(t.name)
  }

  // The schedule around this brew: tank clashes, brewhouse slots already taken, and bright
  // tanks (a week either side, for emptying and weekend moves).
  useEffect(() => {
    if (!brewDate) return
    const until = addDays(brewDate, lastDay + 10)
    listScheduleEntries(addDays(brewDate, -7), until)
      .then(setWindowEntries)
      .catch(() => setWindowEntries([]))
  }, [brewDate, lastDay])
  const clashes = useMemo(() => {
    const until = addDays(brewDate, lastDay - 1)
    return windowEntries.filter((r) => r.tank_id === tankId && r.entry_date >= brewDate && r.entry_date <= until).sort((a, b) => a.entry_date.localeCompare(b.entry_date))
  }, [windowEntries, tankId, brewDate, lastDay])

  // Brewhouse turns: which slots each goes in. Suggested = the first free ones from the brew
  // day (or from the cell double-clicked); the brewer can pick others.
  const takenTurns = useMemo(() => {
    const m = new Map()
    for (const e of windowEntries) if (BREW_LANES.includes(e.lane) && e.text?.trim()) m.set(`${e.entry_date}|${e.slot}|${e.lane}`, e.text)
    return m
  }, [windowEntries])
  const suggestedTurns = useMemo(() => {
    const free = defaultTurnSlots(brewDate, 40, new Set(takenTurns.keys()))
    const first = initial?.firstTurn && initial.firstTurn.date === brewDate ? free.findIndex((t) => t.date === initial.firstTurn.date && t.slot === initial.firstTurn.slot && t.lane === initial.firstTurn.lane) : -1
    return free.slice(Math.max(0, first), Math.max(0, first) + turns)
  }, [brewDate, turns, takenTurns, initial])
  useEffect(() => setPicked(null), [brewDate, turns])
  const turnSlots = picked ?? suggestedTurns
  const turnKey = (t) => `${t.date}|${t.slot}|${t.lane}`
  const slotDays = useMemo(() => {
    const days = [brewDate]
    while (days.length < 3) days.push(nextWorkday(addDays(days[days.length - 1], 1)))
    for (const t of turnSlots) if (!days.includes(t.date)) days.push(t.date)
    return days.sort()
  }, [brewDate, turnSlots])
  function toggleTurn(t) {
    const cur = turnSlots
    const k = turnKey(t)
    if (cur.some((x) => turnKey(x) === k)) setPicked(cur.filter((x) => turnKey(x) !== k))
    else if (cur.length < turns) setPicked([...cur, t].sort((a, b) => turnKey(a).localeCompare(turnKey(b))))
  }

  // Filter day (never a weekend) moves the beer to a bright tank; suggest one that's free
  // from then until it's packaged and the tank is emptied.
  const plan = planSteps(brewDate, steps)
  const filterStep = plan.filter
  const filterDate = plan.filter?.date ?? null
  const rawFilterDate = plan.filter ? addDays(brewDate, plan.filter.day - 1) : null
  const packDate = plan.pack?.date ?? null
  const suggestedBt = filterStep ? suggestBrightTank(brightTanks, windowEntries, filterDate, packDate, turnVolume * turns) : null
  const brightTank = btChoice === 'auto' ? suggestedBt : brightTanks.find((t) => t.id === btChoice) ?? null

  // What goes where: FV jobs up to Filter, then (if a bright tank is set) the beer's arrival and BT jobs.
  const preview = useMemo(() => {
    const name = (s) => (s.task === template?.name ? beerName || s.task : s.task)
    const inFv = brightTank && plan.filter ? plan.fv : [...plan.fv, ...plan.afterFilter]
    const rows = inFv.map((s, i) => ({ key: 'f' + i, date: s.date, slot: s.slot, text: name(s), where: tank ? tankLabel(tank.name) : '' }))
    if (brightTank && plan.filter) {
      rows.push({ key: 'arr', date: plan.filter.date, slot: plan.filter.slot, text: `${beerName || 'beer'} in`, where: tankLabel(brightTank.name) })
      plan.bt.forEach((s, i) => rows.push({ key: 'b' + i, date: s.date, slot: s.slot, text: s.task, where: tankLabel(brightTank.name) }))
    }
    return rows
  }, [plan, beerName, template, brightTank, tank])

  // A specialty / new beer has no colours yet: pick them here, saved with the booking.
  const newBeer = beerName.trim() && !savedBeerStyle(beerName.trim())
  const shown = colours ?? beerStyle(beerName.trim()) ?? { bg: '#ffffff', fg: '#1d2421' }

  async function book() {
    setSaving(true)
    setError(null)
    try {
      if (newBeer) await saveBeerColour(beerName.trim(), shown.bg, shown.fg)
      const b = await createBooking({ brewDate, beerName: beerName.trim(), recipeId, template, tank, brightTank, turnVolumeL: turnVolume, turnQuantity: turns, turnSlots, notes, pack })
      onBooked(b)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const tooBig = tank?.capacity_l != null && turnVolume * turns > Number(tank.capacity_l)
  const ready = beerName.trim() && brewDate && tank && template && !tooBig && turnSlots.length === turns
  const packLitres = Math.round((Number(pack.pallets) || 0) * LITRES_PER_PALLET + [50, 30, 20].reduce((t, l) => t + (Number(pack[`kegs_${l}`]) || 0) * l, 0))
  const overPacked = packLitres > turnVolume * turns
  const packWhen = plan.pack
  const recipeName = realRecipes.find((r) => r.id === recipeId)?.name
  const split = useMemo(() => {
    if (!demand) return null
    const packDate = packWhen?.date ?? addDays(brewDate, 21)
    const packagedL = turnVolume * turns * YIELD
    const args = { fc: demand.fc, stock: demand.stock, packDate, packagedL }
    // The forecast may name the beer as the recipe does ("Pale Ale") or as the schedule ("Pale").
    const sp = suggestPackSplit({ ...args, beer: beerName }) ?? (recipeName ? suggestPackSplit({ ...args, beer: recipeName }) : null)
    if (!sp) return null
    const pallets = Math.floor(sp.cubesL / LITRES_PER_PALLET + 0.25) // whole pallets, rounding down unless nearly full
    const kegs = Math.max(0, Math.floor((packagedL - pallets * LITRES_PER_PALLET) / 50))
    return { ...sp, pallets, kegs, packagedL, packDate }
  }, [demand, beerName, recipeName, brewDate, turnVolume, turns, packWhen?.date])

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
          {newBeer && (
            <div className="sc-newbeer">
              <div><strong>New beer: pick its colours</strong> <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>used for {beerName.trim()} everywhere in the app</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Cell <input type="color" value={shown.bg} onChange={(e) => setColours({ ...shown, bg: e.target.value })} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Font <input type="color" value={shown.fg} onChange={(e) => setColours({ ...shown, fg: e.target.value })} /></label>
                <span className="sc-chip" style={{ background: shown.bg, color: shown.fg }}>{beerName.trim()}</span>
              </div>
            </div>
          )}
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
          <div>
            <div>Brewhouse slots <span style={{ color: 'var(--ink2)', fontSize: '0.85rem' }}>· {turnSlots.length} of {turns} picked{picked ? '' : ' (suggested: the first free ones)'}</span></div>
            <table className="turn-picker">
              <thead>
                <tr><th></th>{TURN_SLOTS.map(([slot, lane]) => <th key={slot + lane}>{slot} {LANE_LABEL[lane]}</th>)}</tr>
              </thead>
              <tbody>
                {slotDays.map((d) => (
                  <tr key={d} className={isWeekend(d) ? 'turn-wkend' : ''}>
                    <th>{fmt(d)}</th>
                    {TURN_SLOTS.map(([slot, lane]) => {
                      const t = { date: d, slot, lane }
                      const k = turnKey(t)
                      const taken = takenTurns.get(k)
                      const n = turnSlots.findIndex((x) => turnKey(x) === k)
                      return (
                        <td key={k}>
                          {taken ? (
                            <span className="turn-taken" title="Already booked">{taken}</span>
                          ) : (
                            <button type="button" className={n >= 0 ? 'turn-on' : 'secondary'} onClick={() => toggleTurn(t)} disabled={n < 0 && turnSlots.length >= turns}>
                              {n >= 0 ? `Turn ${n + 1}` : '+'}
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {turnSlots.length < turns && <div className="sc-warn" style={{ margin: '4px 0 0' }}>Pick {turns - turnSlots.length} more slot{turns - turnSlots.length === 1 ? '' : 's'}.</div>}
            {isWeekend(brewDate) && <div className="sc-warn" style={{ margin: '4px 0 0' }}>{fmt(brewDate)} is a weekend.</div>}
          </div>
          {filterStep && (
            <label>Bright tank on filter day ({fmt(filterDate)}{rawFilterDate !== filterDate ? `, moved from ${fmt(rawFilterDate)} as we don't work weekends` : ''})
              <select value={btChoice} onChange={(e) => setBtChoice(e.target.value)}>
                <option value="auto">{suggestedBt ? `${tankLabel(suggestedBt.name)} (suggested, free ${fmt(filterDate)} to ${fmt(btFreeAfter(suggestedBt, packDate))}, ${emptyingDays(suggestedBt)} day${emptyingDays(suggestedBt) > 1 ? 's' : ''} to empty)` : 'No free bright tank found'}</option>
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
            <p className="sc-warn" style={{ margin: 0 }}>No bright tank is empty and big enough from {fmt(filterDate)} until it's packaged ({fmt(packDate)}) and emptied. Pick one anyway, or leave it in the FV and move it later.</p>
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
            {packWhen && Object.entries(packTexts(pack)).filter(([kind, t]) => t && !freePackLane(kind, packWhen.date, packWhen.slot, windowEntries)).map(([kind]) => (
              <div key={kind} className="sc-warn" style={{ margin: '4px 0 0' }}>Both {kind} columns are already booked {fmt(packWhen.date)} {packWhen.slot}. It will share the first one; move it after booking.</div>
            ))}
            {Number(pack.pallets) > 0 && (
              <div style={{ color: 'var(--ink2)', fontSize: '0.8rem' }}>
                {pack.pallets} pallet{Number(pack.pallets) === 1 ? '' : 's'} = {(Number(pack.pallets) * CANS_PER_PALLET).toLocaleString()} cans = {Number(pack.pallets) * CUBES_PER_PALLET} cubes
              </div>
            )}
            {split ? (
              <div className="sc-split">
                <div>
                  <strong>Suggested from the forecast:</strong> {split.pallets} pallet{split.pallets === 1 ? '' : 's'} ({split.pallets * CUBES_PER_PALLET} cubes) and {split.kegs} × 50 L kegs
                  <span className="sc-split-why">
                    {' '}· {Math.round(split.cubeShare * 100)}% cubes / {100 - Math.round(split.cubeShare * 100)}% kegs of about {Math.round(split.packagedL).toLocaleString()} L packaged
                    {split.byNeed
                      ? `. On ${fmt(split.packDate)} you'd be short ${Math.round(Math.max(0, split.cube.goal - split.cube.atPack))} cubes and ${Math.round(Math.max(0, split.keg.goal - split.keg.atPack))} kegs of ${demand.weeks} weeks' stock.`
                      : `. Stock covers ${demand.weeks} weeks either way, so this follows the forecast mix.`}
                  </span>
                </div>
                <button type="button" className="secondary" onClick={() => setPack({ ...pack, pallets: String(split.pallets), kegs_50: String(split.kegs) })}>Use suggestion</button>
              </div>
            ) : (
              <div style={{ color: 'var(--ink2)', fontSize: '0.8rem' }}>Split depends on SKU and demand; enter what this batch needs.{beerName && demand ? ' (No forecast for this beer yet.)' : ''}</div>
            )}
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
              {packWhen && Object.entries(packTexts(pack)).filter(([, t]) => t).map(([kind, t]) => {
                const lane = freePackLane(kind, packWhen.date, packWhen.slot, windowEntries)
                return <li key={kind}>{fmt(packWhen.date)} {packWhen.slot} · {lane ? `${LANE_LABEL[lane]} column ${lane.slice(-1)}` : `${kind === 'canning' ? 'Canning' : 'Kegging'} (both columns already booked)`} · {t}</li>
              })}
            </ul>
          </details>
        )}

        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button onClick={book} disabled={!ready || saving} style={{ marginTop: '0.75rem' }}>{saving ? 'Booking…' : 'Book it'}</button>
      </div>
    </div>
  )
}
