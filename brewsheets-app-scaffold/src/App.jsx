import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import RecipesPage from './pages/RecipesPage.jsx'
import RecipeEditPage from './pages/RecipeEditPage.jsx'
import BrewDayPage from './pages/BrewDayPage.jsx'
import BatchesPage from './pages/BatchesPage.jsx'
import AddBrewPage from './pages/AddBrewPage.jsx'
import BatchDetailPage from './pages/BatchDetailPage.jsx'
import TanksPage from './pages/TanksPage.jsx'
import CellarPage from './pages/CellarPage.jsx'
import IngredientsPage from './pages/IngredientsPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import { AuthProvider, RequireAuth } from './auth.jsx'

const navClass = ({ isActive }) => 'nav-link' + (isActive ? ' active' : '')

export default function App() {
  // Adding a brew (/batches/new) belongs to the Brew Day tab, not Batches
  const addingBrew = useLocation().pathname === '/batches/new'
  return (
    <AuthProvider>
    <div>
      <header className="app-header">
        <strong className="brand">Brew<span>sheets</span></strong>
        <nav className="app-nav">
          <NavLink to="/recipes" className={navClass}>
            Recipes
          </NavLink>
          <NavLink to="/brew-day" className={(p) => navClass({ isActive: p.isActive || addingBrew })}>
            Brew Day
          </NavLink>
          <NavLink to="/batches" className={(p) => navClass({ isActive: p.isActive && !addingBrew })}>
            Batches
          </NavLink>
          <NavLink to="/cellar" className={navClass}>
            Cellar
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
          <Route path="/" element={<Navigate to="/brew-day" replace />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/new" element={<RecipeEditPage />} />
          <Route path="/recipes/:id" element={<RecipeEditPage />} />
          <Route path="/brew-day" element={<BrewDayPage />} />
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/batches/new" element={<AddBrewPage />} />
          <Route path="/batches/:id" element={<BatchDetailPage />} />
          <Route path="/cellar" element={<CellarPage />} />
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
