import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import RecipesPage from './pages/RecipesPage.jsx'
import RecipeEditPage from './pages/RecipeEditPage.jsx'
import BatchesPage from './pages/BatchesPage.jsx'
import AddBrewPage from './pages/AddBrewPage.jsx'
import BatchDetailPage from './pages/BatchDetailPage.jsx'
import TanksPage from './pages/TanksPage.jsx'
import IngredientsPage from './pages/IngredientsPage.jsx'

const navStyle = ({ isActive }) => ({
  padding: '0.5rem 1rem',
  textDecoration: 'none',
  color: isActive ? '#fff' : '#1a1a1a',
  background: isActive ? '#1a1a1a' : 'transparent',
  borderRadius: 4,
  fontWeight: 600,
})

export default function App() {
  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '1rem 1.5rem',
          borderBottom: '1px solid #ddd',
          background: '#fff',
        }}
      >
        <strong style={{ fontSize: '1.1rem' }}>🍺 Brewsheets</strong>
        <nav style={{ display: 'flex', gap: '0.5rem' }}>
          <NavLink to="/recipes" style={navStyle}>
            Recipes
          </NavLink>
          <NavLink to="/batches" style={navStyle}>
            Batches
          </NavLink>
          <NavLink to="/tanks" style={navStyle}>
            Tanks
          </NavLink>
          <NavLink to="/ingredients" style={navStyle}>
            Ingredients
          </NavLink>
        </nav>
      </header>
      <main style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/batches" replace />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/new" element={<RecipeEditPage />} />
          <Route path="/recipes/:id" element={<RecipeEditPage />} />
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/batches/new" element={<AddBrewPage />} />
          <Route path="/batches/:id" element={<BatchDetailPage />} />
          <Route path="/tanks" element={<TanksPage />} />
          <Route path="/ingredients" element={<IngredientsPage />} />
        </Routes>
      </main>
    </div>
  )
}
