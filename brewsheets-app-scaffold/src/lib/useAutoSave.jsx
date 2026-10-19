import { useEffect, useRef, useState } from 'react'

// Saves fields as they're typed: a moment after the last keystroke (saveSoon), straight away
// on leaving a box or ticking a checkbox (saveNow), and anything still waiting when the page
// closes. Saves run one at a time, in order. save(key, value) does the actual write.
export function useAutoSave(save, delay = 700) {
  const [status, setStatus] = useState(null) // null | 'saving' | 'saved' | { error }
  const pending = useRef({})
  const queue = useRef(Promise.resolve())
  const sent = useRef({}) // key -> last value written, so leaving a box doesn't re-send it
  const saveRef = useRef(save)
  saveRef.current = save

  function run(key, value) {
    setStatus('saving')
    queue.current = queue.current.then(async () => {
      try {
        await saveRef.current(key, value)
        setStatus('saved')
      } catch (e) {
        delete sent.current[key]
        setStatus({ error: e.message })
      }
    })
    return queue.current
  }
  function saveNow(key, value) {
    clearTimeout(pending.current[key]?.timer)
    delete pending.current[key]
    const v = JSON.stringify(value)
    if (sent.current[key] === v) return queue.current
    sent.current[key] = v
    return run(key, value)
  }
  function saveSoon(key, value) {
    clearTimeout(pending.current[key]?.timer)
    pending.current[key] = { value, timer: setTimeout(() => saveNow(key, value), delay) }
  }
  const flush = useRef(null)
  flush.current = () => { for (const [k, p] of Object.entries(pending.current)) saveNow(k, p.value) }
  useEffect(() => () => flush.current(), [])

  return { saveSoon, saveNow, status }
}

// "Saving…" / "✓ Saved" / "Not saved: …" next to a form.
export function SaveStatus({ status }) {
  if (!status) return null
  if (status === 'saving') return <span className="save-status">Saving…</span>
  if (status === 'saved') return <span className="save-status ok">✓ Saved</span>
  return <span className="save-status bad">Not saved: {status.error}</span>
}
