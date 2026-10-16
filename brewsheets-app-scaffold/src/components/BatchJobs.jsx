import { useEffect, useState } from 'react'
import { addDays, daysBetween, listScheduleEntries, listCellarTemplates, listBookings, stepsForTank, todayIso } from '../lib/schedule'
import { gravityAdvice } from '../lib/dayTasks'
import { TaskLine } from './TankDay.jsx'

const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
const slotRank = (s) => (s === 'AM' ? 0 : 1)

// The batch's cellar jobs in its current tank: the schedule's jobs (tick them off here too),
// or the cellar template's suggested steps when the schedule has none, plus today's gravity advice.
export default function BatchJobs({ batch }) {
  const [rows, setRows] = useState(null)
  const [version, setVersion] = useState(0)
  const today = todayIso()
  const tank = batch.tanks
  const inBbt = tank?.tank_type === 'BBT'
  const start = (inBbt && batch.bbt_transfer_date) || batch.date_brewed

  useEffect(() => {
    if (!start || !batch.tank_id || ['packaged', 'archived'].includes(batch.status)) { setRows([]); return }
    Promise.all([listScheduleEntries(start, addDays(start, 35)), listCellarTemplates(), listBookings({ fromIso: addDays(start, -30) })])
      .then(([entries, templates, bookings]) => {
        const beers = new Set([...templates.map((t) => t.name), ...bookings.map((b) => b.beer_name), batch.beer_style, batch.recipes?.name].filter(Boolean).map((n) => n.trim().toLowerCase()))
        const jobs = entries
          .filter((e) => e.lane === 'tank' && e.tank_id === batch.tank_id && (e.text ?? '').trim() && !beers.has(e.text.trim().toLowerCase()) && e.text.trim().toLowerCase() !== 'brew')
          .map((e) => ({ date: e.entry_date, task: { id: e.id, slot: e.slot, text: e.text, done: !!e.done } }))
        if (jobs.length) return setRows(jobs.sort((a, b) => a.date.localeCompare(b.date) || slotRank(a.task.slot) - slotRank(b.task.slot)))
        // No schedule jobs: the recipe's cellar template, dated from brew day (day 1).
        const tpl = templates.find((t) => t.id === batch.recipes?.cellar_template_id)
        if (!tpl || inBbt) return setRows([])
        setRows(stepsForTank(tpl, tank).map((s) => ({ date: addDays(batch.date_brewed, Number(s.day) - 1), suggested: tpl.name, task: { slot: s.slot, text: s.task } }))
          .sort((a, b) => a.date.localeCompare(b.date) || slotRank(a.task.slot) - slotRank(b.task.slot)))
      })
      .catch(() => setRows([]))
  }, [batch.id, batch.tank_id, start, version])

  const advice = gravityAdvice(batch, today)
  if (!rows?.length && !advice.length) return null
  return (
    <div className="batch-jobs">
      <h3>Jobs{tank ? ` in ${tank.name.startsWith('BT') ? tank.name : `FV${tank.name}`}` : ''}</h3>
      {advice.map((a, i) => <div key={'a' + i} className={`day-advice ${a.level}`}>{a.text}</div>)}
      {rows?.map((r, i) => (
        <div key={r.task.id ?? i} className={'bj-row' + (r.date === today ? ' today' : r.date < today && (r.task.done || r.suggested) ? ' past' : '')}>
          <span className="bj-date">{r.date === today ? 'Today' : fmt(r.date)}{start ? ` · D${daysBetween(batch.date_brewed, r.date) + 1}` : ''}</span>
          {r.suggested
            ? <span><span className="day-slot">{r.task.slot}</span> {r.task.text} <span className="bj-sugg">suggested ({r.suggested} template)</span></span>
            : <TaskLine task={r.task} onChanged={() => setVersion((v) => v + 1)} />}
        </div>
      ))}
    </div>
  )
}
