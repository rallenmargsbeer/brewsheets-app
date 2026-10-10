// Every beer gets its own cell colour on the schedule. Core beers have fixed colours so
// they always look the same week to week; one-offs get a colour from the spare set,
// picked from their name so it stays the same every time.

// Light tints so the dark cell text stays readable.
const CORE = {
  itp: '#cfe0f8', // blue
  pale: '#fbd9c2', // orange
  kolsch: '#fbeaa6', // yellow
  mermid: '#f6cfe1', // pink
  draught: '#c9eadb', // aqua
  'drift xpa': '#ddd4f6', // violet
  riverdog: '#d3e9c6', // green
  red: '#f3c5c3', // red
  brown: '#e4d3bf', // brown
  stout: '#d5d3cf', // grey
  lager: '#c8e6f1', // sky
  megsy: '#f1dcc0', // sand
}
const SPARE = ['#e0bfe8', '#a9d8e2', '#f4b8b8', '#cbdc93', '#a9c8f0', '#f5b5d8', '#d6c7a2', '#b3e2ae', '#c3b8ec', '#f0cf86']

// "8 Ball 1500L" and "ITP trial - 1000L" belong to "8 Ball" and "ITP trial".
export const beerKey = (name) =>
  String(name ?? '')
    .replace(/\s*-?\s*\d+\s*L$/i, '')
    .trim()
    .toLowerCase()

export function beerColour(name) {
  const key = beerKey(name)
  if (!key) return null
  if (CORE[key]) return CORE[key]
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SPARE[h % SPARE.length]
}

// Works out which beer each schedule cell belongs to.
// - Brew 1 / Brew 2 cells are the beer's name.
// - Booked cells know their beer from the booking.
// - Other tank cells belong to the beer last brewed into that tank: a run starts at a
//   cell naming a beer (the day-1 PM cell) or a "Brew" cell followed by one.
// `entries` must reach back far enough (a lager's run is ~4 weeks) to see the brew.
export function assignBeers(entries, { knownBeers = [], bookingBeer = {} } = {}) {
  const names = new Map() // beerKey -> display name
  for (const n of knownBeers) names.set(beerKey(n), n)
  for (const e of entries) if (e.lane === 'brew_1' || e.lane === 'brew_2') names.set(beerKey(e.text), e.text.replace(/\s*-?\s*\d+\s*L$/i, '').trim())

  const beerOf = new Map() // entry id -> beer display name
  const order = (a, b) => a.entry_date.localeCompare(b.entry_date) || (a.slot === b.slot ? 0 : a.slot === 'AM' ? -1 : 1)

  for (const e of entries) {
    if (e.booking_id && bookingBeer[e.booking_id]) beerOf.set(e.id, bookingBeer[e.booking_id])
    else if (e.lane === 'brew_1' || e.lane === 'brew_2') beerOf.set(e.id, names.get(beerKey(e.text)))
  }

  // Each tank's stays: { beer, start, end } as slot keys ("2026-10-12|0" = AM, "|1" = PM),
  // used to shade every cell of the stay, empty ones included.
  const runs = new Map() // tank_id -> [{ beer, start, end }]
  const byTank = new Map()
  for (const e of entries) if (e.lane === 'tank') byTank.set(e.tank_id, [...(byTank.get(e.tank_id) ?? []), e])
  // Two passes: the first learns one-off beer names from FV brew days, so the second can
  // recognise them when they turn up by name in a bright tank.
  for (let pass = 0; pass < 2; pass++) for (const [tankId, list] of byTank) {
    list.sort(order)
    const tankRuns = []
    let current = null
    list.forEach((e, i) => {
      if (beerOf.has(e.id)) current = beerOf.get(e.id)
      else {
        const named = names.get(beerKey(e.text))
        if (named) current = named
        else if (e.text.trim().toLowerCase() === 'brew') {
          // "Brew" (AM) then the beer's name (PM): the run starts here.
          // A one-off beer won't be a known name, so the same-day PM cell after "Brew" counts too.
          const next = list[i + 1]
          const samePm = next && next.entry_date === e.entry_date && e.slot === 'AM' && next.slot === 'PM'
          const nextNamed = next && (beerOf.get(next.id) ?? names.get(beerKey(next.text)) ?? (samePm ? next.text.trim() : null))
          if (nextNamed) {
            current = nextNamed
            if (samePm && !names.has(beerKey(next.text))) names.set(beerKey(next.text), next.text.trim())
          }
        }
        if (current) beerOf.set(e.id, current)
      }
      if (current) {
        const k = slotKey(e.entry_date, e.slot)
        const last = tankRuns[tankRuns.length - 1]
        if (last && last.beer === current && last.open) last.end = k
        else tankRuns.push({ beer: current, start: k, end: k, open: true })
      }
      // Filtering moves the beer out to a BT, so the FV's run ends after that cell.
      if (/filter/i.test(e.text) && !/\?$/.test(e.text.trim())) {
        current = null
        if (tankRuns.length) tankRuns[tankRuns.length - 1].open = false
      }
    })
    runs.set(tankId, tankRuns)
  }
  return { beerOf, runs }
}

export const slotKey = (date, slot) => `${date}|${slot === 'AM' ? 0 : 1}`

// The beer sitting in a tank at a given half-day, if any.
export function beerInTank(runs, tankId, date, slot) {
  return stayAt(runs, tankId, date, slot)?.beer ?? null
}

// The whole stay ({ beer, start, end }) covering a tank's half-day, if any.
export function stayAt(runs, tankId, date, slot) {
  const k = slotKey(date, slot)
  return (runs.get(tankId) ?? []).find((r) => r.start <= k && k <= r.end) ?? null
}
