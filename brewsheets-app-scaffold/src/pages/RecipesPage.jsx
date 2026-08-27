import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecipes } from '../lib/api'

export default function RecipesPage() {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listRecipes()
      .then(setRecipes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

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

      {!loading && !error && (
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
            {recipes.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.style}</td>
                <td>{r.target_og ?? '—'}</td>
                <td>{r.target_fg ?? '—'}</td>
                <td>{r.is_core_range ? 'Yes' : 'No'}</td>
                <td>
                  <Link to={`/recipes/${r.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
            {recipes.length === 0 && (
              <tr>
                <td colSpan={6}>No recipes yet — create one to get started.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
