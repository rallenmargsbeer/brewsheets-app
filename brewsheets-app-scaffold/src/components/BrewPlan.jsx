import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listStock, stockByBeer } from '../lib/stock'
import { loadForecast, forecastIndex, loadBrews, brewPlan, capacityPlan, saveSetting, LEAD_DAYS, YIELD } from '../lib/forecast'
import { todayIso, daysBetween, isScheduleEditor } from '../lib/schedule'

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
    Promise.all([stockData ? null : listStock(), loadForecast(), loadBrews()])
      .then(([stock, forecast, brews]) => setSrc({ stock, forecast, brews }))
      .catch((e) => setError(e.message))
  }
  useEffect(load, [])
  const fc = useMemo(() => (src ? forecastIndex(src.forecast) : null), [src])
  const plan = useMemo(() => {
    const stock = stockData ?? src?.stock
    if (!src || !stock) return null
    return brewPlan({ stock: stockByBeer(stock), fc, brews: src.brews, months })
  }, [src, fc, stockData, months])
  const capacity = useMemo(() => (plan ? capacityPlan({ plan, brews: src.brews, months, capacityL: src.forecast.capacityL }) : null), [plan, src, months])
  return { plan, capacity, fc, forecast: src?.forecast, error, reload: load }
}

function urgency(r) {
  if (!r.brewL) return 'ok'
  const days = daysBetween(todayIso(), r.brewBy)
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
              <td className="stock-beer">{r.beer}</td>
              <td><span className={`stock-pill ${urgency(r)}`}>{r.brewL ? litres(r.brewL) : 'covered'}</span></td>
              <td>{r.brewL ? (r.brewBy === todayIso() ? 'now' : shortDate(r.brewBy)) : ''}</td>
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
              <td className="stock-beer">{r.beer}</td>
              <td><Pair c={r.stock.cubes} k={r.stock.kegs} /></td>
              <td><Pair c={r.demandC} k={r.demandK} /></td>
              <td><Pair c={r.minC} k={r.minK} /></td>
              <td title={brewList(r.inTank)}>{r.inTank.length ? litres(r.inTankL) : ''}</td>
              <td title={brewList(r.booked)}>{r.booked.length ? `${litres(r.bookedL)} (${r.booked.length})` : ''}</td>
              <td className={r.endL < r.minL ? 'stock-neg' : ''}>{litres(Math.max(0, r.endL))}</td>
              <td className="plan-need"><span className={`stock-pill ${urgency(r)}`}>{r.brewL ? litres(r.brewL) : 'covered'}</span></td>
              <td>{r.runsOut ? <span title={`Runs out ${shortDate(r.runsOut)}`}>{shortDate(r.belowMin)} <span className="stock-neg">· out {shortDate(r.runsOut)}</span></span> : shortDate(r.belowMin)}</td>
              <td><strong>{r.brewL ? (r.brewBy === todayIso() ? 'Now' : shortDate(r.brewBy)) : ''}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const planNote = (weeks) => `Litres are packaged litres (a cube is 6 L, a keg 50 L). Hold ${weeks} wks = the next ${weeks} weeks of forecast sales, the stock to keep on hand; it rolls forward day by day, so it rises ahead of busy months. In tank and booked brews count from the day after they're filtered, at ${Math.round(YIELD * 100)}% of the batch (batch size from the brew cell, e.g. "8 Ball 1500L", or the FV's size). Brew more is brewhouse litres needed to keep ${weeks} weeks of stock through the period; brew by is ${LEAD_DAYS} days before stock would drop below that.`

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
      {capacity && <CapacityTable rows={capacity} compact />}
    </section>
  )
}

const fmtMonth = (m) => new Date(`${m}T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

// Brewhouse litres per month: booked brews plus what the plan says to brew, against capacity.
export function CapacityTable({ rows, compact = false }) {
  const over = rows.filter((r) => r.spare < 0)
  return (
    <div className={compact ? 'cap-compact' : ''}>
      <table className="stock-table cap-table">
        <thead>
          <tr>
            <th className="stock-beer">Month</th>
            {!compact && <th>Booked</th>}
            {!compact && <th>Still to brew</th>}
            <th className="cap-bar-h">Brewhouse load</th>
            <th>{compact ? 'Spare' : 'Spare / over'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td className="stock-beer">{fmtMonth(r.month)}</td>
              {!compact && <td>{litres(r.booked)}</td>}
              {!compact && <td>{litres(r.needed)}</td>}
              <td className="cap-bar-h">
                <div className={`cap-bar ${r.spare < 0 ? 'over' : r.spare < r.capacity * 0.1 ? 'tight' : ''}`} title={`${Math.round(r.total).toLocaleString()} of ${r.capacity.toLocaleString()} L`}>
                  <div className="cap-booked" style={{ width: `${Math.min(100, (r.booked / r.capacity) * 100)}%` }} />
                  <div className="cap-needed" style={{ left: `${Math.min(100, (r.booked / r.capacity) * 100)}%`, width: `${Math.max(0, Math.min(100, (r.total / r.capacity) * 100) - Math.min(100, (r.booked / r.capacity) * 100))}%` }} />
                  <span>{Math.round((r.total / r.capacity) * 100)}%</span>
                </div>
              </td>
              <td className={r.spare < 0 ? 'stock-neg' : ''}><strong>{r.spare < 0 ? `over ${litres(-r.spare)}` : litres(r.spare)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
      {over.length > 0 && (
        <p className="cap-warn">
          Over the brewhouse limit in {over.map((r) => fmtMonth(r.month)).join(' and ')}. Brew some of it earlier, in a month with spare
          capacity, or accept dropping under the stock goal.
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
