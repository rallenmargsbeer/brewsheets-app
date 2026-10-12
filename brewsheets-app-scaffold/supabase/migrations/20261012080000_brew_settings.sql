-- Shared brewing settings (e.g. lactic acid buffering figures for the acid calculator).
create table if not exists public.brew_settings (
  key text primary key,
  value numeric,
  updated_at timestamptz not null default now()
);
alter table public.brew_settings enable row level security;
create policy "read all" on public.brew_settings for select using (true);
create policy "editors insert" on public.brew_settings for insert with check (public.is_schedule_editor());
create policy "editors update" on public.brew_settings for update using (public.is_schedule_editor());
grant select on public.brew_settings to anon, authenticated;
grant insert, update on public.brew_settings to authenticated;
insert into public.brew_settings (key, value) values
  ('lactic_mash_ml_per_hl_per_0_1ph', 8),
  ('lactic_wort_ml_per_hl_per_0_1ph', 10)
on conflict (key) do nothing;
