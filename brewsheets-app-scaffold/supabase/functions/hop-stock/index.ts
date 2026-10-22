// Hop stock on hand from Unleashed -> unl_dataset 'hopStock'. READ-ONLY toward Unleashed (GET only).
// For the Forecast page's hop forecast. Run by an admin from that page, or with the cron secret.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAll } from './unleashed.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const cron = req.headers.get('x-cron-secret')
  if (cron) {
    const { data: secret } = await admin.rpc('get_sync_cron_secret')
    if (!secret || cron !== secret) return json({ error: 'forbidden' }, 403)
  } else {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = await admin.auth.getUser(token)
    if (!u?.user) return json({ error: 'sign in required' }, 401)
    const { data: me } = await admin.from('app_users').select('role, status').eq('id', u.user.id).maybeSingle()
    if (me?.role !== 'admin' || me?.status !== 'active') return json({ error: 'admins only' }, 403)
  }

  const id = Deno.env.get('UNLEASHED_API_ID'), key = Deno.env.get('UNLEASHED_API_KEY')
  if (!id || !key) return json({ error: 'Unleashed credentials not set' }, 500)
  try {
    const { data: hops, error } = await admin.from('ingredients').select('name, unleashed_code').eq('unleashed_group', 'Hops')
    if (error) throw error
    const nameOf = new Map(hops.map((h) => [h.unleashed_code, h.name]))
    const soh = await getAll('StockOnHand', {}, id, key)
    const items = soh
      .filter((s: any) => nameOf.has(s.ProductCode))
      .map((s: any) => ({ code: s.ProductCode, name: nameOf.get(s.ProductCode), onHand: Number(s.QtyOnHand || 0), available: Number(s.AvailableQty ?? s.QtyOnHand ?? 0) }))
      .filter((s: any) => s.onHand || s.available)
    const data = { pulled: new Date().toISOString(), items }
    const { error: e2 } = await admin.from('unl_dataset').upsert({ key: 'hopStock', data, updated_at: data.pulled })
    if (e2) throw e2
    return json({ ok: true, hops: items.length })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
