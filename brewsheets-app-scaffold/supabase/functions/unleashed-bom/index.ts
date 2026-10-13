// Bills of materials for the beers (FB- products) -> unl_dataset 'boms'. READ-ONLY toward
// Unleashed (GET only). Used to draft recipes.
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
    const boms = await getAll('BillOfMaterials', {}, id, key)
    const beers = boms
      .filter((b: any) => /^FB-/i.test(b.Product?.ProductCode || ''))
      .map((b: any) => ({
        code: b.Product.ProductCode,
        description: b.Product.ProductDescription,
        unit: b.Product.UnitOfMeasure?.Name ?? null,
        obsolete: !!b.Obsolete,
        lines: (b.BillOfMaterialsLines || []).map((l: any) => ({
          code: l.Product?.ProductCode,
          description: l.Product?.ProductDescription,
          qty: l.Quantity,
          unit: l.Product?.UnitOfMeasure?.Name ?? null,
          group: l.Product?.ProductGroup?.GroupName ?? null,
        })),
      }))
    const { error } = await admin.from('unl_dataset').upsert({ key: 'boms', data: beers, updated_at: new Date().toISOString() })
    if (error) throw error
    return json({ ok: true, boms: boms.length, beers: beers.length, sample: JSON.stringify(boms[0]).slice(0, 1500) })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
