import { Link } from 'react-router-dom'

export default function BrewDayPage() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <h1>Brew Day</h1>
      <p style={{ color: 'var(--ink2)', marginBottom: '2rem' }}>
        Pick a recipe, set the turn volume and number of turns, then fill in the brew sheet.
      </p>
      <Link to="/batches/new">
        <button style={{ fontSize: '1.25rem', padding: '1rem 2.5rem' }}>Start brew</button>
      </Link>
    </div>
  )
}
