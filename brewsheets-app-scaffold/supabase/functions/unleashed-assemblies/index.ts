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
    const all = await getAll('Assemblies', {}, id, key)
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
      lines: (a.AssemblyLines || []).map((l: any) => ({
        code: l.Product?.ProductCode,
        description: l.Product?.ProductDescription,
        qty: l.Quantity,
        unit: l.Product?.UnitOfMeasure?.Name ?? null,
      })),
    }))
    const at = new Date().toISOString()
    const { error } = await admin.from('unl_dataset').upsert({ key: 'assemblies', data: { at, statuses, open }, updated_at: at })
    if (error) throw error
    return json({ ok: true, total: all.length, open: open.length, statuses })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
