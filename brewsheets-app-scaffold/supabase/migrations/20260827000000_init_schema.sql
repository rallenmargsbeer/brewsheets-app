-- Brewsheets app — initial schema
-- Covers v1 scope: recipes, brew-day process logging, fermentation/cellar logging.
-- Deliberately NOT a 1:1 replica of the old spreadsheet — redesigned into a normalized
-- relational structure. Packaging/excise/centrifuge/CIP tracking and full tank/vessel
-- scheduling are out of scope for this migration (later phases).

create extension if not exists "pgcrypto";

-- ============================================================================
-- RECIPES
-- A recipe is a reusable definition for a beer style (e.g. "Drift XPA").
-- Batches reference a recipe as their starting point.
-- ============================================================================

create table recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  style text,
  is_core_range boolean not null default true, -- true for the fixed core lineup, false for seasonals/one-offs
  target_og numeric(5,1),          -- e.g. 11.0 (plato)
  target_fg numeric(5,1),
  ko_temp numeric(5,1),            -- knockout temperature target
  mash_step_1_temp numeric(5,1),   -- "0-20" step
  mash_step_2_temp numeric(5,1),   -- "20-40" step
  mash_step_3_temp numeric(5,1),   -- "40-60" step
  mash_out_temp numeric(5,1),
  yeast_type text,                 -- e.g. "5kg AY4"
  yeast_nutrient_qty_kg numeric(6,3),
  whirlfloc_qty_kg numeric(6,3),
  biofine_qty_l numeric(6,3),
  filter_micron text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table recipes is 'Reusable beer recipe definitions (grist/hops/water chem live in child tables).';

-- Grist / malt bill
create table recipe_grist_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_name text not null,   -- e.g. "Pale", "Dexter", "Wheat"
  qty_kg numeric(7,2) not null,
  sort_order int not null default 0
);

-- Water chemistry additions (mash + kettle)
create table recipe_water_additions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  additive_name text not null,     -- e.g. "Calcium Sulphate", "Calcium Chloride", "Lactic Acid"
  qty_kg numeric(7,3) not null,
  addition_stage text,             -- 'mash' | 'kettle' — free text for now, can tighten later
  sort_order int not null default 0
);

-- Hop schedule (boil additions + dry hop + whirlpool)
create table recipe_hop_additions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  hop_name text not null,
  addition_type text not null check (addition_type in ('boil', 'whirlpool', 'dry_hop')),
  boil_time_min int,                -- 60/45/20/15/10/5, null for whirlpool/dry hop
  qty_kg numeric(7,3),
  dry_hop_batches int,               -- number of dry-hop batches, only relevant when addition_type = 'dry_hop'
  dry_hop_qty_per_batch_kg numeric(7,3),
  sort_order int not null default 0
);

-- ============================================================================
-- TANKS
-- Lightweight reference so brew runs / fermentation readings can point at a
-- vessel. Full tank/vessel scheduling (availability, calendar) is a later phase —
-- this table just gives fermentation logging somewhere to point to in v1.
-- ============================================================================

create table tanks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,        -- e.g. "FV3"
  tank_type text,                   -- e.g. 'FV', 'BBT'
  capacity_l numeric(8,1),
  is_active boolean not null default true
);

-- ============================================================================
-- BATCHES
-- One actual brew of a recipe. A batch can be made up of 1-4 brew runs
-- (separate brewhouse turns combined into one fermenter) — see brew_runs.
-- ============================================================================

create table batches (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id),
  batch_number text not null unique,
  beer_style text,                  -- denormalized snapshot of recipe.style/name at brew time
  status text not null default 'planned'
    check (status in ('planned', 'brewing', 'fermenting', 'conditioning', 'packaged', 'archived')),
  tank_id uuid references tanks(id),
  date_brewed date,
  package_date date,
  approved_by text,
  ready_to_package boolean not null default false,
  cip_by text,
  cip_date date,
  actual_og numeric(5,1),
  actual_fg numeric(5,1),
  abv numeric(4,2),
  target_abv numeric(4,2),
  ready_for_excise boolean not null default false,
  brewhouse_yield_l numeric(8,1),
  fv_to_bbt_l numeric(8,1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table batches is 'One brewed batch. batch_number/beer_style/date_brewed/package_date are the fields sensory-app''s batches table will eventually sync from — see the brewsheets-schedule-app migration notes.';

create index on batches (recipe_id);
create index on batches (status);

-- ============================================================================
-- BREW RUNS
-- 1-4 per batch: each is one mash+boil+knockout cycle ("brewhouse turn").
-- Multiple runs get combined into the same fermenter (same batch).
-- ============================================================================

create table brew_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  run_number int not null check (run_number between 1 and 4),

  brew_date date,
  brewer text,

  -- Mash
  strike_temp numeric(5,1),
  mash_water_l numeric(7,1),
  mash_temp numeric(5,1),
  mash_ph numeric(4,2),
  flowmeter_target_l numeric(7,1),
  flowmeter_actual_l numeric(7,1),
  mash_in_time timestamptz,
  mash_end_time timestamptz,

  -- Lauter / vorlauf
  vorlauf_start_time timestamptz,
  lauter_start_time timestamptz,
  lauter_end_time timestamptz,
  first_runnings_gravity numeric(5,1),
  last_runnings_gravity numeric(5,1),
  total_kettle_acid_ml numeric(6,1),

  -- Boil
  target_preboil_gravity numeric(5,1),
  boil_start_time timestamptz,
  boil_end_time timestamptz,
  preboil_volume_l numeric(7,1),
  preboil_gravity numeric(5,1),
  postboil_volume_l numeric(7,1),
  postboil_gravity numeric(5,1),

  -- Transfer / knockout
  transfer_start_time timestamptz,
  transfer_end_time timestamptz,
  ko_start_time timestamptz,
  ko_end_time timestamptz,
  ko_flowmeter_l numeric(7,1),
  correction_l numeric(7,1),

  -- Whirlpool
  whirlpool_gravity numeric(5,1),
  whirlpool_ph numeric(4,2),
  whirlpool_o2_check boolean,

  brewhouse_efficiency numeric(5,2),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (batch_id, run_number)
);

create index on brew_runs (batch_id);

-- ============================================================================
-- FERMENTATION READINGS
-- Daily fermentation/cellar log entries for a batch.
-- ============================================================================

create table fermentation_readings (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  reading_date date not null,
  fermentation_day int,             -- day 0, 1, 2, ...
  temp_panel numeric(5,1),
  gravity_plato numeric(5,1),
  ph numeric(4,2),
  tank_pressure numeric(5,2),
  co2_in_tank numeric(5,2),
  o2_in_tank numeric(6,3),
  co2_in_can numeric(5,2),
  o2_in_can numeric(6,3),
  abv_tracker numeric(4,2),          -- calculated at entry time, stored for history
  sensory_check boolean,
  initials text,
  notes text,
  created_at timestamptz not null default now(),

  unique (batch_id, reading_date)
);

create index on fermentation_readings (batch_id);

-- Scheduled cellar tasks tied to a batch (e.g. dry hop addition, transfer, CIP)
create table cellar_tasks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  task_description text not null,
  scheduled_date date,
  condition_status text,             -- free text status/condition note, e.g. 'done', 'skipped'
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index on cellar_tasks (batch_id);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_recipes_updated_at before update on recipes
  for each row execute function set_updated_at();

create trigger trg_batches_updated_at before update on batches
  for each row execute function set_updated_at();

create trigger trg_brew_runs_updated_at before update on brew_runs
  for each row execute function set_updated_at();
