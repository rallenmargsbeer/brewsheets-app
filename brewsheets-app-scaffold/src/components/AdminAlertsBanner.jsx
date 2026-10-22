import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// Raised by anyone (e.g. "Complete anyway" on an out-of-spec batch); only admins can read them.
export async function raiseAdminAlert({ kind, batchId, message, by }) {
  const { error } = await supabase.from('admin_alerts').insert({ kind, batch_id: batchId ?? null, message, raised_by_name: by ?? null })
  if (error) throw error
}

const when = (t) => new Date(t).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// For admins: alerts not yet ticked off, on every page, rechecked on page change and every
// few minutes.
export default function AdminAlertsBanner() {
  const [alerts, setAlerts] = useState([])
  const { pathname } = useLocation()
  const load = () => supabase.from('admin_alerts').select('id, kind, batch_id, message, raised_by_name, created_at').is('seen_at', null).order('created_at')
    .then(({ data }) => setAlerts(data ?? []))
  useEffect(() => {
    load()
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [pathname])
  async function seen(a) {
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('admin_alerts').update({ seen_at: new Date().toISOString(), seen_by: u?.user?.id ?? null }).eq('id', a.id)
    load()
  }
  if (!alerts.length) return null
  return (
    <div className="admin-alerts">
      {alerts.map((a) => (
        <div key={a.id} className="admin-alert">
          <div>
            <strong>⚠ {a.message}</strong>
            <div className="admin-alert-meta">{a.raised_by_name ?? 'Someone'} · {when(a.created_at)}{a.batch_id && <> · <Link to={`/batches/${a.batch_id}`}>Open batch</Link></>}</div>
          </div>
          <button className="secondary" onClick={() => seen(a)}>Seen</button>
        </div>
      ))}
    </div>
  )
}
