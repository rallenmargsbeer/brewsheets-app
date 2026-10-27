-- Sensory batches and nightly jobs, now run by the production database.
--
-- Batches up to #424 still come from the Batch Log sheet: the old sensory project keeps its
-- nightly sheet sync running, and each night we copy across any new batches (and package dates
-- that have appeared) from it. From #425 on, sensory batches come from the production app:
-- created when the beer goes to the brite tank, and dated (with 30/90/180 day retention
-- checkpoints) from its first packaging session.

-- Which core SKU a production beer is: names compared ignoring case, spaces and punctuation,
-- either one starting with the other (Drift XPA -> Drift, Red -> Red IPA, Riverdog -> River Dog).
create or replace function public.sensory_sku_for(p_name text) returns uuid
language sql stable set search_path = public as $$
  select id from sensory_skus k,
    lateral (select regexp_replace(lower(k.name), '[^a-z]', '', 'g') a, regexp_replace(lower(coalesce(p_name, '')), '[^a-z]', '', 'g') b) n
  where n.b <> '' and (n.b like n.a || '%' or n.a like n.b || '%')
  order by length(n.a) desc limit 1;
$$;

create or replace function public.sensory_add_checkpoints(p_batch uuid, p_date date) returns void
language sql set search_path = public as $$
  insert into sensory_retention_checkpoints (batch_id, days, due_date)
  select p_batch, d, p_date + d from unnest(array[30, 90, 180]) d
  where not exists (select 1 from sensory_retention_checkpoints c where c.batch_id = p_batch and c.days = d);
$$;

-- From #425: make or update the sensory batch for a production batch.
create or replace function public.sensory_sync_production_batch(p_batch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; sku uuid; pk date; sid uuid;
begin
  select pb.id, pb.batch_number, pb.status, pb.bbt_transfer_date, coalesce(r.name, pb.beer_style) beer
    into b from batches pb left join recipes r on r.id = pb.recipe_id where pb.id = p_batch;
  if b.id is null or b.batch_number !~ '^\d+$' or b.batch_number::int < 425 then return; end if;
  select min(package_date) into pk from packaging_sessions where batch_id = b.id;
  if b.bbt_transfer_date is null and pk is null then return; end if; -- not in the brite tank yet
  sku := sensory_sku_for(b.beer);
  if sku is null then return; end if; -- core range only
  insert into sensory_batches (sku_id, batch_number, package_date, production_batch_id)
  values (sku, b.batch_number, pk, b.id)
  on conflict (batch_number) do update set production_batch_id = excluded.production_batch_id,
    package_date = coalesce(sensory_batches.package_date, excluded.package_date)
  returning id into sid;
  if pk is not null then perform sensory_add_checkpoints(sid, (select package_date from sensory_batches where id = sid)); end if;
end $$;

create or replace function public.sensory_on_batch() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform sensory_sync_production_batch(new.id); return new; end $$;
create or replace function public.sensory_on_packaging() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform sensory_sync_production_batch(new.batch_id); return new; end $$;
drop trigger if exists sensory_batch_feed on public.batches;
create trigger sensory_batch_feed after insert or update of bbt_transfer_date, status on public.batches
  for each row execute function public.sensory_on_batch();
drop trigger if exists sensory_packaging_feed on public.packaging_sessions;
create trigger sensory_packaging_feed after insert or update of package_date on public.packaging_sessions
  for each row execute function public.sensory_on_packaging();

-- Up to #424: new batches and newly packaged dates from the old project's export.
create or replace function public.sensory_import_sheet_batches(p json) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; itp uuid := '8d79b283-21e6-4289-9d91-152f4275759f'; dup uuid := '66dd1454-37db-40e4-be41-3e1c454dfbba';
begin
  insert into sensory_skus select * from json_populate_recordset(null::sensory_skus, p->'skus') k where k.id <> dup on conflict (id) do nothing;
  for r in select * from json_populate_recordset(null::sensory_batches, p->'batches') x
           where x.batch_number ~ '^\d+$' and x.batch_number::int <= 424 loop
    if not exists (select 1 from sensory_batches where batch_number = r.batch_number) then
      insert into sensory_batches (id, sku_id, batch_number, package_date, format, status, created_at, production_batch_id)
      values (r.id, case when r.sku_id = dup then itp else r.sku_id end, r.batch_number, r.package_date, r.format, r.status, r.created_at,
              (select id from batches where batch_number = r.batch_number limit 1));
      n := n + 1;
    elsif r.package_date is not null then
      update sensory_batches set package_date = r.package_date where batch_number = r.batch_number and package_date is null;
      if found then n := n + 1; end if;
    end if;
  end loop;
  insert into sensory_retention_checkpoints
  select c.* from json_populate_recordset(null::sensory_retention_checkpoints, p->'retention_checkpoints') c
  join sensory_batches b on b.id = c.batch_id
  where not exists (select 1 from sensory_retention_checkpoints x where x.batch_id = c.batch_id and x.days = c.days)
  on conflict (id) do nothing;
  return n;
end $$;

-- Nightly, step 1: ask the old project for its data (its address key and export token are in
-- Vault: sensory_old_publishable_key, sensory_merge_token). Step 2, five minutes later, imports it.
create or replace function public.sensory_sheet_fetch() returns void
language plpgsql security definer set search_path = public, vault as $$
declare rid bigint;
begin
  select net.http_post(url := 'https://qglmuisievxvntfgztfl.supabase.co/rest/v1/rpc/export_for_merge',
    headers := jsonb_build_object('apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'sensory_old_publishable_key'), 'Content-Type', 'application/json'),
    body := jsonb_build_object('p_token', (select decrypted_secret from vault.decrypted_secrets where name = 'sensory_merge_token')),
    timeout_milliseconds := 60000) into rid;
  insert into app_settings (key, data, updated_at) values ('sensory_sheet_request', to_jsonb(rid), now())
  on conflict (key) do update set data = excluded.data, updated_at = now();
end $$;
create or replace function public.sensory_sheet_import() returns integer
language plpgsql security definer set search_path = public as $$
declare rid bigint; res record;
begin
  select (data #>> '{}')::bigint into rid from app_settings where key = 'sensory_sheet_request';
  select status_code, content into res from net._http_response where id = rid;
  if res.status_code is distinct from 200 then
    insert into admin_alerts (kind, message, raised_by_name) values ('sensory_sync_failed', 'Sensory batch sync from the Batch Log sheet failed (' || coalesce(res.status_code::text, 'no response') || ').', 'Sensory');
    return null;
  end if;
  return sensory_import_sheet_batches(res.content::json);
end $$;

-- Session prep (was the old app's prepare-session): the night before the 1st and 3rd Thursday
-- (Perth time), make a TTT panel (batches packaged since the last session day) and a retention
-- panel (checkpoints due since then), wrap them in a session, and tell admins.
create or replace function public.sensory_prepare_session() returns text
language plpgsql security definer set search_path = public as $$
declare tomorrow date := (now() at time zone 'Australia/Perth')::date + 1; prev date; sid uuid; tp uuid; rp uuid; nt int; nr int;
begin
  if extract(dow from tomorrow) <> 4 or ceil(extract(day from tomorrow) / 7.0) not in (1, 3) then return 'not a session day'; end if;
  if exists (select 1 from sensory_panels where date = tomorrow) then return 'already prepared'; end if;
  -- The previous session day: the 1st or 3rd Thursday before tomorrow.
  select max(d)::date into prev from generate_series(tomorrow - 35, tomorrow - 1, interval '1 day') d
    where extract(dow from d) = 4 and ceil(extract(day from d) / 7.0) in (1, 3);
  select count(*) into nt from sensory_batches where package_date > prev and package_date <= tomorrow;
  select count(distinct batch_id) into nr from sensory_retention_checkpoints where not assessed and due_date > prev and due_date <= tomorrow;
  if nt = 0 and nr = 0 then return 'nothing due'; end if;
  insert into sensory_sessions (date, label) values (tomorrow, 'Session — ' || tomorrow) returning id into sid;
  if nt > 0 then
    insert into sensory_panels (date, label, panel_type) values (tomorrow, 'TTT Session — ' || tomorrow, 'ttt') returning id into tp;
    insert into sensory_panel_batches (panel_id, batch_id) select tp, id from sensory_batches where package_date > prev and package_date <= tomorrow;
    insert into sensory_session_panels values (sid, tp);
  end if;
  if nr > 0 then
    insert into sensory_panels (date, label, panel_type) values (tomorrow, 'Retention Session — ' || tomorrow, 'retention') returning id into rp;
    insert into sensory_panel_batches (panel_id, batch_id) select distinct rp, batch_id from sensory_retention_checkpoints where not assessed and due_date > prev and due_date <= tomorrow;
    insert into sensory_session_panels values (sid, rp);
  end if;
  insert into admin_alerts (kind, message, raised_by_name)
  values ('sensory_session_prep', 'Sensory session ' || to_char(tomorrow, 'Dy DD Mon') || ': ' || nt || ' TTT and ' || nr || ' retention batch' || case when nr = 1 then '' else 'es' end || ' ready. Add the tasters on the Sensory tab.', 'Sensory');
  return 'prepared';
end $$;

-- QC samples whose read is due today (Perth time) (was qc-incubation-reminder).
create or replace function public.sensory_qc_reminder() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from sensory_qc_tests where result = 'pending' and due_date = (now() at time zone 'Australia/Perth')::date;
  if n > 0 then
    insert into admin_alerts (kind, message, raised_by_name) values ('sensory_qc_due', n || ' QC sample' || case when n = 1 then ' is' else 's are' end || ' ready to read today (Sensory, QC Log).', 'Sensory');
  end if;
  return n;
end $$;

revoke all on function public.sensory_sync_production_batch(uuid), public.sensory_import_sheet_batches(json), public.sensory_sheet_fetch(),
  public.sensory_sheet_import(), public.sensory_prepare_session(), public.sensory_qc_reminder() from public, anon, authenticated;

-- Perth evening schedule (UTC): sheet copy 19:10 and 19:15 (after the old project's 19:00 sync),
-- session prep 19:20, session completion 19:25, QC reminder 19:30.
select cron.schedule('sensory-sheet-fetch', '10 19 * * *', 'select public.sensory_sheet_fetch()');
select cron.schedule('sensory-sheet-import', '15 19 * * *', 'select public.sensory_sheet_import()');
select cron.schedule('sensory-prepare-session', '20 19 * * *', 'select public.sensory_prepare_session()');
select cron.schedule('sensory-check-sessions', '25 19 * * *', 'select public.sensory_check_sessions()');
select cron.schedule('sensory-qc-reminder', '30 19 * * *', 'select public.sensory_qc_reminder()');
