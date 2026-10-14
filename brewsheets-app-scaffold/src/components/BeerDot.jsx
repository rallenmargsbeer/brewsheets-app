import { createContext, useContext, useEffect, useState } from 'react'
import { listBeerColours } from '../lib/schedule'
import { savedBeerStyle, setBeerColours } from '../lib/beerColours'

// Beer colours (the schedule's colour key) loaded once for the whole app; the version
// bumps when they arrive so dots re-render.
const BeerColours = createContext(0)

export function BeerColoursProvider({ children }) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    listBeerColours().then((rows) => { setBeerColours(rows); setVersion((v) => v + 1) }).catch(() => {})
  }, [])
  return <BeerColours.Provider value={version}>{children}</BeerColours.Provider>
}

export function useBeerColour(name) {
  useContext(BeerColours)
  return savedBeerStyle(name)
}

// A small dot in the beer's schedule colour, before its name. Nothing for beers without one.
export default function BeerDot({ name }) {
  const s = useBeerColour(name)
  if (!s) return null
  return <span className="beer-dot" style={{ background: s.bg }} title={name} aria-hidden="true" />
}
