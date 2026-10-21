-- "On chill": a fermenting batch moves to chilling when its tank's Chill / Crash job is ticked
-- off on the schedule, and back to fermenting if that's unticked.
alter table public.batches drop constraint if exists batches_status_check;
alter table public.batches add constraint batches_status_check
  check (status = any (array['planned', 'brewing', 'fermenting', 'chilling', 'conditioning', 'packaged', 'archived']));

create or replace function public.chill_job_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lane = 'tank' and new.tank_id is not null and coalesce(new.text, '') ~* '(chill|crash)'
     and new.done is distinct from old.done then
    if new.done then
      update public.batches set status = 'chilling'
      where tank_id = new.tank_id and status = 'fermenting' and (date_brewed is null or date_brewed <= new.entry_date);
    else
      update public.batches set status = 'fermenting'
      where tank_id = new.tank_id and status = 'chilling';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists chill_job_status on public.schedule_entries;
create trigger chill_job_status after update of done on public.schedule_entries
  for each row execute function public.chill_job_status();

-- Batches already chilled before this existed.
update public.batches b set status = 'chilling'
where b.status = 'fermenting' and exists (
  select 1 from public.schedule_entries e
  where e.lane = 'tank' and e.tank_id = b.tank_id and e.done and coalesce(e.text, '') ~* '(chill|crash)'
    and (b.date_brewed is null or e.entry_date >= b.date_brewed));
