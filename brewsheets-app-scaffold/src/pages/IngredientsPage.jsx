import { useEffect, useMemo, useRef, useState } from 'react'
import {
  listIngredients,
  importIngredients,
  updateIngredientSections,
  updateIngredientPotentialPpg,
  updateIngredientAlphaAcid,
} from '../lib/api'

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

// Unleashed's own "Product Group" is the stable classification of what an
// ingredient IS (kept as-is in unleashed_group, below) — but an ingredient can
// be USED in more than one recipe section, so this maps a group to the *set*
// of sections it should default into. Hops go in Kettle Additions (boil),
// Whirlpool Additions (knockout/late additions), and Fermenter Additions (dry
// hop); Salt (which covers things like Lactic Acid in Ryan's Unleashed data)
// covers both Water Chemistry and kettle-stage acid/salt additions. "Other Raw
// Material" is too mixed a bucket (whirlfloc, yeast nutrient, CIP chemicals,
// purees, ...) to default anywhere — those start unassigned and get sorted by
// hand below.
function mapUnleashedGroupToSections(group) {
  const g = (group || '').trim().toLowerCase()
  if (g === 'hops') return ['kettle', 'whirlpool', 'fermenter']
  if (g === 'malt') return ['grist']
  if (g === 'yeast') return ['fermenter']
  if (g === 'salt') return ['water', 'kettle']
  return []
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, commas and
// newlines inside quotes, and "" as an escaped quote. Unleashed's export has
// all three (e.g. a Base Pack value of "1,000", and a product description
// that wraps across two physical lines inside one quoted field).
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c === '\r') {
      // skip — \n (if present) handles the line break
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// Unleashed exports have shown up mojibake'd when decoded as strict UTF-8
// (a Windows-1252 file misread) — if decoding produces replacement
// characters, redecode as Windows-1252 instead.
async function readFileAsText(file) {
  const buffer = await file.arrayBuffer()
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  if (text.includes('�')) {
    text = new TextDecoder('windows-1252').decode(buffer)
  }
  return text
}

function parseUnleashedCsv(text) {
  const rows = parseCsv(text)
  const headerIdx = rows.findIndex((r) => (r[0] || '').trim().toLowerCase() === 'product code')
  if (headerIdx === -1) {
    throw new Error(
      'Couldn\'t find a "Product Code" column — is this a Product List export from Unleashed?'
    )
  }
  const header = rows[headerIdx].map((h) => h.trim().toLowerCase())
  const codeIdx = header.indexOf('product code')
  const nameIdx = header.indexOf('product description')
  const groupIdx = header.indexOf('product group')
  const unitIdx = header.indexOf('base unit')
  if (codeIdx === -1 || nameIdx === -1) {
    throw new Error('Missing expected columns (Product Code / Product Description) in this CSV.')
  }

  // De-dupe by code within the file itself (last row wins) before sending to the API.
  const byCode = new Map()
  for (const row of rows.slice(headerIdx + 1)) {
    const code = (row[codeIdx] || '').trim()
    if (!code) continue
    // A few Unleashed descriptions wrap across two physical lines inside one
    // quoted CSV field — collapse that (and any other stray whitespace) to a
    // single space so it doesn't show an embedded line break in the app.
    const name = (row[nameIdx] || '').replace(/\s+/g, ' ').trim() || code
    const group = groupIdx === -1 ? '' : (row[groupIdx] || '').trim()
    const baseUnit = unitIdx === -1 ? '' : (row[unitIdx] || '').trim()
    byCode.set(code, {
      unleashed_code: code,
      name,
      unleashed_group: group || null,
      sections: mapUnleashedGroupToSections(group),
      base_unit: baseUnit || null,
    })
  }
  return Array.from(byCode.values())
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
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const fileInputRef = useRef(null)

  function refresh() {
    listIngredients()
      .then(setIngredients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  async function handleFile(e) {
    const file = e.target.files[0]
    e.target.value = '' // allow re-selecting the same file again later
    if (!file) return
    setImporting(true)
    setImportResult(null)
    setError(null)
    try {
      const text = await readFileAsText(file)
      const parsedRows = parseUnleashedCsv(text)
      if (parsedRows.length === 0) {
        throw new Error('No ingredient rows found in this file.')
      }
      const result = await importIngredients(parsedRows)
      setImportResult(
        `Imported ${parsedRows.length} ingredients from the file — ${result.inserted} new, ${result.updated} updated. Section assignments on ingredients you'd already reviewed were left untouched.`
      )
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
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

  async function saveAlphaAcid(ingredient, value) {
    const parsed = value === '' ? null : Number(value)
    if (parsed === ingredient.alpha_acid_pct) return
    const updated = await updateIngredientAlphaAcid(ingredient.id, parsed)
    setIngredients((prev) => prev.map((i) => (i.id === ingredient.id ? updated : i)))
  }

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
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '⬆ Import CSV from Unleashed'}
          </button>
        </div>
      </div>

      <p style={{ color: '#666', marginTop: '-0.5rem' }}>
        Imported ingredients power the suggestions that pop up while typing an Item/Ingredient
        name on the recipe form — you can still type anything not on this list. An ingredient can
        be checked into more than one section (e.g. Hops into both Kettle and Fermenter
        Additions). "Unleashed Group" is Unleashed's own classification, kept as-is for reference.
        Export a "Product List" CSV from Unleashed and import it here; re-importing later updates
        names/units (matched by Unleashed's Product Code) without touching section assignments
        you've already set.
      </p>

      {importResult && <p style={{ color: '#1a7a1a' }}>{importResult}</p>}
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
                <th style={stickyHeaderCellStyle}>Alpha Acid %</th>
                <th style={stickyHeaderCellStyle}>Unit</th>
                <th style={stickyHeaderCellStyle}>Unleashed Code</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
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
                      ? 'No ingredients imported yet — import a CSV from Unleashed to get started.'
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
