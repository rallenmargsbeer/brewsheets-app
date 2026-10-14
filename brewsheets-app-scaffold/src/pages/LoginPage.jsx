import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth, pinAuth } from '../auth'
import PinPad from '../components/PinPad.jsx'

export default function LoginPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const from = location.state?.from || '/today'
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forgot, setForgot] = useState(false)

  if (session && !params.get('confirmed')) return <Navigate to={from} replace />

  async function signIn(p) {
    setBusy(true)
    setError('')
    try {
      const t = await pinAuth({ action: 'signin', pin: p })
      const { error: err } = await supabase.auth.setSession(t)
      if (err) throw err
      navigate(from, { replace: true })
    } catch (e) {
      setError(e.message)
      setPin('')
    }
    setBusy(false)
  }

  if (forgot) return <ForgotPin onBack={() => setForgot(false)} />
  return (
    <div className="auth-card">
      <h1>Enter your PIN</h1>
      {params.get('confirmed') && <p className="auth-ok">Email confirmed. Once an admin approves you, sign in with your PIN.</p>}
      <PinPad value={pin} onChange={setPin} onComplete={signIn} disabled={busy} />
      {busy && <p className="stock-muted">Signing in…</p>}
      {error && <p className="auth-error">{error}</p>}
      <div className="auth-links">
        <Link to="/signup">Sign up</Link>
        <button type="button" className="linklike" onClick={() => setForgot(true)}>Forgot PIN?</button>
      </div>
    </div>
  )
}

// Emails a link that signs you in to set a new PIN.
function ForgotPin({ onBack }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  async function send(e) {
    e.preventDefault()
    setError('')
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/set-pin` },
    })
    if (err) setError(err.message)
    else setSent(true)
  }
  return (
    <form className="auth-card" onSubmit={send}>
      <h1>Forgot your PIN?</h1>
      {sent ? (
        <p className="auth-ok">Check your email for a link to set a new PIN.</p>
      ) : (
        <>
          <p className="stock-muted">We'll email you a link to set a new one.</p>
          <input type="email" placeholder="you@margaretriverbeer.co" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit">Email me a link</button>
        </>
      )}
      <button type="button" className="linklike" onClick={onBack}>Back to sign in</button>
    </form>
  )
}
