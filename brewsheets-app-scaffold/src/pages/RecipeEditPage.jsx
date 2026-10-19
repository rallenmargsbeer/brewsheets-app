import { tinsethIbu, moreySrm, byName, estimateOg, estimateAbv } from '../lib/beerCalcs'
import { loadBrewhouseEff, effFor } from '../lib/brewhouseEff'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getRecipe,
  upsertRecipe,
  replaceGristItems,
  replaceWaterAdditions,
  replaceKettleAdditions,
  replaceWhirlpoolAdditions,
  replaceFermenterAdditions,
  replaceBlendItems,
  deleteRecipe,
  listIngredients,
} from '../lib/api'
import IngredientPicker from '../components/IngredientPicker.jsx'
import { listCellarTemplates } from '../lib/schedule'

const emptyRecipe = {
  name: '',
  style: '',
  is_core_range: true,
  target_og: '',
  target_fg: '',
  target_abv: '',
  target_ibu: '',
  target_srm: '',
  ko_temp: '',
  target_ko_ph_min: '',
  target_ko_ph_max: '',
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

function LineItemsEditor({ title, subtitle, items, setItems, fields, defaults, ingredients }) {
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
                  ) : f.pickerSection ? (
                    <IngredientPicker
                      value={item[f.key] ?? ''}
                      section={f.pickerSection}
                      ingredients={ingredients}
                      onCommit={(name) => update(i, f.key, name)}
                      width={f.width ?? 180}
                    />
                  ) : (
                    <input
                      type={f.type ?? 'text'}
                      value={item[f.key] ?? ''}
                      onChange={(e) => update(i, f.key, e.target.value)}
                      style={{ width: f.width ?? 100 }}
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
    </Section>
  )
}

// Amounts are stored per litre (g/L). New recipes are written as amounts for a 25 HL brew
// (kg, or g for water salts); existing recipes open in g/L. A switch flips between the two.
const BATCH_HL = 25
const SCALE = { grist: 2.5, water: 2500, kettle: 2.5, whirlpool: 2.5, fermenter: 2.5 } // g/L -> amount per 25 HL
const factor = (sec, mode) => (mode === 'batch' ? SCALE[sec] : 1)
const toBatch = (items, sec, mode = 'batch') => items.map((i) => ({ ...i, qty_25: i.qty_g_per_l == null || i.qty_g_per_l === '' ? '' : +(Number(i.qty_g_per_l) * factor(sec, mode)).toFixed(6) }))
const toPerL = (items, sec, mode = 'batch') => items.map(({ qty_25, ...i }) => ({ ...i, qty_g_per_l: qty_25 === '' || qty_25 == null ? '' : Number(qty_25) / factor(sec, mode) }))
const unitLabel = (sec, mode) => (mode === 'batch' ? `${sec === 'water' ? 'g' : 'kg'} per ${BATCH_HL} HL` : 'Qty (g/L)')

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
  const [blend, setBlend] = useState([])
  // How amounts are typed: 'batch' (per 25 HL, new recipes) or 'gl' (g/L, existing recipes).
  const [mode, setMode] = useState(isNew ? 'batch' : 'gl')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [ingredients, setIngredients] = useState([])
  const [cellarTemplates, setCellarTemplates] = useState([])

  // Powers the autocomplete suggestions on each Item/Ingredient field —
  // imported on the Ingredients page (from an Unleashed CSV export) and
  // categorized to match the section it should show up in.
  useEffect(() => {
    listCellarTemplates().then(setCellarTemplates).catch(() => {})
    listIngredients()
      .then(setIngredients)
      .catch(() => {
        /* suggestions are a convenience, not required — fail quietly */
      })
  }, [])

  useEffect(() => {
    if (isNew) return
    getRecipe(id)
      .then((r) => {
        setRecipe(r)
        setGrist(toBatch([...(r.recipe_grist_items ?? [])].sort((a, b) => Number(b.qty_g_per_l ?? 0) - Number(a.qty_g_per_l ?? 0)), 'grist', 'gl')) // base malt first
        setWater(toBatch(r.recipe_water_additions ?? [], 'water', 'gl'))
        setKettle(toBatch([...(r.recipe_kettle_additions ?? [])].sort((a, b) => Number(b.boil_time_min ?? -1) - Number(a.boil_time_min ?? -1)), 'kettle', 'gl')) // boil order
        setWhirlpool(toBatch(r.recipe_whirlpool_additions ?? [], 'whirlpool', 'gl'))
        setFermenter(toBatch(r.recipe_fermenter_additions ?? [], 'fermenter', 'gl'))
        setBlend([...(r.recipe_blend_items ?? [])].sort((a, b) => a.sort_order - b.sort_order))
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
      if (g.ingredient_name && g.qty_25 === '') {
        errors.push(`Grist item "${g.ingredient_name}" needs a quantity.`)
      }
    }
    for (const w of water) {
      if (w.additive_name && w.qty_25 === '') {
        errors.push(`Water addition "${w.additive_name}" needs a quantity.`)
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
        recipe_blend_items: _rbi,
        ...recipeFields
      } = recipe
      const payload = cleanBlanks(recipeFields)
      if (isNew) delete payload.id
      const saved = await upsertRecipe(payload)
      await replaceGristItems(
        saved.id,
        toPerL(grist, 'grist', mode)
          .filter((g) => g.ingredient_name)
          .map(({ id: _i, recipe_id: _r, ...g }) => cleanBlanks(g))
      )
      await replaceWaterAdditions(
        saved.id,
        toPerL(water, 'water', mode)
          .filter((w) => w.additive_name)
          .map(({ id: _i, recipe_id: _r, ...w }) => cleanBlanks(w))
      )
      await replaceKettleAdditions(
        saved.id,
        toPerL(kettle, 'kettle', mode)
          .filter((k) => k.item_name)
          .map(({ id: _i, recipe_id: _r, ...k }) => cleanBlanks(k))
      )
      await replaceWhirlpoolAdditions(
        saved.id,
        toPerL(whirlpool, 'whirlpool', mode)
          .filter((wp) => wp.item_name)
          .map(({ id: _i, recipe_id: _r, ...wp }) => cleanBlanks(wp))
      )
      await replaceBlendItems(
        saved.id,
        blend
          .filter((b) => b.ingredient_name && b.qty_per_l !== '' && b.qty_per_l != null)
          .map(({ id: _i, recipe_id: _r, sort_order: _s, ...b }) => cleanBlanks(b))
      )
      await replaceFermenterAdditions(
        saved.id,
        toPerL(fermenter, 'fermenter', mode)
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
            <div style={{ fontSize: '0.85rem', color: '#444' }}>Cellar template</div>
            <select value={recipe.cellar_template_id ?? ''} onChange={(e) => updateField('cellar_template_id', e.target.value || null)}>
              <option value="">None</option>
              {cellarTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
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
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: '0.85rem', color: '#444' }}>Excise type</div>
            <select value={recipe.is_rtd ? 'rtd' : 'beer'} onChange={(e) => updateField('is_rtd', e.target.value === 'rtd')}>
              <option value="beer">Beer</option>
              <option value="rtd">RTD</option>
            </select>
          </label>
          <Field label="Target OG" value={recipe.target_og} onChange={(v) => updateField('target_og', v)} />
          <Field label="Target FG" value={recipe.target_fg} onChange={(v) => updateField('target_fg', v)} />
          <Field label="Target ABV (%)" value={recipe.target_abv} onChange={(v) => updateField('target_abv', v)} />
          <Field label="Target IBU" value={recipe.target_ibu} onChange={(v) => updateField('target_ibu', v)} />
          <Field label="Target SRM" value={recipe.target_srm} onChange={(v) => updateField('target_srm', v)} />
        </div>
        <RecipeEstimates recipe={recipe} grist={toPerL(grist, 'grist', mode)} kettle={toPerL(kettle, 'kettle', mode)} whirlpool={toPerL(whirlpool, 'whirlpool', mode)} ingredients={ingredients} />
      </Section>

      {recipe.is_rtd ? (
        <LineItemsEditor
          title="Blend ingredients"
          subtitle="RTD: everything blended into the brite tank, per litre of finished blend. Give anything alcoholic its alcohol % (ethanol 96) so the batch ABV can be calculated."
          items={blend}
          setItems={setBlend}
          ingredients={ingredients}
          defaults={{ unit: 'L' }}
          fields={[
            { key: 'ingredient_name', label: 'Ingredient', width: 260, pickerSection: 'fermenter' },
            { key: 'qty_per_l', label: 'Qty per L of blend', type: 'number', width: 110 },
            { key: 'unit', label: 'Unit', type: 'select', options: ['L', 'mL', 'kg', 'g'] },
            { key: 'abv_pct', label: 'Alcohol %', type: 'number', width: 80 },
          ]}
        />
      ) : (
      <>
      <Section title="Mash Schedule" subtitle="These show up as targets on the Brew Day sheet, next to what actually happened.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
          <Field label="Target Strike Temp" value={recipe.target_strike_temp} onChange={(v) => updateField('target_strike_temp', v)} />
          <Field label="Target Mash pH" value={recipe.target_mash_ph} onChange={(v) => updateField('target_mash_ph', v)} />
          <Field label="Liquor:Grist Ratio (L/kg)" value={recipe.liquor_grist_ratio} onChange={(v) => updateField('liquor_grist_ratio', v)} />
          <Field label="Mash Duration (min)" value={recipe.mash_duration_min} onChange={(v) => updateField('mash_duration_min', v)} />
          <Field label="Step 1 (0-20) temp" value={recipe.mash_step_1_temp} onChange={(v) => updateField('mash_step_1_temp', v)} />
          <Field label="Step 2 (20-40) temp" value={recipe.mash_step_2_temp} onChange={(v) => updateField('mash_step_2_temp', v)} />
          <Field label="Step 3 (40-60) temp" value={recipe.mash_step_3_temp} onChange={(v) => updateField('mash_step_3_temp', v)} />
          <Field label="Mash out temp" value={recipe.mash_out_temp} onChange={(v) => updateField('mash_out_temp', v)} />
          <Field label="KO temp" value={recipe.ko_temp} onChange={(v) => updateField('ko_temp', v)} />
          <Field label="Target KO pH (min)" value={recipe.target_ko_ph_min} onChange={(v) => updateField('target_ko_ph_min', v)} />
          <Field label="Target KO pH (max)" value={recipe.target_ko_ph_max} onChange={(v) => updateField('target_ko_ph_max', v)} />
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

      <div className="recipe-mode">
        <span>Enter amounts as</span>
        {[['batch', `per ${BATCH_HL} HL brew`], ['gl', 'g/L']].map(([m, label]) => (
          <button key={m} type="button" className={mode === m ? '' : 'secondary'} onClick={() => {
            if (m === mode) return
            const flip = (items, sec) => toBatch(toPerL(items, sec, mode), sec, m)
            setGrist(flip(grist, 'grist')); setWater(flip(water, 'water')); setKettle(flip(kettle, 'kettle')); setWhirlpool(flip(whirlpool, 'whirlpool')); setFermenter(flip(fermenter, 'fermenter'))
            setMode(m)
          }}>{label}</button>
        ))}
        <span className="stock-muted">{mode === 'batch' ? 'Malt, hops and fermenter additions in kg, water salts in g, for one 25 HL brew. Saved per litre, so any brew size scales.' : 'Grams per litre of wort.'}</span>
      </div>

      <LineItemsEditor
        title="Grist / Malt Bill"
        subtitle="Pack Size is the bag weight this ingredient is bought in — leave it blank for anything not bought in fixed bags. It's what the Add Brew wizard uses to let you allocate whole bags per turn instead of a computed weight."
        items={grist}
        setItems={setGrist}
        ingredients={ingredients}
        defaults={{ pack_size_kg: 25 }}
        fields={[
          { key: 'ingredient_name', label: 'Ingredient', width: 200, pickerSection: 'grist' },
          { key: 'qty_25', label: unitLabel('grist', mode), type: 'number' },
          { key: 'pack_size_kg', label: 'Pack Size (kg)', type: 'number', width: 90 },
        ]}
      />

      <LineItemsEditor
        title="Water Chemistry"
        items={water}
        setItems={setWater}
        ingredients={ingredients}
        fields={[
          { key: 'additive_name', label: 'Additive', width: 200, pickerSection: 'water' },
          { key: 'qty_25', label: unitLabel('water', mode), type: 'number' },
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
        ingredients={ingredients}
        fields={[
          { key: 'item_name', label: 'Item', width: 180, pickerSection: 'kettle' },
          { key: 'boil_time_min', label: 'Time (min)', type: 'number', width: 90 },
          { key: 'qty_25', label: unitLabel('kettle', mode), type: 'number', width: 90 },
        ]}
      />

      <LineItemsEditor
        title="Whirlpool Additions"
        subtitle="Everything added at knockout/whirlpool — late hop additions, whirlpool-timed items."
        items={whirlpool}
        setItems={setWhirlpool}
        ingredients={ingredients}
        fields={[
          { key: 'item_name', label: 'Item', width: 180, pickerSection: 'whirlpool' },
          { key: 'stand_time_min', label: 'Stand time (min)', type: 'number', width: 90 },
          { key: 'qty_25', label: unitLabel('whirlpool', mode), type: 'number', width: 90 },
        ]}
      />

      <LineItemsEditor
        title="Fermenter Additions"
        subtitle='Everything added to the fermenter — pitched yeast, dry hops. Add one row per addition (e.g. two dry hop rows for a two-stage dry hop).'
        items={fermenter}
        setItems={setFermenter}
        ingredients={ingredients}
        fields={[
          { key: 'item_name', label: 'Item', width: 180, pickerSection: 'fermenter' },
          { key: 'qty_25', label: unitLabel('fermenter', mode), type: 'number', width: 90 },
          { key: 'timing_notes', label: 'Timing (e.g. "day 3")', width: 140 },
        ]}
      />

      <Section title="Fining &amp; Filtration" subtitle="Brite tank stage — after fermentation, before packaging.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          <Field label="Biofine (mL/L)" value={recipe.biofine_ml_per_l} onChange={(v) => updateField('biofine_ml_per_l', v)} />
          <Field label="Filter" value={recipe.filter_micron} onChange={(v) => updateField('filter_micron', v)} />
        </div>
      </Section>

      </>
      )}

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

// Estimated IBU and SRM from the recipe's per-litre amounts (so independent of batch size),
// using alpha acid and colour from the Ingredients page and the target OG for hop utilisation.
function RecipeEstimates({ recipe, grist, kettle, whirlpool, ingredients }) {
  const alpha = byName(ingredients, 'alpha_acid_pct')
  const colour = byName(ingredients, 'color_lovibond')
  const hops = [
    ...kettle.map((k) => ({ name: k.item_name, grams: Number(k.qty_g_per_l), minutes: k.boil_time_min })),
    ...whirlpool.map((w) => ({ name: w.item_name, grams: Number(w.qty_g_per_l), minutes: w.stand_time_min })),
  ].map((h) => ({ ...h, alphaPct: alpha.get(h.name) }))
  const malts = grist.map((g) => ({ name: g.ingredient_name, grams: Number(g.qty_g_per_l), lovibond: colour.get(g.ingredient_name) }))
  const ibu = tinsethIbu(hops, recipe.target_og || 12, 1)
  const srm = moreySrm(malts, 1)
  const missingAlpha = hops.filter((h) => h.grams > 0 && h.minutes != null && h.alphaPct == null && ingredients.some((i) => i.name === h.name && i.unleashed_group?.toLowerCase().includes('hop'))).map((h) => h.name)
  const missingColour = malts.filter((m) => m.grams > 0 && m.lovibond == null).map((m) => m.name)
  // Brewhouse efficiency for the OG estimate, from past turns' KO gravity and volume (editable here).
  const [hist, setHist] = useState(null)
  const [eff, setEff] = useState('')
  useEffect(() => {
    loadBrewhouseEff().then((turns) => {
      const h = effFor(turns, recipe.id)
      setHist(h)
      setEff(h ? h.eff.toFixed(0) : '80')
    }).catch(() => setEff('80'))
  }, [recipe.id])
  const ppg = byName(ingredients, 'potential_ppg')
  const og = estimateOg(grist.map((g) => ({ grams: Number(g.qty_g_per_l), ppg: ppg.get(g.ingredient_name) })), Number(eff) || 0)
  const missingPpg = grist.filter((g) => Number(g.qty_g_per_l) > 0 && !ppg.has(g.ingredient_name)).map((g) => g.ingredient_name)
  const abv = estimateAbv(recipe.target_og, recipe.target_fg)
  const vs = (est, target) => (est != null && target !== '' && target != null ? ` (target ${target})` : '')
  return (
    <div className="rec-est">
      <div><span>Estimated OG</span><strong>{og != null ? `${og.toFixed(1)} °P` : '—'}</strong>{vs(og, recipe.target_og)}{' '}
        at <input type="number" value={eff} onChange={(e) => setEff(e.target.value)} aria-label="Brewhouse efficiency %" style={{ width: 56 }} />% efficiency
        {hist && <small> ({hist.own ? 'this beer' : 'all beers'}: {hist.eff.toFixed(1)}% average of {hist.n} turns)</small>}</div>
      <div><span>Estimated ABV</span><strong>{abv != null ? `${abv.toFixed(1)}%` : '—'}</strong>{abv != null ? ' from target OG and FG' : ' (needs target OG and FG)'}{vs(abv, recipe.target_abv)}</div>
      <div><span>Estimated IBU</span><strong>{ibu != null ? ibu.toFixed(0) : '—'}</strong>{vs(ibu, recipe.target_ibu)}</div>
      <div><span>Estimated SRM</span><strong>{srm != null ? srm.toFixed(1) : '—'}</strong>{vs(srm, recipe.target_srm)}</div>
      {(missingAlpha.length > 0 || missingColour.length > 0 || missingPpg.length > 0) && (
        <p>
          {missingPpg.length > 0 && <>No potential PPG on the Ingredients page for: {[...new Set(missingPpg)].join(', ')}. </>}
          {missingAlpha.length > 0 && <>No alpha acid % on the Ingredients page for: {[...new Set(missingAlpha)].join(', ')}. </>}
          {missingColour.length > 0 && <>No colour (°L) on the Ingredients page for: {[...new Set(missingColour)].join(', ')}.</>}
        </p>
      )}
    </div>
  )
}
