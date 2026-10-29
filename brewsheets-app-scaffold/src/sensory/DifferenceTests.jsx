import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

// Difference tests: is there a detectable difference between two samples (raw material, process,
// yeast generation)? Triangle: three cups, one odd. Tetrad: four cups, two of each, pick the pair
// that belongs together (same chance of guessing, about half the tasters needed). A lead sets the
// test up and adds tasters; each taster gets coded cups in a balanced order and answers here.
const ORDERS = {
  triangle: ['AAB', 'ABA', 'BAA', 'BBA', 'BAB', 'ABB'],
  tetrad: ['AABB', 'ABAB', 'ABBA', 'BBAA', 'BABA', 'BAAB'],
}
const METHOD_LABEL = { triangle: 'Triangle', tetrad: 'Tetrad' }

// Chance of at least k right out of n by guessing (1 in 3 for both methods).
function pValue(n, k) {
  const choose = (a, b) => { let r = 1; for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i; return r }
  let p = 0
  for (let i = k; i <= n; i++) p += choose(n, i) * (1 / 3) ** i * (2 / 3) ** (n - i)
  return p
}
// Fewest correct answers out of n that show a difference at the given level.
function needed(n, alpha = 0.05) {
  for (let k = 0; k <= n; k++) if (pValue(n, k) <= alpha) return k
  return null
}

function makeCups(method, seat) {
  const order = ORDERS[method][seat % 6]
  const codes = new Set()
  while (codes.size < order.length) codes.add(String(100 + Math.floor(Math.random() * 900)))
  return [...codes].map((code, i) => ({ code, sample: order[i] }))
}
const isCorrect = (method, cups, answer) => {
  const pick = cups.filter((c) => answer.includes(c.code))
  if (method === 'triangle') {
    const odd = cups.filter((c) => c.sample === 'A').length === 1 ? 'A' : 'B'
    return pick.length === 1 && pick[0].sample === odd
  }
  return pick.length === 2 && pick[0].sample === pick[1].sample
}

const today = () => new Date().toLocaleDateString('en-CA')
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

function Result({ test, responses }) {
  const answered = responses.filter((r) => r.answer)
  const n = answered.length
  const k = answered.filter((r) => r.correct).length
  if (!n) return <p className="stock-muted">No answers yet.</p>
  const p = pValue(n, k)
  const need = needed(n)
  const sig = p <= 0.05
  return (
    <div className={sig ? 'dt-result dt-sig' : 'dt-result'}>
      <strong>{sig ? 'Difference detected' : 'No difference detected'}</strong>
      <div>
        {k} of {n} correct · p = {p < 0.001 ? '< 0.001' : p.toFixed(3)} ·{' '}
        {need != null ? `${need} of ${n} needed at 95%` : `${n} ${n === 1 ? 'taster is' : 'tasters are'} too few to show a difference at 95%`}
      </div>
      {!sig && n < 12 && <div className="stock-muted" style={{ fontSize: '0.85rem' }}>With only {n} answer{n === 1 ? '' : 's'} a small difference can be missed: repeat the test or add tasters before calling the samples the same.</div>}
    </div>
  )
}

function NewTest({ store, me, onCreated, onCancel }) {
  const [f, setF] = useState({ label: '', method: 'tetrad', sample_a: '', sample_b: '', batch_a_id: '', batch_b_id: '', notes: '', date: today() })
  const [error, setError] = useState(null)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const batches = [...store.batches].sort((a, b) => Number(b.batch_number) - Number(a.batch_number))
  const skuName = (b) => store.skus.find((s) => s.id === b.sku_id)?.name ?? ''
  const pickBatch = (side, id) => {
    const b = batches.find((x) => x.id === id)
    setF((x) => ({ ...x, [`batch_${side}_id`]: id, [`sample_${side}`]: x[`sample_${side}`] || (b ? `#${b.batch_number} ${skuName(b)}` : '') }))
  }
  async function save() {
    setError(null)
    const { data, error: e } = await supabase.from('sensory_difference_tests').insert({
      ...f, batch_a_id: f.batch_a_id || null, batch_b_id: f.batch_b_id || null, created_by: me.id,
    }).select().single()
    if (e) return setError(e.message)
    onCreated(data)
  }
  const sample = (side, label) => (
    <div style={{ flex: '1 1 240px' }}>
      <label style={{ display: 'block' }}>{label}
        <input value={f[`sample_${side}`]} onChange={(e) => set(`sample_${side}`, e.target.value)} placeholder="e.g. Pale #431 (gen 4 yeast)" style={{ width: '100%' }} />
      </label>
      <select value={f[`batch_${side}_id`]} onChange={(e) => pickBatch(side, e.target.value)} style={{ marginTop: 4, width: '100%' }}>
        <option value="">Link a batch (optional)</option>
        {batches.map((b) => <option key={b.id} value={b.id}>#{b.batch_number} {skuName(b)}</option>)}
      </select>
    </div>
  )
  return (
    <div className="dt-card">
      <h3 style={{ marginTop: 0 }}>New difference test</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
        <label style={{ flex: '2 1 240px' }}>What are you testing?<input value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. New Citra lot vs current" style={{ width: '100%' }} /></label>
        <label>Date<input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label>Method
          <select value={f.method} onChange={(e) => set('method', e.target.value)}>
            <option value="tetrad">Tetrad (4 cups, best for small panels)</option>
            <option value="triangle">Triangle (3 cups)</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
        {sample('a', 'Sample A (usually the current / control)')}
        {sample('b', 'Sample B (the change)')}
      </div>
      <label style={{ display: 'block', marginTop: '0.75rem' }}>Notes<input value={f.notes} onChange={(e) => set('notes', e.target.value)} style={{ width: '100%' }} /></label>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button onClick={save} disabled={!f.label.trim() || !f.sample_a.trim() || !f.sample_b.trim()}>Create test</button>
        <button className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function AddTasters({ test, responses, store, onChanged }) {
  const [picked, setPicked] = useState([])
  const taken = new Set(responses.map((r) => r.taster_id))
  const people = store.profiles.filter((p) => !taken.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))
  async function add() {
    const start = responses.reduce((m, r) => Math.max(m, r.seat + 1), 0)
    const rows = picked.map((id, i) => ({ test_id: test.id, taster_id: id, seat: start + i, cups: makeCups(test.method, start + i) }))
    const { error } = await supabase.from('sensory_difference_responses').insert(rows)
    if (!error) { setPicked([]); onChanged() }
  }
  if (!people.length) return null
  return (
    <div style={{ margin: '0.5rem 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {people.map((p) => (
          <button key={p.id} className={picked.includes(p.id) ? '' : 'secondary'} style={{ padding: '0.3rem 0.7rem' }}
            onClick={() => setPicked((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))}>{p.name}</button>
        ))}
      </div>
      <button onClick={add} disabled={!picked.length} style={{ marginTop: '0.5rem' }}>Add {picked.length || ''} taster{picked.length === 1 ? '' : 's'}</button>
    </div>
  )
}

function MyAnswer({ test, mine, onChanged }) {
  const [answer, setAnswer] = useState([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const want = test.method === 'triangle' ? 1 : 2
  const toggle = (code) => setAnswer((a) => (a.includes(code) ? a.filter((c) => c !== code) : want === 1 ? [code] : a.length < 2 ? [...a, code] : a))
  async function submit() {
    setBusy(true)
    const { error } = await supabase.from('sensory_difference_responses').update({
      answer, correct: isCorrect(test.method, mine.cups, answer), comment, answered_at: new Date().toISOString(),
    }).eq('id', mine.id)
    setBusy(false)
    if (!error) onChanged()
  }
  if (mine.answer) return <p className="stock-muted">You've answered this one{test.status === 'closed' ? ` (${mine.correct ? 'correct' : 'not correct'})` : ''}.</p>
  return (
    <div className="dt-answer">
      <p style={{ margin: '0 0 0.5rem' }}>
        Taste the cups in this order, left to right.{' '}
        {test.method === 'triangle' ? 'Two are the same and one is different: pick the odd one.' : 'There are two pairs: pick the two cups that belong together.'}{' '}
        If you can't tell, you must still pick.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {mine.cups.map((c) => (
          <button key={c.code} className={answer.includes(c.code) ? 'dt-cup on' : 'dt-cup'} onClick={() => toggle(c.code)}>{c.code}</button>
        ))}
      </div>
      <label style={{ display: 'block', marginTop: '0.5rem' }}>What was different? (optional)<input value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} /></label>
      <button onClick={submit} disabled={busy || answer.length !== want} style={{ marginTop: '0.5rem' }}>{busy ? '…' : 'Submit'}</button>
    </div>
  )
}

function TestCard({ test, store, me, isLead, onChanged }) {
  const [responses, setResponses] = useState([])
  const [open, setOpen] = useState(test.status === 'open')
  const [pour, setPour] = useState(false) // hidden by default: a lead who is also tasting shouldn't see the answers
  const load = () => supabase.from('sensory_difference_responses').select('*').eq('test_id', test.id).order('seat')
    .then(({ data }) => setResponses(data ?? []))
  useEffect(() => { load() }, [test.id])
  const name = (id) => store.profiles.find((p) => p.id === id)?.name ?? 'Taster'
  const mine = responses.find((r) => r.taster_id === me.id)
  // Nobody sees the running result until they've answered (a lead who isn't tasting sees it straight away).
  const showResult = test.status === 'closed' || mine?.answer || (isLead && !mine)
  async function close(status) {
    await supabase.from('sensory_difference_tests').update({ status }).eq('id', test.id)
    onChanged()
  }
  async function remove() {
    if (!window.confirm(`Delete the test "${test.label}" and its answers?`)) return
    await supabase.from('sensory_difference_tests').delete().eq('id', test.id)
    onChanged()
  }
  return (
    <div className="dt-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div>
          <strong>{test.label}</strong> <span className="stock-muted">· {METHOD_LABEL[test.method]} · {fmt(test.date)}{test.status === 'closed' ? ' · closed' : ''}</span>
          <div className="stock-muted" style={{ fontSize: '0.85rem' }}>A: {test.sample_a} · B: {test.sample_b}</div>
        </div>
        <span className="stock-muted">{responses.filter((r) => r.answer).length} of {responses.length} answered {open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          {test.notes && <p style={{ marginTop: 0 }}>{test.notes}</p>}
          {mine && test.status === 'open' && <MyAnswer test={test} mine={mine} onChanged={load} />}
          {showResult && <Result test={test} responses={responses} />}
          {isLead && (
            <>
              <button className="secondary" onClick={() => setPour(!pour)} style={{ marginTop: '0.75rem' }}>{pour ? 'Hide pour sheet' : 'Show pour sheet'}</button>
              {pour && <p className="stock-muted" style={{ margin: '0.5rem 0', fontSize: '0.85rem' }}>Label each cup with its code and fill it with the sample shown. Serve each taster's cups left to right in this order. Whoever pours shouldn't taste.</p>}
              {pour && responses.length > 0 && (
                <table className="stock-table">
                  <thead><tr><th>Taster</th><th>Cups (left to right)</th><th>Answer</th><th>Comment</th></tr></thead>
                  <tbody>
                    {responses.map((r) => (
                      <tr key={r.id}>
                        <td>{name(r.taster_id)}</td>
                        <td>{r.cups.map((c) => `${c.code} = ${c.sample}`).join(' · ')}</td>
                        <td>{r.answer ? (r.correct ? '✓ correct' : '✗ wrong') : <span className="stock-muted">waiting</span>}</td>
                        <td>{r.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {test.status === 'open' && <AddTasters test={test} responses={responses} store={store} onChanged={load} />}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button className="secondary" onClick={() => close(test.status === 'open' ? 'closed' : 'open')}>{test.status === 'open' ? 'Close test' : 'Reopen'}</button>
                <button className="secondary" onClick={remove} style={{ color: 'var(--bad)' }}>Delete</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function DifferenceTests({ store, currentProfile, isLead }) {
  const [tests, setTests] = useState(null)
  const [adding, setAdding] = useState(false)
  const load = () => supabase.from('sensory_difference_tests').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })
    .then(({ data }) => setTests(data ?? []))
  useEffect(() => { load() }, [])
  const sorted = useMemo(() => [...(tests ?? [])].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)), [tests])
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Difference tests</h2>
          <p className="stock-muted" style={{ margin: '0.25rem 0 0' }}>Is there a difference you can taste between two samples? Use it for raw material, process and yeast changes. Tetrads need about half the tasters a triangle does.</p>
        </div>
        {isLead && !adding && <button onClick={() => setAdding(true)}>+ New test</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
        {adding && <NewTest store={store} me={currentProfile} onCreated={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} />}
        {tests && !tests.length && !adding && <p className="stock-muted">No difference tests yet.</p>}
        {sorted.map((t) => <TestCard key={t.id} test={t} store={store} me={currentProfile} isLead={isLead} onChanged={load} />)}
      </div>
    </div>
  )
}
