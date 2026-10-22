import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBrewPlan, BrewPlanTable, CapacityTable, PlanSettings, planNote } from '../components/BrewPlan'
import { saveForecast, addMonths, monthOf } from '../lib/forecast'
import { isScheduleEditor, todayIso } from '../lib/schedule'
import BeerDot from '../components/BeerDot.jsx'
import HopForecast from '../components/HopForecast.jsx'
import { useAuth } from '../auth.jsx'

const fmtMonth = (m) => new Date(`${m}T00:00:00`).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
const FORMATS = [['cube', 'Cubes'], ['keg', 'Kegs (50 L)']]

export default function ForecastPage() {
  const [params, setParams] = useSearchParams()
  const { isAdmin } = useAuth()
  const tab = params.get('tab') === 'demand' ? 'demand' : params.get('tab') === 'hops' && isAdmin ? 'hops' : 'plan'
  const [months, setMonths] = useState(3)
  const { plan, capacity, fc, forecast, error, reload } = useBrewPlan(months)
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Forecast</h1>
        <div className="calc-tabs">
          <button className={tab === 'plan' ? '' : 'secondary'} onClick={() => setParams({})}>Brew plan</button>
          <button className={tab === 'demand' ? '' : 'secondary'} onClick={() => setParams({ tab: 'demand' })}>Forecast demand</button>
          {isAdmin && <button className={tab === 'hops' ? '' : 'secondary'} onClick={() => setParams({ tab: 'hops' })}>Hop forecast</button>}
        </div>
      </div>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {tab === 'hops' && <HopForecast />}
      {!forecast && !error && tab !== 'hops' && <p>Loading…</p>}
      {tab === 'plan' && plan && (
        <>
          <div className="stock-controls">
            <label>Plan for the next
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {[1, 2, 3, 4, 6].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <PlanSettings forecast={forecast} onSaved={reload} />
          </div>
          <section className="stock-card stock-plan">
            <h2>What to brew <span>stock + tanks + booked brews against forecast</span></h2>
            <BrewPlanTable plan={plan} months={months} weeks={fc.coverWeeks} />
          </section>
          <section className="stock-card stock-plan">
            <h2>Brewhouse capacity <span>brewing by month within {forecast.capacityL.toLocaleString()} L a month, up to a year ahead</span></h2>
            <CapacityTable plan={capacity} />
          </section>
          <p className="stock-muted" style={{ fontSize: '0.8rem' }}>{planNote(fc.coverWeeks)}</p>
        </>
      )}
      {tab === 'demand' && forecast && <DemandGrid forecast={forecast} onSaved={reload} />}
    </div>
  )
}

// Monthly forecast per beer, cubes and kegs. Editors type straight in.
function DemandGrid({ forecast, onSaved }) {
  const [editor, setEditor] = useState(false)
  const [start, setStart] = useState(monthOf(todayIso()))
  const [values, setValues] = useState({}) // "beer|format|month" -> string
  const [added, setAdded] = useState([])
  const [newBeer, setNewBeer] = useState('')
  const [status, setStatus] = useState(null)
  useEffect(() => { isScheduleEditor().then(setEditor) }, [])

  const saved = useMemo(() => {
    const m = {}
    for (const r of forecast.rows) m[`${r.beer}|${r.format}|${r.month}`] = Number(r.qty)
    return m
  }, [forecast])
  const beers = useMemo(() => {
    const set = new Set([...forecast.rows.map((r) => r.beer), ...added])
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [forecast, added])
  const monthsShown = Array.from({ length: 12 }, (_, i) => addMonths(start, i))

  const valueOf = (k) => values[k] ?? (saved[k] ? String(saved[k]) : '')
  async function commit(beer, format, col) {
    const k = `${beer}|${format}|${col}`
    if (values[k] == null) return
    const qty = Math.max(0, Number(values[k]) || 0)
    if (qty === (saved[k] ?? 0)) return
    setStatus('Saving…')
    try {
      await saveForecast(beer, format, col, qty)
      saved[k] = qty
      setStatus('Saved')
      onSaved()
    } catch (e) {
      setStatus(e.message)
    }
  }

  return (
    <>
      <div className="stock-controls">
        <button className="secondary" onClick={() => setStart(addMonths(start, -1))}>‹</button>
        <strong>{fmtMonth(monthsShown[0])} to {fmtMonth(monthsShown[11])}</strong>
        <button className="secondary" onClick={() => setStart(addMonths(start, 1))}>›</button>
        {start !== monthOf(todayIso()) && <button className="secondary" onClick={() => setStart(monthOf(todayIso()))}>This month</button>}
        {status && <span className="stock-muted">{status}</span>}
        {!editor && <span className="stock-muted">View only: schedule editors can change the forecast.</span>}
      </div>
      <section className="stock-card stock-plan">
        <h2>Forecast demand <span>units sold per month · stock to hold is worked out from this ({forecast.coverWeeks} weeks of sales)</span></h2>
        <div className="stock-scroll">
          <table className="stock-table fc-grid">
            <thead>
              <tr>
                <th className="stock-beer">Beer</th>
                <th></th>
                {monthsShown.map((m) => <th key={m}>{fmtMonth(m)}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {beers.map((beer) => FORMATS.map(([format, label], i) => (
                <tr key={beer + format} className={i ? 'fc-keg' : 'fc-cube'}>
                  {i === 0 && <td className="stock-beer" rowSpan={2}><BeerDot name={beer} />{beer}</td>}
                  <td className="fc-format"><span className={`fc-tag ${format}`}>{label}</span></td>
                  {monthsShown.map((col) => {
                    const k = `${beer}|${format}|${col}`
                    return (
                      <td key={col}>
                        {editor ? (
                          <input
                            inputMode="numeric"
                            value={valueOf(k)}
                            onChange={(e) => setValues({ ...values, [k]: e.target.value.replace(/[^\d.]/g, '') })}
                            onBlur={() => commit(beer, format, col)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          />
                        ) : valueOf(k)}
                      </td>
                    )
                  })}
                  <td className="stock-total">{monthsShown.reduce((a, m) => a + (Number(valueOf(`${beer}|${format}|${m}`)) || 0), 0).toLocaleString()}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
      {editor && (
        <form className="stock-controls" onSubmit={(e) => { e.preventDefault(); const b = newBeer.trim(); if (b && !beers.includes(b)) setAdded([...added, b]); setNewBeer('') }}>
          <input value={newBeer} onChange={(e) => setNewBeer(e.target.value)} placeholder="Beer name" style={{ width: 180 }} />
          <button className="secondary" disabled={!newBeer.trim()}>Add beer</button>
          <span className="stock-muted">Use the same name as on the Stock page.</span>
        </form>
      )}
    </>
  )
}
