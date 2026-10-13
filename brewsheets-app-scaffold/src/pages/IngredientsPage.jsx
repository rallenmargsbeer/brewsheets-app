import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  listIngredients,
  markIngredientChecked,
  syncIngredients,
  ingredientSyncInfo,
  updateIngredientSections,
  updateIngredientPotentialPpg,
  updateIngredientAlphaAcid,
  updateIngredientLovibond,
} from '../lib/api'
import { isScheduleEditor } from '../lib/schedule'

// Recipe-flow order — also used for the default sort/grouping below.
const SECTION_ORDER = ['grist', 'water', 'kettle', 'whirlpool', 'fermenter']
const SECTION_LABELS = {
  grist: 'Grist / Malt Bill',
  water: 'Water Chemistry',
  kettle: 'Kettle Additions',
  whirlpool: 'Whirlpool Additions',
  fermenter: 'Fermenter Additions',
}

// Keeps the header row visible while scrolling through a ~300-row list.
// Matches the page background (#f7f5f2, from index.css) so rows scrolling
// underneath don't show through, plus a shadow so it reads as "on top."
const stickyHeaderCellStyle = {
  position: 'sticky',
  top: 0,
  background: '#f7f5f2',
  boxShadow: '0 1px 0 #ddd',
  zIndex: 1,
}

// Potential PPG only makes sense for a fermentable, Alpha Acid % only for a hop — both are
// gated on Unleashed's own "Product Group" classification (kept as-is in unleashed_group),
// not the section checkboxes, since a non-hop item like Irish Moss is still legitimately
// checked into Kettle Additions and shouldn't get an Alpha Acid field because of that.
function isMalt(ingredient) {
  return (ingredient.unleashed_group || '').trim().toLowerCase() === 'malt'
}
function isHops(ingredient) {
  return (ingredient.unleashed_group || '').trim().toLowerCase() === 'hops'
}

// For sorting/grouping only — an ingredient can belong to several sections,
// so this just picks the earliest one in recipe-flow order to group it
// under. It's still suggested everywhere it's actually assigned.
function primarySection(sections) {
  return SECTION_ORDER.find((s) => sections.includes(s)) ?? null
}

// Shared editable-number cell for Potential PPG / Alpha Acid % — only editable for the
// ingredient type it applies to (see isMalt/isHops above); shows a plain dash everywhere
// else so it's clear the field doesn't apply rather than looking like an empty editable one.
// Local input + save-on-blur, same pattern as the per-turn ingredient rows on the Batch
// Detail page.
function NumericTagCell({ applies, value, onSave }) {
  const [local, setLocal] = useState(value ?? '')
  if (!applies) return <span style={{ color: '#ccc' }}>—</span>
  return (
    <input
      type="number"
      step="0.1"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onSave(local)}
      style={{ width: 70 }}
    />
  )
}

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const [syncInfo, setSyncInfo] = useState(null)
  const [editor, setEditor] = useState(false)
  const [params, setParams] = useSearchParams()
  const reviewOnly = params.get('review') === '1'
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')

  function refresh() {
    listIngredients()
      .then(setIngredients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])
  useEffect(() => {
    isScheduleEditor().then(setEditor)
    ingredientSyncInfo().then(setSyncInfo).catch(() => {})
  }, [])

  async function syncNow() {
    setSyncing(true)
    setSyncMsg(null)
    setError(null)
    try {
      const r = await syncIngredients()
      setSyncMsg(`Checked ${r.checked} Unleashed products: ${r.added} new, ${r.updated} updated, ${r.hidden} hidden as obsolete.`)
      setSyncInfo(r)
      refresh()
      window.dispatchEvent(new Event('ingredients-changed'))
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  async function markChecked(ingredient) {
    const updated = await markIngredientChecked(ingredient.id)
    setIngredients((prev) => prev.map((i) => (i.id === ingredient.id ? updated : i)))
    window.dispatchEvent(new Event('ingredients-changed'))
  }

  async function toggleSection(ingredient, section) {
    const has = ingredient.sections.includes(section)
    const nextSections = has
      ? ingredient.sections.filter((s) => s !== section)
      : [...ingredient.sections, section]
    const updated = await updateIngredientSections(ingredient.id, nextSections)
    setIngredients((prev) => prev.map((i) => (i.id === ingredient.id ? updated : i)))
  }

  async function savePotentialPpg(ingredient, value) {
    const parsed = value === '' ? null : Number(value)
    if (parsed === ingredient.potential_ppg) return
    const updated = await updateIngredientPotentialPpg(ingredient.id, parsed)
    setIngredients((prev) => prev.map((i) => (i.id === ingredient.id ? updated : i)))
  }

  async function saveLovibond(ingredient, value) {
    const parsed = value === '' ? null : Number(value)
    if (parsed === ingredient.color_lovibond) return
    const updated = await updateIngredientLovibond(ingredient.id, parsed)
    setIngredients((prev) => prev.map((i) => (i.id === ingredient.id ? updated : i)))
  }

  async function saveAlphaAcid(ingredient, value) {
    const parsed = value === '' ? null : Number(value)
    if (parsed === ingredient.alpha_acid_pct) return
    const updated = await updateIngredientAlphaAcid(ingredient.id, parsed)
    setIngredients((prev) => prev.map((i) => (i.id === ingredient.id ? updated : i)))
  }

  const reviewCount = ingredients.filter((i) => i.needs_review).length
  const unassignedCount = useMemo(
    () => ingredients.filter((i) => i.sections.length === 0).length,
    [ingredients]
  )

  // Default sort: grouped by primary section in recipe-flow order (Grist,
  // Water, Kettle, Fermenter, then Unassigned last), alphabetical by name
  // within each group — an ingredient assigned to more than one section is
  // still fully usable in all of them, this just picks where it sorts.
  const filtered = ingredients
    .filter((i) => {
      if (reviewOnly && !i.needs_review) return false
      if (sectionFilter && !i.sections.includes(sectionFilter)) return false
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      const aIdx = SECTION_ORDER.indexOf(primarySection(a.sections))
      const bIdx = SECTION_ORDER.indexOf(primarySection(b.sections))
      const orderDiff = (aIdx === -1 ? SECTION_ORDER.length : aIdx) - (bIdx === -1 ? SECTION_ORDER.length : bIdx)
      if (orderDiff !== 0) return orderDiff
      return a.name.localeCompare(b.name)
    })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Ingredients</h1>
        {editor && (
          <button onClick={syncNow} disabled={syncing}>
            {syncing ? 'Syncing from Unleashed…' : '↻ Sync from Unleashed now'}
          </button>
        )}
      </div>

      <p style={{ color: '#666', marginTop: '-0.5rem' }}>
        Imported ingredients power the suggestions that pop up while typing an Item/Ingredient
        name on the recipe form — you can still type anything not on this list. An ingredient can
        be checked into more than one section (e.g. Hops into both Kettle and Fermenter
        Additions). "Unleashed Group" is Unleashed's own classification, kept as-is for reference.
        Raw materials (Hops, Malt, Yeast, Salt, Other Raw Material) sync from Unleashed every
        morning, read-only: new products are added and flagged for checking, names and units are
        kept up to date, and section assignments, PPG, colour and alpha you've set are never touched.
        {syncInfo?.at && <> Last sync: {new Date(syncInfo.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}.</>}
      </p>

      {syncMsg && <p style={{ color: '#1a7a1a' }}>{syncMsg}</p>}
      {reviewCount > 0 && (
        <div className="ing-review-bar">
          <strong>{reviewCount} new ingredient{reviewCount === 1 ? '' : 's'} from Unleashed to check.</strong>{' '}
          {reviewOnly
            ? <button className="secondary" onClick={() => setParams({})}>Show all ingredients</button>
            : <button className="secondary" onClick={() => setParams({ review: '1' })}>Show only these</button>}
        </div>
      )}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!loading && unassignedCount > 0 && (
        <p style={{ color: '#a66a00' }}>
          {unassignedCount} ingredient{unassignedCount === 1 ? '' : 's'} not assigned to any
          section yet — they won't show up as suggestions anywhere on the recipe form until you
          check at least one section for them below.
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 240 }}
            />
            <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
              <option value="">All sections</option>
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <table>
            <thead>
              <tr>
                <th style={stickyHeaderCellStyle}>Name</th>
                <th style={stickyHeaderCellStyle}>Unleashed Group</th>
                {SECTION_ORDER.map((s) => (
                  <th key={s} style={stickyHeaderCellStyle}>
                    {SECTION_LABELS[s]}
                  </th>
                ))}
                <th style={stickyHeaderCellStyle}>Potential PPG</th>
                <th style={stickyHeaderCellStyle}>Colour (°L)</th>
                <th style={stickyHeaderCellStyle}>Alpha Acid %</th>
                <th style={stickyHeaderCellStyle}>Unit</th>
                <th style={stickyHeaderCellStyle}>Unleashed Code</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    {i.needs_review && (
                      <span className="ing-new">
                        New{editor && <button className="secondary" onClick={() => markChecked(i)}>Mark checked</button>}
                      </span>
                    )}
                  </td>
                  <td style={{ color: '#666' }}>{i.unleashed_group ?? '—'}</td>
                  {SECTION_ORDER.map((s) => (
                    <td key={s} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={i.sections.includes(s)}
                        onChange={() => toggleSection(i, s)}
                      />
                    </td>
                  ))}
                  <td>
                    <NumericTagCell applies={isMalt(i)} value={i.potential_ppg} onSave={(v) => savePotentialPpg(i, v)} />
                  </td>
                  <td>
                    <NumericTagCell applies={isMalt(i)} value={i.color_lovibond} onSave={(v) => saveLovibond(i, v)} />
                  </td>
                  <td>
                    <NumericTagCell applies={isHops(i)} value={i.alpha_acid_pct} onSave={(v) => saveAlphaAcid(i, v)} />
                  </td>
                  <td>{i.base_unit ?? '—'}</td>
                  <td style={{ color: '#666', fontSize: '0.85rem' }}>{i.unleashed_code}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5 + SECTION_ORDER.length}>
                    {ingredients.length === 0
                      ? 'No ingredients yet: they sync from Unleashed each morning.'
                      : 'No ingredients match your search/filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
