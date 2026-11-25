import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { sameBeer } from '../lib/incoming'
import { useAuth } from '../auth.jsx'

// 20 L and 30 L kegs to fill on a pack-off: the beer's par level (app_settings 'small_keg_pars',
// one entry per beer and size with its Unleashed product code) less what's available in stock.
// Admins can change a par here.
export default function SmallKegSuggestion({ beer, onUse }) {
  const { isAdmin } = useAuth()
  const [pars, setPars] = useState(null)
  const [stock, setStock] = useState({})
  const [asOf, setAsOf] = useState(null)

  useEffect(() => {
    supabase.from('app_settings').select('data').eq('key', 'small_keg_pars').maybeSingle()
      .then(async ({ data }) => {
        const all = Array.isArray(data?.data) ? data.data : []
        setPars(all)
        const codes = all.filter((p) => sameBeer(p.beer, beer)).map((p) => p.code)
        if (!codes.length) return
        const { data: items } = await supabase.from('stock_items').select('code, available, pulled_at').in('code', codes)
        const by = {}
        for (const it of items ?? []) by[it.code.toLowerCase()] = (by[it.code.toLowerCase()] ?? 0) + (Number(it.available) || 0)
        setStock(by)
        setAsOf((items ?? []).map((i) => i.pulled_at).filter(Boolean).sort().pop() ?? null)
      })
      .catch(() => setPars([]))
  }, [beer])

  const mine = (pars ?? []).filter((p) => sameBeer(p.beer, beer)).sort((a, b) => a.size - b.size)
  if (!mine.length) return null

  async function setPar(entry, value) {
    const next = pars.map((p) => (p === entry ? { ...p, par: Number(value) || 0 } : p))
    setPars(next)
    await supabase.from('app_settings').upsert({ key: 'small_keg_pars', data: next, updated_at: new Date().toISOString() })
  }

  return (
    <div className="pk-par">
      {mine.map((p) => {
        const have = stock[p.code.toLowerCase()] ?? 0
        const need = Math.max(0, (Number(p.par) || 0) - have) // negative stock = sold but not yet packed, so it's filled too
        return (
          <div key={p.code} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <span>
              <strong>{p.size} L kegs: {need ? `fill ${need}` : 'none needed'}</strong>{' '}
              <span className="stock-muted">
                (par{' '}
                {isAdmin
                  ? <input type="number" min="0" value={p.par} onChange={(e) => setPar(p, e.target.value)} style={{ width: 48 }} aria-label={`${p.size} L par`} />
                  : p.par}
                , {have} in stock)
              </span>
            </span>
            {need > 0 && <button type="button" className="secondary" onClick={() => onUse(p.size, need)}>Use {need}</button>}
          </div>
        )
      })}
      {asOf && <div className="stock-muted" style={{ fontSize: '0.75rem' }}>Stock from Unleashed as of {new Date(asOf).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. Refresh it on the Stock page.</div>}
    </div>
  )
}
