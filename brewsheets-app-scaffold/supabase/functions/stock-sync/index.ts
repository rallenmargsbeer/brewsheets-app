// Stock on hand -> Supabase. READ-ONLY toward Unleashed (GET only) and Liquid Mix (reads its
// stock report). Writes only to this project's own stock tables.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAll, getJson } from './unleashed.ts'
import { lmStock } from './liquidmix.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Unleashed product groups worth keeping: packaged beer only (not labels, cans, boxes etc).
const GROUPS = /^(kegs|cubes|sellable 4 packs)$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // ---- who is calling? the scheduled job (shared secret) or a signed-in report viewer / schedule editor
  let trigger = 'manual'
  let requestedBy: string | null = null
  const cron = req.headers.get('x-cron-secret')
  if (cron) {
    const { data: secret } = await admin.rpc('get_sync_cron_secret')
    if (!secret || cron !== secret) return json({ error: 'forbidden' }, 403)
    trigger = 'cron'
  } else {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = await admin.auth.getUser(token)
    const email = u?.user?.email?.toLowerCase()
    if (!email) return json({ error: 'sign in required' }, 401)
    const [{ data: v }, { data: e }] = await Promise.all([
      admin.from('report_viewers').select('email').ilike('email', email).maybeSingle(),
      admin.from('schedule_editors').select('email').ilike('email', email).maybeSingle(),
    ])
    if (!v && !e) return json({ error: 'not allowed to refresh stock' }, 403)
    requestedBy = email
  }

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: running } = await admin.from('stock_sync_runs').select('id').eq('status', 'running').gt('started_at', since).limit(1)
  if (running && running.length) return json({ error: 'A stock refresh is already running. Try again in a minute.' }, 409)
  const { data: run } = await admin.from('stock_sync_runs').insert({ trigger, requested_by: requestedBy }).select('id').single()
  const runId = run!.id
  const pulledAt = new Date().toISOString()

  // Each source replaces its own rows only when it pulled cleanly; a failed source keeps its last data.
  async function save(source: string, rows: Record<string, unknown>[]) {
    if (!rows.length) throw new Error(`${source}: no stock rows returned; existing data kept.`)
    const { error } = await admin.from('stock_items').insert(rows.map((r) => ({ ...r, source, run_id: runId, pulled_at: pulledAt })))
    if (error) throw new Error(`${source}: saving failed: ${error.message}`)
    await admin.from('stock_items').delete().eq('source', source).neq('run_id', runId)
    return rows.length
  }

  const results: Record<string, string> = {}
  const env = (k: string) => Deno.env.get(k)

  // ---- Unleashed: stock on hand by warehouse
  try {
    const id = env('UNLEASHED_API_ID'), key = env('UNLEASHED_API_KEY')
    if (!id || !key) throw new Error('UNLEASHED_API_ID / UNLEASHED_API_KEY not set')
    // Company-wide totals, then each packaged product's split by warehouse.
    const totals = (await getAll('StockOnHand', {}, id, key)).filter(
      (s: any) => GROUPS.test(s.ProductGroupName || '') && (s.QtyOnHand || s.AllocatedQty)
    )
    const row = (s: any, location: string) => ({
      location,
      code: String(s.ProductCode || '').trim(),
      description: s.ProductDescription,
      product_group: s.ProductGroupName,
      on_hand: s.QtyOnHand || 0,
      allocated: s.AllocatedQty || 0,
      available: s.AvailableQty ?? (s.QtyOnHand || 0) - (s.AllocatedQty || 0),
    })
    const rows: Record<string, unknown>[] = []
    let sample = ''
    try {
      // A few products at a time keeps it quick without hammering the API.
      for (let i = 0; i < totals.length; i += 6) {
        await Promise.all(totals.slice(i, i + 6).map(async (t: any) => {
          const per = await getJson(`StockOnHand/${t.ProductGuid}/AllWarehouses`, {}, id, key)
          if (!sample) sample = JSON.stringify(per).slice(0, 700)
          const list = Array.isArray(per) ? per : per.Items || []
          for (const w of list) {
            // This endpoint only gives available qty per warehouse.
            const qty = w.QtyOnHand ?? w.AvailableQty ?? 0
            if (!qty && !w.AllocatedQty) continue
            const name = typeof w.Warehouse === 'string' ? w.Warehouse : w.Warehouse?.WarehouseName || w.WarehouseName || w.WarehouseCode || 'Unknown warehouse'
            rows.push(row({ ...t, ...w, QtyOnHand: qty, AllocatedQty: w.AllocatedQty ?? 0, AvailableQty: w.AvailableQty ?? qty, ProductCode: t.ProductCode, ProductDescription: t.ProductDescription, ProductGroupName: t.ProductGroupName }, name))
          }
        }))
      }
      if (!rows.length && totals.length) throw new Error('no warehouse rows matched; response looks like ' + sample)
    } catch (e) {
      results.unleashed_note = 'warehouse split unavailable (' + String((e as Error).message) + '); totals only'
      rows.length = 0
      for (const t of totals) rows.push(row(t, 'All warehouses'))
    }
    results.unleashed = `${await save('unleashed', rows)} rows`
  } catch (e) {
    results.unleashed = 'error: ' + String((e as Error).message || e)
  }

  // ---- Liquid Mix: 3PL and wholesale accounts
  for (const [source, label, user, pass] of [
    ['lm_3pl', 'LM 3PL', env('LM_3PL_USERNAME'), env('LM_3PL_PASSWORD')],
    ['lm_wholesale', 'LM Wholesale', env('LM_WHOLESALE_USERNAME'), env('LM_WHOLESALE_PASSWORD')],
  ] as const) {
    try {
      if (!user || !pass) throw new Error('username / password secrets not set')
      const stock = await lmStock(user, pass)
      const n = await save(source, stock.map((s) => ({
        location: label,
        // The two LM accounts put their own code and the vendor code in opposite columns; keep both.
        code: s.item,
        alt_code: s.code,
        description: s.description,
        product_group: s.upc ? `${s.upc} per unit` : null,
        on_hand: s.soh,
        on_order: s.soo,
        allocated: s.sold,
        available: s.available,
      })))
      results[source] = `${n} rows`
    } catch (e) {
      results[source] = 'error: ' + String((e as Error).message || e)
    }
  }

  // ---- Daily snapshot of every source's current stock (one per day; a rerun replaces it)
  try {
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) // Perth date
    const { data: now } = await admin.from('stock_items').select('source, location, code, alt_code, available')
    if (now?.length) {
      await admin.from('stock_history').delete().eq('snap_date', today)
      const { error } = await admin.from('stock_history').insert(now.map((r) => ({ ...r, snap_date: today })))
      if (error) throw error
    }
  } catch (e) {
    results.history_note = 'snapshot failed: ' + String((e as Error).message || e)
  }

  // ---- Unleashed sales orders for the last 13 weeks (read-only), summed per day, product and customer
  try {
    const id = env('UNLEASHED_API_ID'), key = env('UNLEASHED_API_KEY')
    if (!id || !key) throw new Error('Unleashed credentials not set')
    const since = new Date(Date.now() - 91 * 86400000).toISOString().slice(0, 10)
    const orders = await getAll('SalesOrders', { startDate: since }, id, key)
    const msDate = (v: string) => {
      const m = /-?\d+/.exec(String(v || ''))
      return m ? new Date(parseInt(m[0], 10) + 8 * 3600 * 1000).toISOString().slice(0, 10) : null
    }
    const sums = new Map<string, { sale_date: string; code: string; customer: string; qty: number }>()
    for (const o of orders) {
      if (!['Completed', 'Placed', 'Backordered', 'Dispatched'].includes(o.OrderStatus)) continue
      const d = msDate(o.OrderDate)
      if (!d || d < since) continue
      const customer = o.Customer?.CustomerName || ''
      for (const l of o.SalesOrderLines || []) {
        const code = String(l.Product?.ProductCode || '').trim()
        const qty = Number(l.OrderQuantity || 0)
        if (!code || !qty) continue
        const k = `${d}|${code}|${customer}`
        const e = sums.get(k) ?? { sale_date: d, code, customer, qty: 0 }
        e.qty += qty
        sums.set(k, e)
      }
    }
    if (!sums.size) throw new Error('no sales lines returned; existing sales kept')
    await admin.from('stock_sales').delete().gte('sale_date', '1900-01-01')
    const rows = [...sums.values()]
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await admin.from('stock_sales').insert(rows.slice(i, i + 1000))
      if (error) throw error
    }
    results.sales_note = `${orders.length} orders, ${rows.length} sales lines`
  } catch (e) {
    results.sales_note = 'sales pull failed: ' + String((e as Error).message || e)
  }

  const failed = Object.entries(results).filter(([k]) => !k.endsWith('_note')).map(([, v]) => v).filter((r) => r.startsWith('error')).length
  const detail = Object.entries(results).map(([k, v]) => `${k}: ${v}`).join(' · ')
  await admin.from('stock_sync_runs').update({ finished_at: new Date().toISOString(), status: failed === 3 ? 'error' : failed ? 'partial' : 'ok', detail: detail.slice(0, 1000) }).eq('id', runId)
  return json({ ok: failed < 3, results }, failed === 3 ? 500 : 200)
})
