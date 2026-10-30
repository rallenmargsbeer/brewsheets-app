import React, { useState, useEffect, useMemo } from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Beaker, ClipboardList, Archive, Settings, LayoutDashboard, Plus, X, Check, User, Upload, Users, ChevronRight, ChevronDown, LogOut, TrendingUp, Droplet, Calendar, UserCog, Search, FlaskConical, MapPin, LayoutGrid } from 'lucide-react';
import Papa from 'papaparse';
import { supabase } from '../supabaseClient';
import DifferenceTests from './DifferenceTests.jsx';

const INTENSITY_LEVELS = [
  { label: 'Absent', score: 1 },
  { label: 'Low', score: 3 },
  { label: 'Medium', score: 5 },
  { label: 'High', score: 7 },
  { label: 'Very High', score: 9 },
];

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function traitId(category, trait) { return `${slug(category)}__${slug(trait)}`; }

const TRAIT_TAXONOMY = {
  aroma: [
    { category: 'Malt', traits: ['Caramel', 'Toast', 'Biscuit', 'Bread', 'Roast', 'Choc'] },
    { category: 'Hops', traits: ['Citrus', 'Floral', 'Pine', 'Fruity', 'Herbal', 'Earthy', 'Diesel', 'Noble'] },
    { category: 'Esters', traits: ['Apple', 'Fruity', 'Bready'] },
    { category: 'Phenols', traits: ['Phenolic'] },
  ],
  flavor: [
    { category: 'Malt', traits: ['Sweetness', 'Caramel', 'Toasty', 'Biscuity', 'Cracker', 'Bready', 'Roasted', 'Chocolate'] },
    { category: 'Hops', traits: ['Citrus', 'Floral', 'Fruity', 'Resinous', 'Herbal', 'Spicy', 'Earthy', 'Grassy', 'Savoury'] },
    { category: 'Ester Profile', traits: ['Apple', 'Fruity', 'Bready', 'Phenolic'] },
    { category: 'Bitterness', traits: ['Initial bitterness', 'Lingering Bitterness'] },
    { category: 'Acidity', traits: ['Tartness', 'Lactic', 'Acetic'] },
    { category: 'Body', traits: ['Crispness', 'Salty', 'Viscosity', 'Carbonation'] },
    { category: 'Alcohol', traits: ['Heat'] },
  ],
};

const SECTION_LABELS = { aroma: 'Aroma', flavor: 'Flavour & Body' };

// Plain-language explanations for every trait, shown via the "What do
// these mean?" glossary in the tasting form. Keyed the same way as
// scores/targets (traitId(category, trait)), so this stays in sync with
// TRAIT_TAXONOMY automatically if traits are ever added/removed there.
const TRAIT_DEFINITIONS = {
  // Aroma — Malt
  malt__caramel: 'Sweet, toffee-like aroma from caramelized malt sugars.',
  malt__toast: 'Aroma reminiscent of toasted bread or grain.',
  malt__biscuit: 'Dry, cracker-like malt aroma.',
  malt__bread: 'Fresh-baked bread dough aroma.',
  malt__roast: 'Dark, coffee-like or charred aroma from roasted malts.',
  malt__choc: 'Chocolate-like aroma from dark/chocolate malts.',
  // Aroma — Hops
  'hops__citrus': 'Orange, lemon, or grapefruit-like hop aroma.',
  'hops__floral': 'Perfumed, flower-like hop aroma.',
  'hops__pine': 'Resinous, pine needle-like hop aroma.',
  'hops__fruity': 'Tropical or stone-fruit hop aroma — mango, passionfruit, peach.',
  'hops__herbal': 'Grassy, tea-like, or herbaceous hop aroma.',
  'hops__earthy': 'Soil-like, musty hop aroma.',
  'hops__diesel': 'Fuel-like, petrol aroma sometimes found in certain hop varieties.',
  'hops__noble': 'Classic, mild spicy-herbal aroma of traditional European hops.',
  // Aroma — Esters
  esters__apple: 'Green apple or apple-skin aroma from fermentation esters.',
  esters__fruity: 'General fruity ester aroma — banana, pear, stone fruit.',
  esters__bready: 'Yeasty, bread-dough aroma from fermentation.',
  // Aroma — Phenols
  phenols__phenolic: 'Clove, spicy, or medicinal aroma from phenolic compounds.',
  // Flavour — Malt
  malt__sweetness: 'Perceived sugar-like sweetness on the palate.',
  malt__toasty: 'Toasted grain flavour.',
  malt__biscuity: 'Dry, cracker-like malt flavour.',
  malt__cracker: 'Dry, neutral grain flavour.',
  malt__roasted: 'Coffee-like, charred flavour from dark malts.',
  malt__chocolate: 'Cocoa/chocolate flavour from dark malts.',
  // Flavour — Hops
  'hops__resinous': 'Sticky, pine-sap hop flavour.',
  'hops__spicy': 'Peppery, spice-like hop flavour.',
  'hops__grassy': 'Fresh-cut grass flavour.',
  'hops__savoury': 'Umami-like, brothy hop flavour.',
  // Flavour — Ester Profile
  'ester-profile__apple': 'Green apple flavour.',
  'ester-profile__fruity': 'General fruity ester flavour.',
  'ester-profile__bready': 'Yeasty bread flavour.',
  'ester-profile__phenolic': 'Clove/spice flavour from phenols.',
  // Flavour — Bitterness
  'bitterness__initial-bitterness': 'Bitterness perceived at first taste.',
  'bitterness__lingering-bitterness': 'Bitterness that persists after swallowing.',
  // Flavour — Acidity
  acidity__tartness: 'Sharp, sour flavour.',
  acidity__lactic: 'Yogurt-like, mild sour flavour from lactic acid.',
  acidity__acetic: 'Vinegar-like sour flavour from acetic acid.',
  // Flavour — Body
  body__crispness: 'Light, clean, refreshing mouthfeel.',
  body__salty: 'Perceived saltiness.',
  body__viscosity: 'Thickness/fullness of mouthfeel.',
  body__carbonation: 'Perceived level of fizziness.',
  // Flavour — Alcohol
  alcohol__heat: 'Warming sensation from alcohol content.',
};
const CORE_BEERS = ['Drift', 'Pale', 'Kolsch', 'River Dog', 'In The Pines', 'Red IPA', 'Mermid', 'Stout', 'Brown', 'Draught'];

function defaultSectionScores(section) {
  const out = {};
  TRAIT_TAXONOMY[section].forEach(group => group.traits.forEach(t => { out[traitId(group.category, t)] = 1; }));
  return out;
}
function defaultAllScores() { return { aroma: defaultSectionScores('aroma'), flavor: defaultSectionScores('flavor') }; }
function normalizeTarget(target) {
  if (target && typeof target.aroma === 'object' && typeof target.flavor === 'object') return target;
  return defaultAllScores();
}
function getScore(scoresObj, section, id) { return (scoresObj && scoresObj[section] && scoresObj[section][id]) ?? 1; }

function traitLabelsFor(section) {
  const nameCounts = {};
  TRAIT_TAXONOMY[section].forEach(g => g.traits.forEach(t => { nameCounts[t] = (nameCounts[t] || 0) + 1; }));
  const labels = {};
  TRAIT_TAXONOMY[section].forEach(g => g.traits.forEach(t => {
    const id = traitId(g.category, t);
    labels[id] = nameCounts[t] > 1 ? `${t} (${g.category})` : t;
  }));
  return labels;
}

const OFF_FLAVORS = [
  'Diacetyl (buttery)', 'DMS (cooked corn)', 'Acetaldehyde (green apple)',
  'Oxidation (cardboard/papery)', 'Phenolic (band-aid/clove)', 'Astringent (drying/tannic)',
  'Unintended sour/acidic', 'Skunked (lightstruck)', 'Metallic', 'Yeasty/Sulfury',
  'Infection (off-aroma/haze)', 'Solvent/Fusel',
];

const RETENTION_INTERVALS = [30, 90, 180];
const QC_READ_DAYS = 5;

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
function addDays(dateStr, n) { const d = new Date(dateStr); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function useSupabaseData(session) {
  const [skus, setSkus] = useState([]);
  const [batches, setBatches] = useState([]);
  const [retention, setRetention] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [panels, setPanels] = useState([]);
  const [panelBatches, setPanelBatches] = useState([]);
  const [briteChecks, setBriteChecks] = useState([]);
  const [sensorySessions, setSensorySessions] = useState([]);
  const [sensorySessionPanels, setSensorySessionPanels] = useState([]);
  const [sensorySessionParticipants, setSensorySessionParticipants] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [qcLocations, setQcLocations] = useState([]);
  const [qcSamples, setQcSamples] = useState([]);
  const [qcTests, setQcTests] = useState([]);
  const [spikes, setSpikes] = useState([]);
  const [spikeTastings, setSpikeTastings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [error, setError] = useState(null);

  const loadAll = async () => {
    setLoading(true); setError(null);
    try {
      const [s, b, r, se, p, pb, bc, ss, ssp, sspt, pr, ql, qs, qt, sk] = await Promise.all([
        supabase.from('sensory_skus').select('*'),
        supabase.from('sensory_batches').select('*'),
        supabase.from('sensory_retention_checkpoints').select('*'),
        supabase.from('sensory_tastings').select('*'),
        supabase.from('sensory_panels').select('*'),
        supabase.from('sensory_panel_batches').select('*'),
        supabase.from('sensory_brite_checks').select('*'),
        supabase.from('sensory_sessions').select('*'),
        supabase.from('sensory_session_panels').select('*'),
        supabase.from('sensory_session_participants').select('*'),
        supabase.from('sensory_profiles').select('*'),
        supabase.from('sensory_qc_locations').select('*'),
        supabase.from('sensory_qc_samples').select('*'),
        supabase.from('sensory_qc_tests').select('*'),
        supabase.from('sensory_spikes').select('*').order('created_at'),
      ]);
      if (s.error) throw s.error;
      setSkus(s.data || []);
      setBatches((b.data || []).sort((a, b2) => Number(b2.batch_number) - Number(a.batch_number)));
      setRetention(r.data || []);
      // Tastings of spiked samples are kept apart: they never count towards a batch's results.
      setSessions((se.data || []).filter(t => !t.spike_id));
      setSpikeTastings((se.data || []).filter(t => t.spike_id));
      setSpikes(sk.data || []);
      setPanels(p.data || []);
      setPanelBatches(pb.data || []);
      setBriteChecks(bc.data || []);
      setSensorySessions(ss.data || []);
      setSensorySessionPanels(ssp.data || []);
      setSensorySessionParticipants(sspt.data || []);
      setProfiles(pr.data || []);
      setQcLocations(ql.data || []);
      setQcSamples(qs.data || []);
      setQcTests(qt.data || []);
    } catch (e) {
      setError(e.message || 'Failed to load data.');
    } finally {
      setLoading(false);
      setInitialLoadDone(true);
    }
  };

  useEffect(() => { if (session) loadAll(); }, [session]);

  const profileName = (id) => (profiles.find(p => p.id === id) || {}).name || 'Unknown';

  const addSku = async (sku) => {
    const { error } = await supabase.from('sensory_skus').insert({
      name: sku.name, style: sku.style, abv: sku.abv, descriptors: sku.descriptors,
      watchouts: sku.watchouts, target: sku.target, tolerance: sku.tolerance, notes: sku.notes,
    });
    if (error) throw error;
    await loadAll();
  };

  const updateSku = async (sku) => {
    const { error } = await supabase.from('sensory_skus').update({
      name: sku.name, style: sku.style, abv: sku.abv, descriptors: sku.descriptors,
      watchouts: sku.watchouts, target: sku.target, tolerance: sku.tolerance, notes: sku.notes,
    }).eq('id', sku.id);
    if (error) throw error;
    await loadAll();
  };

  const addBatch = async ({ skuId, batchNumber, packageDate, format }) => {
    const { data, error } = await supabase.from('sensory_batches').insert({
      sku_id: skuId, batch_number: batchNumber, package_date: packageDate || null, format,
    }).select().single();
    if (error) throw error;
    const checkpoints = RETENTION_INTERVALS.map(days => ({
      batch_id: data.id, days, due_date: addDays(packageDate || todayISO(), days), assessed: false,
    }));
    const { error: rErr } = await supabase.from('sensory_retention_checkpoints').insert(checkpoints);
    if (rErr) throw rErr;
    await loadAll();
    return data.id;
  };

  const importBatches = async (rows) => {
    let added = 0, skipped = 0, graduated = 0;
    for (const row of rows) {
      const existing = batches.find(b => b.batch_number === row.batchNumber);
      if (existing) {
        if (!existing.package_date && row.packagedDate) {
          const { error: updateErr } = await supabase.from('sensory_batches').update({ package_date: row.packagedDate }).eq('id', existing.id);
          if (updateErr) throw updateErr;
          const checkpoints = RETENTION_INTERVALS.map(days => ({
            batch_id: existing.id, days, due_date: addDays(row.packagedDate, days), assessed: false,
          }));
          await supabase.from('sensory_retention_checkpoints').insert(checkpoints);
          graduated++;
        } else {
          skipped++;
        }
        continue;
      }

      let sku = skus.find(s => s.name.toLowerCase() === row.skuName.toLowerCase());
      if (!sku) {
        const { data: newSku, error: skuErr } = await supabase.from('sensory_skus').insert({
          name: row.skuName, style: '', abv: 0, descriptors: [], watchouts: [],
          target: defaultAllScores(), tolerance: 2,
          notes: 'Auto-created from a sheet import — set a real target profile.',
        }).select().single();
        if (skuErr) throw skuErr;
        sku = newSku;
        skus.push(sku);
      }

      const packageDate = row.packagedDate || null;
      const { data: newBatch, error: batchErr } = await supabase.from('sensory_batches').insert({
        sku_id: sku.id, batch_number: row.batchNumber, package_date: packageDate, format: 'Can',
      }).select().single();
      if (batchErr) throw batchErr;
      batches.push(newBatch);

      if (packageDate) {
        const checkpoints = RETENTION_INTERVALS.map(days => ({
          batch_id: newBatch.id, days, due_date: addDays(packageDate, days), assessed: false,
        }));
        await supabase.from('sensory_retention_checkpoints').insert(checkpoints);
      }
      added++;
    }
    await loadAll();
    return { added, skipped };
  };

  // Marks any open session complete once every participant has tasted everything in it
  // (a database function, which also raises an admin alert).
  const triggerCompletionCheck = () => {
    supabase.rpc('sensory_check_sessions').then(() => {}, () => {});
  };

  const addSession = async (sess) => {
    const { error } = await supabase.from('sensory_tastings').insert({
      batch_id: sess.batchId, taster_id: session.user.id, date: sess.date, scores: sess.scores,
      overall: sess.overall, off_flavors: sess.offFlavors, notes: sess.notes,
      retention_checkpoint_id: sess.retentionCheckpointId || null,
      tasting_type: sess.tastingType || 'ttt',
      spike_id: sess.spikeId || null,
    });
    if (error) throw error;
    if (sess.retentionCheckpointId) {
      await supabase.from('sensory_retention_checkpoints').update({ assessed: true }).eq('id', sess.retentionCheckpointId);
    }
    await loadAll();
    triggerCompletionCheck();
  };

  const updateSession = async (sessionId, sess) => {
    const { error } = await supabase.from('sensory_tastings').update({
      batch_id: sess.batchId, date: sess.date, scores: sess.scores,
      overall: sess.overall, off_flavors: sess.offFlavors, notes: sess.notes,
      retention_checkpoint_id: sess.retentionCheckpointId || null,
      tasting_type: sess.tastingType || 'ttt',
    }).eq('id', sessionId);
    if (error) throw error;
    if (sess.retentionCheckpointId) {
      await supabase.from('sensory_retention_checkpoints').update({ assessed: true }).eq('id', sess.retentionCheckpointId);
    }
    await loadAll();
    triggerCompletionCheck();
  };

  const addSpike = async ({ sessionId, baseBatchId, offFlavor, label, notes }) => {
    const { error } = await supabase.from('sensory_spikes').insert({
      sensory_session_id: sessionId, base_batch_id: baseBatchId, off_flavor: offFlavor, label, notes: notes || '', created_by: session.user.id,
    });
    if (error) throw error;
    await loadAll();
  };

  const deleteSpike = async (spikeId) => {
    const { error } = await supabase.from('sensory_spikes').delete().eq('id', spikeId);
    if (error) throw error;
    await loadAll();
  };

  const deleteSession = async (sessionId) => {
    const { error } = await supabase.from('sensory_tastings').delete().eq('id', sessionId);
    if (error) throw error;
    await loadAll();
  };

  const createPanel = async ({ date, label, batchIds, panelType }) => {
    const { data: panel, error } = await supabase.from('sensory_panels').insert({ date, label, panel_type: panelType || 'ttt' }).select().single();
    if (error) throw error;
    await supabase.from('sensory_panel_batches').insert(batchIds.map((bid, i) => ({ panel_id: panel.id, batch_id: bid, sort_order: i })));
    await loadAll();
  };

  const deletePanel = async (panelId) => {
    const { error } = await supabase.from('sensory_panels').delete().eq('id', panelId);
    if (error) throw error;
    await loadAll();
  };

  const reorderPanelBatch = async (panelId, batchId, direction) => {
    const rows = panelBatches.filter(pb => pb.panel_id === panelId).sort((a, b) => a.sort_order - b.sort_order);
    const idx = rows.findIndex(r => r.batch_id === batchId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) return;
    const a = rows[idx], b = rows[swapIdx];
    await supabase.from('sensory_panel_batches').update({ sort_order: b.sort_order }).eq('panel_id', panelId).eq('batch_id', a.batch_id);
    await supabase.from('sensory_panel_batches').update({ sort_order: a.sort_order }).eq('panel_id', panelId).eq('batch_id', b.batch_id);
    await loadAll();
  };

  const addBriteCheck = async ({ batchId, decision, notes }) => {
    const { error } = await supabase.from('sensory_brite_checks').insert({
      batch_id: batchId, taster_id: session.user.id, date: todayISO(), decision, notes: notes || '',
    });
    if (error) throw error;
    await loadAll();
  };

  const createSensorySession = async ({ date, label, panelIds, participantIds }) => {
    const { data: sess, error } = await supabase.from('sensory_sessions').insert({ date, label }).select().single();
    if (error) throw error;
    if (panelIds.length > 0) {
      await supabase.from('sensory_session_panels').insert(panelIds.map(pid => ({ sensory_session_id: sess.id, panel_id: pid })));
    }
    if (participantIds.length > 0) {
      await supabase.from('sensory_session_participants').insert(participantIds.map(uid => ({ sensory_session_id: sess.id, user_id: uid })));
    }
    await loadAll();
  };

  const deleteSensorySession = async (sensorySessionId) => {
    const { error } = await supabase.from('sensory_sessions').delete().eq('id', sensorySessionId);
    if (error) throw error;
    await loadAll();
  };

  const updateSessionParticipants = async (sensorySessionId, participantIds) => {
    const { error: delErr } = await supabase.from('sensory_session_participants').delete().eq('sensory_session_id', sensorySessionId);
    if (delErr) throw delErr;
    if (participantIds.length > 0) {
      const { error: insErr } = await supabase.from('sensory_session_participants').insert(
        participantIds.map(uid => ({ sensory_session_id: sensorySessionId, user_id: uid }))
      );
      if (insErr) throw insErr;
    }
    await loadAll();
  };

  const finishSensorySession = async (sensorySessionId) => {
    const { error } = await supabase.from('sensory_sessions').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', sensorySessionId);
    if (error) throw error;
    await loadAll();
  };

  const updateProfileRole = async (profileId, role) => {
    const { error } = await supabase.from('sensory_profiles').update({ role }).eq('id', profileId);
    if (error) throw error;
    await loadAll();
  };

  const addQcSample = async ({ sampleType, batchId, locationId, notes }) => {
    const pulledDate = todayISO();
    const { data, error } = await supabase.from('sensory_qc_samples').insert({
      sample_type: sampleType, batch_id: batchId || null, location_id: locationId || null,
      pulled_by: session.user.id, pulled_date: pulledDate, notes: notes || '',
    }).select().single();
    if (error) throw error;
    const dueDate = addDays(pulledDate, QC_READ_DAYS);
    const tests = ['wild_yeast', 'b_tube'].map(testType => ({ sample_id: data.id, test_type: testType, due_date: dueDate }));
    const { error: tErr } = await supabase.from('sensory_qc_tests').insert(tests);
    if (tErr) throw tErr;
    await loadAll();
  };

  const logQcResult = async ({ testId, result, notes }) => {
    const { error } = await supabase.from('sensory_qc_tests').update({
      result, read_date: todayISO(), read_by: session.user.id, notes: notes || '',
    }).eq('id', testId);
    if (error) throw error;
    await loadAll();
  };

  const addQcLocation = async ({ name, sortOrder }) => {
    const { error } = await supabase.from('sensory_qc_locations').insert({ name, sort_order: sortOrder || 0 });
    if (error) throw error;
    await loadAll();
  };

  const updateQcLocation = async (locationId, fields) => {
    const { error } = await supabase.from('sensory_qc_locations').update(fields).eq('id', locationId);
    if (error) throw error;
    await loadAll();
  };

  const deleteQcSample = async (sampleId) => {
    await supabase.from('sensory_qc_tests').delete().eq('sample_id', sampleId);
    const { error } = await supabase.from('sensory_qc_samples').delete().eq('id', sampleId);
    if (error) throw error;
    await loadAll();
  };

  return {
    skus, batches, retention, sessions, spikes, spikeTastings, panels, panelBatches, briteChecks, profiles, profileName,
    sensorySessions, sensorySessionPanels, sensorySessionParticipants, qcLocations, qcSamples, qcTests,
    loading, initialLoadDone, error, reload: loadAll,
    addSku, updateSku, addBatch, addSession, updateSession, deleteSession, addSpike, deleteSpike, createPanel, deletePanel, reorderPanelBatch, importBatches, addBriteCheck,
    createSensorySession, deleteSensorySession, updateSessionParticipants, finishSensorySession, updateProfileRole,
    addQcSample, logQcResult, addQcLocation, updateQcLocation, deleteQcSample,
  };
}

const Pill = ({ children, tone = 'neutral' }) => {
  const tones = {
    neutral: { background: 'var(--surface-2)', color: 'var(--text-muted)' },
    good: { background: '#e3f1e5', color: 'var(--good)' },
    bad: { background: '#fdecea', color: 'var(--bad)' },
    warn: { background: '#fde7dc', color: '#c4521f' },
  };
  return <span style={{ ...tones[tone], fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, letterSpacing: 0.3, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{children}</span>;
};

const Card = ({ children, style, className }) => (
  <div className={className} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: 20, ...style }}>{children}</div>
);

const Button = ({ children, onClick, variant = 'primary', style, type = 'button', disabled }) => (
  // The production app's buttons (index.css): navy primary, white "secondary"; danger is red text.
  <button type={type} onClick={onClick} disabled={disabled} className={variant === 'primary' ? '' : 'secondary'} style={{
    display: 'inline-flex', alignItems: 'center', gap: 6, ...(variant === 'danger' ? { color: 'var(--bad)' } : {}), ...style,
  }}>{children}</button>
);

const Field = ({ label, children }) => (
  <label style={{ display: 'block', marginBottom: 14 }}>
    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
    {children}
  </label>
);

const inputStyle = {
  width: '100%', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
  padding: '9px 11px', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-body)', boxSizing: 'border-box',
};

function IntensityPicker({ value, onChange, target, tolerance }) {
  const offTarget = target != null && Math.abs(value - target) > tolerance;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {INTENSITY_LEVELS.map(lvl => {
        const active = value === lvl.score;
        const isTarget = target === lvl.score;
        return (
          <button key={lvl.score} type="button" onClick={() => onChange(lvl.score)} title={lvl.label} style={{
            flex: 1, padding: '6px 2px', fontSize: 10.5, borderRadius: 5, cursor: 'pointer', fontFamily: 'var(--font-mono)',
            border: `1px solid ${isTarget ? 'var(--accent)' : 'var(--line)'}`,
            background: active ? (offTarget ? '#fdecea' : '#e3f1e5') : 'transparent',
            color: active ? (offTarget ? 'var(--bad)' : 'var(--good)') : 'var(--text-muted)',
            fontWeight: active ? 700 : 400,
          }}>{lvl.label.split(' ').map(w => w[0]).join('')}</button>
        );
      })}
    </div>
  );
}

// Spider diagram look: polygon rings at 3, 6 and 9, the TTT target in brand orange, batches bold.
const TARGET_STYLE = { stroke: 'var(--orange)', fill: 'var(--orange)', strokeWidth: 2, dot: { r: 2.5, fill: 'var(--orange)', strokeWidth: 0 } };
// Called inline (not as <SpiderGrid />): Recharts only finds its own components among a chart's children.
const spiderGrid = () => [
  <PolarGrid key="grid" gridType="polygon" stroke="var(--line)" />,
  <PolarAngleAxis key="angle" dataKey="trait" tick={{ fill: 'var(--text)', fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-body)' }} />,
  <PolarRadiusAxis key="radius" domain={[0, 9]} tickCount={4} tick={false} axisLine={false} />,
];

function TraitSpiderChart({ section, target, actual, height = 420 }) {
  const labels = traitLabelsFor(section);
  const chartData = TRAIT_TAXONOMY[section].flatMap(g => g.traits.map(t => {
    const id = traitId(g.category, t);
    return { trait: labels[id], Target: target ? (target[id] ?? 1) : 0, Batch: actual ? (actual[id] ?? 1) : 0 };
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={chartData} outerRadius="78%">
        {spiderGrid()}
        {target && <Radar name="TTT Target" dataKey="Target" {...TARGET_STYLE} fillOpacity={actual ? 0.1 : 0.2} />}
        {actual && <Radar name="This Batch" dataKey="Batch" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.3} strokeWidth={2.5} dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }} />}
        <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12.5, fontFamily: 'var(--font-body)', paddingTop: 6 }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

const COMPARE_COLORS = ['var(--accent)', '#7A9CC6', '#B98CC7', 'var(--teal)', 'var(--gold)', 'var(--forest)', '#C7597A', '#5B8C7B'];

function MultiBatchSpiderChart({ section, target, series, height = 420 }) {
  const labels = traitLabelsFor(section);
  const chartData = TRAIT_TAXONOMY[section].flatMap(g => g.traits.map(t => {
    const id = traitId(g.category, t);
    const row = { trait: labels[id], Target: target ? (target[id] ?? 1) : 0 };
    series.forEach(s => { row[s.label] = s.scores ? (s.scores[id] ?? 1) : 1; });
    return row;
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={chartData} outerRadius="78%">
        {spiderGrid()}
        {target && <Radar name="TTT Target" dataKey="Target" {...TARGET_STYLE} fillOpacity={0.08} />}
        {series.map((s, i) => (
          <Radar key={s.label} name={s.label} dataKey={s.label} stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]} fill={COMPARE_COLORS[i % COMPARE_COLORS.length]} fillOpacity={0.14} strokeWidth={2.5} dot={{ r: 2.5, fill: COMPARE_COLORS[i % COMPARE_COLORS.length], strokeWidth: 0 }} />
        ))}
        <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12.5, fontFamily: 'var(--font-body)', paddingTop: 6 }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function TraitSectionEditor({ section, scores, onChange, target, tolerance }) {
  return (
    <div>
      {TRAIT_TAXONOMY[section].map(group => (
        <div key={group.category} style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 8px' }}>{group.category}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.traits.map(t => {
              const id = traitId(group.category, t);
              return (
                <div key={id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t}</span>
                  <IntensityPicker value={scores[id] ?? 1} onChange={v => onChange(id, v)} target={target ? (target[id] ?? null) : null} tolerance={tolerance ?? 0} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function TagInput({ values, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = () => { if (draft.trim()) { onChange([...values, draft.trim()]); setDraft(''); } };
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input style={inputStyle} value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={placeholder} />
        <Button variant="ghost" onClick={add}>Add</Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {values.map((v, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, background: 'var(--surface-2)', color: 'var(--text-muted)', padding: '4px 8px 4px 10px', borderRadius: 20 }}>
            {v} <X size={12} style={{ cursor: 'pointer' }} onClick={() => onChange(values.filter((_, idx) => idx !== i))} />
          </span>
        ))}
      </div>
    </div>
  );
}

function TraitGlossaryModal({ onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div className="modal-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, width: 640, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>What do these mean?</h3>
          <X size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={onClose} />
        </div>
        {Object.keys(SECTION_LABELS).map(section => (
          <div key={section} style={{ marginBottom: 20 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{SECTION_LABELS[section]}</p>
            {TRAIT_TAXONOMY[section].map(group => (
              <div key={group.category} style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 4px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{group.category}</p>
                {group.traits.map(t => {
                  const id = traitId(group.category, t);
                  return (
                    <p key={id} style={{ margin: '0 0 4px', fontSize: 13 }}>
                      <strong>{t}</strong> — <span style={{ color: 'var(--text-muted)' }}>{TRAIT_DEFINITIONS[id] || 'No description yet.'}</span>
                    </p>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TastingForm({ store, currentProfile, onDone, presetBatchId, presetSpike, presetTastingType, activePanelId, editSession }) {
  // A spiked sample: scored like any other, but the taster only sees the lead's label for it.
  const spike = editSession ? (editSession.spike_id ? store.spikes.find(k => k.id === editSession.spike_id) || { label: 'Sample' } : null) : presetSpike || null;
  const [batchId, setBatchId] = useState(editSession ? editSession.batch_id : (presetBatchId || (store.batches[0] ? store.batches[0].id : '')));
  useEffect(() => { if (presetBatchId && !editSession) setBatchId(presetBatchId); }, [presetBatchId]);
  const [tastingType, setTastingType] = useState(editSession ? editSession.tasting_type : (presetTastingType || 'ttt'));
  useEffect(() => { if (presetTastingType && !editSession) setTastingType(presetTastingType); }, [presetTastingType]);
  const [scores, setScores] = useState(editSession ? editSession.scores : defaultAllScores());
  const [activeSection, setActiveSection] = useState('aroma');
  const [overall, setOverall] = useState(editSession ? editSession.overall : 'pass');
  const [offFlavors, setOffFlavors] = useState(editSession ? (editSession.off_flavors || []) : []);
  const [notes, setNotes] = useState(editSession ? (editSession.notes || '') : '');
  const [retentionCheckpointId, setRetentionCheckpointId] = useState(editSession ? (editSession.retention_checkpoint_id || '') : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showGlossary, setShowGlossary] = useState(false);

  const batch = store.batches.find(b => b.id === batchId);
  const sku = batch ? store.skus.find(s => s.id === batch.sku_id) : null;
  // Retention is off-flavours, notes and an overall call: no trait scores or spider charts.
  const isRetention = !spike && tastingType === 'retention';
  const dueCheckpoints = batch ? store.retention.filter(r => r.batch_id === batch.id && (!r.assessed || r.id === retentionCheckpointId)) : [];

  const toggleOff = (f) => setOffFlavors(prev =>
    prev.some(x => x.flavor === f) ? prev.filter(x => x.flavor !== f) : [...prev, { flavor: f, intensity: 3 }]);
  const setOffIntensity = (f, intensity) => setOffFlavors(prev => prev.map(x => x.flavor === f ? { ...x, intensity } : x));
  const setTraitScore = (section, id, v) => setScores(s => ({ ...s, [section]: { ...s[section], [id]: v } }));

  const hasAnyScoreChanged = () => {
    const touched = (section) => Object.values(scores[section] || {}).some(v => v !== 1);
    return touched('aroma') || touched('flavor');
  };

  const submit = async () => {
    if (!batchId) return;
    if (!isRetention && !hasAnyScoreChanged() && offFlavors.length === 0 && !notes.trim()) {
      if (!window.confirm("This tasting doesn't have any scores, off-flavors, or notes filled in — submit anyway?")) return;
    }
    setSubmitting(true); setError('');
    try {
      const payload = {
        batchId, date: editSession ? editSession.date : todayISO(), scores: isRetention ? { aroma: {}, flavor: {} } : scores, overall, offFlavors, notes,
        retentionCheckpointId: tastingType === 'retention' ? (retentionCheckpointId || null) : null,
        tastingType: spike ? 'ttt' : tastingType,
        spikeId: spike ? spike.id : null,
      };
      if (editSession) {
        await store.updateSession(editSession.id, payload);
        onDone();
        return;
      }

      await store.addSession(payload);
      // From a panel: straight back to it (the beer shows as tasted there). Otherwise confirm.
      if (!activePanelId) window.alert('Tasting submitted — thanks!');
      onDone();
    } catch (e) {
      setError(e.message || 'Could not submit — try again.');
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div>
      {!isRetention && <Card style={{ marginBottom: 20 }}>
        <h4 style={{ margin: '0 0 2px', fontFamily: 'var(--font-display)', fontSize: 18 }}>{sku ? sku.name : 'No SKU selected'}</h4>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>{sku ? `${sku.style} · ${sku.abv}% ABV` : ''}</p>
        <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {Object.keys(SECTION_LABELS).map(sec => (
            <div key={sec}>
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', textAlign: 'center' }}>{SECTION_LABELS[sec]}</p>
              <TraitSpiderChart section={sec} target={sku ? sku.target[sec] : null} actual={scores[sec]} height={440} />
            </div>
          ))}
        </div>
      </Card>}

      <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 24 }}>
        <Card>
          <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-display)', fontSize: 20 }}>{editSession ? 'Edit tasting' : 'Log a tasting'}</h3>
          <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: 13 }}>Tasting as <strong style={{ color: 'var(--text)' }}>{currentProfile.name}</strong></p>

          {spike ? (
            <Field label="Sample"><p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{spike.label}</p></Field>
          ) : (<>
          <Field label="Tasting type">
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setTastingType('ttt')} style={{
                flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${tastingType === 'ttt' ? 'var(--accent)' : 'var(--line)'}`,
                background: tastingType === 'ttt' ? '#e1f0f3' : 'transparent',
                color: tastingType === 'ttt' ? 'var(--accent)' : 'var(--text-muted)',
              }}>True to Type</button>
              <button type="button" onClick={() => setTastingType('retention')} style={{
                flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${tastingType === 'retention' ? 'var(--accent)' : 'var(--line)'}`,
                background: tastingType === 'retention' ? '#e1f0f3' : 'transparent',
                color: tastingType === 'retention' ? 'var(--accent)' : 'var(--text-muted)',
              }}>Retention</button>
            </div>
          </Field>

          <Field label="Batch">
            <select style={inputStyle} value={batchId} onChange={e => { setBatchId(e.target.value); setRetentionCheckpointId(''); }}>
              {store.batches.filter(b => b.package_date).map(b => {
                const s = store.skus.find(sk => sk.id === b.sku_id);
                return <option key={b.id} value={b.id}>{b.batch_number} — {s ? s.name : 'Unknown SKU'}</option>;
              })}
            </select>
          </Field>

          </>)}

          {!spike && tastingType === 'retention' && dueCheckpoints.length > 0 && (
            <Field label="Retention checkpoint">
              <select style={inputStyle} value={retentionCheckpointId} onChange={e => setRetentionCheckpointId(e.target.value)}>
                <option value="">Not a scheduled checkpoint</option>
                {dueCheckpoints.map(r => <option key={r.id} value={r.id}>Day {r.days} — due {r.due_date}</option>)}
              </select>
            </Field>
          )}

          {!isRetention && (<>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {Object.keys(SECTION_LABELS).map(sec => (
              <button key={sec} type="button" onClick={() => setActiveSection(sec)} style={{
                flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${activeSection === sec ? 'var(--accent)' : 'var(--line)'}`,
                background: activeSection === sec ? '#e1f0f3' : 'transparent',
                color: activeSection === sec ? 'var(--accent)' : 'var(--text-muted)',
              }}>{SECTION_LABELS[sec]}</button>
            ))}
          </div>
          <button type="button" onClick={() => setShowGlossary(true)} style={{ background: 'none', border: 'none', padding: 0, margin: '0 0 16px', fontSize: 12, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}>
            What do these mean?
          </button>
          {showGlossary && <TraitGlossaryModal onClose={() => setShowGlossary(false)} />}

          <TraitSectionEditor section={activeSection} scores={scores[activeSection]} onChange={(id, v) => setTraitScore(activeSection, id, v)}
            target={sku ? sku.target[activeSection] : null} tolerance={sku ? sku.tolerance : 2} />
          </>)}

          <Field label="Off-flavors detected">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: offFlavors.length > 0 ? 10 : 0 }}>
              {OFF_FLAVORS.map(f => {
                const selected = offFlavors.some(x => x.flavor === f);
                return (
                  <button key={f} type="button" onClick={() => toggleOff(f)} style={{
                    fontSize: 12, padding: '6px 10px', borderRadius: 20, cursor: 'pointer',
                    border: `1px solid ${selected ? 'var(--bad)' : 'var(--line)'}`,
                    background: selected ? '#fdecea' : 'transparent',
                    color: selected ? 'var(--bad)' : 'var(--text-muted)',
                  }}>{f}</button>
                );
              })}
            </div>
            {offFlavors.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {offFlavors.map(({ flavor, intensity }) => (
                  <div key={flavor} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) minmax(0, max-content)', gap: 10, alignItems: 'center', background: 'var(--surface-2)', borderRadius: 6, padding: '8px 10px' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--bad)' }}>{flavor}</span>
                    {/* Scrolls sideways when the screen is too narrow for all five. */}
                    <div style={{ display: 'flex', gap: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} type="button" onClick={() => setOffIntensity(flavor, n)} style={{
                          flex: '0 0 24px', width: 24, height: 24, padding: 0, borderRadius: 5, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                          border: `1px solid ${intensity === n ? 'var(--bad)' : 'var(--line)'}`,
                          background: intensity === n ? '#fdecea' : 'transparent',
                          color: intensity === n ? 'var(--bad)' : 'var(--text-muted)', fontWeight: intensity === n ? 700 : 400,
                        }}>{n}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Field>

          <Field label="Tasting notes">
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical', fontFamily: 'var(--font-body)' }}
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="What stood out?" />
          </Field>

          <Field label="Overall call">
            <div style={{ display: 'flex', gap: 8 }}>
              {['pass', 'flag', 'fail'].map(v => (
                <button key={v} type="button" onClick={() => setOverall(v)} style={{
                  flex: 1, padding: '9px 0', borderRadius: 7, textTransform: 'capitalize', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  border: `1px solid ${overall === v ? 'var(--accent)' : 'var(--line)'}`,
                  background: overall === v ? '#e1f0f3' : 'transparent',
                  color: overall === v ? 'var(--accent)' : 'var(--text-muted)',
                }}>{v}</button>
              ))}
            </div>
          </Field>

          {error && <p style={{ color: 'var(--bad)', fontSize: 12.5, marginBottom: 8 }}>{error}</p>}
          <Button onClick={submit} disabled={!batchId || submitting} style={{ width: '100%', justifyContent: 'center' }}>
            <Check size={15} /> {submitting ? 'Saving…' : editSession ? 'Save changes' : 'Submit tasting'}
          </Button>
        </Card>

        {sku && (
          <Card style={{ alignSelf: 'start' }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>True-to-type reference</p>
            <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.5 }}>{sku.notes}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>{sku.descriptors.map(d => <Pill key={d}>{d}</Pill>)}</div>
            {sku.watchouts.length > 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--bad)' }}>Watch for: {sku.watchouts.join(', ')}</p>}
          </Card>
        )}
      </div>
    </div>
  );
}

function DeletePanelButton({ panel, store }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!window.confirm(`Delete "${panel.label}"? This removes the panel itself — the batches and any tastings already logged stay untouched.`)) return;
    setBusy(true);
    try {
      await store.deletePanel(panel.id);
    } catch (e) {
      alert(e.message || 'Could not delete — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="danger" onClick={handleClick} disabled={busy} style={{ padding: '6px 10px', fontSize: 12 }}>
      <X size={13} /> {busy ? 'Deleting…' : 'Delete'}
    </Button>
  );
}

function computeSessionProgress(sess, store) {
  const panelIds = store.sensorySessionPanels.filter(sp => sp.sensory_session_id === sess.id).map(sp => sp.panel_id);
  const participantIds = store.sensorySessionParticipants.filter(pp => pp.sensory_session_id === sess.id).map(pp => pp.user_id);
  const panelsInfo = panelIds.map(pid => store.panels.find(p => p.id === pid)).filter(Boolean);

  const batchEntries = [];
  panelsInfo.forEach(panel => {
    const bids = store.panelBatches.filter(pb => pb.panel_id === panel.id).sort((a, b) => a.sort_order - b.sort_order).map(pb => pb.batch_id);
    bids.forEach(bid => batchEntries.push({ batchId: bid, panelType: panel.panel_type, panelId: panel.id }));
  });

  let total = 0, done = 0;
  batchEntries.forEach(be => {
    participantIds.forEach(uid => {
      total++;
      if (store.sessions.some(s => s.batch_id === be.batchId && s.taster_id === uid && s.tasting_type === be.panelType)) done++;
    });
  });
  const spikes = store.spikes.filter(k => k.sensory_session_id === sess.id);
  spikes.forEach(k => participantIds.forEach(uid => {
    total++;
    if (store.spikeTastings.some(t => t.spike_id === k.id && t.taster_id === uid)) done++;
  }));

  return { panelsInfo, participantIds, batchEntries, spikes, total, done };
}

function SessionBuilder({ store }) {
  const [building, setBuilding] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [label, setLabel] = useState('');
  const [selectedPanelIds, setSelectedPanelIds] = useState([]);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState([]);
  const [busy, setBusy] = useState(false);

  const togglePanel = (id) => setSelectedPanelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleParticipant = (id) => setSelectedParticipantIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const create = async () => {
    if (selectedPanelIds.length === 0 || selectedParticipantIds.length === 0) return;
    setBusy(true);
    try {
      await store.createSensorySession({ date, label: label || `Session — ${date}`, panelIds: selectedPanelIds, participantIds: selectedParticipantIds });
      setBuilding(false); setLabel(''); setSelectedPanelIds([]); setSelectedParticipantIds([]);
    } finally {
      setBusy(false);
    }
  };

  const sortedPanels = useMemo(() => [...store.panels].sort((a, b) => b.date.localeCompare(a.date)), [store.panels]);

  return (
    <>
      <Button onClick={() => setBuilding(v => !v)}><Plus size={15} /> Build session</Button>
      {building && (
        <Card style={{ marginTop: 14, marginBottom: 20 }}>
          <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Field label="Date"><input type="date" style={inputStyle} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Label (optional)"><input style={inputStyle} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Thursday session" /></Field>
          </div>
          <Field label={`Panels to include (${selectedPanelIds.length} chosen)`}>
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sortedPanels.map(p => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: selectedPanelIds.includes(p.id) ? 'var(--surface-2)' : 'transparent' }}>
                  <input type="checkbox" checked={selectedPanelIds.includes(p.id)} onChange={() => togglePanel(p.id)} />
                  <span style={{ fontSize: 13 }}>{p.label}</span>
                  <Pill tone={p.panel_type === 'retention' ? 'warn' : 'neutral'}>{p.panel_type === 'retention' ? 'Retention' : 'TTT'}</Pill>
                </label>
              ))}
              {sortedPanels.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No panels exist yet — build one on the Panels tab first.</p>}
            </div>
          </Field>
          <Field label={`Assign participants (${selectedParticipantIds.length} chosen)`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {store.profiles.map(p => (
                <button key={p.id} type="button" onClick={() => toggleParticipant(p.id)} style={{
                  fontSize: 12, padding: '6px 10px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${selectedParticipantIds.includes(p.id) ? 'var(--accent)' : 'var(--line)'}`,
                  background: selectedParticipantIds.includes(p.id) ? '#e1f0f3' : 'transparent',
                  color: selectedParticipantIds.includes(p.id) ? 'var(--accent)' : 'var(--text-muted)',
                }}>{p.name}</button>
              ))}
            </div>
          </Field>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Button onClick={create} disabled={busy || selectedPanelIds.length === 0 || selectedParticipantIds.length === 0}>{busy ? 'Creating…' : 'Create session'}</Button>
            <Button variant="ghost" onClick={() => setBuilding(false)}>Cancel</Button>
          </div>
        </Card>
      )}
    </>
  );
}

function SessionResultBatch({ be, store, relevantTastings }) {
  const [mode, setMode] = useState('averaged');

  const batch = store.batches.find(b => b.id === be.batchId);
  const sku = batch ? store.skus.find(s => s.id === batch.sku_id) : null;
  const target = sku ? normalizeTarget(sku.target) : null;
  const tastings = relevantTastings.filter(t => t.batch_id === be.batchId && t.tasting_type === be.panelType);

  const avgScoresBySection = { aroma: {}, flavor: {} };
  ['aroma', 'flavor'].forEach(section => {
    TRAIT_TAXONOMY[section].forEach(g => g.traits.forEach(t => {
      const id = traitId(g.category, t);
      const vals = tastings.map(s => s.scores?.[section]?.[id]).filter(v => v != null);
      avgScoresBySection[section][id] = vals.length > 0 ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
    }));
  });

  const seriesBySection = {
    aroma: tastings.map(t => ({ label: store.profileName(t.taster_id), scores: t.scores?.aroma || {} })),
    flavor: tastings.map(t => ({ label: store.profileName(t.taster_id), scores: t.scores?.flavor || {} })),
  };

  return (
    <div style={{ marginBottom: 32, paddingBottom: 28, borderBottom: '1px solid var(--line)' }}>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>{batch ? batch.batch_number : '—'} — {sku ? sku.name : 'Unknown SKU'}</h3>
          <Pill tone={be.panelType === 'retention' ? 'warn' : 'neutral'}>{be.panelType === 'retention' ? 'Retention' : 'TTT'}</Pill>
        </div>
        {tastings.length > 1 && be.panelType !== 'retention' && (
          <div className="no-print" style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setMode('averaged')} style={{
              fontSize: 12, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
              border: `1px solid ${mode === 'averaged' ? 'var(--accent)' : 'var(--line)'}`,
              background: mode === 'averaged' ? '#e1f0f3' : 'transparent',
              color: mode === 'averaged' ? 'var(--accent)' : 'var(--text-muted)',
            }}>Averaged</button>
            <button type="button" onClick={() => setMode('individual')} style={{
              fontSize: 12, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
              border: `1px solid ${mode === 'individual' ? 'var(--accent)' : 'var(--line)'}`,
              background: mode === 'individual' ? '#e1f0f3' : 'transparent',
              color: mode === 'individual' ? 'var(--accent)' : 'var(--text-muted)',
            }}>Individual ({tastings.length})</button>
          </div>
        )}
      </div>

      {be.panelType !== 'retention' && <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 18 }}>
        {mode === 'averaged' ? (
          <>
            <TraitSpiderChart section="aroma" target={target ? target.aroma : null} actual={avgScoresBySection.aroma} height={420} />
            <TraitSpiderChart section="flavor" target={target ? target.flavor : null} actual={avgScoresBySection.flavor} height={420} />
          </>
        ) : (
          <>
            <MultiBatchSpiderChart section="aroma" target={target ? target.aroma : null} series={seriesBySection.aroma} height={420} />
            <MultiBatchSpiderChart section="flavor" target={target ? target.flavor : null} series={seriesBySection.flavor} height={420} />
          </>
        )}
      </div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {tastings.map(t => (
          <div key={t.id} style={{ flex: '1 1 220px', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{store.profileName(t.taster_id)}</span>
              <Pill tone={t.overall === 'pass' ? 'good' : t.overall === 'flag' ? 'warn' : 'bad'}>{t.overall}</Pill>
            </div>
            {(t.off_flavors || []).length > 0 && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--bad)' }}>{t.off_flavors.map(f => `${f.flavor} (${f.intensity}/5)`).join(', ')}</p>}
            {t.notes && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>"{t.notes}"</p>}
          </div>
        ))}
        {tastings.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No tastings recorded.</p>}
      </div>
    </div>
  );
}

function SessionResultsModal({ sess, store, onClose }) {
  const progress = computeSessionProgress(sess, store);

  const relevantTastings = useMemo(() => {
    return progress.batchEntries.flatMap(be =>
      store.sessions.filter(s => s.batch_id === be.batchId && s.tasting_type === be.panelType && progress.participantIds.includes(s.taster_id))
    );
  }, [progress, store.sessions]);

  // While the session is open, show the batches tasted so far and list the rest.
  const hasTastings = (be) => relevantTastings.some(t => t.batch_id === be.batchId && t.tasting_type === be.panelType);
  const tasted = progress.batchEntries.filter(hasTastings);
  const untasted = progress.batchEntries.filter(be => !hasTastings(be));
  const passCount = relevantTastings.filter(t => t.overall === 'pass').length;
  const flagCount = relevantTastings.filter(t => t.overall === 'flag').length;
  const failCount = relevantTastings.filter(t => t.overall === 'fail').length;
  const allOffFlavors = relevantTastings.flatMap(t => t.off_flavors || []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: '32px 20px', overflowY: 'auto' }}>
      <div className="modal-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 32, width: 1200, maxWidth: '96vw' }}>
        <div className="no-print header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Button variant="ghost" onClick={onClose}><X size={15} /> Close</Button>
          <Button onClick={() => window.print()}><Upload size={15} style={{ transform: 'rotate(180deg)' }} /> Print / Save as PDF</Button>
        </div>

        <div id="batch-report-printable">
          <div style={{ borderBottom: '2px solid var(--accent)', paddingBottom: 14, marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'var(--font-mono)' }}>Session Results</p>
            <h2 style={{ margin: '2px 0 4px', fontFamily: 'var(--font-display)', fontSize: 26 }}>{sess.label}</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              {sess.date} · Participants: {progress.participantIds.map(uid => store.profileName(uid)).join(', ') || 'none'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <Card style={{ flex: 1 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tastings</p>
              <p style={{ margin: 0, fontSize: 26, fontFamily: 'var(--font-display)' }}>{relevantTastings.length}</p>
            </Card>
            <Card style={{ flex: 1 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pass</p>
              <p style={{ margin: 0, fontSize: 26, fontFamily: 'var(--font-display)', color: 'var(--good)' }}>{passCount}</p>
            </Card>
            <Card style={{ flex: 1 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Flag</p>
              <p style={{ margin: 0, fontSize: 26, fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>{flagCount}</p>
            </Card>
            <Card style={{ flex: 1 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Fail</p>
              <p style={{ margin: 0, fontSize: 26, fontFamily: 'var(--font-display)', color: 'var(--bad)' }}>{failCount}</p>
            </Card>
          </div>

          {allOffFlavors.length > 0 && (
            <Card style={{ marginBottom: 24 }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Off-flavors noted this session</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--bad)' }}>{allOffFlavors.map(f => `${f.flavor} (${f.intensity}/5)`).join(', ')}</p>
            </Card>
          )}

          {sess.status !== 'complete' && untasted.length > 0 && (
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Results so far: the session is still open. Not tasted yet: {untasted.map(be => {
              const b = store.batches.find(x => x.id === be.batchId);
              return `${b ? b.batch_number : '?'} (${be.panelType === 'retention' ? 'retention' : 'TTT'})`;
            }).join(', ')}.</p>
          )}
          {tasted.map(be => (
            <SessionResultBatch key={`${be.batchId}-${be.panelType}`} be={be} store={store} relevantTastings={relevantTastings} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Did a taster pick up a spike? Hit: they named the spiked off-flavour. Partial: they called
// something off (another off-flavour, or flag / fail) but not that one. Miss: passed it clean.
function spikeOutcome(spike, tasting) {
  if (!tasting) return null;
  const offs = tasting.off_flavors || [];
  if (offs.some(o => o.flavor === spike.off_flavor)) return 'hit';
  if (offs.length || tasting.overall !== 'pass') return 'partial';
  return 'miss';
}
const SPIKE_OUTCOME = { hit: ['good', 'Picked it'], partial: ['warn', 'Something off'], miss: ['bad', 'Missed'] };

// Where each spike sits among a session's samples, so it doesn't always come last.
function placeSpikes(entries, spikes) {
  const out = [...entries];
  spikes.forEach(k => {
    const h = [...k.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    out.splice(h % (out.length + 1), 0, { spike: k });
  });
  return out;
}

function SpikePanel({ sess, store, progress }) {
  const [adding, setAdding] = useState(false);
  const [baseBatchId, setBaseBatchId] = useState('');
  const [offFlavor, setOffFlavor] = useState(OFF_FLAVORS[0]);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const packaged = store.batches.filter(b => b.package_date);
  const batchName = (id) => {
    const b = store.batches.find(x => x.id === id);
    const k = b ? store.skus.find(x => x.id === b.sku_id) : null;
    return b ? `${b.batch_number} — ${k ? k.name : ''}` : '—';
  };
  const pickBatch = (id) => { setBaseBatchId(id); if (!label.trim() || packaged.some(b => batchName(b.id) === label)) setLabel(id ? batchName(id) : ''); };
  const save = async () => {
    setBusy(true);
    try {
      await store.addSpike({ sessionId: sess.id, baseBatchId, offFlavor, label: label.trim(), notes });
      setAdding(false); setBaseBatchId(''); setLabel(''); setNotes('');
    } catch (e) { alert(e.message || 'Could not add — try again.'); } finally { setBusy(false); }
  };
  const remove = async (k) => {
    if (!window.confirm(`Remove the spiked "${k.label}"? Any tastings of it are deleted too.`)) return;
    try { await store.deleteSpike(k.id); } catch (e) { alert(e.message || 'Could not remove — try again.'); }
  };
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: progress.spikes.length || adding ? 8 : 0 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Spiked samples <span style={{ fontWeight: 400, textTransform: 'none' }}>· only leads see this</span></p>
        {!adding && sess.status !== 'complete' && <Button variant="ghost" onClick={() => setAdding(true)} style={{ fontSize: 11, padding: '3px 8px' }}><Plus size={12} /> Add spike</Button>}
      </div>
      {adding && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 10 }}>
          <Field label="Base beer">
            <select style={inputStyle} value={baseBatchId} onChange={e => pickBatch(e.target.value)}>
              <option value="">Pick a batch…</option>
              {packaged.map(b => <option key={b.id} value={b.id}>{batchName(b.id)}</option>)}
            </select>
          </Field>
          <Field label="Spiked with">
            <select style={inputStyle} value={offFlavor} onChange={e => setOffFlavor(e.target.value)}>
              {OFF_FLAVORS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Tasters see it as">
            <input style={inputStyle} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. 431 — Drift, or Sample X" />
          </Field>
          <Field label="Dose / notes">
            <input style={inputStyle} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. 2x threshold" />
          </Field>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <Button onClick={save} disabled={busy || !baseBatchId || !label.trim()} style={{ fontSize: 12, padding: '6px 10px' }}>{busy ? 'Saving…' : 'Add'}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)} style={{ fontSize: 12, padding: '6px 10px' }}>Cancel</Button>
          </div>
        </div>
      )}
      {progress.spikes.map(k => (
        <div key={k.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}><strong>{k.label}</strong> <span style={{ color: 'var(--text-muted)' }}>· {batchName(k.base_batch_id)} spiked with {k.off_flavor}{k.notes ? ` (${k.notes})` : ''}</span></span>
            <Button variant="ghost" onClick={() => remove(k)} style={{ fontSize: 11, padding: '3px 8px' }}><X size={12} /></Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {progress.participantIds.map(uid => {
              const o = spikeOutcome(k, store.spikeTastings.find(t => t.spike_id === k.id && t.taster_id === uid));
              return <Pill key={uid} tone={o ? SPIKE_OUTCOME[o][0] : 'neutral'}>{store.profileName(uid)}: {o ? SPIKE_OUTCOME[o][1] : 'not tasted'}</Pill>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionCard({ sess, store, isLead, currentProfile, onLogTasting, onEditTasting }) {
  const progress = computeSessionProgress(sess, store);
  const [expanded, setExpanded] = useState(!isLead);
  const [showResults, setShowResults] = useState(false);
  const [editingParticipants, setEditingParticipants] = useState(false);
  const [draftParticipantIds, setDraftParticipantIds] = useState([]);
  const [savingParticipants, setSavingParticipants] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${sess.label}"? This does not affect the underlying panels, batches, or tastings.`)) return;
    try {
      await store.deleteSensorySession(sess.id);
    } catch (e) {
      alert(e.message || 'Could not delete — try again.');
    }
  };

  const startEditingParticipants = () => {
    setDraftParticipantIds(progress.participantIds);
    setEditingParticipants(true);
  };

  const toggleDraftParticipant = (id) => setDraftParticipantIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const saveParticipants = async () => {
    setSavingParticipants(true);
    try {
      await store.updateSessionParticipants(sess.id, draftParticipantIds);
      setEditingParticipants(false);
    } catch (e) {
      alert(e.message || 'Could not update — try again.');
    } finally {
      setSavingParticipants(false);
    }
  };

  const [finishing, setFinishing] = useState(false);
  const handleFinish = async () => {
    if (!window.confirm(`Mark "${sess.label}" as complete? This works even if not everyone has finished tasting — do this if you're ready to close it out regardless.`)) return;
    setFinishing(true);
    try {
      await store.finishSensorySession(sess.id);
    } catch (e) {
      alert(e.message || 'Could not finish — try again.');
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Card>
      {showResults && <SessionResultsModal sess={sess} store={store} onClose={() => setShowResults(false)} />}
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>{sess.label}</p>
            <Pill tone={sess.status === 'complete' ? 'good' : 'warn'}>{sess.status === 'complete' ? 'Complete' : 'Open'}</Pill>
          </div>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sess.date} · {progress.done}/{progress.total} tastings done</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {sess.status === 'complete' ? (
            <Button variant="ghost" onClick={() => setShowResults(true)} style={{ fontSize: 12, padding: '6px 10px' }}>View results</Button>
          ) : (<>
            {isLead && progress.done > 0 && <Button variant="ghost" onClick={() => setShowResults(true)} style={{ fontSize: 12, padding: '6px 10px' }}>Results so far</Button>}
            <Button variant="ghost" onClick={() => setExpanded(v => !v)} style={{ fontSize: 12, padding: '6px 10px' }}>{expanded ? 'Hide' : 'View'}</Button>
          </>)}
          {isLead && sess.status !== 'complete' && <Button variant="ghost" onClick={handleFinish} disabled={finishing} style={{ fontSize: 12, padding: '6px 10px' }}>{finishing ? 'Finishing…' : 'Finish session'}</Button>}
          {isLead && <Button variant="danger" onClick={handleDelete} style={{ fontSize: 12, padding: '6px 10px' }}><X size={13} /> Delete</Button>}
        </div>
      </div>

      {isLead && (
        editingParticipants ? (
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Assigned staff</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {store.profiles.map(p => (
                <button key={p.id} type="button" onClick={() => toggleDraftParticipant(p.id)} style={{
                  fontSize: 12, padding: '6px 10px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${draftParticipantIds.includes(p.id) ? 'var(--accent)' : 'var(--line)'}`,
                  background: draftParticipantIds.includes(p.id) ? '#e1f0f3' : 'transparent',
                  color: draftParticipantIds.includes(p.id) ? 'var(--accent)' : 'var(--text-muted)',
                }}>{p.name}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={saveParticipants} disabled={savingParticipants} style={{ fontSize: 12, padding: '6px 10px' }}>{savingParticipants ? 'Saving…' : 'Save'}</Button>
              <Button variant="ghost" onClick={() => setEditingParticipants(false)} style={{ fontSize: 12, padding: '6px 10px' }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: expanded ? 12 : 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Participants: {progress.participantIds.length > 0 ? progress.participantIds.map(uid => store.profileName(uid)).join(', ') : 'none assigned'}
            <Button variant="ghost" onClick={startEditingParticipants} style={{ fontSize: 11, padding: '3px 8px' }}>Edit</Button>
          </p>
        )
      )}
      {isLead && (expanded || sess.status === 'complete' || progress.spikes.length > 0) && <SpikePanel sess={sess} store={store} progress={progress} />}

      {sess.status !== 'complete' && expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {placeSpikes(progress.batchEntries, isLead ? [] : progress.spikes).map(be => {
            if (be.spike) {
              const k = be.spike;
              const mine = store.spikeTastings.find(t => t.spike_id === k.id && t.taster_id === currentProfile.id);
              return (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6 }}>
                  <span style={{ fontSize: 13.5 }}>{k.label} <Pill tone="neutral">TTT</Pill></span>
                  {mine ? <Button variant="ghost" onClick={() => onEditTasting(mine)} style={{ fontSize: 12, padding: '6px 10px' }}>✓ Tasted — edit</Button> : (
                    <Button variant="ghost" onClick={() => onLogTasting(k.base_batch_id, 'ttt', null, k)} style={{ fontSize: 12, padding: '6px 10px' }}>Taste now <ChevronRight size={13} /></Button>
                  )}
                </div>
              );
            }
            const batch = store.batches.find(b => b.id === be.batchId);
            const sku = batch ? store.skus.find(s => s.id === batch.sku_id) : null;
            const myTasting = store.sessions.find(s => s.batch_id === be.batchId && s.taster_id === currentProfile.id && s.tasting_type === be.panelType);
            return (
              <div key={`${be.batchId}-${be.panelType}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6 }}>
                <span style={{ fontSize: 13.5 }}>{batch ? batch.batch_number : '—'} — {sku ? sku.name : ''} <Pill tone={be.panelType === 'retention' ? 'warn' : 'neutral'}>{be.panelType === 'retention' ? 'Retention' : 'TTT'}</Pill></span>
                {!isLead && (myTasting ? <Button variant="ghost" onClick={() => onEditTasting(myTasting)} style={{ fontSize: 12, padding: '6px 10px' }}>✓ Tasted — edit</Button> : (
                  <Button variant="ghost" onClick={() => onLogTasting(be.batchId, be.panelType, be.panelId)} style={{ fontSize: 12, padding: '6px 10px' }}>Taste now <ChevronRight size={13} /></Button>
                ))}
              </div>

            );
          })}
        </div>
      )}
    </Card>
  );
}

function SessionsView({ store, isLead, currentProfile, onLogTasting, onEditTasting }) {
  const mySessions = useMemo(() => {
    const ids = store.sensorySessionParticipants.filter(pp => pp.user_id === currentProfile.id).map(pp => pp.sensory_session_id);
    return store.sensorySessions.filter(s => ids.includes(s.id)).sort((a, b) => b.date.localeCompare(a.date));
  }, [store.sensorySessions, store.sensorySessionParticipants, currentProfile.id]);

  const allSessionsSorted = useMemo(() => [...store.sensorySessions].sort((a, b) => b.date.localeCompare(a.date)), [store.sensorySessions]);
  const sessionsToShow = isLead ? allSessionsSorted : mySessions;

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Sessions</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>{isLead ? 'All sensory sessions.' : "Sessions you're assigned to."}</p>
        </div>
        {isLead && <SessionBuilder store={store} />}
      </div>

      {sessionsToShow.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>{isLead ? 'No sessions yet — build one above.' : 'No sessions assigned to you right now.'}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sessionsToShow.map(sess => (
          <SessionCard key={sess.id} sess={sess} store={store} isLead={isLead} currentProfile={currentProfile} onLogTasting={onLogTasting} onEditTasting={onEditTasting} />
        ))}
      </div>
    </div>
  );
}

function PanelsView({ store, isLead, currentProfile, onLogTasting, onEditTasting }) {
  const [building, setBuilding] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayISO());
  const [panelType, setPanelType] = useState('ttt');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);

  const create = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await store.createPanel({ date, label: label || `Panel — ${date}`, batchIds: selected, panelType });
      setBuilding(false); setLabel(''); setSelected([]); setPanelType('ttt');
    } finally {
      setBusy(false);
    }
  };

  const sortedPanels = useMemo(() => [...store.panels].sort((a, b) => b.date.localeCompare(a.date)), [store.panels]);

  const panelProgress = (panel) => {
    const batchIds = store.panelBatches.filter(pb => pb.panel_id === panel.id).sort((a, b) => a.sort_order - b.sort_order).map(pb => pb.batch_id);
    const total = batchIds.length;
    const doneByMe = batchIds.filter(bid =>
      store.sessions.some(s => s.batch_id === bid && s.taster_id === currentProfile.id && s.tasting_type === panel.panel_type)
    ).length;
    return { total, doneByMe, batchIds };
  };

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Sensory panels</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>{isLead ? 'Build a panel by picking which batches need tasting.' : 'Work through your assigned panel one batch at a time.'}</p>
        </div>
        {isLead && <Button onClick={() => setBuilding(v => !v)}><Plus size={15} /> Build panel</Button>}
      </div>

      {building && (
        <Card style={{ marginBottom: 20 }}>
          <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Field label="Date"><input type="date" style={inputStyle} value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Label (optional)"><input style={inputStyle} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Tuesday panel" /></Field>
          </div>
          <Field label="Panel type">
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setPanelType('ttt')} style={{
                flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${panelType === 'ttt' ? 'var(--accent)' : 'var(--line)'}`,
                background: panelType === 'ttt' ? '#e1f0f3' : 'transparent',
                color: panelType === 'ttt' ? 'var(--accent)' : 'var(--text-muted)',
              }}>True to Type</button>
              <button type="button" onClick={() => setPanelType('retention')} style={{
                flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${panelType === 'retention' ? 'var(--accent)' : 'var(--line)'}`,
                background: panelType === 'retention' ? '#e1f0f3' : 'transparent',
                color: panelType === 'retention' ? 'var(--accent)' : 'var(--text-muted)',
              }}>Retention</button>
            </div>
          </Field>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Select batches ({selected.length} chosen)</p>
          {store.batches.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No batches yet — add some on the Batches tab first.</p>}
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            {store.batches.filter(b => b.package_date).map(b => {
              const sku = store.skus.find(s => s.id === b.sku_id);
              return (
                <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: selected.includes(b.id) ? 'var(--surface-2)' : 'transparent' }}>
                  <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggleSelect(b.id)} />
                  <span style={{ fontSize: 13.5 }}><strong>{b.batch_number}</strong> — {sku ? sku.name : 'Unknown SKU'}</span>
                  {b.package_date && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>packaged {b.package_date}</span>}
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={create} disabled={selected.length === 0 || busy}>{busy ? 'Creating…' : `Create panel with ${selected.length} batch${selected.length !== 1 ? 'es' : ''}`}</Button>
            <Button variant="ghost" onClick={() => setBuilding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {sortedPanels.length === 0 && !building && <p style={{ color: 'var(--text-muted)' }}>No panels yet.{isLead ? ' Build one to get started.' : ' Check back once your QA lead sets one up.'}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sortedPanels.map(panel => {
          const progress = panelProgress(panel);
          return (
            <Card key={panel.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>{panel.label}</p>
                    <Pill tone={panel.panel_type === 'retention' ? 'warn' : 'neutral'}>{panel.panel_type === 'retention' ? 'Retention' : 'True to Type'}</Pill>
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{panel.date} · {progress.total} batches</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Pill tone={progress.doneByMe === progress.total ? 'good' : 'warn'}>{progress.doneByMe}/{progress.total} done by you</Pill>
                  {isLead && <DeletePanelButton panel={panel} store={store} />}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {progress.batchIds.map((bid, idx) => {
                  const batch = store.batches.find(b => b.id === bid);
                  const sku = batch ? store.skus.find(s => s.id === batch.sku_id) : null;
                  const myTasting = store.sessions.find(s => s.batch_id === bid && s.taster_id === currentProfile.id && s.tasting_type === panel.panel_type);
                  const totalTastings = store.sessions.filter(s => s.batch_id === bid && s.tasting_type === panel.panel_type).length;
                  return (
                    <div key={bid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {isLead && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <button type="button" onClick={() => store.reorderPanelBatch(panel.id, bid, 'up')} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--text-faint)' : 'var(--text-muted)', padding: 0, lineHeight: 0.7 }}>▲</button>
                            <button type="button" onClick={() => store.reorderPanelBatch(panel.id, bid, 'down')} disabled={idx === progress.batchIds.length - 1} style={{ background: 'none', border: 'none', cursor: idx === progress.batchIds.length - 1 ? 'default' : 'pointer', color: idx === progress.batchIds.length - 1 ? 'var(--text-faint)' : 'var(--text-muted)', padding: 0, lineHeight: 0.7 }}>▼</button>
                          </div>
                        )}
                        <span style={{ fontSize: 13.5 }}>{batch ? batch.batch_number : '—'} — {sku ? sku.name : ''}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{totalTastings} tasting{totalTastings !== 1 ? 's' : ''} logged</span>
                        {myTasting ? <Button variant="ghost" onClick={() => onEditTasting(myTasting)} style={{ fontSize: 12, padding: '6px 10px' }}>✓ Tasted — edit</Button> : (
                          <Button variant="ghost" onClick={() => onLogTasting(bid, panel.panel_type, panel.id)} style={{ fontSize: 12, padding: '6px 10px' }}>Taste now <ChevronRight size={13} /></Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RetentionQueue({ store, onLogTasting }) {
  const rows = useMemo(() => {
    return store.retention.map(r => {
      const batch = store.batches.find(b => b.id === r.batch_id);
      const sku = batch ? store.skus.find(s => s.id === batch.sku_id) : null;
      return { ...r, batch, sku };
    }).filter(r => r.batch).sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [store.retention, store.batches, store.skus]);

  const today = todayISO();
  const overdue = rows.filter(r => !r.assessed && r.due_date < today);
  const dueSoon = rows.filter(r => !r.assessed && r.due_date >= today && daysBetween(today, r.due_date) <= 7);
  const upcoming = rows.filter(r => !r.assessed && daysBetween(today, r.due_date) > 7);
  const done = rows.filter(r => r.assessed);

  const Group = ({ title, items }) => items.length > 0 && (
    <div style={{ marginBottom: 22 }}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 10 }}>{title} · {items.length}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 16px' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{r.batch.batch_number} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {r.sku ? r.sku.name : ''}</span></p>
              <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Day {r.days} checkpoint · due {r.due_date}</p>
            </div>
            {r.assessed ? <Pill tone="good">Assessed</Pill> : <Button variant="ghost" onClick={() => onLogTasting(r.batch.id, 'retention')} style={{ fontSize: 12.5, padding: '7px 12px' }}>Log tasting <ChevronRight size={14} /></Button>}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Retention library queue</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 24px' }}>Every packaged batch gets checkpoints at {RETENTION_INTERVALS.join(' / ')} days.</p>
      {rows.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No batches in retention yet.</p>}
      <Group title="Overdue" items={overdue} />
      <Group title="Due within 7 days" items={dueSoon} />
      <Group title="Upcoming" items={upcoming} />
      <Group title="Completed" items={done} />
    </div>
  );
}

const QC_TEST_LABELS = { wild_yeast: 'Wild Yeast', b_tube: 'B Tube' };

function qcSampleLabel(sample, store) {
  if (!sample) return 'Unknown sample';
  if (sample.sample_type === 'environmental') {
    const loc = store.qcLocations.find(l => l.id === sample.location_id);
    return loc ? loc.name : 'Unknown location';
  }
  const batch = store.batches.find(b => b.id === sample.batch_id);
  const sku = batch ? store.skus.find(s => s.id === batch.sku_id) : null;
  const loc = sample.location_id ? store.qcLocations.find(l => l.id === sample.location_id) : null;
  const prefix = sample.sample_type === 'in_process' ? 'In-process · ' : '';
  return batch ? `${prefix}${batch.batch_number}${sku ? ' · ' + sku.name : ''}${loc ? ' · ' + loc.name : ''}` : 'Unknown batch';
}

function LogQcSampleModal({ store, onClose }) {
  const [sampleType, setSampleType] = useState('batch');
  const [batchId, setBatchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const activeLocations = useMemo(() => store.qcLocations.filter(l => l.active), [store.qcLocations]);
  const sortedBatches = useMemo(() => [...store.batches].sort((a, b) => Number(b.batch_number) - Number(a.batch_number)), [store.batches]);
  const canSubmit = sampleType === 'environmental' ? !!locationId : !!batchId;

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await store.addQcSample({
        sampleType,
        batchId: sampleType !== 'environmental' ? batchId : null,
        locationId: (sampleType === 'environmental' || sampleType === 'in_process') ? (locationId || null) : null,
        notes,
      });
      setDone(true);
    } catch (e) {
      setError(e.message || 'Could not save — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div className="modal-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, width: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>Log a QC sample</h3>
          <X size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={onClose} />
        </div>

        {done ? (
          <div style={{ padding: '12px 0' }}>
            <p style={{ fontSize: 14, marginBottom: 6 }}>Sample logged — Wild Yeast and B Tube reads are due {addDays(todayISO(), QC_READ_DAYS)}.</p>
            <Button onClick={onClose} style={{ marginTop: 8 }}>Done</Button>
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 14px' }}>Creates a Wild Yeast and a B Tube read, both due in {QC_READ_DAYS} days.</p>
            <Field label="Sample source">
              <div style={{ display: 'flex', gap: 8 }}>
                {[['batch', 'Packaged batch'], ['in_process', 'In-process'], ['environmental', 'Environmental']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => { setSampleType(val); setBatchId(''); setLocationId(''); }} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${sampleType === val ? 'var(--accent)' : 'var(--line)'}`,
                    background: sampleType === val ? '#e1f0f3' : 'transparent',
                    color: sampleType === val ? 'var(--accent)' : 'var(--text-muted)',
                  }}>{label}</button>
                ))}
              </div>
            </Field>
            {sampleType === 'environmental' ? (
              <Field label="Location">
                <select style={inputStyle} value={locationId} onChange={e => setLocationId(e.target.value)}>
                  <option value="">Select a location…</option>
                  {activeLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            ) : (
              <>
                <Field label="Batch">
                  <select style={inputStyle} value={batchId} onChange={e => setBatchId(e.target.value)}>
                    <option value="">Select a batch…</option>
                    {sortedBatches.map(b => {
                      const sku = store.skus.find(s => s.id === b.sku_id);
                      return <option key={b.id} value={b.id}>{b.batch_number}{sku ? ` — ${sku.name}` : ''}</option>;
                    })}
                  </select>
                </Field>
                {sampleType === 'in_process' && (
                  <Field label="Location (optional) — where in the process">
                    <select style={inputStyle} value={locationId} onChange={e => setLocationId(e.target.value)}>
                      <option value="">Not specified</option>
                      {activeLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </Field>
                )}
              </>
            )}
            <Field label="Notes (optional)">
              <textarea style={{ ...inputStyle, minHeight: 60, fontFamily: 'var(--font-body)' }} value={notes} onChange={e => setNotes(e.target.value)} />
            </Field>
            {error && <p style={{ color: 'var(--bad)', fontSize: 12.5, marginBottom: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <Button onClick={submit} disabled={!canSubmit || busy}>{busy ? 'Saving…' : 'Log sample'}</Button>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QcTestRow({ test, sample, store }) {
  const [logging, setLogging] = useState(false);
  const [result, setResult] = useState('negative');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await store.logQcResult({ testId: test.id, result, notes });
      setLogging(false); setNotes(''); setResult('negative');
    } catch (e) {
      setError(e.message || 'Could not save — try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSample = async () => {
    if (!window.confirm('Delete this sample and both its tests? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await store.deleteQcSample(sample.id);
    } catch (e) {
      alert(e.message || 'Could not delete — try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{qcSampleLabel(sample, store)}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {QC_TEST_LABELS[test.test_type]} · due {test.due_date}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {test.result === 'pending' ? (
            <>
              <Pill tone="warn">Pending</Pill>
              <Button variant="ghost" onClick={() => setLogging(v => !v)} style={{ fontSize: 12.5, padding: '7px 12px' }}>Log read</Button>
            </>
          ) : (
            <Pill tone={test.result === 'negative' ? 'good' : 'bad'}>{test.result === 'negative' ? 'Negative' : 'Positive'}</Pill>
          )}
          <Button variant="danger" onClick={handleDeleteSample} disabled={deleting} style={{ fontSize: 11, padding: '6px 8px' }}><X size={12} /></Button>
        </div>
      </div>

      {logging && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 14, marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => setResult('negative')} style={{
              flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${result === 'negative' ? 'var(--good)' : 'var(--line)'}`,
              background: result === 'negative' ? '#e3f1e5' : 'transparent',
              color: result === 'negative' ? 'var(--good)' : 'var(--text-muted)',
            }}>Negative</button>
            <button type="button" onClick={() => setResult('positive')} style={{
              flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${result === 'positive' ? 'var(--bad)' : 'var(--line)'}`,
              background: result === 'positive' ? '#fdecea' : 'transparent',
              color: result === 'positive' ? 'var(--bad)' : 'var(--text-muted)',
            }}>Positive</button>
          </div>
          <textarea style={{ ...inputStyle, minHeight: 60, fontFamily: 'var(--font-body)', marginBottom: 10 }}
            value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          {error && <p style={{ color: 'var(--bad)', fontSize: 12.5, marginBottom: 8 }}>{error}</p>}
          <Button onClick={submit} disabled={busy} style={{ fontSize: 12.5 }}>{busy ? 'Saving…' : 'Submit read'}</Button>
        </div>
      )}
    </div>
  );
}

function QcLocationsAdmin({ store }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const addLocation = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await store.addQcLocation({ name: newName.trim(), sortOrder: store.qcLocations.length + 1 });
      setNewName(''); setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (loc) => {
    const name = window.prompt('Rename location', loc.name);
    if (!name || !name.trim() || name.trim() === loc.name) return;
    await store.updateQcLocation(loc.id, { name: name.trim() });
  };

  const toggleActive = async (loc) => {
    await store.updateQcLocation(loc.id, { active: !loc.active });
  };

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>Environmental locations</p>
        <Button variant="ghost" onClick={() => setAdding(v => !v)} style={{ fontSize: 12, padding: '6px 10px' }}><Plus size={13} /> Add location</Button>
      </div>
      {adding && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={inputStyle} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Location name" />
          <Button onClick={addLocation} disabled={!newName.trim() || busy} style={{ fontSize: 12.5 }}>{busy ? '…' : 'Add'}</Button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...store.qcLocations].sort((a, b) => a.sort_order - b.sort_order).map(loc => (
          <Card key={loc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, opacity: loc.active ? 1 : 0.5 }}>{loc.name}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" onClick={() => rename(loc)} style={{ fontSize: 11.5, padding: '5px 9px' }}>Rename</Button>
              <Button variant="ghost" onClick={() => toggleActive(loc)} style={{ fontSize: 11.5, padding: '5px 9px' }}>{loc.active ? 'Deactivate' : 'Activate'}</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function QcView({ store }) {
  const [showLogModal, setShowLogModal] = useState(false);

  const rows = useMemo(() => {
    return store.qcTests
      .map(t => {
        const sample = store.qcSamples.find(s => s.id === t.sample_id);
        return sample ? { ...t, sample } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [store.qcTests, store.qcSamples]);

  const today = todayISO();
  const overdue = rows.filter(r => r.result === 'pending' && r.due_date < today);
  const dueSoon = rows.filter(r => r.result === 'pending' && r.due_date >= today && daysBetween(today, r.due_date) <= 2);

  const Group = ({ title, items }) => items.length > 0 && (
    <div style={{ marginBottom: 22 }}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 10 }}>{title} · {items.length}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(r => <QcTestRow key={r.id} test={r} sample={r.sample} store={store} />)}
      </div>
    </div>
  );

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Log Sample</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>FastOrange Wild Yeast + B Tube reads, due {QC_READ_DAYS} days after a sample is pulled.</p>
        </div>
        <Button onClick={() => setShowLogModal(true)}><Plus size={15} /> Log sample</Button>
      </div>

      {overdue.length === 0 && dueSoon.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nothing needs urgent attention right now — check Incubating for everything still pending.</p>}
      <Group title="Overdue" items={overdue} />
      <Group title="Due within 2 days" items={dueSoon} />

      {showLogModal && <LogQcSampleModal store={store} onClose={() => setShowLogModal(false)} />}
    </div>
  );
}

function TestTubeIcon({ status }) {
  const fill = status === 'overdue' ? 'var(--bad)' : status === 'soon' ? 'var(--accent)' : 'var(--teal)';
  return (
    <svg width="30" height="64" viewBox="0 0 30 64">
      <rect x="7" y="2" width="16" height="6" rx="2" fill="var(--line)" />
      <path d="M9 8 L9 46 A6 6 0 0 0 21 46 L21 8" fill="none" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
      <path d="M9.5 24 L9.5 46 A5.5 5.5 0 0 0 20.5 46 L20.5 24 Z" fill={fill} opacity="0.85" />
    </svg>
  );
}

function IncubatingView({ store }) {
  const pending = useMemo(() => {
    return store.qcTests
      .filter(t => t.result === 'pending')
      .map(t => {
        const sample = store.qcSamples.find(s => s.id === t.sample_id);
        return sample ? { ...t, sample } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [store.qcTests, store.qcSamples]);

  const today = todayISO();
  const statusFor = (dueDate) => {
    const days = daysBetween(today, dueDate);
    if (days < 0) return 'overdue';
    if (days <= 2) return 'soon';
    return 'upcoming';
  };

  const handleDelete = async (sampleId) => {
    if (!window.confirm('Delete this sample and both its tests? This cannot be undone.')) return;
    try {
      await store.deleteQcSample(sampleId);
    } catch (e) {
      alert(e.message || 'Could not delete — try again.');
    }
  };

  return (
    <div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Incubating</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 24px' }}>Every FastOrange read still pending, at a glance.</p>
      {pending.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Nothing incubating right now.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
          {pending.map(t => {
            const status = statusFor(t.due_date);
            const days = daysBetween(today, t.due_date);
            return (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 130, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 10px 10px' }}>
                <TestTubeIcon status={status} />
                <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{qcSampleLabel(t.sample, store)}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{QC_TEST_LABELS[t.test_type]}</p>
                <p style={{ margin: '2px 0 8px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: status === 'overdue' ? 'var(--bad)' : status === 'soon' ? 'var(--accent)' : 'var(--text-faint)' }}>
                  {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'due today' : `${days}d left`}
                </p>
                <Button variant="danger" onClick={() => handleDelete(t.sample.id)} style={{ fontSize: 10.5, padding: '4px 8px' }}><X size={11} /></Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function exportQcResultsCSV(store) {
  const rows = store.qcTests
    .slice()
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
    .map(t => {
      const sample = store.qcSamples.find(s => s.id === t.sample_id);
      return {
        'Sample Type': sample ? sample.sample_type : '',
        Sample: qcSampleLabel(sample, store),
        'Pulled Date': sample ? sample.pulled_date : '',
        'Pulled By': sample ? store.profileName(sample.pulled_by) : '',
        'Test Type': QC_TEST_LABELS[t.test_type] || t.test_type,
        'Due Date': t.due_date,
        Result: t.result,
        'Read Date': t.read_date || '',
        'Read By': t.read_by ? store.profileName(t.read_by) : '',
        Notes: t.notes || '',
      };
    });
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qc-results-export-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function QcDashboard({ store }) {
  const allTests = store.qcTests;
  const pending = allTests.filter(t => t.result === 'pending').length;
  const positive = allTests.filter(t => t.result === 'positive').length;
  const today = todayISO();
  const overdue = allTests.filter(t => t.result === 'pending' && t.due_date < today).length;

  const bySampleType = useMemo(() => {
    const counts = { batch: 0, in_process: 0, environmental: 0 };
    store.qcSamples.forEach(s => { if (counts[s.sample_type] != null) counts[s.sample_type]++; });
    return counts;
  }, [store.qcSamples]);

  const recentPositives = useMemo(() => {
    return allTests
      .filter(t => t.result === 'positive')
      .sort((a, b) => (b.read_date || '').localeCompare(a.read_date || ''))
      .slice(0, 10)
      .map(t => ({ ...t, sample: store.qcSamples.find(s => s.id === t.sample_id) }));
  }, [allTests, store.qcSamples]);

  const stat = (label, value, tone) => (
    <Card style={{ flex: 1 }}>
      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 30, fontFamily: 'var(--font-display)', color: tone || 'var(--text)' }}>{value}</p>
    </Card>
  );

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: 0 }}>QC Dashboard</h3>
        <Button variant="ghost" onClick={() => exportQcResultsCSV(store)} disabled={store.qcTests.length === 0}>
          <Upload size={15} style={{ transform: 'rotate(180deg)' }} /> Export results (CSV)
        </Button>
      </div>
      <div className="dashboard-stats" style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {stat('Samples logged', store.qcSamples.length)}
        {stat('Tests pending', pending)}
        {stat('Overdue', overdue, overdue > 0 ? 'var(--bad)' : 'var(--good)')}
        {stat('Positive results', positive, positive > 0 ? 'var(--bad)' : 'var(--good)')}
      </div>
      <Card style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Samples by source</p>
        <div style={{ display: 'flex', gap: 24 }}>
          <span style={{ fontSize: 13.5 }}><strong>{bySampleType.batch}</strong> packaged batch</span>
          <span style={{ fontSize: 13.5 }}><strong>{bySampleType.in_process}</strong> in-process</span>
          <span style={{ fontSize: 13.5 }}><strong>{bySampleType.environmental}</strong> environmental</span>
        </div>
      </Card>
      <Card>
        <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Recent positive results</p>
        {recentPositives.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No positives logged — clean record so far.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentPositives.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                <span style={{ fontSize: 13 }}>{qcSampleLabel(t.sample, store)} <span style={{ color: 'var(--text-faint)' }}>· {QC_TEST_LABELS[t.test_type]}</span></span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t.read_date}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function QcLocationsTab({ store }) {
  return (
    <div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Locations</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 20px' }}>Environmental sampling points and in-process sampling locations.</p>
      <QcLocationsAdmin store={store} />
    </div>
  );
}

function ImportBatchesModal({ store, onClose }) {
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const doImport = async () => {
    const parsed = Papa.parse(rawText.trim(), { header: true, skipEmptyLines: true });
    if (parsed.errors.length && parsed.data.length === 0) {
      setError('Could not parse that. Make sure you copied the header row along with the data.');
      return;
    }
    const rows = parsed.data
      .map(r => ({
        batchNumber: (r['Batch Number'] || '').trim(),
        skuName: (r['SKU Name'] || '').trim(),
        dateBrewed: (r['Date Brewed'] || '').trim(),
        packagedDate: (r['Packaged Date'] || r['Package Date'] || '').trim(),
      }))
      .filter(r => r.batchNumber && /^\d+$/.test(r.batchNumber) && r.skuName && CORE_BEERS.includes(r.skuName));
    setBusy(true); setError('');
    try {
      const summary = await store.importBatches(rows);
      setResult(summary);
    } catch (e) {
      setError(e.message || 'Could not import.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
      <div className="modal-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, width: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>Import batches from a sheet</h3>
          <X size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={onClose} />
        </div>

        {result ? (
          <div style={{ padding: '12px 0' }}>
            <p style={{ fontSize: 14, marginBottom: 6 }}>Import complete.</p>
            <ul style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              <li><strong style={{ color: 'var(--text)' }}>{result.added}</strong> batches added (new SKUs auto-created where needed — check their TTT profiles)</li>
              {result.skipped > 0 && <li><strong style={{ color: 'var(--text)' }}>{result.skipped}</strong> skipped — batch number already exists</li>}
            </ul>
            <Button onClick={onClose} style={{ marginTop: 8 }}>Done</Button>
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 14px' }}>Paste your Batch Log rows (including the header row): Batch Number, SKU Name, Date Brewed, Packaged Date.</p>
            <textarea style={{ ...inputStyle, minHeight: 160, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder={'Batch Number\tSKU Name\tDate Brewed\tPackaged Date\n363\tKolsch\t2026-06-16\t2026-07-06'}
              value={rawText} onChange={e => setRawText(e.target.value)} />
            {error && <p style={{ color: 'var(--bad)', fontSize: 12.5, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button onClick={doImport} disabled={!rawText.trim() || busy}>{busy ? 'Importing…' : 'Import'}</Button>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TeamManagement({ store, currentProfile }) {
  const [busyId, setBusyId] = useState(null);
  const sortedProfiles = useMemo(() => [...store.profiles].sort((a, b) => a.name.localeCompare(b.name)), [store.profiles]);

  const toggleRole = async (profile) => {
    const newRole = profile.role === 'lead' ? 'staff' : 'lead';
    if (!window.confirm(`Change ${profile.name} to ${newRole === 'lead' ? 'QA Lead' : 'Staff'}?`)) return;
    setBusyId(profile.id);
    try {
      await store.updateProfileRole(profile.id, newRole);
    } catch (e) {
      alert(e.message || 'Could not update — try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Team</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 20px' }}>Manage who has QA lead access. You can't change your own role here — ask another lead if needed.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sortedProfiles.map(p => (
          <Card key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{p.name} {p.id === currentProfile.id && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(you)</span>}</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{p.email}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill tone={p.role === 'lead' ? 'good' : 'neutral'}>{p.role === 'lead' ? 'QA Lead' : 'Staff'}</Pill>
              {p.id !== currentProfile.id && (
                <Button variant="ghost" onClick={() => toggleRole(p)} disabled={busyId === p.id} style={{ fontSize: 12, padding: '6px 10px' }}>
                  {busyId === p.id ? '…' : `Make ${p.role === 'lead' ? 'Staff' : 'QA Lead'}`}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PackagingSignOffView({ store, currentProfile }) {
  // Only beer sitting in a brite tank right now (from the production app), not yet packaged.
  const [inBrite, setInBrite] = useState(null);
  useEffect(() => {
    supabase.from('batches').select('id, batch_number, tanks!inner(tank_type)').eq('tanks.tank_type', 'BBT')
      .in('status', ['planned', 'brewing', 'fermenting', 'chilling', 'conditioning'])
      .then(({ data }) => setInBrite({ ids: new Set((data || []).map(b => b.id)), numbers: new Set((data || []).map(b => String(b.batch_number))) }));
  }, []);
  const briteBatches = useMemo(() =>
    store.batches
      .filter(b => inBrite && (inBrite.ids.has(b.production_batch_id) || inBrite.numbers.has(String(b.batch_number))))
      // Green-lit batches drop off; red or untasted ones stay.
      .filter(b => [...store.briteChecks].filter(c => c.batch_id === b.id).sort((x, y) => y.created_at.localeCompare(x.created_at))[0]?.decision !== 'green')
      .sort((a, b) => Number(b.batch_number) - Number(a.batch_number)),
    [store.batches, store.briteChecks, inBrite]
  );

  return (
    <div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Packaging sign off</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 20px' }}>Batches sitting in Brite tank, awaiting clearance to package. Taste and give it a green or red light.</p>

      {briteBatches.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Nothing waiting on sign off right now.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {briteBatches.map(b => (
            <BriteBatchCard key={b.id} batch={b} store={store} currentProfile={currentProfile} />
          ))}
        </div>
      )}

    </div>
  );
}

function BriteHistoryCard({ batch, store }) {
  const sku = store.skus.find(s => s.id === batch.sku_id);
  const checks = store.briteChecks.filter(c => c.batch_id === batch.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = checks[0];

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{batch.batch_number} — {sku ? sku.name : 'Unknown SKU'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Packaged {batch.package_date} · {checks.length} check{checks.length !== 1 ? 's' : ''}</p>
        </div>
        {latest && <Pill tone={latest.decision === 'green' ? 'good' : 'bad'}>{latest.decision === 'green' ? 'Green light' : 'Red light'}</Pill>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {checks.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            <span style={{ color: 'var(--text-muted)' }}>{store.profileName(c.taster_id)} · {c.date}{c.notes ? ` — "${c.notes}"` : ''}</span>
            <Pill tone={c.decision === 'green' ? 'good' : 'bad'}>{c.decision === 'green' ? 'Green' : 'Red'}</Pill>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BriteBatchCard({ batch, store, currentProfile }) {
  const sku = store.skus.find(s => s.id === batch.sku_id);
  const checks = store.briteChecks.filter(c => c.batch_id === batch.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = checks[0];

  const [logging, setLogging] = useState(false);
  const [decision, setDecision] = useState('green');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await store.addBriteCheck({ batchId: batch.id, decision, notes });
      setLogging(false); setNotes(''); setDecision('green');
    } catch (e) {
      setError(e.message || 'Could not save — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{batch.batch_number} — {sku ? sku.name : 'Unknown SKU'}</p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{checks.length} check{checks.length !== 1 ? 's' : ''} logged</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {latest ? (
            <Pill tone={latest.decision === 'green' ? 'good' : 'bad'}>{latest.decision === 'green' ? 'Green light' : 'Red light'}</Pill>
          ) : (
            <Pill tone="warn">Pending</Pill>
          )}
          <Button variant="ghost" onClick={() => setLogging(v => !v)} style={{ fontSize: 12.5, padding: '7px 12px' }}>Log check</Button>
        </div>
      </div>

      {logging && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 14, marginBottom: checks.length > 0 ? 12 : 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => setDecision('green')} style={{
              flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${decision === 'green' ? 'var(--good)' : 'var(--line)'}`,
              background: decision === 'green' ? '#e3f1e5' : 'transparent',
              color: decision === 'green' ? 'var(--good)' : 'var(--text-muted)',
            }}>Green light</button>
            <button type="button" onClick={() => setDecision('red')} style={{
              flex: 1, padding: '9px 0', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${decision === 'red' ? 'var(--bad)' : 'var(--line)'}`,
              background: decision === 'red' ? '#fdecea' : 'transparent',
              color: decision === 'red' ? 'var(--bad)' : 'var(--text-muted)',
            }}>Red light</button>
          </div>
          <textarea style={{ ...inputStyle, minHeight: 60, fontFamily: 'var(--font-body)', marginBottom: 10 }}
            value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          {error && <p style={{ color: 'var(--bad)', fontSize: 12.5, marginBottom: 8 }}>{error}</p>}
          <Button onClick={submit} disabled={busy} style={{ fontSize: 12.5 }}>{busy ? 'Saving…' : 'Submit check'}</Button>
        </div>
      )}

      {checks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {checks.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <span style={{ color: 'var(--text-muted)' }}>{store.profileName(c.taster_id)} · {c.date}{c.notes ? ` — "${c.notes}"` : ''}</span>
              <Pill tone={c.decision === 'green' ? 'good' : 'bad'}>{c.decision === 'green' ? 'Green' : 'Red'}</Pill>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BatchReportModal({ batch, store, onClose }) {
  const sku = store.skus.find(s => s.id === batch.sku_id);
  const target = sku ? normalizeTarget(sku.target) : null;
  const allSessions = store.sessions.filter(s => s.batch_id === batch.id).sort((a, b) => a.date.localeCompare(b.date));
  const ttSessions = allSessions.filter(s => s.tasting_type === 'ttt');
  const checkpoints = store.retention.filter(r => r.batch_id === batch.id).sort((a, b) => a.days - b.days);
  const briteChecks = store.briteChecks.filter(c => c.batch_id === batch.id).sort((a, b) => a.created_at.localeCompare(b.created_at));

  const avgTtScores = (section) => {
    const out = {};
    TRAIT_TAXONOMY[section].forEach(g => g.traits.forEach(t => {
      const id = traitId(g.category, t);
      const vals = ttSessions.map(s => s.scores?.[section]?.[id]).filter(v => v != null);
      out[id] = vals.length > 0 ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
    }));
    return out;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: '32px 20px', overflowY: 'auto' }}>
      <div className="modal-card" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 32, width: 760, maxWidth: '100%' }}>
        <div className="no-print header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Button variant="ghost" onClick={onClose}><X size={15} /> Close</Button>
          <Button onClick={() => window.print()}><Upload size={15} style={{ transform: 'rotate(180deg)' }} /> Print / Save as PDF</Button>
        </div>

        <div id="batch-report-printable">
          <div style={{ borderBottom: '2px solid var(--accent)', paddingBottom: 14, marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'var(--font-mono)' }}>Batch QA Report</p>
            <h2 style={{ margin: '2px 0 4px', fontFamily: 'var(--font-display)', fontSize: 26 }}>{batch.batch_number} — {sku ? sku.name : 'Unknown SKU'}</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              {sku ? `${sku.style} · ${sku.abv}% ABV` : ''} · {batch.format} · Packaged {batch.package_date || 'not yet packaged'}
            </p>
          </div>

          {briteChecks.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Packaging sign off</p>
              {briteChecks.map(c => (
                <p key={c.id} style={{ margin: '0 0 4px', fontSize: 13 }}>
                  {c.date} — {store.profileName(c.taster_id)}: <strong style={{ color: c.decision === 'green' ? 'var(--good)' : 'var(--bad)' }}>{c.decision === 'green' ? 'Green light' : 'Red light'}</strong>
                  {c.notes ? ` — "${c.notes}"` : ''}
                </p>
              ))}
            </div>
          )}

          {sku && (
            <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              {Object.keys(SECTION_LABELS).map(sec => (
                <div key={sec}>
                  <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', textAlign: 'center' }}>{SECTION_LABELS[sec]} (avg vs target)</p>
                  <TraitSpiderChart section={sec} target={target[sec]} actual={avgTtScores(sec)} height={260} />
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Retention schedule</p>
            {checkpoints.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No retention checkpoints.</p> : (
              <div style={{ display: 'flex', gap: 8 }}>
                {checkpoints.map(c => (
                  <span key={c.id} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', padding: '4px 10px', borderRadius: 5, background: c.assessed ? '#e3f1e5' : 'var(--surface-2)', color: c.assessed ? 'var(--good)' : 'var(--text-muted)' }}>
                    Day {c.days} — {c.assessed ? 'Assessed' : `due ${c.due_date}`}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>All tastings ({allSessions.length})</p>
            {allSessions.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No tastings logged yet.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allSessions.map(s => (
                  <div key={s.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{s.date} — {store.profileName(s.taster_id)} ({s.tasting_type === 'retention' ? 'Retention' : 'TTT'})</span>
                      <Pill tone={s.overall === 'pass' ? 'good' : s.overall === 'flag' ? 'warn' : 'bad'}>{s.overall}</Pill>
                    </div>
                    {(s.off_flavors || []).length > 0 && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--bad)' }}>{s.off_flavors.map(f => `${f.flavor} (${f.intensity}/5)`).join(', ')}</p>}
                    {s.notes && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>"{s.notes}"</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchView({ store }) {
  const [query, setQuery] = useState('');
  const [reportBatch, setReportBatch] = useState(null);
  const q = query.trim().toLowerCase();

  const matchingBatches = useMemo(() => {
    if (!q) return [];
    return store.batches
      .filter(b => {
        const sku = store.skus.find(s => s.id === b.sku_id);
        return b.batch_number.toLowerCase().includes(q) || (sku && sku.name.toLowerCase().includes(q));
      })
      .sort((a, b) => Number(b.batch_number) - Number(a.batch_number))
      .slice(0, 30);
  }, [q, store.batches, store.skus]);

  const matchingTastings = useMemo(() => {
    if (!q) return [];
    return store.sessions
      .filter(s => {
        const batch = store.batches.find(b => b.id === s.batch_id);
        const sku = batch ? store.skus.find(x => x.id === batch.sku_id) : null;
        const hay = [
          batch ? batch.batch_number : '',
          sku ? sku.name : '',
          store.profileName(s.taster_id),
          s.notes || '',
          ...(s.off_flavors || []).map(f => f.flavor),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);
  }, [q, store.sessions, store.batches, store.skus]);

  return (
    <div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Search</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '0 0 20px' }}>Find a batch or tasting by batch number, SKU, taster, notes, or off-flavor.</p>
      <input
        style={{ ...inputStyle, marginBottom: 20, fontSize: 15, padding: '12px 14px' }}
        value={query} onChange={e => setQuery(e.target.value)}
        placeholder="e.g. 385, Kolsch, diacetyl, Sarah…" autoFocus
      />

      {reportBatch && <BatchReportModal batch={reportBatch} store={store} onClose={() => setReportBatch(null)} />}

      {!q ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 13.5 }}>Start typing to search.</p>
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Batches ({matchingBatches.length})</p>
            {matchingBatches.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No matching batches.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {matchingBatches.map(b => {
                  const sku = store.skus.find(s => s.id === b.sku_id);
                  return (
                    <div key={b.id} onClick={() => setReportBatch(b)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6, cursor: 'pointer' }}>
                      <span style={{ fontSize: 13.5 }}><strong>{b.batch_number}</strong> — {sku ? sku.name : 'Unknown SKU'}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{b.package_date ? `packaged ${b.package_date}` : 'in brite tank'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tastings ({matchingTastings.length})</p>
            {matchingTastings.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No matching tastings.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {matchingTastings.map(s => {
                  const batch = store.batches.find(b => b.id === s.batch_id);
                  const sku = batch ? store.skus.find(x => x.id === batch.sku_id) : null;
                  return (
                    <div key={s.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{batch ? batch.batch_number : '—'} — {sku ? sku.name : ''} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {s.date} · {store.profileName(s.taster_id)} · {s.tasting_type === 'retention' ? 'Retention' : 'TTT'}</span></span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Pill tone={s.overall === 'pass' ? 'good' : s.overall === 'flag' ? 'warn' : 'bad'}>{s.overall}</Pill>
                          {batch && <Button variant="ghost" onClick={() => setReportBatch(batch)} style={{ fontSize: 11, padding: '4px 8px' }}>View batch</Button>}
                        </div>
                      </div>
                      {(s.off_flavors || []).length > 0 && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--bad)' }}>{s.off_flavors.map(f => `${f.flavor} (${f.intensity}/5)`).join(', ')}</p>}
                      {s.notes && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>"{s.notes}"</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function BatchesView({ store, isLead }) {
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [reportBatch, setReportBatch] = useState(null);
  const [form, setForm] = useState({ skuId: '', batchNumber: '', packageDate: todayISO(), format: 'Can' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!form.skuId && store.skus[0]) setForm(f => ({ ...f, skuId: store.skus[0].id })); }, [store.skus]);

  const add = async () => {
    if (!form.skuId || !form.batchNumber) return;
    setBusy(true); setError('');
    try {
      await store.addBatch(form);
      setForm({ skuId: store.skus[0]?.id || '', batchNumber: '', packageDate: todayISO(), format: 'Can' });
      setShowNew(false);
    } catch (e) {
      setError(e.message || 'Could not add batch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Batches</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>Packaged batches and their tasting history.</p>
        </div>
        {isLead && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setShowImport(true)}><Upload size={15} /> Import from sheet</Button>
            <Button onClick={() => setShowNew(v => !v)}><Plus size={15} /> New batch</Button>
          </div>
        )}
      </div>

      {showImport && <ImportBatchesModal store={store} onClose={() => setShowImport(false)} />}
      {reportBatch && <BatchReportModal batch={reportBatch} store={store} onClose={() => setReportBatch(null)} />}

      {showNew && (
        <Card style={{ marginBottom: 20 }}>
          <div className="batch-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <Field label="SKU"><select style={inputStyle} value={form.skuId} onChange={e => setForm(f => ({ ...f, skuId: e.target.value }))}>
              {store.skus.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></Field>
            <Field label="Batch #"><input style={inputStyle} value={form.batchNumber} onChange={e => setForm(f => ({ ...f, batchNumber: e.target.value }))} /></Field>
            <Field label="Package date"><input type="date" style={inputStyle} value={form.packageDate} onChange={e => setForm(f => ({ ...f, packageDate: e.target.value }))} /></Field>
            <Field label="Format"><select style={inputStyle} value={form.format} onChange={e => setForm(f => ({ ...f, format: e.target.value }))}>
              <option>Can</option><option>Bottle</option><option>Keg</option>
            </select></Field>
            <Button onClick={add} disabled={busy} style={{ marginBottom: 14 }}>{busy ? 'Adding…' : 'Add'}</Button>
          </div>
          {error && <p style={{ color: 'var(--bad)', fontSize: 12.5 }}>{error}</p>}
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {store.batches.filter(b => b.package_date).map(b => {
          const sku = store.skus.find(s => s.id === b.sku_id);
          const sessions = store.sessions.filter(s => s.batch_id === b.id);
          const flagged = sessions.filter(s => s.overall !== 'pass').length;
          const checkpoints = store.retention.filter(r => r.batch_id === b.id);
          return (
            <Card key={b.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{b.batch_number}</p>
                  <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{sku ? sku.name : 'Unknown SKU'} · {b.format} · packaged {b.package_date || '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Pill>{sessions.length} tasting{sessions.length !== 1 ? 's' : ''}</Pill>
                  {flagged > 0 && <Pill tone="bad">{flagged} flagged</Pill>}
                  <Button variant="ghost" onClick={() => setReportBatch(b)} style={{ padding: '5px 10px', fontSize: 11.5 }}>Report</Button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {checkpoints.map(r => (
                  <span key={r.id} title={`Day ${r.days} — ${r.due_date}`} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 8px', borderRadius: 4, background: r.assessed ? '#e3f1e5' : 'var(--surface-2)', color: r.assessed ? 'var(--good)' : 'var(--text-faint)' }}>D{r.days} {r.assessed ? '✓' : ''}</span>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SkuEditor({ sku, onCancel, onSave, busy }) {
  const [s, setS] = useState({ ...sku, target: normalizeTarget(sku.target) });
  const [activeSection, setActiveSection] = useState('aroma');
  const setTraitTarget = (section, id, v) => setS(x => ({ ...x, target: { ...x.target, [section]: { ...x.target[section], [id]: v } } }));

  return (
    <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 24 }}>
      <Card>
        <h3 style={{ margin: '0 0 16px', fontFamily: 'var(--font-display)', fontSize: 18 }}>{sku.name ? `Edit ${sku.name}` : 'New SKU'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="Name"><input style={inputStyle} value={s.name} onChange={e => setS(x => ({ ...x, name: e.target.value }))} /></Field>
          <Field label="ABV %"><input type="number" step="0.1" style={inputStyle} value={s.abv} onChange={e => setS(x => ({ ...x, abv: Number(e.target.value) }))} /></Field>
        </div>
        <Field label="Style"><input style={inputStyle} value={s.style} onChange={e => setS(x => ({ ...x, style: e.target.value }))} /></Field>
        <Field label="Reference notes"><textarea style={{ ...inputStyle, minHeight: 70, fontFamily: 'var(--font-body)' }} value={s.notes} onChange={e => setS(x => ({ ...x, notes: e.target.value }))} /></Field>
        <Field label="Key descriptors"><TagInput values={s.descriptors} onChange={v => setS(x => ({ ...x, descriptors: v }))} placeholder="e.g. caramel, add & press enter" /></Field>
        <Field label="Off-flavor watch-outs"><TagInput values={s.watchouts} onChange={v => setS(x => ({ ...x, watchouts: v }))} placeholder="e.g. diacetyl, add & press enter" /></Field>
        <Field label={`Tolerance band (± ${s.tolerance} — how far a tasting can be from target before it's flagged)`}>
          <input type="range" min={0} max={8} step={2} value={s.tolerance} onChange={e => setS(x => ({ ...x, tolerance: Number(e.target.value) }))} style={{ width: '100%' }} />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button onClick={() => onSave(s)} disabled={!s.name || busy}>{busy ? 'Saving…' : <><Check size={15} /> Save profile</>}</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </Card>
      <Card>
        <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target profile</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {Object.keys(SECTION_LABELS).map(sec => (
            <button key={sec} type="button" onClick={() => setActiveSection(sec)} style={{
              flex: 1, padding: '8px 0', borderRadius: 7, fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
              border: `1px solid ${activeSection === sec ? 'var(--accent)' : 'var(--line)'}`,
              background: activeSection === sec ? '#e1f0f3' : 'transparent',
              color: activeSection === sec ? 'var(--accent)' : 'var(--text-muted)',
            }}>{SECTION_LABELS[sec]}</button>
          ))}
        </div>
        <TraitSectionEditor section={activeSection} scores={s.target[activeSection]} onChange={(id, v) => setTraitTarget(activeSection, id, v)} target={null} tolerance={0} />
        <TraitSpiderChart section={activeSection} target={s.target[activeSection]} actual={null} height={220} />
      </Card>
    </div>
  );
}

function SkuProfiles({ store, isLead }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewSection, setPreviewSection] = useState('aroma');

  const save = async (sku) => {
    setBusy(true);
    try {
      if (sku.id) await store.updateSku(sku); else await store.addSku(sku);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  if (editing) return <SkuEditor sku={editing} onCancel={() => setEditing(null)} onSave={save} busy={busy} />;

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>True-to-type profiles</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>What "correct" looks like for each SKU.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {Object.keys(SECTION_LABELS).map(sec => (
              <button key={sec} type="button" onClick={() => setPreviewSection(sec)} style={{
                padding: '6px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${previewSection === sec ? 'var(--accent)' : 'var(--line)'}`,
                background: previewSection === sec ? '#e1f0f3' : 'transparent',
                color: previewSection === sec ? 'var(--accent)' : 'var(--text-muted)',
              }}>{SECTION_LABELS[sec]}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {store.skus.filter(sku => CORE_BEERS.includes(sku.name)).map(sku => {
          const target = normalizeTarget(sku.target);
          return (
            <Card key={sku.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>{sku.name}</p>
                  <p style={{ margin: '2px 0 10px', color: 'var(--text-muted)', fontSize: 12.5 }}>{sku.style} · {sku.abv}% ABV</p>
                </div>
                {isLead && <Button variant="ghost" onClick={() => setEditing(sku)} style={{ padding: '5px 10px', fontSize: 12 }}>Edit</Button>}
              </div>
              <TraitSpiderChart section={previewSection} target={target[previewSection]} actual={null} height={190} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>{sku.descriptors.map(d => <Pill key={d}>{d}</Pill>)}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function exportSessionsCSV(store) {
  const traitLabelsAroma = traitLabelsFor('aroma');
  const traitLabelsFlavor = traitLabelsFor('flavor');
  const aromaIds = TRAIT_TAXONOMY.aroma.flatMap(g => g.traits.map(t => traitId(g.category, t)));
  const flavorIds = TRAIT_TAXONOMY.flavor.flatMap(g => g.traits.map(t => traitId(g.category, t)));

  const rows = store.sessions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => {
      const batch = store.batches.find(b => b.id === s.batch_id);
      const sku = batch ? store.skus.find(x => x.id === batch.sku_id) : null;
      const row = {
        Date: s.date,
        Taster: store.profileName(s.taster_id),
        'Batch Number': batch ? batch.batch_number : '',
        SKU: sku ? sku.name : '',
        Type: s.tasting_type === 'retention' ? 'Retention' : 'TTT',
        Overall: s.overall,
        'Off-Flavors': (s.off_flavors || []).map(f => `${f.flavor} (${f.intensity}/5)`).join('; '),
        Notes: s.notes || '',
      };
      aromaIds.forEach(id => { row[`Aroma: ${traitLabelsAroma[id]}`] = s.scores?.aroma?.[id] ?? ''; });
      flavorIds.forEach(id => { row[`Flavour & Body: ${traitLabelsFlavor[id]}`] = s.scores?.flavor?.[id] ?? ''; });
      return row;
    });

  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tastings-export-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function OffFlavorReport({ store }) {
  const stats = useMemo(() => {
    const byFlavor = {};
    OFF_FLAVORS.forEach(f => { byFlavor[f] = { count: 0, intensitySum: 0, skuCounts: {} }; });

    store.sessions.forEach(s => {
      const batch = store.batches.find(b => b.id === s.batch_id);
      const sku = batch ? store.skus.find(x => x.id === batch.sku_id) : null;
      (s.off_flavors || []).forEach(({ flavor, intensity }) => {
        if (!byFlavor[flavor]) return;
        byFlavor[flavor].count += 1;
        byFlavor[flavor].intensitySum += intensity;
        if (sku) byFlavor[flavor].skuCounts[sku.name] = (byFlavor[flavor].skuCounts[sku.name] || 0) + 1;
      });
    });

    return Object.entries(byFlavor)
      .map(([flavor, d]) => ({
        flavor,
        count: d.count,
        avgIntensity: d.count > 0 ? (d.intensitySum / d.count) : 0,
        topSku: Object.entries(d.skuCounts).sort((a, b) => b[1] - a[1])[0],
      }))
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [store.sessions, store.batches, store.skus]);

  const maxCount = Math.max(1, ...stats.map(s => s.count));

  return (
    <Card style={{ marginTop: 20 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Off-flavor incidence</p>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-faint)' }}>Across every tasting logged. A recurring pattern here usually points at process, not a single bad batch.</p>
      {stats.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No off-flavors logged yet — clean panel so far.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stats.map(s => (
            <div key={s.flavor}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.flavor}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {s.count}× · avg {s.avgIntensity.toFixed(1)}/5{s.topSku ? ` · mostly ${s.topSku[0]}` : ''}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(s.count / maxCount) * 100}%`, height: '100%', background: s.avgIntensity >= 3.5 ? 'var(--bad)' : 'var(--accent)' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TrendsView({ store }) {
  const [skuId, setSkuId] = useState('');
  useEffect(() => {
    if (!skuId && store.skus.length > 0) {
      const core = store.skus.find(s => CORE_BEERS.includes(s.name));
      setSkuId((core || store.skus[0]).id);
    }
  }, [store.skus]);

  const sku = store.skus.find(s => s.id === skuId);
  const ttSessions = useMemo(() => store.sessions.filter(s => s.tasting_type === 'ttt'), [store.sessions]);

  const batchSeries = useMemo(() => {
    if (!sku) return [];
    const target = normalizeTarget(sku.target);
    const skuBatches = store.batches
      .filter(b => b.sku_id === sku.id)
      .sort((a, b) => (a.package_date || '').localeCompare(b.package_date || '') || Number(a.batch_number) - Number(b.batch_number));

    const avgDeviationForBatch = (sessions, section) => {
      const ids = TRAIT_TAXONOMY[section].flatMap(g => g.traits.map(t => traitId(g.category, t)));
      let sum = 0, count = 0;
      ids.forEach(id => {
        const targetVal = target[section][id] ?? 1;
        const vals = sessions.map(s => s.scores?.[section]?.[id]).filter(v => v != null);
        if (vals.length === 0) return;
        const avgScore = vals.reduce((a, c) => a + c, 0) / vals.length;
        sum += Math.abs(avgScore - targetVal);
        count++;
      });
      return count > 0 ? sum / count : 0;
    };

    return skuBatches
      .map(b => {
        const sessions = ttSessions.filter(s => s.batch_id === b.id);
        if (sessions.length === 0) return null;
        return {
          batch: b.batch_number,
          'Aroma deviation': Number(avgDeviationForBatch(sessions, 'aroma').toFixed(2)),
          'Flavour & Body deviation': Number(avgDeviationForBatch(sessions, 'flavor').toFixed(2)),
          tastingCount: sessions.length,
        };
      })
      .filter(Boolean);
  }, [sku, store.batches, ttSessions]);

  const topDeviators = useMemo(() => {
    if (!sku) return [];
    const target = normalizeTarget(sku.target);
    const skuBatchIds = new Set(store.batches.filter(b => b.sku_id === sku.id).map(b => b.id));
    const sessions = ttSessions.filter(s => skuBatchIds.has(s.batch_id));

    const acc = {};
    ['aroma', 'flavor'].forEach(section => {
      TRAIT_TAXONOMY[section].forEach(g => g.traits.forEach(t => {
        const id = traitId(g.category, t);
        acc[`${section}:${id}`] = { section, label: `${g.category}: ${t}`, sum: 0, count: 0 };
      }));
    });

    sessions.forEach(s => {
      ['aroma', 'flavor'].forEach(section => {
        const scores = s.scores?.[section] || {};
        Object.entries(scores).forEach(([id, val]) => {
          const key = `${section}:${id}`;
          if (!acc[key]) return;
          const targetVal = target[section][id] ?? 1;
          acc[key].sum += Math.abs(val - targetVal);
          acc[key].count += 1;
        });
      });
    });

    return Object.values(acc)
      .filter(d => d.count > 0)
      .map(d => ({ ...d, avgDeviation: d.sum / d.count }))
      .sort((a, b) => b.avgDeviation - a.avgDeviation)
      .slice(0, 8);
  }, [sku, store.batches, ttSessions]);

  const [compareBatchIds, setCompareBatchIds] = useState([]);
  const [compareSection, setCompareSection] = useState('aroma');

  const skuBatchOptions = useMemo(() =>
    store.batches.filter(b => sku && b.sku_id === sku.id && b.package_date).sort((a, b) => Number(b.batch_number) - Number(a.batch_number)),
    [store.batches, sku]
  );

  useEffect(() => { setCompareBatchIds([]); }, [skuId]);

  const toggleCompare = (batchId) => setCompareBatchIds(prev => {
    if (prev.includes(batchId)) return prev.filter(id => id !== batchId);
    if (prev.length >= 3) return prev;
    return [...prev, batchId];
  });

  const compareSeries = useMemo(() => {
    return compareBatchIds.map(batchId => {
      const batch = store.batches.find(b => b.id === batchId);
      const batchSessions = ttSessions.filter(s => s.batch_id === batchId);
      const scores = {};
      TRAIT_TAXONOMY[compareSection].forEach(g => g.traits.forEach(t => {
        const id = traitId(g.category, t);
        const vals = batchSessions.map(s => s.scores?.[compareSection]?.[id]).filter(v => v != null);
        scores[id] = vals.length > 0 ? vals.reduce((a, c) => a + c, 0) / vals.length : 1;
      }));
      return { label: batch ? batch.batch_number : batchId, scores };
    });
  }, [compareBatchIds, ttSessions, compareSection, store.batches]);

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Trends</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>How far off target each batch has run, over time. True to Type tastings only — retention tastings are excluded, since aging is expected to change a beer over time.</p>
        </div>
        <select style={{ ...inputStyle, width: 220 }} value={skuId} onChange={e => setSkuId(e.target.value)}>
          {store.skus.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Deviation from target by batch</p>
        {batchSeries.length < 2 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Need at least two tasted batches of this SKU to show a trend.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={batchSeries}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="batch" tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              <YAxis domain={[0, 8]} tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 12.5 }} />
              <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12.5, fontFamily: 'var(--font-body)', paddingTop: 6 }} />
              <Line type="monotone" dataKey="Aroma deviation" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Flavour & Body deviation" stroke="var(--bad)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Biggest deviating traits</p>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-faint)' }}>Averaged across every tasting of {sku ? sku.name : 'this SKU'} — the traits most consistently off target.</p>
        {topDeviators.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No tastings logged for this SKU yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topDeviators.map(d => (
              <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                <span style={{ fontSize: 13 }}>{d.label} <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>({SECTION_LABELS[d.section]})</span></span>
                <span style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: d.avgDeviation >= 3 ? 'var(--bad)' : 'var(--text-muted)' }}>±{d.avgDeviation.toFixed(1)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Compare batches</p>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-faint)' }}>Pick up to 3 batches of {sku ? sku.name : 'this SKU'} to overlay on one spider diagram.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {skuBatchOptions.map(b => {
            const selected = compareBatchIds.includes(b.id);
            const disabled = !selected && compareBatchIds.length >= 3;
            return (
              <button key={b.id} type="button" disabled={disabled} onClick={() => toggleCompare(b.id)} style={{
                fontSize: 12, padding: '6px 10px', borderRadius: 20, cursor: disabled ? 'not-allowed' : 'pointer',
                border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
                background: selected ? '#e1f0f3' : 'transparent',
                color: selected ? 'var(--accent)' : disabled ? 'var(--text-faint)' : 'var(--text-muted)',
                opacity: disabled ? 0.5 : 1,
              }}>{b.batch_number}</button>
            );
          })}
          {skuBatchOptions.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: 0 }}>No packaged batches of this SKU yet.</p>}
        </div>

        {compareBatchIds.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {Object.keys(SECTION_LABELS).map(sec => (
                <button key={sec} type="button" onClick={() => setCompareSection(sec)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 7, fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
                  border: `1px solid ${compareSection === sec ? 'var(--accent)' : 'var(--line)'}`,
                  background: compareSection === sec ? '#e1f0f3' : 'transparent',
                  color: compareSection === sec ? 'var(--accent)' : 'var(--text-muted)',
                }}>{SECTION_LABELS[sec]}</button>
              ))}
            </div>
            <MultiBatchSpiderChart section={compareSection} target={sku ? normalizeTarget(sku.target)[compareSection] : null} series={compareSeries} height={400} />
          </>
        )}
      </Card>
    </div>
  );
}

function computeSkuHealth(sku, store) {
  const skuBatchIds = new Set(store.batches.filter(b => b.sku_id === sku.id).map(b => b.id));
  const allSessions = store.sessions.filter(s => skuBatchIds.has(s.batch_id));
  if (allSessions.length === 0) return null;

  const passRate = allSessions.filter(s => s.overall === 'pass').length / allSessions.length;
  const offFlavorRate = allSessions.filter(s => (s.off_flavors || []).length > 0).length / allSessions.length;

  const ttSessions = allSessions.filter(s => s.tasting_type === 'ttt');
  let avgDeviation = null;
  if (ttSessions.length > 0) {
    const target = normalizeTarget(sku.target);
    let sum = 0, count = 0;
    ['aroma', 'flavor'].forEach(section => {
      TRAIT_TAXONOMY[section].forEach(g => g.traits.forEach(t => {
        const id = traitId(g.category, t);
        const targetVal = target[section][id] ?? 1;
        const vals = ttSessions.map(s => s.scores?.[section]?.[id]).filter(v => v != null);
        if (vals.length === 0) return;
        const avgScore = vals.reduce((a, c) => a + c, 0) / vals.length;
        sum += Math.abs(avgScore - targetVal);
        count++;
      }));
    });
    avgDeviation = count > 0 ? sum / count : null;
  }

  const deviationScore = avgDeviation != null ? Math.max(0, 1 - Math.min(avgDeviation, 4) / 4) : null;
  const healthScore = deviationScore != null
    ? (passRate * 0.4 + deviationScore * 0.4 + (1 - offFlavorRate) * 0.2) * 100
    : (passRate * 0.7 + (1 - offFlavorRate) * 0.3) * 100;

  return { passRate, offFlavorRate, avgDeviation, healthScore, tastingCount: allSessions.length };
}

function SkuHealthScoreboard({ store }) {
  const rows = useMemo(() => {
    return store.skus
      .filter(s => CORE_BEERS.includes(s.name))
      .map(s => ({ sku: s, health: computeSkuHealth(s, store) }))
      .filter(r => r.health)
      .sort((a, b) => a.health.healthScore - b.health.healthScore);
  }, [store.skus, store.batches, store.sessions]);

  const scoreColor = (score) => score >= 80 ? 'var(--good)' : score >= 60 ? 'var(--accent)' : 'var(--bad)';

  return (
    <Card style={{ marginBottom: 20 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>SKU health scoreboard</p>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-faint)' }}>Pass rate, on-target consistency (True to Type tastings only), and off-flavor frequency — blended into one score, worst first.</p>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No tastings logged yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(({ sku, health }) => (
            <div key={sku.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 16, alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{sku.name}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{Math.round(health.passRate * 100)}% pass</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{health.avgDeviation != null ? `±${health.avgDeviation.toFixed(1)} dev` : '— dev'}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{Math.round(health.offFlavorRate * 100)}% off-flavor</span>
              <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: scoreColor(health.healthScore) }}>{Math.round(health.healthScore)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function computeTasterCalibration(store) {
  const groups = {};
  store.sessions.forEach(s => {
    const key = `${s.batch_id}:${s.tasting_type}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });

  const tasterStats = {};

  Object.values(groups).forEach(group => {
    if (group.length < 2) return;

    ['aroma', 'flavor'].forEach(section => {
      TRAIT_TAXONOMY[section].forEach(g => g.traits.forEach(t => {
        const id = traitId(g.category, t);
        const vals = group.map(s => ({ taster: s.taster_id, val: s.scores?.[section]?.[id] })).filter(v => v.val != null);
        if (vals.length < 2) return;
        const panelAvg = vals.reduce((a, c) => a + c.val, 0) / vals.length;
        vals.forEach(v => {
          if (!tasterStats[v.taster]) tasterStats[v.taster] = { sumSigned: 0, sumAbs: 0, count: 0 };
          const dev = v.val - panelAvg;
          tasterStats[v.taster].sumSigned += dev;
          tasterStats[v.taster].sumAbs += Math.abs(dev);
          tasterStats[v.taster].count++;
        });
      }));
    });
  });

  const MIN_SAMPLE = 20;
  return Object.entries(tasterStats)
    .map(([tasterId, s]) => ({
      tasterId,
      avgBias: s.sumSigned / s.count,
      avgAbsDeviation: s.sumAbs / s.count,
      sampleSize: s.count,
    }))
    .filter(r => r.sampleSize >= MIN_SAMPLE)
    .sort((a, b) => Math.abs(b.avgBias) - Math.abs(a.avgBias));
}

function TasterCalibration({ store }) {
  const rows = useMemo(() => computeTasterCalibration(store), [store.sessions]);

  return (
    <Card style={{ marginBottom: 20 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Taster calibration</p>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-faint)' }}>How each person's scores compare to the panel average, on batches multiple people tasted. Useful for training conversations — not a ranking.</p>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Not enough overlapping tastings yet — this needs multiple people tasting the same batch to compare.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => (
            <div key={r.tasterId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16, alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{store.profileName(r.tasterId)}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {r.avgBias > 0.15 ? `scores ~${r.avgBias.toFixed(1)} higher than panel` : r.avgBias < -0.15 ? `scores ~${Math.abs(r.avgBias).toFixed(1)} lower than panel` : 'close to panel average'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{r.sampleSize} comparable scores</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Spiked samples per taster: how often they named the spiked off-flavour, by off-flavour.
function SpikeDetection({ store }) {
  const rows = useMemo(() => {
    const by = {};
    store.spikeTastings.forEach(t => {
      const k = store.spikes.find(x => x.id === t.spike_id);
      if (!k) return;
      const r = by[t.taster_id] || (by[t.taster_id] = { tasterId: t.taster_id, n: 0, hit: 0, partial: 0, missed: {} });
      const o = spikeOutcome(k, t);
      r.n++;
      if (o === 'hit') r.hit++;
      else { if (o === 'partial') r.partial++; r.missed[k.off_flavor] = (r.missed[k.off_flavor] || 0) + 1; }
    });
    return Object.values(by).sort((a, b) => b.hit / b.n - a.hit / a.n);
  }, [store.spikeTastings, store.spikes]);
  if (!rows.length) return null;
  return (
    <Card style={{ marginBottom: 20 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Spike detection</p>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-faint)' }}>Spiked samples each taster has scored, and how often they named the off-flavour that was added.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.tasterId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16, alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{store.profileName(r.tasterId)}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {Object.keys(r.missed).length ? `missed: ${Object.entries(r.missed).map(([f, n]) => n > 1 ? `${f} ×${n}` : f).join(', ')}` : 'none missed'}
            </span>
            <Pill tone={r.hit / r.n >= 0.75 ? 'good' : r.hit / r.n >= 0.5 ? 'warn' : 'bad'}>{r.hit}/{r.n} picked{r.partial ? ` · ${r.partial} something off` : ''}</Pill>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Dashboard({ store, onEditSession }) {
  const today = todayISO();
  const overdue = store.retention.filter(r => !r.assessed && r.due_date < today);
  const recent = [...store.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const flaggedRecent = store.sessions.filter(s => s.overall !== 'pass').slice(-5).reverse();
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (s) => {
    if (!window.confirm('Delete this tasting? This cannot be undone.')) return;
    setDeletingId(s.id);
    try {
      await store.deleteSession(s.id);
    } catch (e) {
      alert(e.message || 'Could not delete — try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const stat = (label, value, tone) => (
    <Card style={{ flex: 1 }}>
      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 30, fontFamily: 'var(--font-display)', color: tone || 'var(--text)' }}>{value}</p>
    </Card>
  );

  return (
    <div>
      <div className="header-row-stack" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: 0 }}>Dashboard</h3>
        <Button variant="ghost" onClick={() => exportSessionsCSV(store)} disabled={store.sessions.length === 0}>
          <Upload size={15} style={{ transform: 'rotate(180deg)' }} /> Export all tastings (CSV)
        </Button>
      </div>
      <div className="dashboard-stats" style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {stat('SKUs tracked', store.skus.length)}
        {stat('Active batches', store.batches.filter(b => b.package_date).length)}
        {stat('Overdue retention', overdue.length, overdue.length > 0 ? 'var(--bad)' : 'var(--good)')}
        {stat('Total tastings logged', store.sessions.length)}
      </div>
      <SkuHealthScoreboard store={store} />
      <TasterCalibration store={store} />
      <SpikeDetection store={store} />
      <div className="responsive-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card>
          <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Recent submissions</p>
          {recent.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Nothing logged yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recent.map(s => {
              const b = store.batches.find(x => x.id === s.batch_id);
              const bSku = b ? store.skus.find(x => x.id === b.sku_id) : null;
              return (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{b ? `${b.batch_number} - ${bSku ? bSku.name : 'Unknown SKU'}` : '—'}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{store.profileName(s.taster_id)} · {s.date} · {s.tasting_type === 'retention' ? 'Retention' : 'TTT'}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Pill tone={s.overall === 'pass' ? 'good' : s.overall === 'flag' ? 'warn' : 'bad'}>{s.overall}</Pill>
                    <Button variant="ghost" onClick={() => onEditSession(s)} style={{ padding: '4px 8px', fontSize: 11 }}>Edit</Button>
                    <Button variant="danger" onClick={() => handleDelete(s)} disabled={deletingId === s.id} style={{ padding: '4px 8px', fontSize: 11 }}>{deletingId === s.id ? '…' : 'Delete'}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Flagged / failed tastings</p>
          {flaggedRecent.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No flags — panel's tracking clean.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {flaggedRecent.map(s => {
              const b = store.batches.find(x => x.id === s.batch_id);
              const bSku = b ? store.skus.find(x => x.id === b.sku_id) : null;
              return (
                <div key={s.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{b ? `${b.batch_number} - ${bSku ? bSku.name : 'Unknown SKU'}` : '—'}</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Pill>{s.tasting_type === 'retention' ? 'Retention' : 'TTT'}</Pill>
                      <Pill tone="bad">{s.overall}</Pill>
                    </div>
                  </div>
                  {s.off_flavors.length > 0 && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--bad)' }}>{s.off_flavors.map(f => `${f.flavor} (${f.intensity}/5)`).join(', ')}</p>}
                  {s.notes && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>"{s.notes.slice(0, 90)}{s.notes.length > 90 ? '…' : ''}"</p>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <OffFlavorReport store={store} />
    </div>
  );
}

// The sensory app, moved in from its own project. mode: 'sensory' (Sensory tab), 'qc' (QC Log
// tab) or 'signoff' (just the brite tank sign-off, shown on the Packaging tab). Sign-in is the production app's (PIN); the
// signed-in person's sensory profile (taster, lead or staff) comes from sensory_me(), which links
// their old sensory profile by email or makes a new one.
export default function SensoryApp({ mode = 'sensory' }) {
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [tab, setTab] = useState(mode === 'qc' ? 'qc' : 'sessions');
  const [returnTab, setReturnTab] = useState('sessions'); // where a tasting goes back to when it's saved
  const [presetBatchId, setPresetBatchId] = useState(null);
  const [presetSpike, setPresetSpike] = useState(null);
  const [presetTastingType, setPresetTastingType] = useState(null);
  const [activePanelId, setActivePanelId] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const appMode = mode;
  const [editingSession, setEditingSession] = useState(null);

  useEffect(() => {
    supabase.rpc('sensory_me').then(({ data, error }) => (error ? setProfileError(error.message) : setProfile(Array.isArray(data) ? data[0] : data)));
  }, []);
  // The store keys everything off a session; here that's the sensory profile.
  const session = useMemo(() => (profile ? { user: { id: profile.id } } : null), [profile]);
  const store = useSupabaseData(session);
  const isLead = profile?.role === 'lead';

  const sensoryTabs = [
    { id: 'sessions', label: 'Sessions', icon: Calendar, allowed: true },
    { id: 'panels', label: 'Panels', icon: Users, allowed: true },
    { id: 'submit', label: 'Submit tasting', icon: ClipboardList, allowed: true },
    { id: 'difference', label: 'Difference tests', icon: LayoutGrid, allowed: true },
    { id: 'retention', label: 'Retention queue', icon: Archive, allowed: isLead },
    { id: 'batches', label: 'Batches', icon: Beaker, allowed: isLead },
    { id: 'skus', label: 'TTT profiles', icon: Settings, allowed: true },
    { id: 'search', label: 'Search', icon: Search, allowed: true },
    { id: 'trends', label: 'Trends', icon: TrendingUp, allowed: isLead },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, allowed: isLead },
    { id: 'team', label: 'Team', icon: UserCog, allowed: isLead },
  ];
  const qcTabs = [
    { id: 'qc', label: 'Log Sample', icon: FlaskConical, allowed: isLead },
    { id: 'incubating', label: 'Incubating', icon: TrendingUp, allowed: isLead },
    { id: 'qcDashboard', label: 'Dashboard', icon: LayoutDashboard, allowed: isLead },
    { id: 'qcLocations', label: 'Locations', icon: MapPin, allowed: isLead },
  ];
  const tabs = (appMode === 'qc' ? qcTabs : sensoryTabs).filter(t => t.allowed);

  useEffect(() => { if (tabs.length && !tabs.find(t => t.id === tab)) setTab(tabs[0].id); }, [isLead, appMode]);

  // The production app's look (index.css): same fonts, colours, buttons and inputs.
  const themeVars = {
    '--bg': '#f4f6f8', '--surface': '#fff', '--surface-2': '#f0f7f9', '--line': '#dce2e8',
    '--text': '#141a24', '--text-muted': '#4f5b66', '--text-faint': '#85909a',
    '--accent': '#00687d', '--good': '#1b6e2e', '--bad': '#b00020',
    '--navy': '#141a24', '--teal': '#00687d', '--teal-dark': '#06282e', '--gold': '#BE9C5D', '--forest': '#2F4534',
    '--font-display': 'var(--font)', '--font-body': 'var(--font)', '--font-mono': 'var(--mono)',
  };

  if (profileError) return <p style={{ color: 'crimson' }}>{profileError}</p>
  if (!profile || (store.loading && !store.initialLoadDone)) {
    return (
      <div style={{ ...themeVars, background: 'var(--bg)', color: 'var(--text)', minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="sensory-app" style={{ ...themeVars, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-body)', borderRadius: 10, overflow: 'hidden' }}>
      <style>{`
        input[type=range] { -webkit-appearance: none; background: transparent; height: 20px; }
        .mobile-nav-trigger { display: none; }
        .mobile-dropdown-list { display: contents; }
        input[type=range]::-webkit-slider-runnable-track { height: 4px; background: var(--line); border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; margin-top: -6px; width: 16px; height: 16px; border-radius: 50%; background: currentColor; cursor: pointer; border: 2px solid var(--surface); }
        @media print {
          body * { visibility: hidden; }
          #batch-report-printable, #batch-report-printable * { visibility: visible; }
          #batch-report-printable { position: absolute; top: 0; left: 0; width: 100%; background: white; color: black; }
          .no-print { display: none !important; }
        }
        @media (max-width: 768px) {
          .sn-header { padding: 12px 14px !important; }
          .sn-shell { flex-direction: column !important; }
          .sn-nav {
            width: 100% !important; border-right: none !important; border-bottom: 1px solid var(--line);
            padding: 10px 12px !important; position: relative;
          }
          .mobile-nav-trigger { display: flex !important; }
          .mobile-dropdown-list { display: none; }
          .mobile-dropdown-list.open {
            display: flex !important; flex-direction: column; position: absolute; top: 100%; left: 12px; right: 12px;
            background: var(--surface); border: 1px solid var(--line); border-radius: 8px; z-index: 40; padding: 6px;
            box-shadow: 0 10px 28px rgba(0,0,0,0.25); margin-top: 4px;
          }
          .sn-main { padding: 14px !important; max-width: 100% !important; }
          .header-row-stack { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
          .header-row-stack > * { width: 100% !important; }
          .responsive-grid-2 { grid-template-columns: 1fr !important; }
          .responsive-grid-2 > * { min-width: 0; }
          .modal-card { width: 92vw !important; max-width: 92vw !important; padding: 18px !important; }
          .batch-form-grid { grid-template-columns: 1fr 1fr !important; }
          .dashboard-stats { flex-wrap: wrap !important; }
          .dashboard-stats > * { flex: 1 1 45% !important; min-width: 130px; }
        }
      `}</style>

      {appMode === 'signoff' ? (
        <div style={{ padding: '20px 24px' }}><PackagingSignOffView store={store} currentProfile={profile} /></div>
      ) : (<>
      <header className="sn-header" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{appMode === 'qc' ? 'QC Log' : 'Sensory'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <User size={15} color="var(--text-muted)" />
          <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{profile.name}</span>
          <Pill tone={isLead ? 'good' : 'neutral'}>{isLead ? 'QA Lead' : 'Staff'}</Pill>
        </div>
      </header>

      <div className="sn-shell" style={{ display: 'flex' }}>
        <nav className="sn-nav" style={{ width: 210, borderRight: '1px solid var(--line)', padding: '20px 12px', flexShrink: 0 }}>
          <button className="mobile-nav-trigger" onClick={() => setMobileNavOpen(v => !v)} style={{
            width: '100%', display: 'none', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px',
            borderRadius: 7, border: '1px solid var(--line)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
            background: 'var(--surface)', color: 'var(--accent)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {(() => { const current = tabs.find(t => t.id === tab); const Icon = current ? current.icon : Calendar; return <Icon size={16} />; })()}
              {tabs.find(t => t.id === tab)?.label || 'Menu'}
            </span>
            <ChevronDown size={16} style={{ transform: mobileNavOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
          <div className={`mobile-dropdown-list${mobileNavOpen ? ' open' : ''}`}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setReturnTab('sessions'); setPresetBatchId(null); setPresetSpike(null); setPresetTastingType(null); setActivePanelId(null); setEditingSession(null); setMobileNavOpen(false); }} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 4,
                borderRadius: 7, border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 13.5, fontWeight: 600,
                background: tab === t.id ? 'var(--surface-2)' : 'transparent',
                color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              }}><t.icon size={16} /> {t.label}</button>
            ))}
          </div>
          {store.error && <p style={{ fontSize: 11, color: 'var(--bad)', marginTop: 16, padding: '0 12px' }}>{store.error}</p>}
        </nav>

        <main className="sn-main" style={{ flex: 1, padding: '28px 32px', maxWidth: 1180 }}>
          {tab === 'sessions' && <SessionsView store={store} isLead={isLead} currentProfile={profile} onLogTasting={(bid, type, panelId, spike) => { setReturnTab('sessions'); setPresetBatchId(bid); setPresetSpike(spike || null); setPresetTastingType(type || null); setActivePanelId(panelId || null); setTab('submit'); }} onEditTasting={(s) => { setReturnTab('sessions'); setEditingSession(s); setTab('submit'); }} />}
          {tab === 'panels' && <PanelsView store={store} isLead={isLead} currentProfile={profile} onLogTasting={(bid, type, panelId, spike) => { setReturnTab('panels'); setPresetBatchId(bid); setPresetSpike(spike || null); setPresetTastingType(type || null); setActivePanelId(panelId || null); setTab('submit'); }} onEditTasting={(s) => { setReturnTab('panels'); setEditingSession(s); setTab('submit'); }} />}
          {tab === 'submit' && <TastingForm store={store} currentProfile={profile} onDone={() => { setEditingSession(null); setActivePanelId(null); setPresetSpike(null); setTab(returnTab); }} presetBatchId={presetBatchId} presetSpike={editingSession ? null : presetSpike} presetTastingType={presetTastingType} activePanelId={editingSession ? null : activePanelId} editSession={editingSession} />}
          {tab === 'retention' && isLead && <RetentionQueue store={store} onLogTasting={(bid, type) => { setReturnTab('retention'); setPresetBatchId(bid); setPresetSpike(null); setPresetTastingType(type || null); setActivePanelId(null); setTab('submit'); }} />}
          {tab === 'qc' && isLead && <QcView store={store} />}
          {tab === 'incubating' && isLead && <IncubatingView store={store} />}
          {tab === 'qcDashboard' && isLead && <QcDashboard store={store} />}
          {tab === 'qcLocations' && isLead && <QcLocationsTab store={store} />}
          {tab === 'batches' && isLead && <BatchesView store={store} isLead={isLead} />}
          {tab === 'difference' && <DifferenceTests store={store} currentProfile={profile} isLead={isLead} />}
          {tab === 'skus' && <SkuProfiles store={store} isLead={isLead} />}
          {tab === 'search' && <SearchView store={store} />}
          {tab === 'trends' && isLead && <TrendsView store={store} />}
          {tab === 'dashboard' && isLead && <Dashboard store={store} onEditSession={(s) => { setReturnTab('dashboard'); setEditingSession(s); setTab('submit'); }} />}
          {tab === 'team' && isLead && <TeamManagement store={store} currentProfile={profile} />}
          {appMode === 'qc' && !isLead && <p style={{ color: 'var(--text-muted)' }}>The QC Log is for QA leads. Ask a lead to make you one on the Sensory tab (Team).</p>}
        </main>
      </div>
      </>)}
    </div>
  );
}
