import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { listIngredients } from '../lib/api'
import { loadForecast, addMonths, monthOf, CUBE_L, KEG_L, YIELD } from '../lib/forecast'
import { loadSkuEfficiency } from '../lib/efficiency'
import { beerMatch } from '../lib/incoming'
import { todayIso } from '../lib/schedule'

const fmtMonth = (m) => new Date(`${m}T00:00:00`).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
const kg = (g) => (g / 1000).toLocaleString('en-AU', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

// Hops for contracting: each beer's sales forecast (packaged litres) → brewed litres at its
// own efficiency (80% where it has fewer than 2 finished batches) → hops at its current
// recipe's rates (kettle, whirlpool and fermenter / dry hop). Months past the last one
// forecast repeat the same calendar month from the latest year entered, plus growth.
export default function HopForecast() {
  const [src, setSrc] = useState(null)
  const [error, setError] = useState(null)
  const [start, setStart] = useState(addMonths(monthOf(todayIso()), 1))
  const [count, setCount] = useState(24)
  const [growth, setGrowth] = useState(10)
  const [copied, setCopied] = useState(false)
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)

  useEffect(() => {
    Promise.all([
      loadForecast(),
      supabase.from('recipes').select('name, is_rtd, is_active, recipe_kettle_additions(item_name, qty_g_per_l), recipe_whirlpool_additions(item_name, qty_g_per_l), recipe_fermenter_additions(item_name, qty_g_per_l)'),
      listIngredients(),
      loadSkuEfficiency().catch(() => () => null),
      supabase.from('hop_contracts').select('*').order('hop').order('contract_year'),
      supabase.from('unl_dataset').select('data').eq('key', 'hopStock').maybeSingle(),
    ]).then(([fc, recipes, ingredients, effFor, contracts, stock]) => {
      if (recipes.error) throw recipes.error
      if (contracts.error) throw contracts.error
      setSrc({ fc, recipes: recipes.data, ingredients, effFor, contracts: contracts.data, stock: stock.data?.data ?? null })
    }).catch((e) => setError(e.message))
  }, [version])

  const out = useMemo(() => {
    if (!src) return null
    const hops = new Set(src.ingredients.filter((i) => /hop/i.test(i.unleashed_group ?? '') || i.alpha_acid_pct != null).map((i) => i.name))
    // Hop grams per brewed litre for each recipe.
    const rates = new Map()
    for (const r of src.recipes.filter((r) => !r.is_rtd && r.is_active !== false)) {
      const m = new Map()
      for (const l of [...(r.recipe_kettle_additions ?? []), ...(r.recipe_whirlpool_additions ?? []), ...(r.recipe_fermenter_additions ?? [])]) {
        if (hops.has(l.item_name) && Number(l.qty_g_per_l) > 0) m.set(l.item_name, (m.get(l.item_name) ?? 0) + Number(l.qty_g_per_l))
      }
      rates.set(beerMatch(r.name), m)
    }
    const rtd = new Set(src.recipes.filter((r) => r.is_rtd).map((r) => beerMatch(r.name)))
    // Packaged litres per beer per month as entered, and the latest year entered for each calendar month.
    const entered = new Map() // beerKey|month -> L
    const names = new Map()
    let last = null
    for (const r of src.fc.rows) {
      const L = Number(r.qty) * (r.format === 'keg' ? KEG_L : CUBE_L)
      const k = `${beerMatch(r.beer)}|${r.month}`
      entered.set(k, (entered.get(k) ?? 0) + L)
      names.set(beerMatch(r.beer), r.beer)
      if (!last || r.month > last) last = r.month
    }
    const months = Array.from({ length: count }, (_, i) => addMonths(start, i))
    const packaged = (bk, m) => {
      if (entered.has(`${bk}|${m}`) || m <= last) return entered.get(`${bk}|${m}`) ?? 0
      let back = m, years = 0
      while (back > last) { back = addMonths(back, -12); years++ }
      return (entered.get(`${bk}|${back}`) ?? 0) * Math.pow(1 + growth / 100, years)
    }
    const byHop = new Map() // hop -> month -> g
    const byBeer = []
    const noRecipe = []
    for (const [bk, name] of names) {
      const rate = rates.get(bk)
      if (!rate) { if (!rtd.has(bk)) noRecipe.push(name); continue }
      if (!rate.size) continue // no hops (e.g. RTD)
      const e = src.effFor(name)
      const yieldF = e && e.n >= 2 ? e.overall : YIELD
      let brewed = 0
      for (const m of months) {
        const L = packaged(bk, m) / yieldF
        brewed += L
        for (const [hop, gpl] of rate) {
          const row = byHop.get(hop) ?? new Map()
          row.set(m, (row.get(m) ?? 0) + L * gpl)
          byHop.set(hop, row)
        }
      }
      byBeer.push({ name, yieldF, brewed, own: !!(e && e.n >= 2) })
    }
    const hopRows = [...byHop].map(([hop, row]) => ({ hop, row, total: [...row.values()].reduce((a, g) => a + g, 0) })).sort((a, b) => b.total - a.total)
    // Position per hop: on hand (Unleashed) + still to come on contracts, against need.
    const onHand = new Map((src.stock?.items ?? []).map((i) => [i.name, Number(i.onHand) || 0]))
    const contracted = new Map()
    for (const c of src.contracts) contracted.set(c.hop, (contracted.get(c.hop) ?? 0) + Number(c.remaining_kg) * 1000)
    const posHops = [...new Set([...byHop.keys(), ...contracted.keys()])]
    const position = posHops.map((hop) => {
      const row = byHop.get(hop) ?? new Map()
      const have = (onHand.get(hop) ?? 0) * 1000 + (contracted.get(hop) ?? 0)
      // A contract line only counts from its "available from" month (e.g. next crop's release).
      const lines = src.contracts.filter((c) => c.hop === hop)
      const haveBy = (m) => (onHand.get(hop) ?? 0) * 1000 + lines.filter((c) => !c.available_from || c.available_from.slice(0, 7) <= m.slice(0, 7)).reduce((a, c) => a + Number(c.remaining_kg) * 1000, 0)
      let cum = 0, runsOut = null
      for (const m of months) { cum += row.get(m) ?? 0; if (!runsOut && cum > haveBy(m)) runsOut = m }
      const need = (y) => months.slice(y * 12, y * 12 + 12).reduce((a, m) => a + (row.get(m) ?? 0), 0)
      return { hop, onHand: (onHand.get(hop) ?? 0) * 1000, contracted: contracted.get(hop) ?? 0, need1: need(0), need2: need(1), have, runsOut, total: [...row.values()].reduce((a, g) => a + g, 0) }
    }).sort((a, b) => b.total - a.total || b.contracted - a.contracted)
    return { months, hopRows, position, byBeer: byBeer.sort((a, b) => b.brewed - a.brewed), noRecipe, last, years: Math.ceil(count / 12) }
  }, [src, start, count, growth])

  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState(null)
  async function refreshStock() {
    setPulling(true); setPullError(null)
    const { data, error: e } = await supabase.functions.invoke('hop-stock', { body: {} })
    if (e || data?.error) setPullError(data?.error ?? e.message)
    else reload()
    setPulling(false)
  }

  if (error) return <p style={{ color: '#b00020' }}>{error}</p>
  if (!out) return <p>Loading…</p>
  const yearSum = (row, y) => out.months.slice(y * 12, y * 12 + 12).reduce((a, m) => a + (row.get(m) ?? 0), 0)
  const yearLabel = (y) => `${fmtMonth(out.months[y * 12])} to ${fmtMonth(out.months[Math.min(out.months.length, y * 12 + 12) - 1])}`
  function copy() {
    const head = ['Hop', ...Array.from({ length: out.years }, (_, y) => `${yearLabel(y)} (kg)`), ...out.months.map((m) => `${fmtMonth(m)} (kg)`)]
    const lines = [head.join('\t'), ...out.hopRows.map((h) => [h.hop, ...Array.from({ length: out.years }, (_, y) => (yearSum(h.row, y) / 1000).toFixed(1)), ...out.months.map((m) => ((h.row.get(m) ?? 0) / 1000).toFixed(1))].join('\t'))]
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <>
      <div className="stock-controls">
        <label>From <input type="month" value={start.slice(0, 7)} onChange={(e) => e.target.value && setStart(`${e.target.value}-01`)} /></label>
        <label>For
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[6, 12, 18, 24].map((n) => <option key={n} value={n}>{n} months</option>)}
          </select>
        </label>
        <label>Growth after {fmtMonth(out.last)} <input type="number" value={growth} onChange={(e) => setGrowth(Number(e.target.value) || 0)} style={{ width: 60 }} /> % a year</label>
        <button className="secondary" onClick={copy} disabled={!out.hopRows.length}>{copied ? '✓ Copied' : 'Copy table'}</button>
      </div>
      <section className="stock-card">
        <h2>Hop position <span>kg: on hand + still on contract, against forecast need</span></h2>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <span className="stock-muted" style={{ fontSize: '0.85rem' }}>On hand from Unleashed{src.stock?.pulled ? `, ${new Date(src.stock.pulled).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ': not pulled yet'}</span>
          <button className="secondary" onClick={refreshStock} disabled={pulling}>{pulling ? 'Pulling…' : 'Refresh stock'}</button>
          {pullError && <span style={{ color: 'crimson' }}>{pullError}</span>}
        </div>
        <div className="stock-scroll">
          <table className="stock-table">
            <thead>
              <tr>
                <th className="stock-beer">Hop</th><th>On hand</th><th>On contract</th>
                <th>Need {yearLabel(0)}</th>{out.years > 1 && <th>Need {yearLabel(1)}</th>}
                <th>Left after {out.years > 1 ? 'year 2' : 'year 1'}</th><th>Runs out</th>
              </tr>
            </thead>
            <tbody>
              {out.position.map((h) => {
                const left = h.have - h.need1 - (out.years > 1 ? h.need2 : 0)
                return (
                  <tr key={h.hop}>
                    <td className="stock-beer">{h.hop}</td>
                    <td>{kg(h.onHand)}</td>
                    <td>{h.contracted ? kg(h.contracted) : '—'}</td>
                    <td>{kg(h.need1)}</td>
                    {out.years > 1 && <td>{kg(h.need2)}</td>}
                    <td className={left < 0 ? 'stock-neg' : ''}><strong>{left < 0 ? `short ${kg(-left)}` : kg(left)}</strong></td>
                    <td>{h.runsOut ? <span className="stock-pill low">{fmtMonth(h.runsOut)}</span> : <span className="stock-muted">covered</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <HopContracts contracts={src.contracts} hops={[...new Set([...out.position.map((p) => p.hop), ...src.ingredients.filter((i) => /hop/i.test(i.unleashed_group ?? '')).map((i) => i.name)])].sort()} onChanged={reload} />

      <section className="stock-card">
        <h2>Hops needed <span>kg, from the sales forecast and current recipes</span></h2>
        <div className="stock-scroll">
          <table className="stock-table">
            <thead>
              <tr>
                <th className="stock-beer">Hop</th>
                {Array.from({ length: out.years }, (_, y) => <th key={y} className="stock-total">{yearLabel(y)}</th>)}
                {out.months.map((m) => <th key={m} className={m > out.last ? 'stock-muted' : ''}>{fmtMonth(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {out.hopRows.map((h) => (
                <tr key={h.hop}>
                  <td className="stock-beer">{h.hop}</td>
                  {Array.from({ length: out.years }, (_, y) => <td key={y} className="stock-total">{kg(yearSum(h.row, y))}</td>)}
                  {out.months.map((m) => <td key={m}>{kg(h.row.get(m) ?? 0)}</td>)}
                </tr>
              ))}
              {!out.hopRows.length && <tr><td colSpan={out.months.length + 1 + out.years} className="stock-muted">No hops: check the recipes have hop lines and the Ingredients page marks them as hops.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="stock-muted" style={{ fontSize: '0.8rem' }}>
          Greyed months are past the last month forecast ({fmtMonth(out.last)}): they repeat the same month from the latest year entered{growth ? `, plus ${growth}% a year` : ''}.
          Brewed litres: {out.byBeer.map((b) => `${b.name} ${Math.round(b.brewed).toLocaleString()} L at ${Math.round(b.yieldF * 100)}%${b.own ? '' : ' (default)'}`).join(' · ')}.
          {out.noRecipe.length > 0 && <> No recipe matched (left out): {out.noRecipe.join(', ')}.</>}
        </p>
      </section>
    </>
  )
}

// The contracts behind the "On contract" column: what's still to come from each supplier.
// Update the remaining kg when a new statement arrives; each change saves straight away.
function HopContracts({ contracts, hops, onChanged }) {
  const [error, setError] = useState(null)
  const save = async (id, fields) => {
    setError(null)
    const { error: e } = await supabase.from('hop_contracts').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
    if (e) setError(e.message); else onChanged()
  }
  async function add() {
    const { error: e } = await supabase.from('hop_contracts').insert({ supplier: 'Supplier', hop: hops[0] ?? 'Hop', remaining_kg: 0, as_of: todayIso() })
    if (e) setError(e.message); else onChanged()
  }
  async function remove(c) {
    if (!window.confirm(`Remove the ${c.supplier} ${c.contract_year ?? ''} line for ${c.hop}?`)) return
    const { error: e } = await supabase.from('hop_contracts').delete().eq('id', c.id)
    if (e) setError(e.message); else onChanged()
  }
  const cell = (c, k, props = {}) => (
    <input defaultValue={c[k] ?? ''} {...props} onBlur={(e) => {
      const v = e.target.value === '' ? null : props.type === 'number' ? Number(e.target.value) : e.target.value
      if (String(v ?? '') !== String(c[k] ?? '')) save(c.id, { [k]: v })
    }} />
  )
  return (
    <section className="stock-card">
      <h2>Hop contracts <span>remaining to be shipped; edit when a new statement comes in</span></h2>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <datalist id="hop-names">{hops.map((h) => <option key={h} value={h} />)}</datalist>
      <div className="stock-scroll">
        <table className="stock-table">
          <thead><tr><th>Supplier</th><th>Agreement</th><th>Year</th><th className="stock-beer">Hop</th><th>Remaining kg</th><th>Available from</th><th>Order by</th><th>Statement date</th><th></th></tr></thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td>{cell(c, 'supplier', { style: { width: 130 } })}</td>
                <td>{cell(c, 'agreement', { style: { width: 110 } })}</td>
                <td>{cell(c, 'contract_year', { type: 'number', style: { width: 65 } })}</td>
                <td className="stock-beer">{cell(c, 'hop', { list: 'hop-names', style: { width: 240 } })}</td>
                <td>{cell(c, 'remaining_kg', { type: 'number', step: '0.1', style: { width: 80 } })}</td>
                <td>{cell(c, 'available_from', { type: 'date' })}</td>
                <td>{cell(c, 'order_by', { type: 'date' })}</td>
                <td>{cell(c, 'as_of', { type: 'date' })}</td>
                <td><button className="secondary" onClick={() => remove(c)} aria-label="Remove contract line" style={{ padding: '0.2rem 0.5rem' }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="secondary" onClick={add} style={{ marginTop: '0.5rem' }}>+ Add contract line</button>
    </section>
  )
}
