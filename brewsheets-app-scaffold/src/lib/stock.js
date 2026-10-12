import { supabase } from '../supabaseClient'

export const SOURCE_LABEL = { unleashed: 'Unleashed', lm_3pl: 'LM 3PL', lm_wholesale: 'LM Wholesale' }

export async function listStock() {
  const [items, products, runs] = await Promise.all([
    supabase.from('stock_items').select('source, location, code, alt_code, description, product_group, on_hand, allocated, on_order, available, pulled_at'),
    supabase.from('stock_products').select('*'),
    supabase.from('stock_sync_runs').select('*').order('id', { ascending: false }).limit(5),
  ])
  for (const r of [items, products, runs]) if (r.error) throw r.error
  return { items: items.data, products: products.data, runs: runs.data }
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
