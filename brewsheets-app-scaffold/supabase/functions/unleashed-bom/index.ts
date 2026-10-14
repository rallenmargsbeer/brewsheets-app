// Bills of materials from Unleashed. READ-ONLY toward Unleashed (GET only).
// Beers (FB- products) -> unl_dataset 'boms' (to draft recipes); everything else (cubes,
// kegs and other packaged products) -> 'pack_boms' (packaging materials report).
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
    const shape = (b: any) => ({
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
      })
    const isBeer = (b: any) => /^FB-/i.test(b.Product?.ProductCode || '')
    const beers = boms.filter(isBeer).map(shape)
    const packs = boms.filter((b: any) => !isBeer(b) && !b.Obsolete).map(shape)
    const at = new Date().toISOString()
    const { error } = await admin.from('unl_dataset').upsert([{ key: 'boms', data: beers, updated_at: at }, { key: 'pack_boms', data: packs, updated_at: at }])
    if (error) throw error
    return json({ ok: true, boms: boms.length, beers: beers.length, packs: packs.length })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
