import { useState } from 'react'
import { setTaskDone } from '../lib/dayTasks'

// A tick box for a schedule task (editors only); everyone else sees the text.
export function TaskLine({ task, editor, onChanged }) {
  const [done, setDone] = useState(task.done)
  const [busy, setBusy] = useState(false)
  async function toggle() {
    setBusy(true)
    try {
      await setTaskDone(task.id, !done)
      setDone(!done)
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }
  return (
    <label className={`day-task${done ? ' done' : ''}`}>
      {editor && task.id ? <input type="checkbox" checked={done} disabled={busy} onChange={toggle} /> : null}
      <span className="day-slot">{task.slot}</span>
      <span>{task.text}</span>
    </label>
  )
}

// Today's work for one tank: scheduled tasks, else the template's suggestion, plus gravity.
export default function TankDay({ day, editor, onChanged, compact = false }) {
  const { scheduled, fromTemplate, advice } = day
  const nothing = !scheduled.length && !fromTemplate.length && !advice.length
  return (
    <div className="tank-day">
      {scheduled.map((t) => <TaskLine key={t.id} task={t} editor={editor} onChanged={onChanged} />)}
      {fromTemplate.map((t, i) => (
        <div key={i} className="day-task suggested">
          <span className="day-slot">{t.slot}</span>
          <span>{t.text}</span>
          {!compact && <span className="day-from">suggested: {t.template} template, day {t.day}</span>}
        </div>
      ))}
      {advice.map((a, i) => <div key={'a' + i} className={`day-advice ${a.level}`}>{a.text}</div>)}
      {nothing && <div className="stock-muted">Nothing scheduled today.</div>}
    </div>
  )
}
