import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecipes, setRecipeHidden } from '../lib/api'
import BeerDot from '../components/BeerDot.jsx'

export default function RecipesPage() {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showHidden, setShowHidden] = useState(false)

  const load = () =>
    listRecipes()
      .then(setRecipes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  async function toggle(r) {
    try {
      await setRecipeHidden(r.id, r.is_active !== false)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const shown = recipes.filter((r) => r.is_active !== false)
  const hidden = recipes.filter((r) => r.is_active === false)
  const rows = (list) => list.map((r) => (
    <tr key={r.id} className={r.is_active === false ? 'recipe-hidden' : ''}>
      <td><BeerDot name={r.name} />{r.name}</td>
      <td>{r.style}</td>
      <td>{r.target_og ?? '—'}</td>
      <td>{r.target_fg ?? '—'}</td>
      <td>{r.is_core_range ? 'Yes' : 'No'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <Link to={`/recipes/${r.id}`}>Edit</Link>
        <button className="secondary recipe-hide" onClick={() => toggle(r)}>{r.is_active === false ? 'Unhide' : 'Hide'}</button>
      </td>
    </tr>
  ))

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <h1>Recipes</h1>
        <Link to="/recipes/new">
          <button>+ New Recipe</button>
        </Link>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && (
        <>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Style</th>
                <th>Target OG</th>
                <th>Target FG</th>
                <th>Core range?</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows(shown)}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6}>No recipes yet — create one to get started.</td>
                </tr>
              )}
              {showHidden && hidden.length > 0 && (
                <tr className="recipe-hidden-head"><td colSpan={6}>Hidden: not offered on Brew Day</td></tr>
              )}
              {showHidden && rows(hidden)}
            </tbody>
          </table>
          {hidden.length > 0 && (
            <button className="secondary" style={{ marginTop: '0.75rem' }} onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? 'Collapse hidden recipes' : `Show ${hidden.length} hidden recipe${hidden.length === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
