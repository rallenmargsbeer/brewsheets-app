import { supabase } from '../supabaseClient'

export const SOURCE_LABEL = { unleashed: 'Unleashed', lm_3pl: 'LM 3PL', lm_wholesale: 'LM Wholesale' }

// Supabase returns at most 1000 rows per request; page through bigger tables.
async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) return out
  }
}

export async function listStock() {
  const since = new Date(Date.now() - 92 * 86400000).toISOString().slice(0, 10)
  const [items, products, runs, sales, history, core] = await Promise.all([
    fetchAll(() => supabase.from('stock_items').select('source, location, code, alt_code, description, product_group, on_hand, allocated, on_order, available, pulled_at')),
    fetchAll(() => supabase.from('stock_products').select('*')),
    supabase.from('stock_sync_runs').select('*').order('id', { ascending: false }).limit(5),
    fetchAll(() => supabase.from('stock_sales').select('sale_date, code, customer, qty').gte('sale_date', since)),
    fetchAll(() => supabase.from('stock_history').select('snap_date, code, alt_code, available').eq('source', 'lm_wholesale').gte('snap_date', since).order('snap_date')),
    coreCodes(),
  ])
  if (runs.error) throw runs.error
  return { items, products, runs: runs.data, sales, history, core }
}

// Unleashed codes in the "Core Range" product sub-group (from the nightly Unleashed sync).
// Empty if this account can't read it; the page then falls back to a fixed list.
async function coreCodes() {
  const { data } = await supabase.from('unl_dataset').select('data').eq('key', 'products').maybeSingle()
  return new Set((data?.data ?? []).filter((p) => p.range === 'Core Range').map((p) => p.code.toLowerCase()))
}

// Pulls fresh stock from Unleashed and Liquid Mix (read-only) via the stock-sync function.
export async function refreshStock() {
  const { data, error } = await supabase.functions.invoke('stock-sync', { body: { trigger: 'manual' } })
  if (error) {
    let text = error.message
    try { text = (await error.context.json()).error || text } catch { /* keep generic message */ }
    throw new Error(text)
  }
  return data
}

export async function mapStockProduct({ beer, format, source, code }) {
  const { error } = await supabase.from('stock_products').upsert({ beer, format, source, code }, { onConflict: 'source,code' })
  if (error) throw error
}

export async function unmapStockProduct(id) {
  const { error } = await supabase.from('stock_products').delete().eq('id', id)
  if (error) throw error
}

// Cube or keg, guessed from Unleashed's product group or the code itself.
export function guessFormat(item) {
  const s = `${item.product_group ?? ''} ${item.code}`.toLowerCase()
  if (/keg/.test(s)) return 'keg'
  if (/cube|16x375|x375/.test(s)) return 'cube'
  return null
}

// Keg size in litres from a product code or description ("20L Keg-ITP", "30l Keg-8 Ball",
// "KEG-8BALL30", ": 50000 ml"); kegs without a size are 50 L.
export function kegSize(code, description = '') {
  const l = /(\d{2})\s*l\b/i.exec(code) || /(\d{2})\s*l\b/i.exec(description)
  if (l) return Number(l[1])
  const ml = /(\d{5})\s*ml/i.exec(description)
  if (ml) return Math.round(Number(ml[1]) / 1000)
  const tail = /^keg-.*?(20|30)$/i.exec(code)
  return tail ? Number(tail[1]) : 50
}
