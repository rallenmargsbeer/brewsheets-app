import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth'

const STATUS = { pending: 'Waiting for approval', active: 'Active', disabled: 'Disabled' }

export default function UsersPage() {
  const { appUser } = useAuth()
  const [users, setUsers] = useState(null)
  const [confirmed, setConfirmed] = useState({})
  const [error, setError] = useState('')

  async function load() {
    const [u, c] = await Promise.all([
      supabase.from('app_users').select('*').order('status', { ascending: false }).order('name'),
      supabase.rpc('app_users_confirmed'),
    ])
    if (u.error) { setError(u.error.message); return }
    setUsers(u.data)
    setConfirmed(Object.fromEntries((c.data ?? []).map((r) => [r.id, r.confirmed])))
  }
  useEffect(() => { load() }, [])

  async function update(u, patch, ask) {
    if (ask && !window.confirm(ask)) return
    setError('')
    const { error: err } = await supabase.from('app_users').update(patch).eq('id', u.id)
    if (err) setError(err.message)
    load()
    window.dispatchEvent(new Event('users-changed'))
  }
  const approve = (u) => update(u, { status: 'active', approved_at: new Date().toISOString(), approved_by: appUser?.email })

  if (!users) return <p>{error || 'Loading…'}</p>
  const pending = users.filter((u) => u.status === 'pending').length
  return (
    <div>
      <h1>Users</h1>
      <p className="stock-muted">
        Staff sign up with their @margaretriverbeer.co (or @mrbeergroup.com) email and a 4-digit PIN, confirm their email, then you approve them here.
        Users run brew day, cellar and packaging; admins can also edit the schedule, recipes, ingredients and forecast, see reports, and manage users.
      </p>
      {pending > 0 && <p className="auth-ok">{pending} waiting for approval.</p>}
      {error && <p className="auth-error">{error}</p>}
      <div className="stock-scroll">
        <table className="users-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Email confirmed</th><th>Level</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const me = u.id === appUser?.id
              return (
                <tr key={u.id} className={u.status === 'pending' ? 'users-pending' : ''}>
                  <td>{u.name}{me && <span className="stock-muted"> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>{confirmed[u.id] ? 'Yes' : 'Not yet'}</td>
                  <td>
                    <select value={u.role} disabled={me} onChange={(e) => update(u, { role: e.target.value })}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                      <option value="accounts">Accounts (Excise only)</option>
                    </select>
                  </td>
                  <td>{STATUS[u.status]}{!u.pin_hmac && <span className="stock-muted"> · no PIN</span>}</td>
                  <td className="users-actions">
                    {u.status === 'pending' && <button onClick={() => approve(u)}>Approve</button>}
                    {u.status === 'active' && !me && <button className="secondary" onClick={() => update(u, { status: 'disabled' }, `Disable ${u.name}? They won't be able to sign in.`)}>Disable</button>}
                    {u.status === 'disabled' && <button className="secondary" onClick={() => approve(u)}>Enable</button>}
                    {u.pin_hmac && <button className="secondary" onClick={() => update(u, { pin_hmac: null }, `Reset ${u.name}'s PIN? They'll set a new one with "Forgot PIN?" on the sign-in screen.`)}>Reset PIN</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
