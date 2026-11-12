// Assemblies from Unleashed that aren't completed yet. READ-ONLY toward Unleashed (GET only).
// Saved to unl_dataset 'assemblies' with their lines, plus a count of every status seen.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAll } from './unleashed.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: secret } = await admin.rpc('get_sync_cron_secret')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403)

  const id = Deno.env.get('UNLEASHED_API_ID'), key = Deno.env.get('UNLEASHED_API_KEY')
  if (!id || !key) return json({ error: 'Unleashed credentials not set' }, 500)
  try {
    // Optional Unleashed query filters (e.g. { assemblyStatus: 'Forecasted' }), still GET only.
    const body = await req.json().catch(() => ({}))
    const params: Record<string, string> = {}
    for (const [k, v] of Object.entries(body?.params ?? {})) if (/^[a-zA-Z]+$/.test(k)) params[k] = String(v)
    const all = await getAll('Assemblies', params, id, key)
    const statuses: Record<string, number> = {}
    for (const a of all) statuses[a.AssemblyStatus ?? 'none'] = (statuses[a.AssemblyStatus ?? 'none'] ?? 0) + 1
    const open = all.filter((a: any) => !/^(completed|deleted)$/i.test(a.AssemblyStatus ?? '')).map((a: any) => ({
      number: a.AssemblyNumber,
      status: a.AssemblyStatus,
      date: a.AssemblyDate ?? null,
      assembleBy: a.AssembleBy ?? null,
      code: a.Product?.ProductCode,
      description: a.Product?.ProductDescription,
      qty: a.Quantity,
      comments: a.Comments ?? null,
      // Every other header field, so custom statuses (e.g. FORECASTED-FB) are kept.
      extra: Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'AssemblyLines' && v != null)),
      lines: (a.AssemblyLines || []).map((l: any) => ({
        code: l.Product?.ProductCode,
        description: l.Product?.ProductDescription,
        qty: l.Quantity,
        unit: l.Product?.UnitOfMeasure?.Name ?? null,
      })),
    }))
    const at = new Date().toISOString()
    const dkey = body?.key && /^[a-zA-Z_]+$/.test(body.key) ? body.key : 'assemblies'
    const { error } = await admin.from('unl_dataset').upsert({ key: dkey, data: { at, params, statuses, open }, updated_at: at })
    if (error) throw error
    return json({ ok: true, total: all.length, open: open.length, statuses })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
