// @ts-nocheck
// Pure derivation: raw Unleashed products + assemblies -> the dashboard dataset.
// No network, no writes. Shared by the Edge Function and by local verification.
const msDate = (s) => {
  if (!s) return null
  const m = /-?\d+/.exec(String(s))
  return m ? new Date(parseInt(m[0], 10)).toISOString().slice(0, 10) : null
}
const trim = (s) => (s == null ? '' : String(s).trim())
const r2 = (x) => Math.round(x * 100) / 100
const GM = { Hops: 'hp', Malt: 'ml', Yeast: 'ye' }

export function derive(rawProducts, rawAssemblies, pulled) {
  const P = {}
  for (const p of rawProducts) P[trim(p.ProductCode)] = p
  const grp = (c) => (P[c] && P[c].ProductGroup ? P[c].ProductGroup.GroupName : null)
  const sub = (c) => (P[c] && P[c].ProductSubGroup ? P[c].ProductSubGroup.GroupName : null)
  const asmCode = (a) => trim(a.Product && a.Product.ProductCode)

  // ---- scope: pack products (kegs / cubes / 4-packs) that are assembled products
  const FMT = { Kegs: 'Keg', Cubes: 'Cube', 'Sellable 4 Packs': '4-pack' }
  const products = []
  for (const code of Object.keys(P)) {
    const g = grp(code)
    const p = P[code]
    if (!FMT[g] || !p.IsAssembledProduct) continue
    let size = '', sizeInferred = false
    if (FMT[g] === 'Keg') {
      const m = /(\d+)\s*L\b/i.exec(code)
      if (m) size = m[1] + 'L'
      else { size = '50L'; sizeInferred = true }
    }
    products.push({ code, fmt: FMT[g], range: sub(code) || 'Unassigned', size, sizeInferred })
  }
  products.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const scope = new Set(products.map((p) => p.code))
  const prodByCode = Object.fromEntries(products.map((p) => [p.code, p]))

  // ---- packaged-SKU assemblies with cost split
  const part = (code) => {
    const c = trim(code)
    if (grp(c) === 'Finished Beer') return 'bc'
    if (/kegstar/i.test(c)) return 'kg'
    if (/\bcans?\b|can caps?/i.test(c)) return 'cn'
    return 'ot'
  }
  const assemblies = []
  for (const a of rawAssemblies) {
    if (a.AssemblyType !== 'Assembly' || a.AssemblyStatus !== 'Completed' || !a.AssembleBy) continue
    const code = asmCode(a)
    if (!scope.has(code)) continue
    const r = { n: a.AssemblyNumber, d: msDate(a.AssembleBy), code, qty: a.Quantity, bc: 0, bl: 0, bw: 0, kg: 0, cn: 0, ot: 0, fb: '' }
    for (const l of a.AssemblyLines || []) {
      const k = part(l.Product.ProductCode)
      r[k] += l.TotalCost || 0
      if (k === 'bc') {
        r.bl += (l.Quantity || 0) + (l.WastageQuantity || 0)
        r.bw += l.WastageQuantity || 0
        r.fb = trim(l.Product.ProductCode)
      }
    }
    for (const k of ['bc', 'bl', 'bw', 'kg', 'cn', 'ot']) r[k] = r2(r[k])
    r.cost = r2(r.bc + r.kg + r.cn + r.ot)
    assemblies.push(r)
  }
  assemblies.sort((a, b) => (a.n < b.n ? 1 : a.n > b.n ? -1 : 0))

  // ---- beer batches (FB-*) with ingredient lines
  const fbBatches = []
  for (const a of rawAssemblies) {
    if (a.AssemblyType !== 'Assembly' || a.AssemblyStatus !== 'Completed' || !a.AssembleBy || !String(a.Product.ProductCode).startsWith('FB') || !a.Quantity) continue
    const r = { d: msDate(a.AssembleBy), code: asmCode(a), L: Math.round(a.Quantity), lines: [], hp: 0, ml: 0, ye: 0, ot: 0, cd: msDate(a.AssemblyDate) }
    for (const l of a.AssemblyLines || []) {
      const c = trim(l.Product.ProductCode)
      const k = GM[grp(c)] || 'ot'
      r[k] += l.TotalCost || 0
      r.lines.push([c, k, Math.round(((l.Quantity || 0) + (l.WastageQuantity || 0)) * 1000) / 1000, r2(l.TotalCost || 0)])
    }
    for (const k of ['hp', 'ml', 'ye', 'ot']) r[k] = r2(r[k])
    fbBatches.push(r)
  }

  // ---- range per beer: litre-weighted majority of the packaged SKUs made from it
  const rl = {}
  for (const a of assemblies) {
    if (!a.fb) continue
    const rng = prodByCode[a.code].range
    ;(rl[a.fb] = rl[a.fb] || {})[rng] = ((rl[a.fb] || {})[rng] || 0) + a.bl
  }
  const beerRange = {}
  for (const f of Object.keys(rl)) beerRange[f] = Object.entries(rl[f]).sort((x, y) => y[1] - x[1])[0][0]

  // ---- parked (not yet completed) assemblies by month
  const parked = {}
  for (const a of rawAssemblies) {
    if (a.AssemblyStatus !== 'Parked') continue
    const m = (msDate(a.AssembleBy) || '').slice(0, 7)
    if (!m) continue
    const e = (parked[m] = parked[m] || { L: 0, n: 0 })
    e.L += a.Quantity
    e.n += 1
  }

  // ---- efficiency rows: one per beer batch number
  const kegL = (c) => {
    const p = prodByCode[c]
    if (p && p.size) return parseInt(p.size.replace(/\D/g, '') || '50', 10)
    const m = /(\d+)\s*L\b/i.exec(((P[c] && P[c].ProductDescription) || '') + ' ' + c)
    return m ? parseInt(m[1], 10) : 50
  }
  const fb = new Map()
  const pk = new Map()
  for (const a of rawAssemblies) {
    if (a.AssemblyStatus !== 'Completed') continue
    const c = asmCode(a)
    const g = c.startsWith('FB') ? 'FB' : grp(c)
    const sign = a.AssemblyType === 'Disassembly' ? -1 : 1
    if (g === 'FB') {
      for (const b of a.BatchNumbers || []) {
        const key = b.Number + '\u0001' + c
        let f = fb.get(key)
        if (!f) fb.set(key, (f = { key, bn: b.Number, L: 0, beers: new Map(), brew: null, done: null }))
        f.L += sign * Math.abs(b.Quantity)
        f.beers.set(c, (f.beers.get(c) || 0) + sign * Math.abs(b.Quantity))
        const bd = msDate(a.AssembleBy), dd = msDate(a.AssemblyDate)
        f.brew = f.brew === null || bd < f.brew ? bd : f.brew
        f.done = f.done === null || dd > f.done ? dd : f.done
      }
    } else if (g === 'Kegs' || g === 'Cubes') {
      const q = sign * a.Quantity
      const nom = q * (g === 'Kegs' ? kegL(c) : 6)
      const lines = (a.AssemblyLines || []).filter((l) => String(l.Product.ProductCode).startsWith('FB'))
      const lb = new Map()
      const prod = lines.length ? trim(lines[0].Product.ProductCode) : null
      for (const l of lines)
        for (const b of l.BatchNumbers || []) {
          const k = b.Number + '\u0001' + trim(l.Product.ProductCode)
          lb.set(k, (lb.get(k) || 0) + Math.abs(b.Quantity))
        }
      if (!lb.size && prod) for (const b of a.BatchNumbers || []) lb.set(b.Number + '\u0001' + prod, (lb.get(b.Number + '\u0001' + prod) || 0) + Math.abs(b.Quantity))
      let tot = 0
      for (const w of lb.values()) tot += w
      for (const [k, w] of lb) {
        let p = pk.get(k)
        if (!p) pk.set(k, (p = { keg: 0, cube: 0, kegL: 0, cubeL: 0 }))
        const sh = w / tot
        if (g === 'Kegs') { p.keg += q * sh; p.kegL += nom * sh } else { p.cube += q * sh; p.cubeL += nom * sh }
      }
    }
  }
  const eff = []
  for (const f of fb.values()) {
    if (f.L <= 0) continue
    const init = Math.ceil(f.L / 2500) * 2500
    const p = pk.get(f.key) || { keg: 0, cube: 0, kegL: 0, cubeL: 0 }
    eff.push({
      bn: f.bn,
      beer: [...f.beers.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]),
      brew: f.brew, done: f.done, L: Math.round(f.L), init,
      pk: Math.round(p.kegL + p.cubeL),
      keg: Math.round(p.keg * 10) / 10, cube: Math.round(p.cube * 10) / 10,
    })
  }
  return { products, assemblies, pulled, fbBatches, beerRange, parked, eff }
}
