import { useEffect, useMemo, useRef, useState } from 'react'
import { listIngredients, importIngredients, updateIngredientCategory } from '../lib/api'

const CATEGORY_LABELS = {
  grist: 'Grist / Malt Bill',
  water: 'Water Chemistry',
  kettle: 'Kettle Additions',
  fermenter: 'Fermenter Additions',
  uncategorized: 'Uncategorized',
}
const CATEGORY_OPTIONS = ['grist', 'water', 'kettle', 'fermenter', 'uncategorized']

// Unleashed's own "Product Group" only maps cleanly onto three of our recipe
// sections — everything else (mostly "Other Raw Material", a mixed bucket of
// whirlfloc, yeast nutrient, CIP chemicals, fruit purees, etc.) needs a human
// to sort it, so it lands in "uncategorized" and stays out of every recipe
// section's suggestions until assigned here.
function mapProductGroupToCategory(group) {
  const g = (group || '').trim().toLowerCase()
  if (g === 'hops') return 'kettle'
  if (g === 'malt') return 'grist'
  if (g === 'yeast') return 'fermenter'
  if (g === 'salt') return 'water'
  return 'uncategorized'
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
    const group = groupIdx === -1 ? '' : row[groupIdx]
    const baseUnit = unitIdx === -1 ? '' : (row[unitIdx] || '').trim()
    byCode.set(code, {
      unleashed_code: code,
      name,
      category: mapProductGroupToCategory(group),
      base_unit: baseUnit || null,
    })
  }
  return Array.from(byCode.values())
}

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
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
        `Imported ${parsedRows.length} ingredients from the file — ${result.inserted} new, ${result.updated} updated.`
      )
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  async function changeCategory(ingredient, category) {
    const updated = await updateIngredientCategory(ingredient.id, category)
    setIngredients((prev) => prev.map((i) => (i.id === ingredient.id ? updated : i)))
  }

  const uncategorizedCount = useMemo(
    () => ingredients.filter((i) => i.category === 'uncategorized').length,
    [ingredients]
  )

  // Default sort: grouped by category in recipe-flow order (Grist, Water,
  // Kettle, Fermenter, then Uncategorized last), alphabetical by name within
  // each group — makes a ~300-row list actually navigable.
  const filtered = ingredients
    .filter((i) => {
      if (categoryFilter && i.category !== categoryFilter) return false
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      const categoryDiff = CATEGORY_OPTIONS.indexOf(a.category) - CATEGORY_OPTIONS.indexOf(b.category)
      if (categoryDiff !== 0) return categoryDiff
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
        name on the recipe form — you can still type anything not on this list. Export a "Product
        List" CSV from Unleashed and import it here; re-importing later updates existing
        ingredients (matched by Unleashed's Product Code) instead of duplicating them.
      </p>

      {importResult && <p style={{ color: '#1a7a1a' }}>{importResult}</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!loading && uncategorizedCount > 0 && (
        <p style={{ color: '#a66a00' }}>
          {uncategorizedCount} ingredient{uncategorizedCount === 1 ? '' : 's'} still{' '}
          <strong>Uncategorized</strong> — they won't show up as suggestions anywhere on the
          recipe form until you assign them a category below.
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
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Unleashed Code</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>
                    <select value={i.category} onChange={(e) => changeCategory(i, e.target.value)}>
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{i.base_unit ?? '—'}</td>
                  <td style={{ color: '#666', fontSize: '0.85rem' }}>{i.unleashed_code}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4}>
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
