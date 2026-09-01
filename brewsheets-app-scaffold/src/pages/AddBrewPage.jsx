import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRecipes, listBatches, upsertBatch, initializeBrewRuns } from '../lib/api'

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

export default function AddBrewPage() {
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [turnVolumeL, setTurnVolumeL] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listRecipes().then(setRecipes).catch((e) => setError(e.message))
  }, [])

  async function pickTurnQuantity(turnQuantity) {
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
        turn_quantity: turnQuantity,
        target_volume_l: turnVolumeL * turnQuantity,
      })
      await initializeBrewRuns(batch.id, turnQuantity)
      navigate(`/batches/${batch.id}`)
    } catch (e) {
      setError(e.message)
      setCreating(false)
    }
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
              onClick={() => setTurnVolumeL(v.litres)}
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
    </div>
  )
}
