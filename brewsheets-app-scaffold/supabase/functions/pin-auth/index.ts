// Staff PIN sign-in. Accounts are @margaretriverbeer.co (or @mrbeergroup.com) emails with a unique 4-digit PIN.
//   signup {email, name, pin}  -> confirmation email; an admin then approves
//   signin {pin}               -> session tokens (active, confirmed users only)
//   setpin {pin}               -> change your own PIN (needs a session, e.g. from a "forgot PIN" email link)
//   adminsetpin {userId, pin}  -> an admin (or the cron secret) resets someone's PIN and confirms their email
// PINs are stored only as an HMAC. Failed attempts lock an IP out for 15 minutes.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const DOMAIN = /^[^@\s]+@(margaretriverbeer\.co|mrbeergroup\.com)$/i
const PIN = /^\d{4}$/
const WINDOW_MIN = 15, IP_FAILS = 5, ALL_FAILS = 40

async function pinHmac(pin: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(`pin-auth:${SERVICE}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(pin))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const action = body?.action
  const pin = String(body?.pin ?? '')

  if (action === 'signup') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const name = String(body.name ?? '').trim()
    if (!DOMAIN.test(email)) return json({ error: 'Use your @margaretriverbeer.co or @mrbeergroup.com email.' }, 400)
    if (!name) return json({ error: 'Enter your name.' }, 400)
    if (!PIN.test(pin)) return json({ error: 'Your PIN must be 4 digits.' }, 400)
    const h = await pinHmac(pin)
    const { data: taken } = await admin.from('app_users').select('id').eq('pin_hmac', h).maybeSingle()
    if (taken) return json({ error: "That PIN isn't available, pick another." }, 409)
    const { data: existing } = await admin.from('app_users').select('id').ilike('email', email).maybeSingle()
    if (existing) return json({ error: 'That email already has an account. Use "Forgot PIN?" to set a new PIN.' }, 409)

    // Existing auth user (e.g. from the old password sign-in): link to it. Otherwise invite,
    // which sends the confirmation email.
    const { data: found } = await admin.rpc('auth_user_by_email', { p_email: email })
    let id = found?.[0]?.id as string | undefined
    let confirmed = !!found?.[0]?.confirmed
    if (!id) {
      const origin = req.headers.get('origin') || ''
      const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { name },
        redirectTo: origin ? `${origin}/login?confirmed=1` : undefined,
      })
      if (error) return json({ error: error.message }, 400)
      id = inv.user.id
      confirmed = false
    }
    // The first admins come from the old schedule editors list.
    const { data: editor } = await admin.from('schedule_editors').select('email').ilike('email', email).maybeSingle()
    const row = editor
      ? { id, email, name, pin_hmac: h, role: 'admin', status: 'active', approved_at: new Date().toISOString(), approved_by: 'schedule editors list' }
      : { id, email, name, pin_hmac: h, role: 'user', status: 'pending' }
    const { error } = await admin.from('app_users').insert(row)
    if (error) return json({ error: error.code === '23505' ? "That PIN isn't available, pick another." : error.message }, 400)
    return json({ ok: true, status: row.status, confirmed })
  }

  if (action === 'signin') {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString()
    const [{ count: ipFails }, { count: allFails }] = await Promise.all([
      admin.from('pin_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).eq('ok', false).gte('at', since),
      admin.from('pin_attempts').select('id', { count: 'exact', head: true }).eq('ok', false).gte('at', since),
    ])
    if ((ipFails ?? 0) >= IP_FAILS || (allFails ?? 0) >= ALL_FAILS) return json({ error: 'Too many wrong PINs. Try again in 15 minutes.' }, 429)
    const fail = async (msg: string, status = 401) => {
      await admin.from('pin_attempts').insert({ ip, ok: false })
      return json({ error: msg }, status)
    }
    if (!PIN.test(pin)) return fail('Wrong PIN.')
    const { data: u } = await admin.from('app_users').select('id, email, status').eq('pin_hmac', await pinHmac(pin)).maybeSingle()
    if (!u) return fail('Wrong PIN.')
    await admin.from('pin_attempts').insert({ ip, ok: true })
    if (u.status === 'disabled') return json({ error: 'Your account is disabled. Talk to an admin.' }, 403)
    const { data: au } = await admin.rpc('auth_user_by_email', { p_email: u.email })
    if (!au?.[0]?.confirmed) return json({ error: 'Confirm your email first: click the link we sent you.' }, 403)
    if (u.status !== 'active') return json({ error: 'Your account is waiting for an admin to approve it.' }, 403)
    // Make a session: a one-off magic link token, verified straight away.
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.email })
    if (le) return json({ error: le.message }, 500)
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
    const { data: v, error: ve } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
    if (ve || !v.session) return json({ error: ve?.message || 'Could not sign in.' }, 500)
    return json({ access_token: v.session.access_token, refresh_token: v.session.refresh_token })
  }

  if (action === 'setpin') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: who } = await admin.auth.getUser(token)
    if (!who?.user) return json({ error: 'Open the link from your email again.' }, 401)
    if (!PIN.test(pin)) return json({ error: 'Your PIN must be 4 digits.' }, 400)
    const h = await pinHmac(pin)
    const { data: taken } = await admin.from('app_users').select('id').eq('pin_hmac', h).neq('id', who.user.id).maybeSingle()
    if (taken) return json({ error: "That PIN isn't available, pick another." }, 409)
    const { data: me } = await admin.from('app_users').update({ pin_hmac: h }).eq('id', who.user.id).select('status').maybeSingle()
    if (!me) return json({ error: 'No account for this email. Sign up first.' }, 404)
    return json({ ok: true, status: me.status })
  }

  if (action === 'adminsetpin') {
    const cron = req.headers.get('x-cron-secret')
    if (cron) {
      const { data: secret } = await admin.rpc('get_sync_cron_secret')
      if (!secret || cron !== secret) return json({ error: 'forbidden' }, 403)
    } else {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
      const { data: who } = await admin.auth.getUser(token)
      if (!who?.user) return json({ error: 'Sign in first.' }, 401)
      const { data: me } = await admin.from('app_users').select('role, status').eq('id', who.user.id).maybeSingle()
      if (me?.role !== 'admin' || me?.status !== 'active') return json({ error: 'admins only' }, 403)
    }
    const userId = String(body?.userId ?? '')
    if (!PIN.test(pin)) return json({ error: 'The PIN must be 4 digits.' }, 400)
    const h = await pinHmac(pin)
    const { data: taken } = await admin.from('app_users').select('id').eq('pin_hmac', h).neq('id', userId).maybeSingle()
    if (taken) return json({ error: "That PIN isn't available, pick another." }, 409)
    const { data: u } = await admin.from('app_users').update({ pin_hmac: h }).eq('id', userId).select('id').maybeSingle()
    if (!u) return json({ error: 'No such user.' }, 404)
    const { error: ce } = await admin.auth.admin.updateUserById(userId, { email_confirm: true })
    if (ce) return json({ error: ce.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
})
