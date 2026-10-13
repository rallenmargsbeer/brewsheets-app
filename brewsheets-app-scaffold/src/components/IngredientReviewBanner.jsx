import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { listIngredientsToReview } from '../lib/api'
import { isScheduleEditor } from '../lib/schedule'

// For editors: new ingredients synced in from Unleashed that nobody has checked yet.
export default function IngredientReviewBanner() {
  const [items, setItems] = useState([])
  const { pathname } = useLocation()
  useEffect(() => {
    let off = false
    const load = () => isScheduleEditor().then((ok) => (ok ? listIngredientsToReview() : [])).then((r) => { if (!off) setItems(r) }).catch(() => {})
    load()
    window.addEventListener('ingredients-changed', load)
    return () => { off = true; window.removeEventListener('ingredients-changed', load) }
  }, [pathname])
  if (!items.length) return null
  const names = items.slice(0, 4).map((i) => i.name).join(', ')
  return (
    <div className="ing-banner">
      <span>
        <strong>{items.length} new ingredient{items.length === 1 ? '' : 's'} synced from Unleashed</strong>
        {' '}({names}{items.length > 4 ? `, +${items.length - 4} more` : ''}). Check their details are right.
      </span>
      {pathname !== '/ingredients' && <Link to="/ingredients?review=1"><button>Review</button></Link>}
    </div>
  )
}
