-- Alerts for admins, e.g. a brewer pressing "Complete anyway" on an out-of-spec batch. Any
-- staff member can raise one; only admins see them and tick them off.
create table if not exists public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  batch_id uuid references public.batches(id) on delete cascade,
  message text not null,
  raised_by uuid default auth.uid(),
  raised_by_name text,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  seen_by uuid
);
alter table public.admin_alerts enable row level security;
create policy "staff raise" on public.admin_alerts for insert to authenticated with check (public.can_edit());
create policy "admin read" on public.admin_alerts for select to authenticated using (public.is_admin());
create policy "admin update" on public.admin_alerts for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.admin_alerts to authenticated;
