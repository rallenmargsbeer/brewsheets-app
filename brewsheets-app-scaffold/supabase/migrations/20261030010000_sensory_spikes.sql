-- Spiked samples: a lead adds a pour of a batch spiked with a known off-flavour to a session. Tasters
-- see it under the label the lead gives it and score it like any other sample; their tastings carry
-- spike_id, so they never count towards the batch's own results, and the lead sees who picked it up.
create table if not exists public.sensory_spikes (
  id uuid primary key default gen_random_uuid(),
  sensory_session_id uuid not null references public.sensory_sessions(id) on delete cascade,
  base_batch_id uuid not null references public.sensory_batches(id) on delete cascade,
  off_flavor text not null,
  label text not null,
  notes text not null default '',
  created_by uuid references public.sensory_profiles(id),
  created_at timestamptz not null default now()
);
alter table public.sensory_tastings add column if not exists spike_id uuid references public.sensory_spikes(id) on delete cascade;

alter table public.sensory_spikes enable row level security;
create policy "staff read" on public.sensory_spikes for select to authenticated using (public.is_active_user());
create policy "staff insert" on public.sensory_spikes for insert to authenticated with check (public.is_active_user());
create policy "staff update" on public.sensory_spikes for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy "staff delete" on public.sensory_spikes for delete to authenticated using (public.is_active_user());
grant select, insert, update, delete on public.sensory_spikes to authenticated;

-- Session completion: every participant has tasted every batch (not counting spike tastings) and
-- every spiked sample.
create or replace function public.sensory_check_sessions() returns integer
language plpgsql security definer set search_path = public as $$
declare s record; done integer := 0; batches text;
begin
  for s in select * from sensory_sessions where status = 'open' loop
    if not exists (select 1 from sensory_session_panels where sensory_session_id = s.id)
       or not exists (select 1 from sensory_session_participants where sensory_session_id = s.id) then continue; end if;
    if exists (
      select 1
      from sensory_session_participants pp
      join sensory_session_panels sp on sp.sensory_session_id = pp.sensory_session_id
      join sensory_panels p on p.id = sp.panel_id
      join sensory_panel_batches pb on pb.panel_id = p.id
      where pp.sensory_session_id = s.id
        and not exists (select 1 from sensory_tastings t where t.taster_id = pp.user_id and t.batch_id = pb.batch_id and t.tasting_type = p.panel_type and t.spike_id is null)
    ) or exists (
      select 1
      from sensory_session_participants pp
      join sensory_spikes k on k.sensory_session_id = pp.sensory_session_id
      where pp.sensory_session_id = s.id
        and not exists (select 1 from sensory_tastings t where t.taster_id = pp.user_id and t.spike_id = k.id)
    ) then continue; end if;
    update sensory_sessions set status = 'complete', completed_at = now() where id = s.id;
    select string_agg(distinct '#' || b.batch_number || ' ' || k.name, ', ') into batches
      from sensory_session_panels sp join sensory_panel_batches pb on pb.panel_id = sp.panel_id
      join sensory_batches b on b.id = pb.batch_id join sensory_skus k on k.id = b.sku_id
      where sp.sensory_session_id = s.id;
    insert into admin_alerts (kind, message, raised_by_name) values ('sensory_session_complete', 'Sensory session complete: ' || s.label || coalesce(' (' || batches || ')', ''), 'Sensory');
    done := done + 1;
  end loop;
  return done;
end $$;
revoke all on function public.sensory_check_sessions() from public, anon;
grant execute on function public.sensory_check_sessions() to authenticated;
