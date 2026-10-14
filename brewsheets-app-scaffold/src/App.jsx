import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import RecipesPage from './pages/RecipesPage.jsx'
import RecipeEditPage from './pages/RecipeEditPage.jsx'
import BrewDayPage from './pages/BrewDayPage.jsx'
import BatchesPage from './pages/BatchesPage.jsx'
import AddBrewPage from './pages/AddBrewPage.jsx'
import BatchDetailPage from './pages/BatchDetailPage.jsx'
import TanksPage from './pages/TanksPage.jsx'
import CellarPage from './pages/CellarPage.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
import CellarTemplatesPage from './pages/CellarTemplatesPage.jsx'
import PackagingPage from './pages/PackagingPage.jsx'
import PackagingBatchPage from './pages/PackagingBatchPage.jsx'
import IngredientsPage from './pages/IngredientsPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import StockPage from './pages/StockPage.jsx'
import ForecastPage from './pages/ForecastPage.jsx'
import TodayPage from './pages/TodayPage.jsx'
import IngredientReviewBanner from './components/IngredientReviewBanner.jsx'
import DilutionPage from './pages/DilutionPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import SetPinPage from './pages/SetPinPage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import { AuthProvider, RequireAuth, RequireAdmin, useAuth, signOut } from './auth.jsx'
import { BeerColoursProvider } from './components/BeerDot.jsx'

const navClass = ({ isActive }) => 'nav-link' + (isActive ? ' active' : '')

export default function App() {
  return (
    <AuthProvider>
      <BeerColoursProvider>
        <Shell />
      </BeerColoursProvider>
    </AuthProvider>
  )
}

function Shell() {
  const { appUser, isAdmin } = useAuth()
  const signedIn = appUser?.status === 'active'
  // Adding a brew (/batches/new) belongs to the Brew Day tab, not Batches
  const { pathname } = useLocation()
  const addingBrew = pathname === '/batches/new'
  // The schedule grid (every tank is a column) and the stock and forecast tables (every location is a column)
  // get the full screen width.
  const wide = pathname === '/schedule' || pathname === '/stock' || pathname === '/forecast' || pathname === '/ingredients'
  const user = (el) => <RequireAuth>{el}</RequireAuth>
  const admin = (el) => <RequireAdmin>{el}</RequireAdmin>
  return (
    <div>
      <header className="app-header">
        {/* Same lock-up as the sensory app: cream logo, divider, app name. */}
        <div className="brand">
          <img src="/logo-cream.png" alt="Margaret River Beer Co" />
          <span className="brand-divider" />
          <span className="brand-name">Production App</span>
        </div>
        {signedIn && (
        <nav className="app-nav">
          {isAdmin && <NavLink to="/recipes" className={navClass}>Recipes</NavLink>}
          <NavLink to="/today" className={navClass}>Today</NavLink>
          <NavLink to="/schedule" className={navClass}>Schedule</NavLink>
          <NavLink to="/brew-day" className={(p) => navClass({ isActive: p.isActive || addingBrew })}>Brew Day</NavLink>
          <NavLink to="/batches" className={(p) => navClass({ isActive: p.isActive && !addingBrew })}>Batches</NavLink>
          <NavLink to="/cellar" className={navClass}>Cellar</NavLink>
          <NavLink to="/packaging" className={navClass}>Packaging</NavLink>
          <NavLink to="/tanks" className={navClass}>Tanks</NavLink>
          {isAdmin && <NavLink to="/ingredients" className={navClass}>Ingredients</NavLink>}
          <NavLink to="/calculators" className={navClass}>Calculators</NavLink>
          <NavLink to="/stock" className={navClass}>Stock</NavLink>
          <NavLink to="/forecast" className={navClass}>Forecast</NavLink>
          {isAdmin && <NavLink to="/reports" className={navClass}>Reports</NavLink>}
          {isAdmin && <NavLink to="/users" className={navClass}>Users</NavLink>}
          <button type="button" className="nav-link nav-signout" onClick={signOut} title={appUser.email}>{appUser.name.split(' ')[0]} · Sign out</button>
        </nav>
        )}
      </header>
      <main style={{ padding: '1.5rem', maxWidth: wide ? 'none' : 1100, margin: '0 auto' }}>
        {isAdmin && <IngredientReviewBanner />}
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/set-pin" element={<SetPinPage />} />
          <Route path="/recipes" element={admin(<RecipesPage />)} />
          <Route path="/recipes/new" element={admin(<RecipeEditPage />)} />
          <Route path="/recipes/:id" element={admin(<RecipeEditPage />)} />
          <Route path="/brew-day" element={user(<BrewDayPage />)} />
          <Route path="/batches" element={user(<BatchesPage />)} />
          <Route path="/batches/new" element={user(<AddBrewPage />)} />
          <Route path="/batches/:id" element={user(<BatchDetailPage />)} />
          <Route path="/today" element={user(<TodayPage />)} />
          <Route path="/schedule" element={user(<SchedulePage />)} />
          <Route path="/schedule/templates" element={admin(<CellarTemplatesPage />)} />
          <Route path="/cellar" element={user(<CellarPage />)} />
          <Route path="/packaging" element={user(<PackagingPage />)} />
          <Route path="/packaging/:id" element={user(<PackagingBatchPage />)} />
          <Route path="/tanks" element={user(<TanksPage />)} />
          <Route path="/ingredients" element={admin(<IngredientsPage />)} />
          <Route path="/calculators" element={user(<DilutionPage />)} />
          <Route path="/dilution" element={<Navigate to="/calculators" replace />} />
          <Route path="/stock" element={user(<StockPage />)} />
          <Route path="/forecast" element={user(<ForecastPage />)} />
          <Route path="/reports" element={admin(<ReportsPage />)} />
          <Route path="/reports/dashboard" element={admin(<DashboardPage />)} />
          <Route path="/users" element={admin(<UsersPage />)} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
    </div>
  )
}
