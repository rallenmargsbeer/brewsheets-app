import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// The tabs along the top. Admins can drag them into any order and set each one to
// everyone or admins only (saved in app_settings 'nav', so it's the same for everybody).
// Users is always admins only.
export const TABS = [
  { path: '/recipes', label: 'Recipes', admin: true },
  { path: '/today', label: 'Today' },
  { path: '/schedule', label: 'Schedule' },
  { path: '/brew-day', label: 'Brew Day' },
  { path: '/batches', label: 'Batches' },
  { path: '/cellar', label: 'Cellar' },
  { path: '/packaging', label: 'Packaging' },
  { path: '/tanks', label: 'Tanks' },
  { path: '/ingredients', label: 'Ingredients', admin: true },
  { path: '/calculators', label: 'Calculators' },
  { path: '/stock', label: 'Stock' },
  { path: '/forecast', label: 'Forecast' },
  { path: '/reports', label: 'Reports', admin: true },
  { path: '/unleashed', label: 'Unleashed', admin: true },
  { path: '/users', label: 'Users', admin: true, locked: true },
]

const DEFAULT = { order: TABS.map((t) => t.path), adminOnly: TABS.filter((t) => t.admin).map((t) => t.path) }

// The saved layout, with any tab that isn't in it added at the end.
function normalise(cfg) {
  const order = (cfg?.order ?? DEFAULT.order).filter((p) => TABS.some((t) => t.path === p))
  for (const t of TABS) if (!order.includes(t.path)) order.push(t.path)
  const adminOnly = new Set(cfg?.adminOnly ?? DEFAULT.adminOnly)
  // Tabs added since the layout was saved start with their default (so a new admin tab stays admin only).
  for (const t of TABS) if (t.locked || (t.admin && cfg?.order && !cfg.order.includes(t.path))) adminOnly.add(t.path)
  return { order, adminOnly: [...adminOnly] }
}

// The tab layout, loaded once and shared. `isAdminOnly(path)` also covers a tab's sub-pages.
export function useNavConfig() {
  const [cfg, setCfg] = useState(() => normalise(null))
  useEffect(() => {
    supabase.from('app_settings').select('data').eq('key', 'nav').maybeSingle().then(({ data }) => { if (data?.data) setCfg(normalise(data.data)) })
  }, [])
  const isAdminOnly = (path) => cfg.adminOnly.some((p) => path === p || path.startsWith(p + '/'))
  async function save(next) {
    const n = normalise(next)
    const { error } = await supabase.from('app_settings').upsert({ key: 'nav', data: n, updated_at: new Date().toISOString() })
    if (error) throw error
    setCfg(n)
  }
  return { cfg, isAdminOnly, save }
}

const navClass = ({ isActive }) => 'nav-link' + (isActive ? ' active' : '')

export default function NavTabs({ nav, isAdmin, badges = {}, extra }) {
  const { pathname } = useLocation()
  const addingBrew = pathname === '/batches/new' // belongs to Brew Day, not Batches
  const [editing, setEditing] = useState(null) // { order, adminOnly } while editing
  const [drag, setDrag] = useState(null)
  const [error, setError] = useState(null)

  const tab = (path) => TABS.find((t) => t.path === path)
  if (editing) {
    const move = (from, to) => {
      if (from === to) return
      const order = [...editing.order]
      const [p] = order.splice(from, 1)
      order.splice(to, 0, p)
      setEditing({ ...editing, order })
    }
    const toggle = (path) => {
      const set = new Set(editing.adminOnly)
      if (set.has(path)) set.delete(path)
      else set.add(path)
      setEditing({ ...editing, adminOnly: [...set] })
    }
    return (
      <nav className="app-nav nav-editing">
        {editing.order.map((path, i) => {
          const t = tab(path)
          const adminOnly = editing.adminOnly.includes(path)
          return (
            <span
              key={path}
              className={'nav-chip' + (drag === i ? ' dragging' : '')}
              draggable
              onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { e.preventDefault(); if (drag != null && drag !== i) { move(drag, i); setDrag(i) } }}
              onDragEnd={() => setDrag(null)}
              title="Drag to move"
            >
              <span className="nav-grip">⋮⋮</span>
              {t.label}
              <button
                type="button"
                className={'nav-who' + (adminOnly ? ' admin' : '')}
                disabled={t.locked}
                onClick={() => toggle(path)}
                title={t.locked ? 'Always admins only' : 'Click to change who sees this tab'}
              >
                {adminOnly ? 'Admins only' : 'Everyone'}
              </button>
            </span>
          )
        })}
        <button type="button" className="nav-link nav-save" onClick={async () => {
          try { await nav.save(editing); setEditing(null); setError(null) } catch (e) { setError(e.message) }
        }}>Save tabs</button>
        <button type="button" className="nav-link nav-edit-btn secondary" onClick={() => { setEditing(null); setError(null) }}>Cancel</button>
        {error && <span className="nav-error">{error}</span>}
      </nav>
    )
  }

  return (
    <nav className="app-nav">
      {nav.cfg.order.filter((p) => isAdmin || !nav.cfg.adminOnly.includes(p)).map((path) => {
        const t = tab(path)
        const cls = path === '/brew-day' ? (p) => navClass({ isActive: p.isActive || addingBrew }) : path === '/batches' ? (p) => navClass({ isActive: p.isActive && !addingBrew }) : navClass
        return (
          <NavLink key={path} to={path} className={cls}>
            {t.label}
            {badges[path] > 0 && <span className="nav-badge">{badges[path]}</span>}
          </NavLink>
        )
      })}
      {isAdmin && <button type="button" className="nav-link nav-edit-btn" onClick={() => setEditing({ order: [...nav.cfg.order], adminOnly: [...nav.cfg.adminOnly] })} title="Reorder tabs and choose who sees them">Edit tabs</button>}
      {extra}
    </nav>
  )
}
