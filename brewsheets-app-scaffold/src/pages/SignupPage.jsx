import { useState } from 'react'
import { Link } from 'react-router-dom'
import { pinAuth } from '../auth'
import PinPad from '../components/PinPad.jsx'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState('details') // details | pin | confirm | done
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const emailOk = /^[^@\s]+@(margaretriverbeer\.co|mrbeergroup\.com)$/i.test(email.trim())

  async function submit(p2) {
    if (p2 !== pin) { setError("Those PINs don't match. Try again."); setPin(''); setConfirm(''); setStep('pin'); return }
    setBusy(true)
    setError('')
    try {
      setResult(await pinAuth({ action: 'signup', email: email.trim(), name: name.trim(), pin }))
      setStep('done')
    } catch (e) {
      setError(e.message)
      setPin(''); setConfirm(''); setStep(/PIN/.test(e.message) ? 'pin' : 'details')
    }
    setBusy(false)
  }

  if (step === 'done') {
    return (
      <div className="auth-card">
        <h1>You're signed up</h1>
        {result?.status === 'active'
          ? <p className="auth-ok">Your account is ready. Sign in with your PIN.</p>
          : <p className="auth-ok">{result?.confirmed ? '' : 'Check your email and click the link to confirm it. '}An admin then approves your account, and you sign in with your PIN.</p>}
        <Link to="/login">Go to sign in</Link>
      </div>
    )
  }
  return (
    <div className="auth-card">
      <h1>Sign up</h1>
      {step === 'details' && (
        <form onSubmit={(e) => { e.preventDefault(); setError(''); setStep('pin') }} style={{ display: 'grid', gap: '0.75rem' }}>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          <input type="email" placeholder="you@margaretriverbeer.co" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          {email && !emailOk && <p className="auth-error">Use your @margaretriverbeer.co or @mrbeergroup.com email.</p>}
          <button type="submit" disabled={!name.trim() || !emailOk}>Next: choose a PIN</button>
        </form>
      )}
      {step === 'pin' && (
        <>
          <p className="stock-muted">Choose a 4-digit PIN. It's how you sign in, so keep it to yourself.</p>
          <PinPad value={pin} onChange={setPin} onComplete={() => { setError(''); setStep('confirm') }} />
        </>
      )}
      {step === 'confirm' && (
        <>
          <p className="stock-muted">Enter it again to confirm.</p>
          <PinPad value={confirm} onChange={setConfirm} onComplete={submit} disabled={busy} />
        </>
      )}
      {busy && <p className="stock-muted">Signing up…</p>}
      {error && <p className="auth-error">{error}</p>}
      <div className="auth-links"><Link to="/login">Back to sign in</Link></div>
    </div>
  )
}
