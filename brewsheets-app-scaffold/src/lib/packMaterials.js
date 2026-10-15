// Packaging materials needed for the packaging on the schedule: each Canning / Kegging cell
// (cubes, kegs by size) times its product's bill of materials from Unleashed (pack_boms,
// read-only copy). Beer lines (Finished Beer) are left out: only packaging materials count.
import { supabase } from '../supabaseClient'
import { listTanks } from './api'
import { addDays, listScheduleEntries, listCellarTemplates, listBookings, PACK_LANES } from './schedule'
import { assignBeers, packBeer, looseKey } from './beerColours'
import { CUBES_PER_PALLET } from './packaging'

// Product names that differ from the schedule's ("Lager" products are the Draught).
const ALIASES = { lager: 'draught' }
export const nameKey = (s) => { const k = looseKey(s); return ALIASES[k] ?? k }

// "Cube-ITP" -> { fmt: 'cube', size: null, beer: 'itp' }; "30l Keg-Megsy" -> keg 30.
export function parseProduct(code) {
  const m = String(code).match(/^\s*(?:(\d+)\s*l\s+)?(cube|keg)\s*-\s*(.+)$/i)
  if (!m) return null
  const fmt = m[2].toLowerCase()
  return { fmt, size: fmt === 'keg' ? Number(m[1] || 50) : null, beer: nameKey(m[3]) }
}

// What a Canning / Kegging cell asks for: [{ fmt, size, qty }].
export function parsePackText(lane, text) {
  const t = String(text ?? '')
  if (lane.startsWith('canning')) {
    const cubes = t.match(/(\d[\d,]*)\s*cubes?/i)
    if (cubes) return [{ fmt: 'cube', size: null, qty: Number(cubes[1].replace(/,/g, '')) }]
    const pallets = t.match(/(\d+(?:\.\d+)?)\s*pallets?/i)
    if (pallets) return [{ fmt: 'cube', size: null, qty: Math.round(Number(pallets[1]) * CUBES_PER_PALLET) }]
    return []
  }
  return [...t.matchAll(/(\d+)\s*x\s*(\d+)\s*l/gi)].map((m) => ({ fmt: 'keg', size: Number(m[2]), qty: Number(m[1]) }))
}

export async function packagingMaterials(fromIso, toIso) {
  const [entries, templates, bookings, tanks, boms] = await Promise.all([
    listScheduleEntries(addDays(fromIso, -60), toIso),
    listCellarTemplates(),
    listBookings({ fromIso: addDays(fromIso, -120) }),
    listTanks(),
    supabase.from('unl_dataset').select('data, updated_at').eq('key', 'pack_boms').maybeSingle(),
  ])
  if (boms.error) throw boms.error
  const bookingBeer = Object.fromEntries(bookings.map((b) => [b.id, b.beer_name]))
  const { beerOf, runs } = assignBeers(entries, { knownBeers: templates.map((t) => t.name), bookingBeer })
  const brightTankIds = tanks.filter((t) => t.tank_type === 'BBT').map((t) => t.id)

  // BOMs by (format, size, beer).
  const bomFor = new Map()
  for (const b of boms.data?.data ?? []) {
    const p = parseProduct(b.code)
    if (p) bomFor.set(`${p.fmt}|${p.size}|${p.beer}`, b)
  }

  const runsOut = [] // one row per Canning / Kegging cell item
  const totals = new Map() // material code -> { code, description, unit, qty }
  for (const e of entries) {
    if (!PACK_LANES.includes(e.lane) || e.entry_date < fromIso || e.entry_date > toIso || !(e.text ?? '').trim()) continue
    const cellList = entries.filter((x) => x.lane === e.lane && x.entry_date === e.entry_date && x.slot === e.slot)
    const beer = e.beer_name || bookingBeer[e.booking_id] || packBeer(cellList, e.entry_date, e.slot, { entries, beerOf, runs, brightTankIds })
    for (const item of parsePackText(e.lane, e.text)) {
      const bom = beer ? bomFor.get(`${item.fmt}|${item.size}|${nameKey(beer)}`) : null
      runsOut.push({ id: e.id + item.fmt + item.size, date: e.entry_date, slot: e.slot, beer, ...item, text: e.text, product: bom?.code ?? null })
      if (!bom) continue
      for (const l of bom.lines) {
        if (/finished beer/i.test(l.group ?? '') || /^FB[- ]/i.test(l.code ?? '')) continue
        const x = totals.get(l.code) ?? { code: l.code, description: l.description, unit: l.unit, qty: 0 }
        x.qty += Number(l.qty) * item.qty
        totals.set(l.code, x)
      }
    }
  }
  runsOut.sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot))
  const materials = [...totals.values()].sort((a, b) => a.code.localeCompare(b.code))
  return { runs: runsOut, materials, bomsUpdated: boms.data?.updated_at ?? null }
}
