// Liquid Mix stock on hand. The portal drops connections from Supabase's servers, so the
// read runs in the app's Vercel function (api/lm-stock.js), which logs in with the logins
// passed here and reads the Stock On Hand report. Read-only.
const PROXY = 'https://brewsheets-app-obi4.vercel.app/api/lm-stock'

export async function lmStock(username: string, password: string) {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Liquid Mix: ' + (body.error || `HTTP ${res.status}`))
  return body.rows as { item: string; code: string; description: string; upc: string; soh: number; soo: number; sold: number; available: number }[]
}
