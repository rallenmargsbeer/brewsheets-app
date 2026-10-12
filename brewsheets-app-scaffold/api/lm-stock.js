// Reads Liquid Mix stock on hand for the stock-sync Supabase function. Runs here on Vercel
// because the Liquid Mix portal drops connections from Supabase's servers.
// Read-only: logs in, acknowledges the notice, reads the Stock On Hand report (as the
// Combined_stock_LM sheet's Apps Script does). Logins come from Supabase with each call;
// nothing is stored here. Only these fixed portal URLs are ever requested.
const LOGIN_URL = 'https://portal.liquidmix.com.au/Admin/Login'
const STOCK_URL = 'https://portal.liquidmix.com.au/Item/StockOnHandReport'
const NOTICE_URL = 'https://portal.liquidmix.com.au/Admin/Notice'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const hidden = (html, id) => (html.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"', 'i')) || [])[1] || ''

function jar() {
  const m = new Map()
  return {
    take(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';')
        const i = pair.indexOf('=')
        if (i > 0) m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
    },
    header: () => [...m].map(([k, v]) => `${k}=${v}`).join('; '),
    size: () => m.size,
  }
}

function parseTable(html) {
  const table = html.match(/<table[^>]*id=["']dataTables3["'][\s\S]*?<\/table>/i)
  if (!table) throw new Error('stock table (dataTables3) not found; the login may have failed or the page changed')
  const rows = []
  for (const tr of table[0].match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim()
    )
    if (cells.length >= 7 && !(cells[0] === 'Item' && cells[1] === 'Code')) rows.push(cells)
  }
  return rows.map((r) => {
    const soh = Number(r[4] || 0), soo = Number(r[5] || 0), sold = Number(r[6] || 0)
    return { item: r[0], code: r[1], description: r[2], upc: r[3], soh, soo, sold, available: soh - sold }
  })
}

async function lmStock(username, password) {
  const j = jar()
  const page = await fetch(LOGIN_URL, { headers: { 'User-Agent': UA } })
  j.take(page)
  const html = await page.text()
  const viewState = hidden(html, '__VIEWSTATE')
  if (!viewState) throw new Error('cannot read the login form; the login page may have changed')
  const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: j.header(), 'User-Agent': UA }, body: new URLSearchParams(o) })

  const login = await fetch(LOGIN_URL, {
    ...form({
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: hidden(html, '__VIEWSTATEGENERATOR'),
      __EVENTVALIDATION: hidden(html, '__EVENTVALIDATION'),
      ctl00$ContentPlaceHolder1$txtUser: username,
      ctl00$ContentPlaceHolder1$txtPwd: password,
      ctl00$ContentPlaceHolder1$btnlogin: 'Login',
    }),
    redirect: 'manual',
  })
  j.take(login)
  await login.arrayBuffer()
  if (!j.size()) throw new Error('login failed (no session cookie); check the username and password secrets')

  const notice = await fetch(NOTICE_URL, form({ ctl00$ContentPlaceHolder1$btnlogin: 'Got it, thanks' }))
  j.take(notice)
  await notice.arrayBuffer()

  const stock = await fetch(STOCK_URL, { headers: { Cookie: j.header(), 'User-Agent': UA } })
  return parseTable(await stock.text())
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })
  try {
    res.status(200).json({ rows: await lmStock(username, password) })
  } catch (e) {
    res.status(502).json({ error: String(e?.cause?.message || e?.message || e) })
  }
}
