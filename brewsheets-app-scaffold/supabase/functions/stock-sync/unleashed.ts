// READ-ONLY Unleashed client. Only HTTP GET is ever issued; there is no code path for any other method.
const BASE = 'https://api.unleashedsoftware.com'
const enc = new TextEncoder()

async function sign(query: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(query)))
  let s = ''
  for (const b of sig) s += String.fromCharCode(b)
  return btoa(s)
}

export async function getJson(path: string, params: Record<string, string | number>, id: string, key: string) {
  // Encode spaces as %20 (not +): Unleashed signs the query exactly as sent.
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  const res = await fetch(`${BASE}/${path}${query ? '?' + query : ''}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'api-auth-id': id,
      'api-auth-signature': await sign(query, key),
      'client-type': 'margaretriver/brewsheets',
    },
  })
  if (!res.ok) throw new Error(`Unleashed ${path} -> HTTP ${res.status}`)
  return await res.json()
}

// Every page of an endpoint (Unleashed pages as /Endpoint/Page/N).
export async function getAll(endpoint: string, params: Record<string, string | number>, id: string, key: string, pageSize = 500) {
  const p = { ...params, pageSize }
  const first = await getJson(endpoint, p, id, key)
  const items = [...(first.Items || [])]
  const pages = (first.Pagination && first.Pagination.NumberOfPages) || 1
  for (let n = 2; n <= pages; n++) {
    const r = await getJson(`${endpoint}/Page/${n}`, p, id, key)
    items.push(...(r.Items || []))
  }
  return items
}
