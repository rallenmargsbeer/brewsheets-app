import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getRecipe,
  upsertRecipe,
  replaceGristItems,
  replaceWaterAdditions,
  replaceHopAdditions,
  deleteRecipe,
} from '../lib/api'

const emptyRecipe = {
  name: '',
  style: '',
  is_core_range: true,
  target_og: '',
  target_fg: '',
  ko_temp: '',
  mash_step_1_temp: '',
  mash_step_2_temp: '',
  mash_step_3_temp: '',
  mash_out_temp: '',
  yeast_type: '',
  yeast_nutrient_qty_kg: '',
  whirlfloc_qty_kg: '',
  biofine_qty_l: '',
  filter_micron: '',
  notes: '',
}

function LineItemsEditor({ title, items, setItems, fields }) {
  function update(i, key, value) {
    const next = [...items]
    next[i] = { ...next[i], [key]: value }
    setItems(next)
  }
  function add() {
    setItems([...items, Object.fromEntries(fields.map((f) => [f.key, '']))])
  }
  function remove(i) {
    setItems(items.filter((_, idx) => idx !== i))
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            {fields.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              {fields.map((f) => (
                <td key={f.key}>
                  {f.type === 'select' ? (
                    <select
                      value={item[f.key] ?? ''}
                      onChange={(e) => update(i, f.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type ?? 'text'}
                      value={item[f.key] ?? ''}
                      onChange={(e) => update(i, f.key, e.target.value)}
                      style={{ width: f.width ?? 100 }}
                    />
                  )}
                </td>
              ))}
              <td>
                <button className="secondary" onClick={() => remove(i)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="secondary" onClick={add} style={{ marginTop: '0.5rem' }}>
        + Add row
      </button>
    </div>
  )
}

export default function RecipeEditPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()

  const [recipe, setRecipe] = useState(emptyRecipe)
  const [grist, setGrist] = useState([])
  const [water, setWater] = useState([])
  const [hops, setHops] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isNew) return
    getRecipe(id)
      .then((r) => {
        setRecipe(r)
        setGrist(r.recipe_grist_items ?? [])
        setWater(r.recipe_water_additions ?? [])
        setHops(r.recipe_hop_additions ?? [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isNew])

  function updateField(key, value) {
    setRecipe({ ...recipe, [key]: value })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const payload = { ...recipe }
      if (isNew) delete payload.id
      // blank strings -> null for numeric fields
      for (const k of Object.keys(payload)) {
        if (payload[k] === '') payload[k] = null
      }
      const saved = await upsertRecipe(payload)
      await replaceGristItems(
        saved.id,
        grist.filter((g) => g.ingredient_name).map(({ id: _i, recipe_id: _r, ...g }) => g)
      )
      await replaceWaterAdditions(
        saved.id,
        water.filter((w) => w.additive_name).map(({ id: _i, recipe_id: _r, ...w }) => w)
      )
      await replaceHopAdditions(
        saved.id,
        hops.filter((h) => h.hop_name).map(({ id: _i, recipe_id: _r, ...h }) => h)
      )
      navigate('/recipes')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete recipe "${recipe.name}"? This cannot be undone.`)) return
    await deleteRecipe(id)
    navigate('/recipes')
  }

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <h1>{isNew ? 'New Recipe' : `Edit: ${recipe.name}`}</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <label>
          Name
          <br />
          <input value={recipe.name ?? ''} onChange={(e) => updateField('name', e.target.value)} />
        </label>
        <label>
          Style
          <br />
          <input value={recipe.style ?? ''} onChange={(e) => updateField('style', e.target.value)} />
        </label>
        <label>
          Core range?
          <br />
          <select
            value={recipe.is_core_range ? 'yes' : 'no'}
            onChange={(e) => updateField('is_core_range', e.target.value === 'yes')}
          >
            <option value="yes">Yes</option>
            <option value="no">No (seasonal/one-off)</option>
          </select>
        </label>
        <label>
          Target OG
          <br />
          <input value={recipe.target_og ?? ''} onChange={(e) => updateField('target_og', e.target.value)} />
        </label>
        <label>
          Target FG
          <br />
          <input value={recipe.target_fg ?? ''} onChange={(e) => updateField('target_fg', e.target.value)} />
        </label>
        <label>
          KO Temp
          <br />
          <input value={recipe.ko_temp ?? ''} onChange={(e) => updateField('ko_temp', e.target.value)} />
        </label>
        <label>
          Mash step 1 (0-20) temp
          <br />
          <input value={recipe.mash_step_1_temp ?? ''} onChange={(e) => updateField('mash_step_1_temp', e.target.value)} />
        </label>
        <label>
          Mash step 2 (20-40) temp
          <br />
          <input value={recipe.mash_step_2_temp ?? ''} onChange={(e) => updateField('mash_step_2_temp', e.target.value)} />
        </label>
        <label>
          Mash step 3 (40-60) temp
          <br />
          <input value={recipe.mash_step_3_temp ?? ''} onChange={(e) => updateField('mash_step_3_temp', e.target.value)} />
        </label>
        <label>
          Mash out temp
          <br />
          <input value={recipe.mash_out_temp ?? ''} onChange={(e) => updateField('mash_out_temp', e.target.value)} />
        </label>
        <label>
          Yeast
          <br />
          <input value={recipe.yeast_type ?? ''} onChange={(e) => updateField('yeast_type', e.target.value)} />
        </label>
        <label>
          Yeast nutrient (kg)
          <br />
          <input value={recipe.yeast_nutrient_qty_kg ?? ''} onChange={(e) => updateField('yeast_nutrient_qty_kg', e.target.value)} />
        </label>
        <label>
          Whirlfloc (kg)
          <br />
          <input value={recipe.whirlfloc_qty_kg ?? ''} onChange={(e) => updateField('whirlfloc_qty_kg', e.target.value)} />
        </label>
        <label>
          Biofine (L)
          <br />
          <input value={recipe.biofine_qty_l ?? ''} onChange={(e) => updateField('biofine_qty_l', e.target.value)} />
        </label>
        <label>
          Filter
          <br />
          <input value={recipe.filter_micron ?? ''} onChange={(e) => updateField('filter_micron', e.target.value)} />
        </label>
      </div>

      <label style={{ display: 'block', marginBottom: '1.5rem' }}>
        Notes
        <br />
        <textarea
          value={recipe.notes ?? ''}
          onChange={(e) => updateField('notes', e.target.value)}
          rows={3}
          style={{ width: '100%' }}
        />
      </label>

      <LineItemsEditor
        title="Grist / Malt Bill"
        items={grist}
        setItems={setGrist}
        fields={[
          { key: 'ingredient_name', label: 'Ingredient', width: 200 },
          { key: 'qty_kg', label: 'Qty (kg)', type: 'number' },
        ]}
      />

      <LineItemsEditor
        title="Water Chemistry"
        items={water}
        setItems={setWater}
        fields={[
          { key: 'additive_name', label: 'Additive', width: 200 },
          { key: 'qty_kg', label: 'Qty (kg)', type: 'number' },
          {
            key: 'addition_stage',
            label: 'Stage',
            type: 'select',
            options: ['mash', 'kettle'],
          },
        ]}
      />

      <LineItemsEditor
        title="Hop Schedule"
        items={hops}
        setItems={setHops}
        fields={[
          { key: 'hop_name', label: 'Hop', width: 180 },
          {
            key: 'addition_type',
            label: 'Type',
            type: 'select',
            options: ['boil', 'whirlpool', 'dry_hop'],
          },
          { key: 'boil_time_min', label: 'Boil time (min)', type: 'number', width: 90 },
          { key: 'qty_kg', label: 'Qty (kg)', type: 'number', width: 90 },
          { key: 'dry_hop_batches', label: 'Dry hop batches', type: 'number', width: 90 },
          {
            key: 'dry_hop_qty_per_batch_kg',
            label: 'Dry hop qty/batch (kg)',
            type: 'number',
            width: 90,
          },
        ]}
      />

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
        <button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Recipe'}
        </button>
        {!isNew && (
          <button className="secondary" onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
