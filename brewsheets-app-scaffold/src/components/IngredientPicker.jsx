import { useEffect, useMemo, useRef, useState } from 'react'

// Type-ahead over the Unleashed ingredient list. Only an exact Unleashed name can be
// committed (typing is case-insensitive; the saved name always uses Unleashed's
// spelling). Anything else reverts to the previous name on blur.
export default function IngredientPicker({ value, section, ingredients, onCommit, disabled, width = 200 }) {
  const [text, setText] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [warning, setWarning] = useState(null)
  // Tables clip overflow, so the list is fixed-positioned under the input instead.
  const inputRef = useRef(null)
  const [rect, setRect] = useState(null)
  useEffect(() => {
    if (!open) return
    const place = () => setRect(inputRef.current?.getBoundingClientRect() ?? null)
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Follow outside changes to the value (e.g. a recipe row above this one removed).
  useEffect(() => setText(value ?? ''), [value])

  const byLower = useMemo(() => new Map(ingredients.map((i) => [i.name.toLowerCase(), i.name])), [ingredients])

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    const hits = ingredients.filter((i) => i.name.toLowerCase().includes(q))
    // Ingredients tagged for this brew-sheet section first, then names starting with what was typed.
    const rank = (i) => (i.sections?.includes(section) ? 0 : 2) + (i.name.toLowerCase().startsWith(q) ? 0 : 1)
    return hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 8)
  }, [text, ingredients, section])

  function commit(name) {
    setText(name)
    setOpen(false)
    setWarning(null)
    if (name !== value) onCommit(name)
  }

  // Suggestions cancel mousedown, so picking one never blurs the input; a blur means
  // the brewer left the field with whatever they typed.
  function onBlur() {
    setOpen(false)
    const exact = byLower.get(text.trim().toLowerCase())
    if (exact) commit(exact)
    else if (text !== (value ?? '')) {
      setWarning(`"${text}" isn't an Unleashed ingredient`)
      setText(value)
    }
  }

  function onKeyDown(e) {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(matches[active].name)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div style={{ position: 'relative', width }}>
      <input
        ref={inputRef}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
          setWarning(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        style={{ width: '100%', boxSizing: 'border-box', ...(warning ? { borderColor: 'crimson' } : {}) }}
        autoComplete="off"
      />
      {open && rect && matches.length > 0 && text !== (value ?? '') && (
        <ul
          role="listbox"
          style={{ position: 'fixed', zIndex: 1100, left: rect.left, top: rect.bottom + 2, minWidth: rect.width, width: 'max-content', maxWidth: 340, margin: 0, padding: 0, listStyle: 'none', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, boxShadow: '0 4px 14px rgba(0,0,0,0.12)' }}
        >
          {matches.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(m.name)}
              onMouseEnter={() => setActive(i)}
              style={{ padding: '0.45rem 0.6rem', cursor: 'pointer', background: i === active ? 'var(--accent-soft)' : 'transparent' }}
            >
              {m.name}
            </li>
          ))}
        </ul>
      )}
      {warning && <div style={{ color: 'crimson', fontSize: '0.75rem', marginTop: 2 }}>{warning}</div>}
    </div>
  )
}
