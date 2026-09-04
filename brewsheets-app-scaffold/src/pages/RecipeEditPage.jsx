import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getRecipe,
  upsertRecipe,
  replaceGristItems,
  replaceWaterAdditions,
  replaceKettleAdditions,
  replaceWhirlpoolAdditions,
  replaceFermenterAdditions,
  deleteRecipe,
  listIngredients,
} from '../lib/api'

const emptyRecipe = {
  name: '',
  style: '',
  is_core_range: true,
  target_og: '',
  target_fg: '',
  ko_temp: '',
  target_strike_temp: '',
  target_mash_ph: '',
  liquor_grist_ratio: 3.0,
  mash_step_1_temp: '',
  mash_step_2_temp: '',
  mash_step_3_temp: '',
  mash_out_temp: '',
  mash_duration_min: 60,
  lauter_duration_min: 45,
  target_preboil_gravity: '',
  boil_duration_min: 60,
  knockout_duration_min: 20,
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

function LineItemsEditor({ title, subtitle, items, setItems, fields, defaults }) {
  function update(i, key, value) {
    const next = [...items]
    next[i] = { ...next[i], [key]: value }
    setItems(next)
  }
  function add() {
    setItems([...items, { ...Object.fromEntries(fields.map((f) => [f.key, ''])), ...defaults }])
  }
  function remove(i) {
    setItems(items.filter((_, idx) => idx !== i))
  }

  // Stable per-field id for the shared <datalist> a field's inputs point at
  // via list={...} — only fields with datalistOptions get one.
  function datalistId(key) {
    return `dl-${title}-${key}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
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
                      list={f.datalistOptions ? datalistId(f.key) : undefined}
                      autoComplete="off"
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
      {fields
        .filter((f) => f.datalistOptions)
        .map((f) => (
          <datalist key={f.key} id={datalistId(f.key)}>
            {f.datalistOptions.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        ))}
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
  const [whirlpool, setWhirlpool] = useState([])
  const [fermenter, setFermenter] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [ingredients, setIngredients] = useState([])

  // Powers the autocomplete suggestions on each Item/Ingredient field —
  // imported on the Ingredients page (from an Unleashed CSV export) and
  // categorized to match the section it should show up in.
  useEffect(() => {
    listIngredients()
      .then(setIngredients)
      .catch(() => {
        /* suggestions are a convenience, not required — fail quietly */
      })
  }, [])

  // An ingredient can belong to more than one section (e.g. Hops is both
  // kettle and fermenter — see the Ingredients page), so this groups by
  // membership rather than a single category.
  const ingredientNamesByCategory = useMemo(() => {
    const byCategory = { grist: [], water: [], kettle: [], whirlpool: [], fermenter: [] }
    for (const ing of ingredients) {
      for (const section of ing.sections ?? []) {
        if (byCategory[section]) byCategory[section].push(ing.name)
      }
    }
    return byCategory
  }, [ingredients])

  useEffect(() => {
    if (isNew) return
    getRecipe(id)
      .then((r) => {
        setRecipe(r)
        setGrist(r.recipe_grist_items ?? [])
        setWater(r.recipe_water_additions ?? [])
        setKettle(r.recipe_kettle_additions ?? [])
        setWhirlpool(r.recipe_whirlpool_additions ?? [])
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

  // Catches missing required fields before they ever reach the database, so
  // Ryan sees a plain-language message instead of a raw Postgres
  // not-null-constraint error. Only checks fields the database actually
  // requires (not_null columns) — everything else stays optional.
  function validateLineItems() {
    const errors = []
    for (const g of grist) {
      if (g.ingredient_name && g.qty_g_per_l === '') {
        errors.push(`Grist item "${g.ingredient_name}" needs a Qty (g/L) value.`)
      }
    }
    for (const w of water) {
      if (w.additive_name && w.qty_g_per_l === '') {
        errors.push(`Water addition "${w.additive_name}" needs a Qty (g/L) value.`)
      }
    }
    return errors
  }

  async function save() {
    const validationErrors = validateLineItems()
    if (validationErrors.length > 0) {
      setError(validationErrors.join(' '))
      return
    }
    setSaving(true)
    setError(null)
    try {
      // recipe (when editing an existing one) carries the nested arrays that
      // getRecipe()'s embedded select attaches — recipe_grist_items,
      // recipe_water_additions, recipe_kettle_additions,
      // recipe_whirlpool_additions, recipe_fermenter_additions. Those aren't
      // real columns on `recipes`, so they must be stripped before upserting
      // or PostgREST rejects the request ("Could not find the
      // 'recipe_fermenter_additions' column of 'recipes' in the schema
      // cache"). New recipes start from emptyRecipe and never had these
      // keys, which is why this only shows up editing an existing recipe.
      const {
        recipe_grist_items: _rgi,
        recipe_water_additions: _rwa,
        recipe_kettle_additions: _rka,
        recipe_whirlpool_additions: _rwpa,
        recipe_fermenter_additions: _rfa,
        ...recipeFields
      } = recipe
      const payload = cleanBlanks(recipeFields)
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
      await replaceWhirlpoolAdditions(
        saved.id,
        whirlpool
          .filter((wp) => wp.item_name)
          .map(({ id: _i, recipe_id: _r, ...wp }) => cleanBlanks(wp))
      )
      await replaceFermenterAdditions(
        saved.id,
        fermenter
          .filter((f) => f.item_name)
          .map(({ id: _i, recipe_id: _r, ...f }) => cleanBlanks(f))
      )
      navigate('/recipes')
    } catch (e) {
      // Fallback for any required-field gap validateLineItems() doesn't cover
      // — surfaces a plain-language message instead of raw Postgres text.
      if (e.code === '23502') {
        setError(`A required field is missing (${e.message}). Check every row has its required fields filled in.`)
      } else {
        setError(e.message)
      }
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete recipe "${recipe.name}"? This cannot be undone.`)) return
    setError(null)
    try {
      await deleteRecipe(id)
      navigate('/recipes')
    } catch (e) {
      // Postgres foreign-key violation — a batch was brewed from this recipe,
      // so the database correctly refuses to delete it (batches.recipe_id
      // points at it). Previously this error was silently swallowed and the
      // page just sat there with nothing appearing to happen.
      if (e.code === '23503') {
        setError(
          `Can't delete "${recipe.name}" — one or more batches were brewed from this recipe. Delete or reassign those batches first.`
        )
      } else {
        setError(e.message)
      }
    }
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

      <Section title="Mash Schedule" subtitle="These show up as targets on the Brew Day sheet, next to what actually happened.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
          <Field label="Target Mash pH" value={recipe.target_mash_ph} onChange={(v) => updateField('target_mash_ph', v)} />
          <Field label="Liquor:Grist Ratio (L/kg)" value={recipe.liquor_grist_ratio} onChange={(v) => updateField('liquor_grist_ratio', v)} />
          <Field label="Mash Duration (min)" value={recipe.mash_duration_min} onChange={(v) => updateField('mash_duration_min', v)} />
          <Field label="Step 1 (0-20) temp" value={recipe.mash_step_1_temp} onChange={(v) => updateField('mash_step_1_temp', v)} />
          <Field label="Step 2 (20-40) temp" value={recipe.mash_step_2_temp} onChange={(v) => updateField('mash_step_2_temp', v)} />
          <Field label="Step 3 (40-60) temp" value={recipe.mash_step_3_temp} onChange={(v) => updateField('mash_step_3_temp', v)} />
          <Field label="Mash out temp" value={recipe.mash_out_temp} onChange={(v) => updateField('mash_out_temp', v)} />
          <Field label="KO temp" value={recipe.ko_temp} onChange={(v) => updateField('ko_temp', v)} />
        </div>
      </Section>

      <Section title="Lauter, Boil &amp; Knockout Targets" subtitle="Also shown on the Brew Day sheet as targets/auto-timing.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
          <Field label="Lauter Duration (min)" value={recipe.lauter_duration_min} onChange={(v) => updateField('lauter_duration_min', v)} />
          <Field label="Target Pre-Boil Gravity" value={recipe.target_preboil_gravity} onChange={(v) => updateField('target_preboil_gravity', v)} />
          <Field label="Boil Duration (min)" value={recipe.boil_duration_min} onChange={(v) => updateField('boil_duration_min', v)} />
          <Field label="Knockout Duration (min)" value={recipe.knockout_duration_min} onChange={(v) => updateField('knockout_duration_min', v)} />
        </div>
      </Section>

      <LineItemsEditor
        title="Grist / Malt Bill"
        subtitle="Pack Size is the bag weight this ingredient is bought in — leave it blank for anything not bought in fixed bags. It's what the Add Brew wizard uses to let you allocate whole bags per turn instead of a computed weight."
        items={grist}
        setItems={setGrist}
        defaults={{ pack_size_kg: 25 }}
        fields={[
          { key: 'ingredient_name', label: 'Ingredient', width: 200, datalistOptions: ingredientNamesByCategory.grist },
          { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number' },
          { key: 'pack_size_kg', label: 'Pack Size (kg)', type: 'number', width: 90 },
        ]}
      />

      <LineItemsEditor
        title="Water Chemistry"
        items={water}
        setItems={setWater}
        fields={[
          { key: 'additive_name', label: 'Additive', width: 200, datalistOptions: ingredientNamesByCategory.water },
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
        subtitle="Everything added during the boil — hops, whirlfloc, yeast nutrient."
        items={kettle}
        setItems={setKettle}
        fields={[
          { key: 'item_name', label: 'Item', width: 180, datalistOptions: ingredientNamesByCategory.kettle },
          { key: 'boil_time_min', label: 'Time (min)', type: 'number', width: 90 },
           { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number', width: 90 },
        ]}
      />

      <LineItemsEditor
        title="Whirlpool Additions"
        subtitle="Everything added at knockout/whirlpool — late hop additions, whirlpool-timed items."
        items={whirlpool}
        setItems={setWhirlpool}
        fields={[
          { key: 'item_name', label: 'Item', width: 180, datalistOptions: ingredientNamesByCategory.whirlpool },
          { key: 'stand_time_min', label: 'Stand time (min)', type: 'number', width: 90 },
          { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number', width: 90 },
        ]}
      />

      <LineItemsEditor
        title="Fermenter Additions"
        subtitle='Everything added to the fermenter — pitched yeast, dry hops. Add one row per addition (e.g. two dry hop rows for a two-stage dry hop).'
        items={fermenter}
        setItems={setFermenter}
        fields={[
          { key: 'item_name', label: 'Item', width: 180, datalistOptions: ingredientNamesByCategory.fermenter },
          { key: 'qty_g_per_l', label: 'Qty (g/L)', type: 'number', width: 90 },
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
