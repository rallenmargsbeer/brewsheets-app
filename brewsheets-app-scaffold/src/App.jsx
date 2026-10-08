import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import RecipesPage from './pages/RecipesPage.jsx'
import RecipeEditPage from './pages/RecipeEditPage.jsx'
import BatchesPage from './pages/BatchesPage.jsx'
import AddBrewPage from './pages/AddBrewPage.jsx'
import BatchDetailPage from './pages/BatchDetailPage.jsx'
import TanksPage from './pages/TanksPage.jsx'
import IngredientsPage from './pages/IngredientsPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import { AuthProvider, RequireAuth } from './auth.jsx'

const navClass = ({ isActive }) => 'nav-link' + (isActive ? ' active' : '')

export default function App() {
  return (
    <AuthProvider>
    <div>
      <header className="app-header">
        <strong className="brand">Brew<span>sheets</span></strong>
        <nav className="app-nav">
          <NavLink to="/recipes" className={navClass}>
            Recipes
          </NavLink>
          <NavLink to="/batches" className={navClass}>
            Batches
          </NavLink>
          <NavLink to="/tanks" className={navClass}>
            Tanks
          </NavLink>
          <NavLink to="/ingredients" className={navClass}>
            Ingredients
          </NavLink>
          <NavLink to="/reports" className={navClass}>
            Reports
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
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reports" element={<RequireAuth><ReportsPage /></RequireAuth>} />
          <Route path="/reports/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        </Routes>
      </main>
    </div>
    </AuthProvider>
  )
}
