-- The signed-in person's sensory profile: theirs if linked, else their old sensory profile
-- matched by email (linked now), else a new staff profile.
create or replace function public.sensory_me() returns setof public.sensory_profiles
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  select id, email, name into u from app_users where id = auth.uid() and status = 'active';
  if u.id is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from sensory_profiles where app_user_id = u.id) then
    update sensory_profiles set app_user_id = u.id
      where id = (select id from sensory_profiles where app_user_id is null and lower(email) = lower(u.email) order by created_at limit 1);
    if not found then
      insert into sensory_profiles (app_user_id, name, email) values (u.id, u.name, u.email);
    end if;
  end if;
  return query select * from sensory_profiles where app_user_id = u.id;
end $$;
revoke all on function public.sensory_me() from public, anon;
grant execute on function public.sensory_me() to authenticated;

-- Open sessions where every participant has tasted every batch in every panel (of that panel's
-- type) are marked complete, and admins get an alert. Run after each tasting and nightly.
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
        and not exists (select 1 from sensory_tastings t where t.taster_id = pp.user_id and t.batch_id = pb.batch_id and t.tasting_type = p.panel_type)
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
