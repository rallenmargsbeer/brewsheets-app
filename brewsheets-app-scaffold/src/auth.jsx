import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'

const AuthContext = createContext({ session: null, appUser: null, isAdmin: false, isAccounts: false, loading: true })

// Session plus the staff account (app_users row: name, role, status).
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [appUser, setAppUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async (s) => {
    if (!s) { setAppUser(null); return }
    const { data } = await supabase.from('app_users').select('id, email, name, role, status').eq('id', s.user.id).maybeSingle()
    setAppUser(data ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadUser(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Outside the callback: supabase calls made inside it can deadlock.
      setTimeout(() => loadUser(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadUser])

  const isAdmin = appUser?.role === 'admin' && appUser?.status === 'active'
  // Accounts users only get the Excise tab.
  const isAccounts = appUser?.role === 'accounts' && appUser?.status === 'active'
  return <AuthContext.Provider value={{ session, appUser, isAdmin, isAccounts, loading, reloadUser: () => loadUser(session) }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export async function signOut() {
  await supabase.auth.signOut()
}

// Calls the pin-auth function; throws its error message.
export async function pinAuth(body, accessToken) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pin-auth`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`)
  return data
}

function Blocked({ title, children }) {
  return (
    <div className="auth-card">
      <h1>{title}</h1>
      <p className="stock-muted">{children}</p>
      <button className="secondary" onClick={signOut}>Sign out</button>
    </div>
  )
}

// Wrap any route element that needs a signed-in, approved staff member.
export function RequireAuth({ children }) {
  const { session, appUser, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p style={{ color: '#666' }}>Loading…</p>
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!appUser) return <Blocked title="No account yet">This email isn't set up as a staff account. <Link to="/signup">Sign up</Link> first.</Blocked>
  if (appUser.status === 'pending') return <Blocked title="Waiting for approval">Thanks {appUser.name}. An admin needs to approve your account before you can use the app.</Blocked>
  if (appUser.status !== 'active') return <Blocked title="Account disabled">Talk to an admin if you need access again.</Blocked>
  return children
}

// Admin-only pages.
export function RequireAdmin({ children }) {
  const { isAdmin } = useAuth()
  return (
    <RequireAuth>
      {isAdmin ? children : <div className="auth-card"><h1>Admins only</h1><p className="stock-muted">Ask an admin if you need this.</p></div>}
    </RequireAuth>
  )
}
