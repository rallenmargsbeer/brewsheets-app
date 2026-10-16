-- Lock the database to signed-in, approved staff. Reading needs an active app user (any role);
-- changing production data needs an active admin or user (not accounts). Edge functions and
-- cron syncs use the service role and are unaffected.
create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users u where u.id = auth.uid() and u.status = 'active' and u.role in ('admin', 'user'));
$$;
revoke execute on function public.can_edit() from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'batches','brew_runs','brew_run_ingredients','cellar_tasks','fermentation_readings','ingredients',
    'packaging_do_checks','packaging_sessions','recipes','recipe_grist_items','recipe_water_additions',
    'recipe_kettle_additions','recipe_whirlpool_additions','recipe_fermenter_additions','recipe_blend_items',
    'batch_blend_items','tank_additions','tanks']
  loop
    execute format('drop policy if exists "open access - no auth yet" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_active_user())', t);
    execute format('create policy "staff insert" on public.%I for insert to authenticated with check (public.can_edit())', t);
    execute format('create policy "staff update" on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit())', t);
    execute format('create policy "staff delete" on public.%I for delete to authenticated using (public.can_edit())', t);
  end loop;

  -- Tables that anyone could read: staff only now (writes keep their existing editor/admin rules).
  foreach t in array array['app_settings','beer_colours','brew_bookings','brew_settings','cellar_template_steps','cellar_templates','schedule_editors','schedule_entries']
  loop
    execute format('drop policy if exists "read all" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_active_user() or public.is_schedule_editor())', t);
  end loop;
end $$;

-- The FV litres view now runs with the reader's permissions, so the rules above apply to it.
alter view public.app_batch_fv set (security_invoker = true);
revoke all on public.app_batch_fv from anon;

-- Only signed-in staff can link a booking to a batch.
create or replace function public.link_booking_to_batch(p_booking uuid, p_batch uuid) returns void
language sql security definer set search_path = public as $$
  update public.brew_bookings set batch_id = p_batch
  where id = p_booking and batch_id is null and public.can_edit()
    and exists (select 1 from public.batches where id = p_batch);
$$;
revoke execute on function public.link_booking_to_batch(uuid, uuid) from anon, public;
grant execute on function public.link_booking_to_batch(uuid, uuid) to authenticated;
