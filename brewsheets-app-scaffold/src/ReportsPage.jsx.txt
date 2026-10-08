import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth'

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Perth', dateStyle: 'medium', timeStyle: 'short' }) : '—')

export default function ReportsPage() {
  const { session } = useAuth()
  const [allowed, setAllowed] = useState(null)
  const [runs, setRuns] = useState([])
  const [counts, setCounts] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const ok = await supabase.rpc('is_report_viewer')
    setAllowed(ok.data === true)
    if (ok.data !== true) return
    const r = await supabase.from('unl_sync_runs').select('*').order('id', { ascending: false }).limit(10)
    setRuns(r.data || [])
    const d = await supabase.from('unl_dataset').select('key, data, updated_at').in('key', ['meta', 'products', 'assemblies', 'eff'])
    const c = {}
    for (const row of d.data || []) c[row.key] = row.key === 'meta' ? row.data : { n: row.data.length, updated_at: row.updated_at }
    setCounts(c)
  }, [])

  useEffect(() => { load() }, [load])

  async function refresh() {
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('unleashed-sync', { body: { trigger: 'manual' } })
    let text = data?.error || error?.message
    if (error?.context?.json) {
      try { text = (await error.context.json()).error || text } catch { /* keep generic message */ }
    }
    setMsg(text ? { bad: true, text } : { bad: false, text: `Refreshed — data as at ${data.pulled} (${data.assemblies} assemblies).` })
    setBusy(false)
    load()
  }

  if (allowed === false) {
    return (
      <div>
        <h1>Reports</h1>
        <p>You're signed in as {session?.user?.email}, but this account isn't on the report viewers list. Ask Ryan to add it.</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    )
  }

  const last = runs[0]
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Reports</h1>
        <span style={{ color: '#666' }}>
          {session?.user?.email} · <a href="#out" onClick={(e) => { e.preventDefault(); supabase.auth.signOut() }}>Sign out</a>
        </span>
      </div>

      <h2>Unleashed data</h2>
      <p style={{ color: '#666', maxWidth: 640 }}>
        Pulled from Unleashed read-only (view and export only; nothing is ever changed in Unleashed). It refreshes
        automatically every night at 2am Perth time, or press Refresh now.
      </p>
      <p>
        Data as at: <strong>{counts.meta?.pulled || 'not yet synced'}</strong>
        {counts.products && <> · {counts.products.n} products · {counts.assemblies?.n} packaged assemblies · {counts.eff?.n} beer batches</>}
      </p>
      <button onClick={refresh} disabled={busy}>{busy ? 'Pulling from Unleashed… (up to a minute)' : 'Refresh from Unleashed'}</button>
      {msg && <p style={{ color: msg.bad ? '#b00020' : '#1b6e2e' }}>{msg.text}</p>}

      <h3>Recent syncs</h3>
      <table>
        <thead><tr><th>Started (Perth)</th><th>Trigger</th><th>Result</th><th>Detail</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{fmt(r.started_at)}</td>
              <td>{r.trigger}{r.requested_by ? ` (${r.requested_by})` : ''}</td>
              <td style={{ color: r.status === 'error' ? '#b00020' : r.status === 'ok' ? '#1b6e2e' : undefined }}>{r.status}</td>
              <td>{r.detail || ''}</td>
            </tr>
          ))}
          {!runs.length && <tr><td colSpan="4" style={{ color: '#666' }}>No syncs yet.</td></tr>}
        </tbody>
      </table>
      {last?.status === 'error' && <p style={{ color: '#b00020' }}>The last sync failed, so the data above is from the previous successful pull.</p>}
    </div>
  )
}
