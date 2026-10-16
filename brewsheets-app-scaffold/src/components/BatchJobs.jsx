import { useEffect, useState } from 'react'
import { addDays, listScheduleEntries, listCellarTemplates, listBookings, stepsForTank } from '../lib/schedule'
import { TaskLine } from './TankDay.jsx'

const slotRank = (s) => (s === 'AM' ? 0 : 1)

// The batch's cellar jobs in its current tank: the schedule's jobs (ticked off in the readings
// table), or the cellar template's suggested steps when the schedule has none.
export function useBatchJobs(batch) {
  const [rows, setRows] = useState([])
  const [version, setVersion] = useState(0)
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

  return { rows, refresh: () => setVersion((v) => v + 1) }
}

// One date's jobs, for the Jobs column of the readings table.
export function JobsCell({ jobs, onChanged }) {
  return (
    <div className="jobs-cell">
      {jobs.map((r, i) => r.suggested
        ? <div key={i} className="day-task suggested"><span className="day-slot">{r.task.slot}</span><span>{r.task.text}</span><span className="bj-sugg">suggested</span></div>
        : <TaskLine key={r.task.id} task={r.task} onChanged={onChanged} />)}
    </div>
  )
}
