// Unleashed -> Supabase sync. READ-ONLY toward Unleashed (GET only). Writes only to this project's own tables.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAll } from './unleashed.ts'
import { derive } from './derive.ts'

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

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // ---- who is calling? either the nightly job (shared secret) or a signed-in report viewer
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
    const { data: v } = await admin.from('report_viewers').select('email').ilike('email', email).maybeSingle()
    if (!v) return json({ error: 'not a report viewer' }, 403)
    requestedBy = email
  }

  const id = Deno.env.get('UNLEASHED_API_ID')
  const key = Deno.env.get('UNLEASHED_API_KEY')
  if (!id || !key) return json({ error: 'Unleashed credentials are not set in Supabase secrets (UNLEASHED_API_ID / UNLEASHED_API_KEY).' }, 500)

  // ---- one run at a time
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: running } = await admin.from('unl_sync_runs').select('id').eq('status', 'running').gt('started_at', since).limit(1)
  if (running && running.length) return json({ error: 'A sync is already running. Try again in a few minutes.' }, 409)

  // Runs left "running" by an earlier call that was cut off (time limit) are marked as failed.
  await admin.from('unl_sync_runs').update({ status: 'error', finished_at: new Date().toISOString(), detail: 'Cut off before finishing (time limit)' })
    .eq('status', 'running').lte('started_at', since)

  const { data: run } = await admin.from('unl_sync_runs').insert({ trigger, requested_by: requestedBy }).select('id').single()
  const finish = (patch: Record<string, unknown>) =>
    admin.from('unl_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run!.id)

  try {
    const [products, assemblies] = await Promise.all([getAll('Products', id, key), getAll('Assemblies', id, key)])

    // Safety net: never overwrite good data with an obviously broken pull.
    if (products.length < 100 || assemblies.length < 500) {
      throw new Error(`Pull looks incomplete (products ${products.length}, assemblies ${assemblies.length}); existing data kept.`)
    }

    const pulled = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) // Perth date
    const data = derive(products, assemblies, pulled)
    if (!data.eff.length || !data.assemblies.length) throw new Error('Derived dataset is empty; existing data kept.')

    const rows = [
      ...['products', 'assemblies', 'fbBatches', 'beerRange', 'parked', 'eff'].map((k) => ({ key: k, data: data[k] })),
      { key: 'meta', data: { pulled, notes: { pkgMedianEntryLagDays: 0 } } },
    ].map((r) => ({ ...r, updated_at: new Date().toISOString() }))
    const { error } = await admin.from('unl_dataset').upsert(rows, { onConflict: 'key' })
    if (error) throw new Error('Saving failed: ' + error.message)

    await finish({ status: 'ok', products: data.products.length, assemblies: assemblies.length, detail: `Pulled ${pulled}` })
    return json({ ok: true, pulled, products: data.products.length, assemblies: assemblies.length })
  } catch (e) {
    await finish({ status: 'error', detail: String((e as Error).message || e).slice(0, 500) })
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
