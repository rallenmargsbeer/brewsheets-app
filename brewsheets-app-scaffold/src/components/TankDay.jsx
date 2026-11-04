import { useState } from 'react'
import { Link } from 'react-router-dom'
import { setTaskDone } from '../lib/dayTasks'
import { recordCellarAction } from '../lib/cellarSteps'

// A tick box for a schedule task (any signed-in user).
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
      {task.id ? <input type="checkbox" checked={done} disabled={busy} onChange={toggle} /> : null}
      <span className="day-slot">{task.slot}</span>
      <span>{task.text}</span>
      {task.carriedFrom && <span className="day-carried">from {new Date(`${task.carriedFrom}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
    </label>
  )
}

// One thing the beer needs next, with a Done button (VDK: Pass / Fail).
function StepLine({ step, batch, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function record(result = null) {
    if (step.key === 'chill' && !window.confirm(`Mark #${batch.batch_number} as chilled (on chill)?`)) return
    setBusy(true); setError(null)
    try {
      await recordCellarAction(batch, step.key, result)
      if (step.also) await recordCellarAction(batch, step.also)
      onChanged?.()
    } catch (e) { setError(e.message); setBusy(false) }
  }
  const btn = { padding: '0.15rem 0.55rem', fontSize: '0.8rem' }
  return (
    <div className={`day-step ${step.level}`}>
      <div className="day-step-main">
        <strong>{step.text}</strong>
        <span className="day-step-why">{step.why}</span>
        {error && <span style={{ color: 'crimson' }}>{error}</span>}
      </div>
      <div className="day-step-act">
        {step.link === 'cellar' && <Link to="/cellar" className="secondary-link">Cellar</Link>}
        {step.vdk ? (<>
          <button className="secondary" style={btn} disabled={busy} onClick={() => record('pass')} title="Negative: OK to chill">Pass</button>
          <button className="secondary" style={btn} disabled={busy} onClick={() => record('fail')}>Fail</button>
        </>) : !step.info && !step.noDone && step.key !== 'reading' && (
          <button className="secondary" style={btn} disabled={busy} onClick={() => record()}>Done</button>
        )}
      </div>
    </div>
  )
}

// Today's work for one tank: what the beer needs next (steps), schedule cells, template
// suggestions and gravity advice (for tanks without a beer, the schedule's cells).
export default function TankDay({ day, editor, onChanged, compact = false }) {
  const { scheduled, fromTemplate, advice, steps = [] } = day
  const nothing = !scheduled.length && !fromTemplate.length && !advice.length && !steps.length
  return (
    <div className="tank-day">
      {steps.map((st) => <StepLine key={st.key} step={st} batch={day.batch} onChanged={onChanged} />)}
      {scheduled.map((t) => <TaskLine key={t.id} task={t} editor={editor} onChanged={onChanged} />)}
      {fromTemplate.map((t, i) => (
        <div key={i} className="day-task suggested">
          <span className="day-slot">{t.slot}</span>
          <span>{t.text}</span>
          {!compact && <span className="day-from">suggested: {t.template} template, day {t.day}</span>}
        </div>
      ))}
      {advice.map((a, i) => <div key={'a' + i} className={`day-advice ${a.level}`}>{a.text}</div>)}
      {nothing && <div className="stock-muted">Nothing to do today.</div>}
    </div>
  )
}
