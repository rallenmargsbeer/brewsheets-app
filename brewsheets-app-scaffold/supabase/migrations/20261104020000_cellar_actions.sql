-- Cellar steps done on a batch (trub off, free rise, dry hop, spund, VDK, chill, and the steps after
-- chill), ticked off on the Today page. VDK has a result: 'pass' (negative, OK to chill) or 'fail'.
create table if not exists public.cellar_actions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  action text not null,
  done_on date not null default current_date,
  result text check (result in ('pass', 'fail')),
  done_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cellar_actions_batch on public.cellar_actions (batch_id);
alter table public.cellar_actions enable row level security;
create policy "staff read" on public.cellar_actions for select to authenticated using (public.is_active_user());
create policy "staff insert" on public.cellar_actions for insert to authenticated with check (public.is_active_user());
create policy "staff delete" on public.cellar_actions for delete to authenticated using (public.is_active_user());
grant select, insert, delete on public.cellar_actions to authenticated;
