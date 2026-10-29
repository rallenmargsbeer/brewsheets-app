-- Difference tests (triangle or tetrad): a lead sets up two samples; each taster gets a coded,
-- balanced presentation and picks the odd one (triangle) or the pair that belong together (tetrad).
create table if not exists public.sensory_difference_tests (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  label text not null,
  method text not null default 'triangle' check (method in ('triangle', 'tetrad')),
  sample_a text not null,
  sample_b text not null,
  batch_a_id uuid references public.sensory_batches(id) on delete set null,
  batch_b_id uuid references public.sensory_batches(id) on delete set null,
  notes text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references public.sensory_profiles(id),
  created_at timestamptz not null default now()
);
-- One row per taster: the cups they were served (code + which sample, in order), then their answer.
create table if not exists public.sensory_difference_responses (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.sensory_difference_tests(id) on delete cascade,
  taster_id uuid not null references public.sensory_profiles(id),
  seat integer not null,
  cups jsonb not null,           -- [{"code":"482","sample":"A"}, ...]
  answer jsonb,                  -- triangle: ["482"] (the odd cup); tetrad: ["482","915"] (a pair)
  correct boolean,
  comment text not null default '',
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (test_id, taster_id)
);
do $$
declare t text;
begin
  foreach t in array array['sensory_difference_tests', 'sensory_difference_responses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_active_user())', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (public.is_active_user())', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using (public.is_active_user()) with check (public.is_active_user())', t);
    execute format('create policy "staff delete" on public.%I for delete to authenticated using (public.is_active_user())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
