import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRecipes, getRecipe, listBatches, upsertBatch, initializeBrewRuns } from '../lib/api'

// Fixed brewhouse turn sizes — tell me the values to use if this ever changes.
const TURN_VOLUMES = [
  { label: '10HL', litres: 1000 },
  { label: '15HL', litres: 1500 },
  { label: '25HL', litres: 2500 },
]

// One tank (100HL) holds up to 4 turns — all 4 selectable here from the start.
// "+ Add another turn" on the Brew Day page (see MAX_TURNS_PER_TANK in
// BatchDetailPage.jsx) is still there as a fallback if you start with fewer
// than 4 and decide to top the tank up later.
const MAX_TURNS_PER_TANK = 4
const TURN_QUANTITIES = Array.from({ length: MAX_TURNS_PER_TANK }, (_, i) => i + 1)

function StepCard({ number, title, done, active, children }) {
  return (
    <div
      style={{
        marginBottom: '1rem',
        padding: '1rem',
        background: active ? '#fff' : '#f0efec',
        border: `1px solid ${active ? '#1a1a1a' : '#ddd'}`,
        borderRadius: 6,
        opacity: done || active ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: active ? '0.75rem' : 0 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: done ? '#1a7a1a' : active ? '#1a1a1a' : '#999',
            color: '#fff',
            fontSize: '0.8rem',
            flexShrink: 0,
          }}
        >
          {done ? '✓' : number}
        </span>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {(active || done) && children}
    </div>
  )
}

// Suggests the next sequential batch number — one past the highest existing
// numeric batch number. Still editable afterward on the Brew Day page, this is
// just a starting point so the brewer never has to invent one on the spot.
async function suggestNextBatchNumber() {
  const batches = await listBatches()
  const numbers = batches
    .map((b) => parseInt(b.batch_number, 10))
    .filter((n) => Number.isInteger(n))
  const next = numbers.length ? Math.max(...numbers) + 1 : 1
  return String(next)
}

// Spreads `totalBags` (rounded to the nearest whole bag) as evenly as possible across
// `turnQuantity` turns — just a starting point for the Allocate Grist Bags grid below,
// not a rule; every cell stays freely editable to match how bags actually get split.
function evenBagSplit(totalBags, turnQuantity) {
  const whole = Math.max(0, Math.round(totalBags))
  const base = Math.floor(whole / turnQuantity)
  const remainder = whole - base * turnQuantity
  return Array.from({ length: turnQuantity }, (_, i) => base + (i < remainder ? 1 : 0))
}

// One row per bagged grist item (pack_size_kg set), one column per turn. Shown only when
// the recipe has at least one such item — otherwise Add Brew behaves exactly as before.
function BagAllocationStep({ items, turnVolumeL, turnQuantity, allocations, setAllocations, onCreate, creating }) {
  function setCount(itemId, turnIndex, value) {
    setAllocations((prev) => {
      const row = prev[itemId] ? [...prev[itemId]] : Array(turnQuantity).fill(0)
      row[turnIndex] = value === '' ? 0 : Number(value)
      return { ...prev, [itemId]: row }
    })
  }

  return (
    <div>
      <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0 }}>
        These ingredients are bought by the bag — say how many bags of each go in every turn. The
        even split below is just a starting point; edit any cell to match how you're actually
        splitting them. Small mismatches against "needed" are fine — Actual on the brew day itself
        is where that gets reconciled.
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Ingredient</th>
            <th style={{ textAlign: 'left' }}>Allocated / Needed</th>
            {Array.from({ length: turnQuantity }, (_, i) => (
              <th key={i}>Turn {i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const totalKg = ((item.qty_g_per_l ?? 0) * turnVolumeL * turnQuantity) / 1000
            const bagsNeeded = item.pack_size_kg ? totalKg / item.pack_size_kg : 0
            const row = allocations[item.id] ?? Array(turnQuantity).fill(0)
            const allocated = row.reduce((sum, v) => sum + (Number(v) || 0), 0)
            const matches = Math.round(allocated) === Math.round(bagsNeeded)
            return (
              <tr key={item.id}>
                <td>{item.ingredient_name}</td>
                <td style={{ color: matches ? '#1a7a1a' : '#a66a00' }}>
                  {allocated} / {bagsNeeded.toFixed(1)} bags
                </td>
                {row.map((count, i) => (
                  <td key={i}>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={count}
                      onChange={(e) => setCount(item.id, i, e.target.value)}
                      style={{ width: 60 }}
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <button onClick={onCreate} disabled={creating} style={{ marginTop: '0.75rem' }}>
        {creating ? '…' : 'Create Brew'}
      </button>
    </div>
  )
}

export default function AddBrewPage() {
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [fullRecipe, setFullRecipe] = useState(null)
  const [turnVolumeL, setTurnVolumeL] = useState(null)
  const [turnQuantity, setTurnQuantity] = useState(null)
  const [allocations, setAllocations] = useState({})
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listRecipes().then(setRecipes).catch((e) => setError(e.message))
  }, [])

  // Full recipe (with nested grist/water/kettle/whirlpool/fermenter arrays) is needed as
  // soon as a recipe is picked — both to snapshot ingredients at creation time and, now,
  // to know upfront whether any grist line has a pack size (which decides whether the
  // Allocate Grist Bags step appears at all).
  useEffect(() => {
    if (!recipeId) {
      setFullRecipe(null)
      return
    }
    getRecipe(recipeId).then(setFullRecipe).catch((e) => setError(e.message))
  }, [recipeId])

  const baggedGristItems = (fullRecipe?.recipe_grist_items ?? []).filter((g) => g.pack_size_kg > 0)

  async function createBrew(quantity, bagAllocations) {
    setCreating(true)
    setError(null)
    try {
      const batchNumber = await suggestNextBatchNumber()
      const recipe = recipes.find((r) => r.id === recipeId)
      const batch = await upsertBatch({
        recipe_id: recipeId,
        batch_number: batchNumber,
        beer_style: recipe?.name,
        status: 'brewing',
        date_brewed: new Date().toISOString().slice(0, 10),
        turn_volume_l: turnVolumeL,
        turn_quantity: quantity,
        target_volume_l: turnVolumeL * quantity,
      })
      await initializeBrewRuns(batch.id, quantity, fullRecipe, turnVolumeL, bagAllocations)
      navigate(`/batches/${batch.id}`)
    } catch (e) {
      setError(e.message)
      setCreating(false)
    }
  }

  // Picking a turn quantity no longer creates the batch straight away — if the recipe has
  // bagged grist items, an Allocate Grist Bags step comes first. Otherwise this behaves
  // exactly as before.
  function pickTurnQuantity(quantity) {
    setTurnQuantity(quantity)
    if (baggedGristItems.length === 0) {
      createBrew(quantity, {})
      return
    }
    const seeded = Object.fromEntries(
      baggedGristItems.map((item) => {
        const totalKg = ((item.qty_g_per_l ?? 0) * turnVolumeL * quantity) / 1000
        const bagsNeeded = item.pack_size_kg ? totalKg / item.pack_size_kg : 0
        return [item.id, evenBagSplit(bagsNeeded, quantity)]
      })
    )
    setAllocations(seeded)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Add Brew</h1>
      <p style={{ color: '#666', marginTop: '-0.5rem' }}>
        Set up today's brew day — pick the recipe, the size of each brewhouse turn, and how many
        turns you're running, and you'll land straight in the brewsheet.
      </p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <StepCard number={1} title="Select Recipe" done={!!recipeId} active>
        <select
          value={recipeId}
          onChange={(e) => {
            setRecipeId(e.target.value)
            setTurnVolumeL(null)
            setTurnQuantity(null)
            setAllocations({})
          }}
          style={{ width: '100%' }}
        >
          <option value="">Select a recipe…</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} {r.style ? `— ${r.style}` : ''}
            </option>
          ))}
        </select>
      </StepCard>

      <StepCard number={2} title="Select Brew Turn Volume" done={turnVolumeL != null} active={!!recipeId}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {TURN_VOLUMES.map((v) => (
            <button
              key={v.label}
              className={turnVolumeL === v.litres ? '' : 'secondary'}
              onClick={() => {
                setTurnVolumeL(v.litres)
                setTurnQuantity(null)
                setAllocations({})
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </StepCard>

      <StepCard number={3} title="Select Brew Turn Quantity" active={turnVolumeL != null}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {TURN_QUANTITIES.map((q) => (
            <button key={q} disabled={creating} onClick={() => pickTurnQuantity(q)}>
              {creating ? '…' : `${q} turn${q === 1 ? '' : 's'}`}
            </button>
          ))}
        </div>
        {turnVolumeL != null && (
          <p style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: 0 }}>
            {TURN_VOLUMES.find((v) => v.litres === turnVolumeL)?.label} per turn — total batch
            volume is calculated automatically once you pick how many turns.
          </p>
        )}
      </StepCard>

      {turnQuantity != null && baggedGristItems.length > 0 && (
        <StepCard number={4} title="Allocate Grist Bags" active>
          <BagAllocationStep
            items={baggedGristItems}
            turnVolumeL={turnVolumeL}
            turnQuantity={turnQuantity}
            allocations={allocations}
            setAllocations={setAllocations}
            onCreate={() => createBrew(turnQuantity, allocations)}
            creating={creating}
          />
        </StepCard>
      )}
    </div>
  )
}
