-- One-off import of the old sensory app's data (export_for_merge on that project), run at the
-- start of the merge and again at cutover. Upserts by id, so it can be re-run safely. The
-- duplicate "In The Pines" SKU (auto-created by the sheet sync) folds into the original.
create or replace function public.sensory_import(p json) returns json
language plpgsql security definer set search_path = public as $$
declare
  dup uuid := '66dd1454-37db-40e4-be41-3e1c454dfbba';
  itp uuid := '8d79b283-21e6-4289-9d91-152f4275759f';
  n json;
begin
  insert into sensory_profiles (id, name, email, role, created_at, app_user_id)
  select r.id, trim(r.name), r.email, r.role, r.created_at,
         (select u.id from app_users u where lower(u.email) = lower(r.email) limit 1)
  from json_populate_recordset(null::sensory_profiles, p->'profiles') r
  on conflict (id) do update set name = excluded.name, email = excluded.email, role = excluded.role,
    app_user_id = coalesce(sensory_profiles.app_user_id, excluded.app_user_id);

  insert into sensory_skus select * from json_populate_recordset(null::sensory_skus, p->'skus') r where r.id <> dup
  on conflict (id) do update set name = excluded.name, style = excluded.style, abv = excluded.abv,
    descriptors = excluded.descriptors, watchouts = excluded.watchouts, target = excluded.target,
    tolerance = excluded.tolerance, notes = excluded.notes, trait_config = excluded.trait_config;

  insert into sensory_batches (id, sku_id, batch_number, package_date, format, status, created_at, production_batch_id)
  select r.id, case when r.sku_id = dup then itp else r.sku_id end, r.batch_number, r.package_date, r.format, r.status, r.created_at,
         (select b.id from batches b where b.batch_number::text = r.batch_number limit 1)
  from json_populate_recordset(null::sensory_batches, p->'batches') r
  on conflict (id) do update set sku_id = excluded.sku_id, package_date = excluded.package_date, format = excluded.format,
    status = excluded.status, production_batch_id = coalesce(sensory_batches.production_batch_id, excluded.production_batch_id);

  insert into sensory_retention_checkpoints select * from json_populate_recordset(null::sensory_retention_checkpoints, p->'retention_checkpoints')
  on conflict (id) do update set due_date = excluded.due_date, assessed = excluded.assessed;

  insert into sensory_tastings select * from json_populate_recordset(null::sensory_tastings, p->'sessions')
  on conflict (id) do update set scores = excluded.scores, overall = excluded.overall, off_flavors = excluded.off_flavors,
    notes = excluded.notes, date = excluded.date, tasting_type = excluded.tasting_type, retention_checkpoint_id = excluded.retention_checkpoint_id;

  insert into sensory_panels select * from json_populate_recordset(null::sensory_panels, p->'panels')
  on conflict (id) do update set date = excluded.date, label = excluded.label, panel_type = excluded.panel_type;
  insert into sensory_panel_batches select * from json_populate_recordset(null::sensory_panel_batches, p->'panel_batches')
  on conflict (panel_id, batch_id) do update set sort_order = excluded.sort_order;
  insert into sensory_brite_checks select * from json_populate_recordset(null::sensory_brite_checks, p->'brite_checks')
  on conflict (id) do update set decision = excluded.decision, notes = excluded.notes;
  insert into sensory_sessions select * from json_populate_recordset(null::sensory_sessions, p->'sensory_sessions')
  on conflict (id) do update set status = excluded.status, completed_at = excluded.completed_at, label = excluded.label, date = excluded.date;
  insert into sensory_session_panels select * from json_populate_recordset(null::sensory_session_panels, p->'sensory_session_panels') on conflict do nothing;
  insert into sensory_session_participants select * from json_populate_recordset(null::sensory_session_participants, p->'sensory_session_participants') on conflict do nothing;
  insert into sensory_qc_locations select * from json_populate_recordset(null::sensory_qc_locations, p->'qc_locations')
  on conflict (id) do update set name = excluded.name, active = excluded.active, sort_order = excluded.sort_order;
  insert into sensory_qc_samples select * from json_populate_recordset(null::sensory_qc_samples, p->'qc_samples')
  on conflict (id) do update set notes = excluded.notes;
  insert into sensory_qc_tests select * from json_populate_recordset(null::sensory_qc_tests, p->'qc_tests')
  on conflict (id) do update set result = excluded.result, read_date = excluded.read_date, read_by = excluded.read_by, notes = excluded.notes;

  select json_build_object('profiles', (select count(*) from sensory_profiles), 'linked', (select count(*) from sensory_profiles where app_user_id is not null),
    'skus', (select count(*) from sensory_skus), 'batches', (select count(*) from sensory_batches),
    'checkpoints', (select count(*) from sensory_retention_checkpoints), 'tastings', (select count(*) from sensory_tastings),
    'panels', (select count(*) from sensory_panels), 'sessions', (select count(*) from sensory_sessions)) into n;
  return n;
end $$;
revoke all on function public.sensory_import(json) from public, anon, authenticated;
