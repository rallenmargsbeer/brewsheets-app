-- Sensory (moved from the separate sensory app). Tables are prefixed sensory_ so they don't
-- clash with production tables. Panel members are sensory_profiles, linked to a production
-- login (app_users) by app_user_id; old profiles keep their ids so past tastings keep their
-- taster. Any signed-in staff member can read and write (lead-only screens are gated in the app).
create table if not exists public.sensory_profiles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid unique references public.app_users(id) on delete set null,
  name text not null,
  email text,
  role text not null default 'staff' check (role in ('staff', 'lead')),
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_skus (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  style text default '',
  abv numeric default 0,
  descriptors text[] default '{}',
  watchouts text[] default '{}',
  target jsonb not null default '{}'::jsonb,
  tolerance numeric not null default 1,
  notes text default '',
  trait_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_batches (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.sensory_skus(id) on delete restrict,
  batch_number text not null unique,
  package_date date,
  format text default 'Can',
  status text not null default 'active',
  production_batch_id uuid references public.batches(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_retention_checkpoints (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.sensory_batches(id) on delete cascade,
  days integer not null,
  due_date date not null,
  assessed boolean not null default false
);
create table if not exists public.sensory_tastings (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.sensory_batches(id) on delete cascade,
  taster_id uuid not null references public.sensory_profiles(id),
  date date not null default current_date,
  scores jsonb not null,
  overall text not null check (overall in ('pass', 'flag', 'fail')),
  off_flavors jsonb default '[]'::jsonb,
  notes text default '',
  retention_checkpoint_id uuid references public.sensory_retention_checkpoints(id),
  tasting_type text not null default 'ttt' check (tasting_type in ('ttt', 'retention')),
  exported_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_panels (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  label text not null,
  panel_type text not null default 'ttt' check (panel_type in ('ttt', 'retention')),
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_panel_batches (
  panel_id uuid not null references public.sensory_panels(id) on delete cascade,
  batch_id uuid not null references public.sensory_batches(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (panel_id, batch_id)
);
create table if not exists public.sensory_brite_checks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.sensory_batches(id) on delete cascade,
  taster_id uuid not null references public.sensory_profiles(id),
  date date not null default current_date,
  decision text not null check (decision in ('green', 'red')),
  notes text default '',
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  label text not null,
  status text not null default 'open' check (status in ('open', 'complete')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_session_panels (
  sensory_session_id uuid not null references public.sensory_sessions(id) on delete cascade,
  panel_id uuid not null references public.sensory_panels(id) on delete cascade,
  primary key (sensory_session_id, panel_id)
);
create table if not exists public.sensory_session_participants (
  sensory_session_id uuid not null references public.sensory_sessions(id) on delete cascade,
  user_id uuid not null references public.sensory_profiles(id) on delete cascade,
  primary key (sensory_session_id, user_id)
);
create table if not exists public.sensory_qc_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0
);
create table if not exists public.sensory_qc_samples (
  id uuid primary key default gen_random_uuid(),
  sample_type text not null check (sample_type in ('batch', 'in_process', 'environmental')),
  batch_id uuid references public.sensory_batches(id),
  location_id uuid references public.sensory_qc_locations(id),
  pulled_by uuid not null references public.sensory_profiles(id),
  pulled_date date not null default current_date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  check ((sample_type in ('batch', 'in_process') and batch_id is not null and location_id is null)
      or (sample_type = 'environmental' and location_id is not null and batch_id is null))
);
create table if not exists public.sensory_qc_tests (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references public.sensory_qc_samples(id) on delete cascade,
  test_type text not null check (test_type in ('wild_yeast', 'b_tube')),
  due_date date not null,
  result text not null default 'pending' check (result in ('pending', 'negative', 'positive')),
  read_date date,
  read_by uuid references public.sensory_profiles(id),
  notes text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.sensory_sync_audit_log (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  batch_number text not null,
  matched_sku_name text,
  package_date date,
  action text not null check (action in ('added', 'updated', 'skipped', 'graduated', 'error')),
  error_detail text
);

do $$
declare t text;
begin
  foreach t in array array['sensory_profiles','sensory_skus','sensory_batches','sensory_retention_checkpoints','sensory_tastings',
    'sensory_panels','sensory_panel_batches','sensory_brite_checks','sensory_sessions','sensory_session_panels',
    'sensory_session_participants','sensory_qc_locations','sensory_qc_samples','sensory_qc_tests','sensory_sync_audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_active_user())', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (public.is_active_user())', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using (public.is_active_user()) with check (public.is_active_user())', t);
    execute format('create policy "staff delete" on public.%I for delete to authenticated using (public.is_active_user())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
