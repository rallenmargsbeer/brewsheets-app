import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// For admins: staff who've signed up and are waiting to be approved. Rechecked on every page
// change, every few minutes, and when the Users page changes someone.
export function usePendingUsers(enabled) {
  const [users, setUsers] = useState([])
  const { pathname } = useLocation()
  useEffect(() => {
    if (!enabled) return setUsers([])
    let off = false
    const load = () =>
      supabase.from('app_users').select('id, name, email').eq('status', 'pending').order('created_at')
        .then(({ data }) => { if (!off) setUsers(data ?? []) })
    load()
    const timer = setInterval(load, 5 * 60 * 1000)
    window.addEventListener('users-changed', load)
    return () => { off = true; clearInterval(timer); window.removeEventListener('users-changed', load) }
  }, [enabled, pathname])
  return users
}

export default function PendingUsersBanner({ users }) {
  const { pathname } = useLocation()
  if (!users.length) return null
  const names = users.slice(0, 3).map((u) => u.name).join(', ')
  return (
    <div className="ing-banner">
      <span>
        <strong>{users.length} {users.length === 1 ? 'person is' : 'people are'} waiting for approval</strong>
        {' '}({names}{users.length > 3 ? `, +${users.length - 3} more` : ''}).
      </span>
      {pathname !== '/users' && <Link to="/users"><button>Review</button></Link>}
    </div>
  )
}
