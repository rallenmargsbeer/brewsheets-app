import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth'
import template from '../dashboardTemplate.html?raw'

const KEYS = ['products', 'assemblies', 'fbBatches', 'beerRange', 'parked', 'eff', 'meta', 'sheetInfo']

// Same key the dashboard uses for a batch: batch number + beer code.
const bkey = (b) => (b.bn + '__' + b.beer[0]).replace(/[^A-Za-z0-9_-]+/g, '-')

// Unleashed entries filed under the wrong batch number (can't be changed there): Unleashed key -> real batch number.
const ALIAS = { '396__FB-Drift-XPA': '395' }

// Match an Unleashed beer code (e.g. FB-ITP, FB-Draught) to a brewsheets-app beer name (e.g. In The Pines, Draught).
const nbn = (x) => String(x).trim().replace(/^0+(?=\d)/, '')
const norm = (s) => String(s || '').toLowerCase().replace(/^fb-/, '').replace(/[^a-z0-9]/g, '')
const initials = (s) => String(s || '').toLowerCase().replace(/^fb-/, '').split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join('')
const sameBeer = (style, beer) => {
  const a = norm(style), b = norm(beer)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a) || initials(style) === b
}

// Turn the brewsheets-app litres (per batch number) into per-batch figures.
// If Unleashed has several different beers under one batch number, only the beer that matches the app's beer gets the litres.
function appFermenterLitres(eff, rows, styles) {
  const byBn = {}
  for (const r of rows || []) byBn[nbn(r.batch_number)] = Number(r.fv_litres)
  const style = {}
  for (const r of styles || []) style[nbn(r.batch_number)] = r.beer_style
  const out = {}
  const groups = {}
  for (const b of eff) { const k = ALIAS[bkey(b)] || nbn(b.bn); (groups[k] = groups[k] || []).push(b) }
  for (const [bn, all] of Object.entries(groups)) {
    const fv = byBn[bn]
    if (!(fv > 0)) continue
    let list = all
    if (new Set(all.map((b) => b.beer[0])).size > 1) list = all.filter((b) => sameBeer(style[bn], b.beer[0]))
    const tot = list.reduce((s, b) => s + b.L, 0)
    if (!(tot > 0)) continue
    for (const b of list) out[bkey(b)] = Math.round(fv * (b.L / tot))
  }
  return out
}

export default function DashboardPage() {
  const { session } = useAuth()
  const email = session && session.user ? session.user.email : null
  const frame = useRef(null)
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    Promise.all([
      supabase.from('unl_dataset').select('key, data').in('key', KEYS),
      supabase.from('eff_fv_litres').select('batch_key, source, litres'),
      supabase.from('app_batch_fv').select('batch_number, fv_litres'),
      supabase.from('batches').select('batch_number, beer_style'),
    ]).then(([ds, fv, app, bs]) => {
      if (off) return
      if (ds.error) return setErr(ds.error.message)
      const m = Object.fromEntries((ds.data || []).map((r) => [r.key, r.data]))
      if (!m.assemblies || !m.meta) {
        return setErr('No Unleashed data available. Either it has not been synced yet (press Refresh on the Reports page) or this account is not on the report viewers list.')
      }
      const DATA = {
        products: m.products, assemblies: m.assemblies, pulled: m.meta.pulled, fbBatches: m.fbBatches,
        beerRange: m.beerRange, notes: m.meta.notes || {}, parked: m.parked, eff: m.eff,
      }
      const OV = {}, SH = {}
      for (const r of fv.data || []) {
        if (r.source === 'manual') OV[r.batch_key] = { L: Number(r.litres) }
        else if (r.source === 'sheet') SH[r.batch_key] = Number(r.litres)
      }
      const FV = {
        OV, SH,
        AP: app.error ? {} : appFermenterLitres(m.eff, app.data, bs.data),
        SHI: m.sheetInfo ? { at: m.sheetInfo.imported || '', unmatched: m.sheetInfo.unmatched || 0 } : {},
      }
      const esc = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16))
      setDoc(template.replace('__DATA__', () => esc(DATA)).replace('__FV__', () => esc(FV)))
    })
    return () => { off = true }
  }, [])

  // The dashboard asks us to save a typed fermenter-litres figure; we write it as the signed-in user.
  useEffect(() => {
    const onMsg = async (e) => {
      const d = e.data
      if (!frame.current || e.source !== frame.current.contentWindow || !d || d.type !== 'fv-save') return
      if (typeof d.key !== 'string' || d.key.length > 200) return
      let error
      if (d.L == null) {
        ;({ error } = await supabase.from('eff_fv_litres').delete().eq('batch_key', d.key).eq('source', 'manual'))
      } else {
        const L = Math.round(Number(d.L))
        if (!(L > 0)) return
        ;({ error } = await supabase.from('eff_fv_litres').upsert(
          { batch_key: d.key, source: 'manual', litres: L, set_by: email, updated_at: new Date().toISOString() },
          { onConflict: 'batch_key,source' }
        ))
      }
      e.source.postMessage({ type: 'fv-result', ok: !error }, '*')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [email])

  // The dashboard asks us to have Claude write commentary; the report-ai function does it for signed-in viewers.
  useEffect(() => {
    const onMsg = async (e) => {
      const d = e.data
      if (!frame.current || e.source !== frame.current.contentWindow || !d || d.type !== 'ai-ask') return
      if (typeof d.id !== 'string' || typeof d.prompt !== 'string') return
      let msg = null
      let text = null
      try {
        const { data, error } = await supabase.functions.invoke('report-ai', { body: { prompt: d.prompt } })
        if (error) {
          msg = error.message
          try { const j = await error.context.json(); if (j && j.error) msg = j.error } catch { /* keep message */ }
        } else if (data && data.text) text = data.text
        else msg = (data && data.error) || 'No text came back.'
      } catch (err) {
        msg = String((err && err.message) || err)
      }
      e.source.postMessage({ type: 'ai-result', id: d.id, ok: !!text, text, error: msg }, '*')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return (
    <div>
      <p style={{ margin: '0 0 0.5rem' }}><Link to="/reports">← Reports</Link></p>
      {err && <p style={{ color: '#b00020' }}>{err}</p>}
      {!doc && !err && <p style={{ color: '#666' }}>Loading data…</p>}
      {doc && (
        <iframe
          ref={frame}
          title="Board dashboard"
          srcDoc={doc}
          style={{ width: '100%', height: 'calc(100vh - 140px)', minHeight: 640, border: '1px solid #ddd', borderRadius: 6, background: '#fff' }}
        />
      )}
    </div>
  )
}
