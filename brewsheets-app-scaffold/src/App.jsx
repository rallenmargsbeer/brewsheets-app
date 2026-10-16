import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
import PendingUsersBanner, { usePendingUsers } from './components/PendingUsersBanner.jsx'
import NavTabs, { useNavConfig } from './components/NavTabs.jsx'
import DilutionPage from './pages/DilutionPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import SetPinPage from './pages/SetPinPage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import PackagingMaterialsPage from './pages/PackagingMaterialsPage.jsx'
import UnleashedPage from './pages/UnleashedPage.jsx'
import ExcisePage from './pages/ExcisePage.jsx'
import StartBlendPage from './pages/StartBlendPage.jsx'
import { AuthProvider, RequireAuth, RequireAdmin, useAuth, signOut } from './auth.jsx'
import { BeerColoursProvider } from './components/BeerDot.jsx'


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
  const { appUser, isAdmin, isAccounts } = useAuth()
  const signedIn = appUser?.status === 'active'
  const pendingUsers = usePendingUsers(isAdmin)
  const nav = useNavConfig()
  const { pathname } = useLocation()
  // The schedule grid (every tank is a column) and the stock and forecast tables (every location is a column)
  // get the full screen width.
  const wide = pathname === '/schedule' || pathname === '/stock' || pathname === '/forecast' || pathname === '/ingredients'
  const user = (el) => <RequireAuth>{el}</RequireAuth>
  const admin = (el) => <RequireAdmin>{el}</RequireAdmin>
  // A tab's pages follow its setting: admins only, or everyone signed in.
  const gate = (path, el) => (nav.isAdminOnly(path) ? admin(el) : user(el))
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
          <NavTabs
            nav={nav}
            isAdmin={isAdmin}
            isAccounts={isAccounts}
            badges={{ '/users': pendingUsers.length }}
            extra={<button type="button" className="nav-link nav-signout" onClick={signOut} title={appUser.email}>{appUser.name.split(' ')[0]} · Sign out</button>}
          />
        )}
      </header>
      <main style={{ padding: '1.5rem', maxWidth: wide ? 'none' : 1100, margin: '0 auto' }}>
        {isAdmin && <PendingUsersBanner users={pendingUsers} />}
        {isAdmin && <IngredientReviewBanner />}
        {isAccounts ? (
          // Accounts: the Excise tab only; any other address lands there.
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-pin" element={<SetPinPage />} />
            <Route path="/excise" element={user(<ExcisePage />)} />
            <Route path="*" element={<Navigate to="/excise" replace />} />
          </Routes>
        ) : (
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/set-pin" element={<SetPinPage />} />
          <Route path="/recipes" element={gate('/recipes', <RecipesPage />)} />
          <Route path="/recipes/new" element={gate('/recipes', <RecipeEditPage />)} />
          <Route path="/recipes/:id" element={gate('/recipes', <RecipeEditPage />)} />
          <Route path="/brew-day" element={gate('/brew-day', <BrewDayPage />)} />
          <Route path="/brew-day/blend" element={gate('/brew-day', <StartBlendPage />)} />
          <Route path="/batches" element={gate('/batches', <BatchesPage />)} />
          <Route path="/batches/new" element={gate('/batches', <AddBrewPage />)} />
          <Route path="/batches/:id" element={gate('/batches', <BatchDetailPage />)} />
          <Route path="/today" element={gate('/today', <TodayPage />)} />
          <Route path="/schedule" element={gate('/schedule', <SchedulePage />)} />
          <Route path="/schedule/templates" element={admin(<CellarTemplatesPage />)} />
          <Route path="/schedule/materials" element={gate('/schedule/materials', <PackagingMaterialsPage />)} />
          <Route path="/cellar" element={gate('/cellar', <CellarPage />)} />
          <Route path="/packaging" element={gate('/packaging', <PackagingPage />)} />
          <Route path="/packaging/:id" element={gate('/packaging', <PackagingBatchPage />)} />
          <Route path="/tanks" element={gate('/tanks', <TanksPage />)} />
          <Route path="/ingredients" element={gate('/ingredients', <IngredientsPage />)} />
          <Route path="/calculators" element={gate('/calculators', <DilutionPage />)} />
          <Route path="/dilution" element={<Navigate to="/calculators" replace />} />
          <Route path="/stock" element={gate('/stock', <StockPage />)} />
          <Route path="/forecast" element={gate('/forecast', <ForecastPage />)} />
          <Route path="/unleashed" element={gate('/unleashed', <UnleashedPage />)} />
          <Route path="/excise" element={gate('/excise', <ExcisePage />)} />
          <Route path="/reports" element={gate('/reports', <ReportsPage />)} />
          <Route path="/reports/dashboard" element={gate('/reports/dashboard', <DashboardPage />)} />
          <Route path="/users" element={admin(<UsersPage />)} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
        )}
      </main>
    </div>
  )
}
