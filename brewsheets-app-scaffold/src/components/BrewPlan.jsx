import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listStock, stockByBeer } from '../lib/stock'
import { loadForecast, forecastIndex, loadBrews, brewPlan, LEAD_DAYS, YIELD } from '../lib/forecast'
import { todayIso, daysBetween } from '../lib/schedule'

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
  return { plan, fc, forecast: src?.forecast, error, reload: load }
}

function urgency(r) {
  if (!r.brewL) return 'ok'
  const days = daysBetween(todayIso(), r.brewBy)
  return days <= 7 ? 'low' : days <= LEAD_DAYS ? 'mid' : 'ok'
}

const brewList = (list) => list.map((b) => `${b.tank} · ${b.beer} · ${b.litres.toLocaleString()} L · ready ${shortDate(b.ready)}`).join('\n')

export function BrewPlanTable({ plan, months, compact = false }) {
  if (!plan.length) return <p className="stock-muted">No forecast entered yet.</p>
  if (compact) {
    return (
      <table className="stock-table plan-table">
        <thead><tr><th className="stock-beer">Beer</th><th>Brew more</th><th>Brew by</th><th>Below min</th></tr></thead>
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
            <th>Min stock{PAIR_HEAD}</th>
            <th>In tank</th>
            <th>Booked brews</th>
            <th>Left at end</th>
            <th className="plan-need">Brew more</th>
            <th>Drops below min</th>
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

export const PLAN_NOTE = `Litres are packaged litres (a cube is 6 L, a keg 50 L). In tank and booked brews count from the day after they're filtered, at ${Math.round(YIELD * 100)}% of the batch (batch size from the brew cell, e.g. "8 Ball 1500L", or the FV's size). Brew more is brewhouse litres needed to stay above minimum stock through the period; brew by is ${LEAD_DAYS} days before stock would drop below minimum.`

// Compact brew plan for the schedule page: what needs brewing and by when.
export function SchedulePlanPanel() {
  const [months, setMonths] = useState(3)
  const { plan, error } = useBrewPlan(months)
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
      {plan && <BrewPlanTable plan={plan} months={months} compact />}
    </section>
  )
}
