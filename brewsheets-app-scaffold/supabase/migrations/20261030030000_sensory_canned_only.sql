-- Sensory tastes canned beer: a batch's sensory package date is its first canning run (a packaging
-- session with cubes), not a kegging-only one. Batches only ever kegged have no package date, so
-- they don't come up for tasting or retention.
create or replace function public.sensory_fill_package_dates() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    update sensory_batches s set package_date = p.d
    from (select batch_id, min(package_date) d from packaging_sessions where coalesce(cubes, 0) > 0 group by 1) p
    where p.batch_id = s.production_batch_id and s.package_date is null
    returning s.id, s.package_date
  loop
    perform sensory_add_checkpoints(r.id, r.package_date);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.sensory_sync_production_batch(p_batch uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; sku uuid; pk date; sid uuid;
begin
  select pb.id, pb.batch_number, pb.status, pb.bbt_transfer_date, coalesce(r.name, pb.beer_style) beer
    into b from batches pb left join recipes r on r.id = pb.recipe_id where pb.id = p_batch;
  if b.id is null or b.batch_number !~ '^\d+$' or b.batch_number::int < 425 then return; end if;
  select min(package_date) into pk from packaging_sessions where batch_id = b.id and coalesce(cubes, 0) > 0;
  if b.bbt_transfer_date is null and not exists (select 1 from packaging_sessions where batch_id = b.id) then return; end if; -- not in the brite tank yet
  sku := sensory_sku_for(b.beer);
  if sku is null then return; end if; -- core range only
  insert into sensory_batches (sku_id, batch_number, package_date, production_batch_id)
  values (sku, b.batch_number, pk, b.id)
  on conflict (batch_number) do update set production_batch_id = excluded.production_batch_id,
    package_date = coalesce(sensory_batches.package_date, excluded.package_date)
  returning id into sid;
  if pk is not null then perform sensory_add_checkpoints(sid, (select package_date from sensory_batches where id = sid)); end if;
end $$;
-- A packaging session's cubes can be filled in after it's first saved.
create or replace trigger sensory_packaging_feed after insert or update of package_date, cubes on public.packaging_sessions
  for each row execute function public.sensory_on_packaging();
revoke all on function public.sensory_fill_package_dates(), public.sensory_sync_production_batch(uuid) from public, anon, authenticated;
