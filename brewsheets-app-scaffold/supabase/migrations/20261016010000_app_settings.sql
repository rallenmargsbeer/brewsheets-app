-- App-wide settings that aren't numbers, e.g. the tab bar: order and which tabs are admins only.
create table if not exists public.app_settings (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "read all" on public.app_settings for select using (true);
create policy "admins insert" on public.app_settings for insert with check (public.is_admin());
create policy "admins update" on public.app_settings for update using (public.is_admin()) with check (public.is_admin());
grant select on public.app_settings to anon, authenticated;
grant insert, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
