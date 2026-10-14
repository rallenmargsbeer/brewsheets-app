import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth, pinAuth } from '../auth'
import PinPad from '../components/PinPad.jsx'

// Reached from the "Forgot PIN?" email link, which signs you in.
export default function SetPinPage() {
  const { session, loading, reloadUser } = useAuth()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState('pin')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  if (loading) return <p style={{ color: '#666' }}>Loading…</p>
  if (!session) return <Navigate to="/login" replace />

  async function save(p2) {
    if (p2 !== pin) { setError("Those PINs don't match. Try again."); setPin(''); setConfirm(''); setStep('pin'); return }
    try {
      await pinAuth({ action: 'setpin', pin }, session.access_token)
      await reloadUser()
      setDone(true)
    } catch (e) {
      setError(e.message); setPin(''); setConfirm(''); setStep('pin')
    }
  }
  return (
    <div className="auth-card">
      <h1>Set a new PIN</h1>
      {done ? (
        <>
          <p className="auth-ok">PIN saved. Use it to sign in from now on.</p>
          <Link to="/today">Continue</Link>
        </>
      ) : step === 'pin' ? (
        <PinPad value={pin} onChange={setPin} onComplete={() => { setError(''); setStep('confirm') }} />
      ) : (
        <>
          <p className="stock-muted">Enter it again to confirm.</p>
          <PinPad value={confirm} onChange={setConfirm} onComplete={save} />
        </>
      )}
      {error && <p className="auth-error">{error}</p>}
    </div>
  )
}
