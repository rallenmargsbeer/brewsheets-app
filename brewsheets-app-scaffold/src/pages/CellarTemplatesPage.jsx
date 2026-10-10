import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isScheduleEditor, listCellarTemplates, saveCellarTemplate, deleteCellarTemplate } from '../lib/schedule'

const VARIANTS = [
  ['all', 'All tanks'],
  ['standard', 'Not FV7/8'],
  ['fv78', 'FV7/8 only'],
]

function TemplateEditor({ template, onSaved, onDeleted }) {
  const [name, setName] = useState(template.name)
  const [steps, setSteps] = useState(template.cellar_template_steps.map((s) => ({ ...s })))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  const set = (i, k, v) => setSteps(steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)))
  function addRow() {
    const last = steps[steps.length - 1]
    setSteps([...steps, { day: last ? last.day + 1 : 1, slot: 'AM', task: '', variant: 'all' }])
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Keep steps in day / AM-PM order.
      const ordered = [...steps].sort((a, b) => Number(a.day) - Number(b.day) || (a.slot === b.slot ? 0 : a.slot === 'AM' ? -1 : 1))
      const id = await saveCellarTemplate({ id: template.id, name: name.trim() }, ordered)
      setMsg('Saved')
      onSaved(id)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the ${template.name} template? Recipes using it will need a new one.`)) return
    await deleteCellarTemplate(template.id)
    onDeleted()
  }

  return (
    <div>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        Name <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p style={{ color: 'var(--ink2)', fontSize: '0.85rem', marginTop: 0 }}>
        Day 1 is brew day. A task that matches the template's name (day 1 PM) is replaced with the booked beer's name.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Day</th><th>AM/PM</th><th>Task</th><th>Applies to</th><th></th></tr>
          </thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={s.id ?? `new${i}`}>
                <td><input type="number" min="1" value={s.day} onChange={(e) => set(i, 'day', e.target.value)} style={{ width: 60 }} /></td>
                <td>
                  <select value={s.slot} onChange={(e) => set(i, 'slot', e.target.value)}>
                    <option>AM</option><option>PM</option>
                  </select>
                </td>
                <td><input value={s.task} onChange={(e) => set(i, 'task', e.target.value)} style={{ width: 180 }} /></td>
                <td>
                  <select value={s.variant} onChange={(e) => set(i, 'variant', e.target.value)}>
                    {VARIANTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td><button className="secondary" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Remove step" style={{ padding: '0.2rem 0.5rem' }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center' }}>
        <button className="secondary" onClick={addRow}>+ Add step</button>
        <button onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save template'}</button>
        {template.id && <button className="secondary" onClick={remove}>Delete template</button>}
        {msg && <span style={{ color: '#11603f', fontWeight: 600 }}>✓ {msg}</span>}
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  )
}

export default function CellarTemplatesPage() {
  const [templates, setTemplates] = useState([])
  const [selected, setSelected] = useState(null)
  const [editor, setEditor] = useState(null)

  function refresh(keepId) {
    listCellarTemplates().then((t) => {
      setTemplates(t)
      setSelected((cur) => t.find((x) => x.id === (keepId ?? cur?.id)) ?? null)
    })
  }
  useEffect(() => {
    isScheduleEditor().then(setEditor)
    refresh()
  }, [])

  if (editor === false) {
    return (
      <div>
        <h1>Cellar templates</h1>
        <p>Only schedule editors can change templates. <Link to="/login" state={{ from: '/schedule/templates' }}>Sign in</Link></p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ margin: 0 }}><Link to="/schedule">← Schedule</Link></p>
      <h1>Cellar templates</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        {templates.map((t) => (
          <button key={t.id} className={selected?.id === t.id ? '' : 'secondary'} onClick={() => setSelected(t)}>{t.name}</button>
        ))}
        <button className="secondary" onClick={() => setSelected({ name: '', cellar_template_steps: [{ day: 1, slot: 'AM', task: 'Brew', variant: 'all' }] })}>+ New template</button>
      </div>
      {selected && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '1rem' }}>
          <TemplateEditor
            key={selected.id ?? 'new'}
            template={selected}
            onSaved={(id) => refresh(id)}
            onDeleted={() => { setSelected(null); refresh() }}
          />
        </div>
      )}
    </div>
  )
}
