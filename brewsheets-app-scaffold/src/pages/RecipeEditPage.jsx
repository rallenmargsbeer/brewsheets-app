import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getRecipe,
  upsertRecipe,
  replaceGristItems,
  replaceWaterAdditions,
  replaceKettleAdditions,
  replaceFermenterAdditions,
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
  biofine_ml_per_l: '',
  filter_micron: '',
  notes: '',
}

function Section({ title, subtitle, children }) {
  return (
    <div
      style={{
        marginBottom: '1.5rem',
        padding: '1rem',
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 6,
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {subtitle && (
        <p style={{ marginTop: '-0.5rem', marginBottom: '1rem', color: '#666', fontSize: '0.85rem' }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', width }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: '0.85rem', color: '#444' }}>{label}</div>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={width ? { width } : undefined}
      />
    </label>
  )
}

function LineItemsEditor({ title, subtitle, items, setItems, fields }) {
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
    <Section title={title} subtitle={subtitle}>
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
    </Section>
  )
}

export default function RecipeEditPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()

  const [recipe, setRecipe] = useState(emptyRecipe)
  const [grist, setGrist] = useState([])
  const [water, setWater] = useState([])
  const [kettle, setKettle] = useState([])
  const [fermenter, setFermenter] = useState([])
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
        setKettle(r.recipe_kettle_additions ?? [])
        setFermenter(r.recipe_fermenter_additions ?? [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isNew])

  function updateField(key, value) {
    setRecipe({ ...recipe, [key]: value })
  }

  // blank string inputs ("") aren't valid values for numeric/integer database
  // columns — convert them to null before anything gets sent to Supabase.
  function cleanBlanks(obj) {
    const out = { ...obj }
    for (const k of Object.keys(out)) {
      if (out[k] === '') out[k] = null
    }
    return out
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const payload = cleanBlanks(recipe)
      if (isNew) delete payload.id
      const saved = await upsertRecipe(payload)
      await replaceGristItems(
        saved.id,
        grist
          .filter((g) => g.ingredient_name)
          .map(({ id: _i, recipe_id: _r, ...g }) => cleanBlanks(g))
      )
      await replaceWaterAdditions(
        saved.id,
        water
          .filter((w) => w.additive_name)
          .map(({ id: _i, recipe_id: _r, ...w }) => cleanBlanks(w))
      )
      await replaceKettleAdditions(
        saved.id,
        kettle
          .filter((k) => k.item_name)
          .map(({ id: _i, recipe_id: _r, ...k }) => cleanBlanks(k))
      )
      await replaceFermenterAdditions(
        saved.id,
        fermenter
          .filter((f) => f.item_name)
          .map(({ id: _i, recipe_id: _r, ...f }) => cleanBlanks(f))
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
      <p style={{ color: '#666', marginTop: '-0.5rem' }}>
        All quantities below (grist, water chemistry, kettle &amp; fermenter additions, biofine) are
        <strong> per litre of finished beer</strong> — enter this recipe as if it were for 1L, and
        scale it up to any batch size when you plan an actual batch.
      </p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <Section title="Basic Info">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
          <Field label="Name" value={recipe.name} onChange={(v) => updateField('name', v)} />
          <Field label="Style" value={recipe.style} onChange={(v) => updateField('style', v)} />
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: '0.85rem', color: '#444' }}>Core range?</div>
            <select
              value={recipe.is_core_range ? 'yes' : 'no'}
              onChange={(e) => updateField('is_core_range', e.target.value === 'yes')}
            >
              <option value="yes">Yes</option>
              <option value="no">No (seasonal/one-off)</option>
            </select>
          </label>
          <Field label="Target OG" value={recipe.target_og} onChange={(v) => updateField('target_og', v)} />
          <Field label="Target FG" value={recipe.target_fg} onChange={(v) => updateField('target_fg', v)} />
        </div>
      </Section>

      <Section title="Mash Schedule">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
          <Field label="Step 1 (0-20) temp" value={recipe.mash_step_1_temp} onChange={(v) => updateField('mash_step_1_temp', v)} />
          <Field label="Step 2 (20-40) temp" value={recipe.mash_step_2_temp} onChange={(v) => updateField('mash_step_2_temp', v)} />
          <Field label="Step 3 (40-60) temp" value={recipe.mash_step_3_temp} onChange={(v) => updateField('mash_step_3_temp', v)} />
          <Field label="Mash out temp" value={recipe.mash_out_temp} onChange={(v) => updateField('mash_out_temp', v)} />
          <Field label="KO temp" value={recipe.ko_temp} onChange={(v) => updateField('ko_temp', v)} />
        </div>
      </Section>

      <LineItemsEditor
        title="Grist / Malt Bill"
        items={grist}
        setItems={setGrist}
        fields={[
          { key: 'ingredient_name', label: 'Ingredient', width: 200 },
          { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number' },
        ]}
      />

      <LineItemsEditor
        title="Water Chemistry"
        items={water}
        setItems={setWater}
        fields={[
          { key: 'additive_name', label: 'Additive', width: 200 },
          { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number' },
          {
            key: 'addition_stage',
            label: 'Stage',
            type: 'select',
            options: ['mash', 'kettle'],
          },
        ]}
      />

      <LineItemsEditor
        title="Kettle Additions"
        subtitle="Everything added during the boil/whirlpool — hops, whirlfloc, yeast nutrient."
        items={kettle}
        setItems={setKettle}
        fields={[
          { key: 'item_name', label: 'Item', width: 180 },
          {
            key: 'addition_type',
            label: 'Type',
            type: 'select',
            options: ['boil', 'whirlpool', 'whirlfloc', 'yeast_nutrient'],
          },
          { key: 'boil_time_min', label: 'Time (min)', type: 'number', width: 90 },
          { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number', width: 90 },
        ]}
      />

      <LineItemsEditor
        title="Fermenter Additions"
        subtitle="Everything added to the fermenter — pitched yeast, dry hops."
        items={fermenter}
        setItems={setFermenter}
        fields={[
          { key: 'item_name', label: 'Item', width: 180 },
          {
            key: 'addition_type',
            label: 'Type',
            type: 'select',
            options: ['yeast', 'dry_hop', 'other'],
          },
          { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number', width: 90 },
          { key: 'dry_hop_batches', label: 'Dry hop batches', type: 'number', width: 90 },
          {
            key: 'dry_hop_qty_per_batch_g_per_l',
            label: 'Dry hop qty/batch (g/L)',
            type: 'number',
            width: 90,
          },
          { key: 'timing_notes', label: 'Timing (e.g. "day 3")', width: 140 },
        ]}
      />

      <Section title="Fining &amp; Filtration" subtitle="Brite tank stage — after fermentation, before packaging.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          <Field label="Biofine (mL/L)" value={recipe.biofine_ml_per_l} onChange={(v) => updateField('biofine_ml_per_l', v)} />
          <Field label="Filter" value={recipe.filter_micron} onChange={(v) => updateField('filter_micron', v)} />
        </div>
      </Section>

      <Section title="Notes">
        <textarea
          value={recipe.notes ?? ''}
          onChange={(e) => updateField('notes', e.target.value)}
          rows={3}
          style={{ width: '100%' }}
        />
      </Section>

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
