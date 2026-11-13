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

export async function getJson(path: string, params: Record<string, string | number>, id: string, key: string, base = BASE) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  const res = await fetch(`${base}/${path}${query ? '?' + query : ''}`, {
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

// Unleashed paginates as /Endpoint/Page/N (some tenants also accept ?pageNumber=N); try the documented form first.
async function getPage(endpoint: string, p: number, id: string, key: string, base: string, pageSize: number) {
  try {
    return await getJson(`${endpoint}/Page/${p}`, { pageSize }, id, key, base)
  } catch (e) {
    return await getJson(endpoint, { pageSize, pageNumber: p }, id, key, base)
  }
}

// Every page of an endpoint. After the first page the rest are fetched a few at a time (not one
// after another), so the whole pull fits inside the edge function's time limit.
export async function getAll(endpoint: string, id: string, key: string, base = BASE, pageSize = 200, parallel = 4) {
  const first = await getJson(endpoint, { pageSize }, id, key, base)
  const items = [...(first.Items || [])]
  const pages = (first.Pagination && first.Pagination.NumberOfPages) || 1
  const rest: number[] = []
  for (let p = 2; p <= pages; p++) rest.push(p)
  for (let i = 0; i < rest.length; i += parallel) {
    const got = await Promise.all(rest.slice(i, i + parallel).map((p) => getPage(endpoint, p, id, key, base, pageSize)))
    for (const r of got) items.push(...(r.Items || []))
  }
  const total = first.Pagination && first.Pagination.NumberOfItems
  if (total != null && items.length !== total) throw new Error(`${endpoint}: expected ${total} items, got ${items.length}`)
  return items
}
