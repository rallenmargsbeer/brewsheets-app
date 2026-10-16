import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { listRecipes, getRecipe, listTanks, listBatches, listBatchesInTanks, upsertBatch, upsertBlendItems } from '../lib/api'
import { tankLabel, IN_TANK_STATUSES } from '../lib/tanks'

const today = () => new Date().toLocaleDateString('en-CA')

// Start an RTD blend: pick the recipe, an empty brite tank and the blend volume. The batch goes
// straight into the BBT (no brewhouse or fermenter) and opens on its blend sheet.
export default function StartBlendPage() {
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState([])
  const [bbts, setBbts] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [tankId, setTankId] = useState('')
  const [volume, setVolume] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listRecipes().then((r) => setRecipes(r.filter((x) => x.is_rtd && x.is_active !== false))).catch((e) => setError(e.message))
    Promise.all([listTanks(), listBatchesInTanks(IN_TANK_STATUSES)])
      .then(([t, b]) => setBbts(t.filter((x) => x.tank_type === 'BBT' && x.is_active !== false).map((x) => ({ ...x, inUse: b.find((y) => y.tank_id === x.id) }))))
      .catch((e) => setError(e.message))
  }, [])

  async function start() {
    setSaving(true); setError(null)
    try {
      const recipe = await getRecipe(recipeId)
      const nums = (await listBatches()).map((b) => parseInt(b.batch_number, 10)).filter(Number.isInteger)
      const V = Number(volume)
      const batch = await upsertBatch({
        recipe_id: recipeId,
        batch_number: String(nums.length ? Math.max(...nums) + 1 : 1),
        beer_style: recipe.name,
        status: 'conditioning',
        tank_id: tankId,
        date_brewed: today(),
        bbt_transfer_date: today(),
        brewhouse_yield_l: V,
        fv_to_bbt_l: V,
        target_volume_l: V,
      })
      await upsertBlendItems((recipe.recipe_blend_items ?? []).sort((a, b) => a.sort_order - b.sort_order).map((i) => ({
        batch_id: batch.id, sort_order: i.sort_order, ingredient_name: i.ingredient_name, unit: i.unit,
        planned_qty: Number(i.qty_per_l) * V, abv_pct: i.abv_pct,
      })))
      navigate(`/batches/${batch.id}?view=blend`)
    } catch (e) { setError(e.message); setSaving(false) }
  }

  const field = { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: '1rem', maxWidth: 320 }
  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ margin: 0 }}><Link to="/brew-day">← Brew Day</Link></p>
      <h1>Start RTD blend</h1>
      <label style={field}>Recipe
        <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
          <option value="">Choose…</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      {!recipes.length && <p className="stock-muted">No RTD recipes yet. Set a recipe's Excise type to RTD.</p>}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.9rem', marginBottom: 4 }}>Brite tank</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {bbts.map((t) => (
            <button key={t.id} className={tankId === t.id ? '' : 'secondary'} disabled={!!t.inUse} onClick={() => setTankId(t.id)} title={t.inUse ? `In use: batch ${t.inUse.batch_number}` : ''}>
              {tankLabel(t.name)}{t.inUse ? ` · in use (${t.inUse.batch_number})` : ''}
            </button>
          ))}
        </div>
      </div>
      <label style={field}>Blend volume (L)<input type="number" inputMode="numeric" value={volume} onChange={(e) => setVolume(e.target.value)} /></label>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button onClick={start} disabled={!recipeId || !tankId || !(Number(volume) > 0) || saving} style={{ fontSize: '1.1rem', padding: '0.75rem 2rem' }}>{saving ? '…' : 'Start blend'}</button>
    </div>
  )
}
