import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BeerDot from './BeerDot.jsx'
import { listStock, stockByBeer } from '../lib/stock'
import { loadForecast, forecastIndex, loadPlanning, brewPlan, levelBrewing, applyLevelling, brewsToBook, setBeerProfiles, profileOf, saveSetting, LOOKAHEAD_MONTHS, LEAD_DAYS, YIELD, PRIORITY, TURNS_PER_DAY } from '../lib/forecast'
import { loadSkuEfficiency } from '../lib/efficiency'
import { beerMatch } from '../lib/incoming'
import { useAuth } from '../auth'
import { todayIso, daysBetween, isScheduleEditor, addDays as addDaysIso } from '../lib/schedule'

const litres = (n) => (n >= 50 ? `${(Math.round(n / 100) * 100).toLocaleString()} L` : '0 L')
const units = (n) => Math.round(n).toLocaleString()
// Cubes and kegs side by side, each in its own colour.
const Pair = ({ c, k }) => <><span className="u-cube">{units(c)}</span><span className="u-keg">{units(k)}</span></>
const PAIR_HEAD = <><br /><span className="u-cube-h">cubes</span> <span className="u-keg-h">kegs</span></>
export const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '')

// Stock, forecast and the schedule's brews, loaded together; the plan is worked out for `months`.
// Pass `stockData` (from listStock) when the page already has it.
export function useBrewPlan(months, stockData = null) {
  const [src, setSrc] = useState(null)
  const [error, setError] = useState(null)
  const load = () => {
    setError(null)
    Promise.all([stockData ? null : listStock(), loadForecast(), loadPlanning(), loadSkuEfficiency().catch(() => () => null)])
      .then(([stock, forecast, planning, effFor]) => {
        // Each beer's real efficiency (2+ finished batches) and FV days from its cellar template.
        setBeerProfiles({
          yieldOf: (beer) => { const e = effFor(beer); return e && e.n >= 2 ? e.overall : null },
          fvDaysOf: (beer) => planning.fvDaysOf(beer),
        })
        const brews = planning.brews.map((b) => ({ ...b, packaged: b.litres * profileOf(b.beer).yield }))
        setSrc({ stock, forecast, brews, planning })
      })
      .catch((e) => setError(e.message))
  }
  useEffect(load, [])
  const fc = useMemo(() => (src ? forecastIndex(src.forecast) : null), [src])
  const plan = useMemo(() => {
    const stock = stockData ?? src?.stock
    if (!src || !stock) return null
    const byBeer = stockByBeer(stock)
    // The brewhouse plan looks a year ahead so busy months pull brewing forward.
    const long = brewPlan({ stock: byBeer, fc, brews: src.brews, months: LOOKAHEAD_MONTHS })
    const levelled = levelBrewing({ plan: long, brews: src.brews, capacityL: src.forecast.capacityL })
    const rows = applyLevelling(brewPlan({ stock: byBeer, fc, brews: src.brews, months }), levelled, { months })
    const belowMin = new Map(long.map((r) => [beerMatch(r.beer), r.belowMin]))
    const { fvs, busy, turns, fvDaysOf } = src.planning
    const toBook = brewsToBook({ stock: byBeer, fc, brews: src.brews, fvs, busy, turns, fvDaysOf, belowMin })
    return { rows, levelled, toBook }
  }, [src, fc, stockData, months])
  return { plan: plan?.rows ?? null, capacity: plan?.levelled ?? null, toBook: plan?.toBook ?? null, fc, forecast: src?.forecast, error, reload: load }
}

function urgency(r) {
  if (r.brewL < 50) return 'ok'
  const days = daysBetween(todayIso(), r.brewBy)
  if (!r.brewhouse) return days <= 2 ? 'low' : days <= 7 ? 'mid' : 'ok'
  return days <= 7 ? 'low' : days <= LEAD_DAYS ? 'mid' : 'ok'
}

const brewList = (list) => list.map((b) => `${b.tank} · ${b.beer} · ${b.litres.toLocaleString()} L · ready ${shortDate(b.ready)}`).join('\n')

export function BrewPlanTable({ plan, months, weeks, compact = false }) {
  if (!plan.length) return <p className="stock-muted">No forecast entered yet.</p>
  if (compact) {
    return (
      <table className="stock-table plan-table">
        <thead><tr><th className="stock-beer">Beer</th><th>Brew more</th><th>Brew by</th><th>Below {weeks} wks</th></tr></thead>
        <tbody>
          {plan.map((r) => (
            <tr key={r.beer}>
              <td className="stock-beer"><BeerDot name={r.beer} />{r.beer}</td>
              <td><span className={`stock-pill ${urgency(r)}`}>{r.brewL >= 50 ? litres(r.brewL) : 'covered'}</span></td>
              <td>{r.brewL >= 50 ? (r.brewBy <= todayIso() ? 'now' : shortDate(r.brewBy)) : ''}</td>
              <td className="stock-muted">{shortDate(r.belowMin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <div className="stock-scroll">
      <table className="stock-table plan-table">
        <thead>
          <tr>
            <th className="stock-beer">Beer</th>
            <th>Stock now{PAIR_HEAD}</th>
            <th>Forecast next {months} mo{PAIR_HEAD}</th>
            <th>Hold {weeks} wks{PAIR_HEAD}</th>
            <th>In tank</th>
            <th>Booked brews</th>
            <th>Left at end</th>
            <th className="plan-need">Brew more</th>
            <th>Drops below {weeks} wks</th>
            <th>Brew by</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((r) => (
            <tr key={r.beer}>
              <td className="stock-beer"><BeerDot name={r.beer} />{r.beer}</td>
              <td><Pair c={r.stock.cubes} k={r.stock.kegs} /></td>
              <td><Pair c={r.demandC} k={r.demandK} /></td>
              <td><Pair c={r.minC} k={r.minK} /></td>
              <td title={brewList(r.inTank)}>{r.inTank.length ? litres(r.inTankL) : ''}</td>
              <td title={brewList(r.booked)}>{r.booked.length ? `${litres(r.bookedL)} (${r.booked.length})` : ''}</td>
              <td className={r.endL < r.minL ? 'stock-neg' : ''}>{litres(Math.max(0, r.endL))}</td>
              <td className="plan-need">
                <span className={`stock-pill ${urgency(r)}`}>{r.brewL >= 50 ? litres(r.brewL) : 'covered'}</span>
                {r.earlyL >= 50 && <div className="plan-early">incl. {litres(r.earlyL)} for later months</div>}
                {r.shortL >= 50 && <div className="plan-short">{litres(r.shortL)} late: dips under the goal</div>}
                {!r.brewhouse && r.brewL >= 50 && <div className="plan-early">mixed in a BT, not brewhouse</div>}
              </td>
              <td>{r.runsOut ? <span title={`Runs out ${shortDate(r.runsOut)}`}>{shortDate(r.belowMin)} <span className="stock-neg">· out {shortDate(r.runsOut)}</span></span> : shortDate(r.belowMin)}</td>
              <td><strong>{r.brewL >= 50 ? (r.brewBy <= todayIso() ? 'Now' : shortDate(r.brewBy)) : ''}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The plan as separate brews to book, each with the date to brew it by.
export function BrewsToBookTable({ list, months, weeks }) {
  const { isAdmin } = useAuth()
  const end = addDaysIso(todayIso(), Math.round(months * 30.44))
  const rows = list.filter((b) => b.bookOn < end)
  if (!rows.length) return <p className="stock-muted" style={{ padding: '0.5rem 0.9rem' }}>Nothing more to brew in this period: stock, tanks and booked brews cover the goal.</p>
  const total = rows.filter((b) => b.brewhouse).reduce((a, b) => a + b.size, 0)
  const today = todayIso()
  const note = (b) => {
    if (b.noRoom) return <span className="plan-short">no FV free for this in the plan window</span>
    if (b.late) {
      return (
        <>
          <span className="plan-short">catching up: first free {b.tank ? `FV${b.tank.name}` : 'FV'} slot; stock is under the {weeks}-week goal until it's ready, about {shortDate(b.ready ?? addDaysIso(b.bookOn, b.leadDays))}</span>
          {b.swap && (
            <div className="plan-swap">
              Or swap: brew this instead of {b.swap.beer} ({b.swap.tank}, {shortDate(b.swap.start)}) and move {b.swap.beer} to {shortDate(b.bookOn)}.
              {b.swap.until ? ` ${b.swap.beer} stays above its goal until ${shortDate(b.swap.until)}.` : ` ${b.swap.beer} stays above its goal.`}
            </div>
          )}
        </>
      )
    }
    if (b.early) return <span className="plan-early">early: no FV or brewhouse slot nearer {shortDate(b.brewBy)}</span>
    return <span className="stock-muted">for stock from {shortDate(b.neededFor)}</span>
  }
  return (
    <div className="stock-scroll">
      <table className="stock-table plan-table book-table">
        <thead><tr><th>Brew day</th><th className="stock-beer">Beer</th><th>Batch</th><th>FV</th><th></th>{isAdmin && <th></th>}</tr></thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={i}>
              <td><strong>{shortDate(b.bookOn < today ? today : b.bookOn)}</strong></td>
              <td className="stock-beer"><BeerDot name={b.beer} />{b.beer}</td>
              <td>{b.size.toLocaleString()} L{b.brewhouse ? '' : ' (mixed in a BT)'}</td>
              <td>{b.tank ? `FV${b.tank.name}` : ''}</td>
              <td>{note(b)}</td>
              {isAdmin && (
                <td>
                  {!b.noRoom && (
                    <Link to={`/schedule?${new URLSearchParams({ book: '1', beer: b.beer, date: b.bookOn < today ? today : b.bookOn, litres: String(b.size), ...(b.tank ? { tank: b.tank.id } : {}) })}`}>
                      <button className="secondary">Book</button>
                    </Link>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="stock-muted" style={{ fontSize: '0.8rem', padding: '0 0.9rem' }}>
        {rows.length} brew{rows.length === 1 ? '' : 's'}, {total.toLocaleString()} L through the brewhouse, on top of what's booked. Each brew is placed on the schedule as it stands: a weekday with brewhouse turns free (at most {TURNS_PER_DAY} a day, so a 10,000 L batch takes two days) and an FV big enough that's empty from brew day until its Filter day (from the cellar template). It goes on the latest such day before stock would drop under the goal, highest priority beers first; when there's no room in time it takes the first free slot, with a suggested swap where a lower priority booked brew can wait. Packaged litres use each beer's own overall efficiency from Unleashed (80% where there are fewer than 2 finished batches).
      </p>
    </div>
  )
}

export const planNote = (weeks) => `Litres are packaged litres (a cube is 6 L, a keg 50 L). Hold ${weeks} wks = the next ${weeks} weeks of forecast sales, the stock to keep on hand; it rolls forward day by day, so it rises ahead of busy months. In tank and booked brews count from the day after they're filtered, at each beer's own overall efficiency from Unleashed (${Math.round(YIELD * 100)}% where there are fewer than 2 finished batches) (batch size from the brew cell, e.g. "8 Ball 1500L", or the FV's size). Brew more is brewhouse litres to brew in the period to keep ${weeks} weeks of stock, including beer that has to be brewed early because a later month needs more than the brewhouse limit (the plan looks ${LOOKAHEAD_MONTHS} months ahead); brew by is the beer's FV days (from its cellar template) plus a day before stock would drop below the goal, or sooner when brewing early. When the brewhouse can't keep up, ${PRIORITY.join(', ')} get brewed first, in that order. Megsy is mixed in a bright tank in a day, so it doesn't count against the brewhouse limit or get brewed early.`

// Compact brew plan for the schedule page: what needs brewing and by when.
export function SchedulePlanPanel() {
  const [months, setMonths] = useState(3)
  const { plan, capacity, fc, error } = useBrewPlan(months)
  return (
    <section className="stock-card stock-plan plan-sched">
      <h2>
        Brew plan
        <span>
          next{' '}
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Plan period">
            {[1, 2, 3, 4, 6].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
          </select>
          {' '}· <Link to="/forecast" style={{ color: '#fff' }}>details</Link>
        </span>
      </h2>
      {error && <p style={{ color: '#b00020', padding: '0 0.9rem' }}>{error}</p>}
      {!plan && !error && <p className="stock-muted" style={{ padding: '0.5rem 0.9rem' }}>Loading…</p>}
      {plan && <BrewPlanTable plan={plan} months={months} weeks={fc.coverWeeks} compact />}
      {capacity && <CapacityTable plan={capacity} compact />}
    </section>
  )
}

const fmtMonth = (m) => new Date(`${m}T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

// Brewhouse litres per month, levelled to the limit: booked brews, plus what the plan brews
// (including beer brewed early because a later month needs more than the brewhouse can do).
export function CapacityTable({ plan, compact = false }) {
  const rows = compact ? plan.months.slice(0, 3) : plan.months
  const pct = (x, r) => Math.min(100, (x / r.capacity) * 100)
  const peaks = plan.months.filter((r) => r.movedEarlier >= 50)
  return (
    <div className={compact ? 'cap-compact' : ''}>
      <table className="stock-table cap-table">
        <thead>
          <tr>
            <th className="stock-beer">Month</th>
            {!compact && <th>Booked</th>}
            {!compact && <th>Needed that month</th>}
            <th>{compact ? 'To brew' : 'Plan to brew'}</th>
            <th className="cap-bar-h">Brewhouse load</th>
            {!compact && <th>Spare</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td className="stock-beer">{fmtMonth(r.month)}</td>
              {!compact && <td>{litres(r.booked)}</td>}
              {!compact && <td className={r.movedEarlier >= 50 || r.tooLate >= 50 ? 'stock-neg' : ''}>{litres(r.needed)}</td>}
              <td>
                {litres(r.planned)}
                {r.early >= 50 && !(r.tooLate >= 50) && <div className="plan-early">{litres(r.early)} early</div>}
                {r.movedEarlier >= 50 && <div className="plan-early">{litres(r.movedEarlier)} brewed earlier</div>}
                {r.tooLate >= 50 && <div className="plan-short">{litres(r.tooLate)} too late to brew</div>}
                {r.catchUp >= 50 && <div className="plan-short">{litres(r.catchUp)} catch-up</div>}
              </td>
              <td className="cap-bar-h">
                <div className={`cap-bar ${r.booked > r.capacity ? 'over' : r.spare < r.capacity * 0.1 ? 'tight' : ''}`} title={`${Math.round(r.total).toLocaleString()} of ${Math.round(r.capacity).toLocaleString()} L`}>
                  <div className="cap-booked" style={{ width: `${pct(r.booked, r)}%` }} />
                  <div className="cap-needed" style={{ left: `${pct(r.booked, r)}%`, width: `${Math.max(0, pct(r.total, r) - pct(r.booked, r))}%` }} />
                  <span>{Math.round((r.total / r.capacity) * 100)}%</span>
                </div>
              </td>
              {!compact && <td>{litres(Math.max(0, r.spare))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {plan.short >= 50 && (
        <p className="cap-warn">
          {litres(plan.short)} can't be brewed in time, even running the brewhouse at its limit from now. It's caught up in the next months with spare capacity (shown as catch-up), lowest priority beers last, but stock will dip under the goal until then.
          {plan.never >= 50 && ` ${litres(plan.never)} doesn't fit at all in the next ${plan.months.length} months.`}
        </p>
      )}
      {plan.short < 50 && peaks.length > 0 && (
        <p className="cap-note">
          {peaks.map((r) => fmtMonth(r.month)).join(', ')} need{peaks.length === 1 ? 's' : ''} more than the brewhouse can brew, so {litres(peaks.reduce((a, r) => a + r.movedEarlier, 0))} is planned earlier and held as stock.
        </p>
      )}
    </div>
  )
}

// The two shared planning settings: weeks of stock to hold and the brewhouse's monthly limit.
export function PlanSettings({ forecast, onSaved }) {
  const [editor, setEditor] = useState(false)
  const [vals, setVals] = useState({ coverWeeks: forecast.coverWeeks, capacityL: forecast.capacityL })
  const [msg, setMsg] = useState(null)
  useEffect(() => { isScheduleEditor().then(setEditor) }, [])
  useEffect(() => { setVals({ coverWeeks: forecast.coverWeeks, capacityL: forecast.capacityL }) }, [forecast])
  async function commit(name) {
    const v = Number(vals[name])
    if (!(v > 0) || v === forecast[name]) return setVals({ ...vals, [name]: forecast[name] })
    try { await saveSetting(name, v); setMsg(null); onSaved() } catch (e) { setMsg(e.message) }
  }
  const field = (name, width) => editor ? (
    <input type="number" min="1" value={vals[name]} style={{ width }} onChange={(e) => setVals({ ...vals, [name]: e.target.value })} onBlur={() => commit(name)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  ) : <strong>{Number(vals[name]).toLocaleString()}</strong>
  return (
    <>
      <label>Hold {field('coverWeeks', '3.5rem')} weeks of stock</label>
      <label>Brewhouse limit {field('capacityL', '6.5rem')} L a month</label>
      {msg && <span style={{ color: '#b00020' }}>{msg}</span>}
    </>
  )
}
