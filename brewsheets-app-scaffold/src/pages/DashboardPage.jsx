import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import template from '../dashboardTemplate.html?raw'

const KEYS = ['products', 'assemblies', 'fbBatches', 'beerRange', 'parked', 'eff', 'meta']

export default function DashboardPage() {
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    supabase
      .from('unl_dataset')
      .select('key, data')
      .in('key', KEYS)
      .then(({ data, error }) => {
        if (off) return
        if (error) return setErr(error.message)
        const m = Object.fromEntries((data || []).map((r) => [r.key, r.data]))
        if (!m.assemblies || !m.meta) {
          return setErr('No Unleashed data available. Either it has not been synced yet (press Refresh on the Reports page) or this account is not on the report viewers list.')
        }
        const DATA = {
          products: m.products, assemblies: m.assemblies, pulled: m.meta.pulled, fbBatches: m.fbBatches,
          beerRange: m.beerRange, notes: m.meta.notes || {}, parked: m.parked, eff: m.eff,
        }
        const json = JSON.stringify(DATA).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16))
        setDoc(template.replace('__DATA__', () => json))
      })
    return () => { off = true }
  }, [])

  return (
    <div>
      <p style={{ margin: '0 0 0.5rem' }}><Link to="/reports">← Reports</Link></p>
      {err && <p style={{ color: '#b00020' }}>{err}</p>}
      {!doc && !err && <p style={{ color: '#666' }}>Loading data…</p>}
      {doc && (
        <iframe
          title="Board dashboard"
          srcDoc={doc}
          style={{ width: '100%', height: 'calc(100vh - 140px)', minHeight: 640, border: '1px solid #ddd', borderRadius: 6, background: '#fff' }}
        />
      )}
    </div>
  )
}
