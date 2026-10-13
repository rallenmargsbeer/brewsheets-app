// Raw materials from Unleashed -> ingredients. READ-ONLY toward Unleashed (GET only).
// New products are added flagged needs_review so editors check them; existing ones get
// their name / group / unit refreshed (sections, PPG, alpha and colour are never touched);
// products Unleashed marks obsolete are hidden.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAll } from './unleashed.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const GROUPS = ['hops', 'malt', 'yeast', 'salt', 'other raw material']

// Default recipe sections for a new ingredient, by its Unleashed group (as the CSV import did).
function sectionsFor(group: string) {
  const g = group.trim().toLowerCase()
  if (g === 'hops') return ['kettle', 'whirlpool', 'fermenter']
  if (g === 'malt') return ['grist']
  if (g === 'yeast') return ['fermenter']
  if (g === 'salt') return ['water', 'kettle']
  return []
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // The daily job (shared secret) or a signed-in schedule editor.
  const cron = req.headers.get('x-cron-secret')
  if (cron) {
    const { data: secret } = await admin.rpc('get_sync_cron_secret')
    if (!secret || cron !== secret) return json({ error: 'forbidden' }, 403)
  } else {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = await admin.auth.getUser(token)
    const email = u?.user?.email?.toLowerCase()
    if (!email) return json({ error: 'sign in required' }, 401)
    const { data: e } = await admin.from('schedule_editors').select('email').ilike('email', email).maybeSingle()
    if (!e) return json({ error: 'only schedule editors can sync ingredients' }, 403)
  }

  const id = Deno.env.get('UNLEASHED_API_ID'), key = Deno.env.get('UNLEASHED_API_KEY')
  if (!id || !key) return json({ error: 'Unleashed credentials not set' }, 500)
  try {
    const products = (await getAll('Products', {}, id, key)).filter((p: any) =>
      GROUPS.includes(String(p.ProductGroup?.GroupName || '').trim().toLowerCase()) && p.ProductCode
    )
    const { data: existing, error: exErr } = await admin.from('ingredients').select('id, unleashed_code, name, unleashed_group, base_unit, is_active')
    if (exErr) throw exErr
    const byCode = new Map(existing.map((r) => [r.unleashed_code, r]))
    const now = new Date().toISOString()
    const added: string[] = []
    let updated = 0
    let hidden = 0
    for (const p of products) {
      const code = String(p.ProductCode).trim()
      const name = String(p.ProductDescription || code).replace(/\s+/g, ' ').trim()
      const group = String(p.ProductGroup?.GroupName || '').trim() || null
      const unit = p.UnitOfMeasure?.Name ?? null
      const active = !p.Obsolete
      const cur = byCode.get(code)
      if (!cur) {
        if (!active) continue
        const { error } = await admin.from('ingredients').insert({
          unleashed_code: code, name, unleashed_group: group, base_unit: unit,
          sections: sectionsFor(group ?? ''), is_active: true, needs_review: true, synced_at: now,
        })
        if (error) throw error
        added.push(name)
        continue
      }
      const changes: Record<string, unknown> = {}
      if (cur.name !== name) changes.name = name
      if (cur.unleashed_group !== group) changes.unleashed_group = group
      if (unit && cur.base_unit !== unit) changes.base_unit = unit
      if (cur.is_active !== active) changes.is_active = active
      if (Object.keys(changes).length) {
        const { error } = await admin.from('ingredients').update({ ...changes, synced_at: now }).eq('id', cur.id)
        if (error) throw error
        if (changes.is_active === false) hidden++
        else updated++
      }
    }
    const summary = { at: now, checked: products.length, added: added.length, updated, hidden, addedNames: added.slice(0, 50) }
    await admin.from('unl_dataset').upsert({ key: 'ingredientSync', data: summary, updated_at: now })
    return json({ ok: true, ...summary })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
