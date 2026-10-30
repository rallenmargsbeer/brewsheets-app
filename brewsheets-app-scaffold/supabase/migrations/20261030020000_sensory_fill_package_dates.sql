-- Batches up to #424 come from the Batch Log sheet, which doesn't always have the package date, and a
-- sensory batch without one doesn't show up for tasting. Each night, after the sheet import, fill any
-- missing package date from the production app's first packaging session and add its 30/90/180 day
-- retention checkpoints.
create or replace function public.sensory_fill_package_dates() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    update sensory_batches s set package_date = p.d
    from (select batch_id, min(package_date) d from packaging_sessions group by 1) p
    where p.batch_id = s.production_batch_id and s.package_date is null
    returning s.id, s.package_date
  loop
    perform sensory_add_checkpoints(r.id, r.package_date);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.sensory_sheet_import() returns integer
language plpgsql security definer set search_path = public as $$
declare rid bigint; res record; n integer;
begin
  select (data #>> '{}')::bigint into rid from app_settings where key = 'sensory_sheet_request';
  select status_code, content into res from net._http_response where id = rid;
  if res.status_code is distinct from 200 then
    insert into admin_alerts (kind, message, raised_by_name) values ('sensory_sync_failed', 'Sensory batch sync from the Batch Log sheet failed (' || coalesce(res.status_code::text, 'no response') || ').', 'Sensory');
    perform sensory_fill_package_dates();
    return null;
  end if;
  n := sensory_import_sheet_batches(res.content::json);
  return n + sensory_fill_package_dates();
end $$;

revoke all on function public.sensory_fill_package_dates(), public.sensory_sheet_import() from public, anon, authenticated;
