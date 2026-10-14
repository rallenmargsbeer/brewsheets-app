-- Staff accounts: sign up with an @margaretriverbeer.co email and a unique 4-digit PIN,
-- confirm the email, then an admin approves. Sign-in is by PIN only (pin-auth function).
create table if not exists public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  pin_hmac text unique, -- HMAC of the PIN (never the PIN itself); null after an admin resets it
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text
);
alter table public.app_users enable row level security;

-- Failed / successful PIN attempts, for lockout.
create table if not exists public.pin_attempts (
  id bigserial primary key,
  ip text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
alter table public.pin_attempts enable row level security;
create index if not exists pin_attempts_ip_at on public.pin_attempts (ip, at);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users u where u.id = auth.uid() and u.role = 'admin' and u.status = 'active');
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users u where u.id = auth.uid() and u.status = 'active');
$$;

-- Existing checks: admins edit (schedule, recipes, forecast…); every active user can view
-- stock and reports data. The old email lists still count.
create or replace function public.is_schedule_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.schedule_editors e where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.is_report_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() or exists (
    select 1 from public.report_viewers v where lower(v.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Users see their own row; admins see and manage everyone.
create policy "own row" on public.app_users for select using (id = auth.uid() or public.is_admin());
create policy "admins update" on public.app_users for update using (public.is_admin());
create policy "admins delete" on public.app_users for delete using (public.is_admin());
grant select, update, delete on public.app_users to authenticated;
grant all on public.app_users, public.pin_attempts to service_role;
grant usage, select on sequence public.pin_attempts_id_seq to service_role;

-- For the pin-auth function (service role only): an auth user by email, and whether the
-- email is confirmed.
create or replace function public.auth_user_by_email(p_email text)
returns table (id uuid, confirmed boolean)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email_confirmed_at is not null from auth.users u where lower(u.email) = lower(p_email) limit 1;
$$;
revoke all on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_by_email(text) to service_role;

-- Admins see who has confirmed their email.
create or replace function public.app_users_confirmed()
returns table (id uuid, confirmed boolean)
language sql stable security definer set search_path = public, auth as $$
  select a.id, u.email_confirmed_at is not null from public.app_users a join auth.users u on u.id = a.id where public.is_admin();
$$;
grant execute on function public.app_users_confirmed() to authenticated;

-- Any active user can tick a schedule task done (only the done flag).
create or replace function public.set_task_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_active_user() or public.is_schedule_editor()) then raise exception 'sign in required'; end if;
  update public.schedule_entries set done = p_done where id = p_id;
end $$;
revoke all on function public.set_task_done(uuid, boolean) from public, anon;
grant execute on function public.set_task_done(uuid, boolean) to authenticated;
