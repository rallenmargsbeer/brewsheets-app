import { useEffect, useState } from 'react'
import { listRecipes, getRecipe } from '../lib/api'

const SIZES = [10, 15, 20, 25, 30, 35, 40]
const kg = (n) => (n >= 100 ? Math.round(n).toLocaleString() : (+n.toFixed(1)).toLocaleString())

// Mill in: pick a SKU and see just the grist to mill for one brew (25 HL unless changed).
// Right-click (or long-press on a tablet) the brew size to change it.
export default function MillInPage() {
  const [recipes, setRecipes] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [recipe, setRecipe] = useState(null)
  const [hl, setHl] = useState(25)
  const [menu, setMenu] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    listRecipes()
      .then((r) => setRecipes(r.filter((x) => x.is_active !== false && !x.is_rtd && !/historical import/i.test(x.name))))
      .catch((e) => setError(e.message))
  }, [])
  useEffect(() => {
    setRecipe(null)
    if (recipeId) getRecipe(recipeId).then(setRecipe).catch((e) => setError(e.message))
  }, [recipeId])

  // Long-press for touch screens: open the size menu after holding ~0.6 s.
  let hold = null
  const openMenu = (x, y) => setMenu({ x, y })
  const touchStart = (e) => { const t = e.touches[0]; hold = setTimeout(() => openMenu(t.clientX, t.clientY), 600) }
  const touchEnd = () => clearTimeout(hold)

  function custom() {
    const v = window.prompt('Brew size in HL', String(hl))
    if (v && Number(v) > 0) setHl(Number(v))
    setMenu(null)
  }

  const litres = hl * 100
  const grist = [...(recipe?.recipe_grist_items ?? [])]
    .map((g) => ({ ...g, kg: (Number(g.qty_g_per_l) || 0) * litres / 1000 }))
    .sort((a, b) => b.kg - a.kg)
  const total = grist.reduce((a, g) => a + g.kg, 0)

  return (
    <div style={{ maxWidth: 720 }} onClick={() => menu && setMenu(null)}>
      <h1>Mill In</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 220px', maxWidth: 320 }}>
          SKU
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} style={{ fontSize: '1.1rem' }}>
            <option value="">Choose…</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <div>
          <div style={{ fontSize: '0.85rem', color: 'var(--ink2)' }}>Brew size</div>
          <button
            className="secondary millin-size"
            onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY) }}
            onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchMove={touchEnd}
            title="Right-click (or press and hold) to change"
          >{hl} HL</button>
        </div>
      </div>
      <p className="stock-muted" style={{ fontSize: '0.85rem', marginTop: '-0.5rem' }}>Right-click the brew size (press and hold on the iPad) to change it.</p>

      {menu && (
        <div className="millin-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {SIZES.map((s) => <button key={s} className={s === hl ? '' : 'secondary'} onClick={() => { setHl(s); setMenu(null) }}>{s} HL</button>)}
          <button className="secondary" onClick={custom}>Other…</button>
        </div>
      )}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {recipe && (
        <section className="stock-card">
          <h2 style={{ marginTop: 0 }}>{recipe.name} · {hl} HL ({litres.toLocaleString()} L)</h2>
          {grist.length ? (
            <table className="stock-table millin-table">
              <thead><tr><th>Malt</th><th style={{ textAlign: 'right' }}>Kg</th><th style={{ textAlign: 'right' }}>Bags</th></tr></thead>
              <tbody>
                {grist.map((g) => {
                  const pack = Number(g.pack_size_kg) || null
                  return (
                    <tr key={g.id ?? g.ingredient_name}>
                      <td>{g.ingredient_name}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{kg(g.kg)}</td>
                      <td style={{ textAlign: 'right' }}>{pack ? `${+(g.kg / pack).toFixed(1)} × ${pack} kg` : ''}</td>
                    </tr>
                  )
                })}
                <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{kg(total)}</strong></td><td></td></tr>
              </tbody>
            </table>
          ) : <p className="stock-muted">This recipe has no grist.</p>}
        </section>
      )}
    </div>
  )
}
