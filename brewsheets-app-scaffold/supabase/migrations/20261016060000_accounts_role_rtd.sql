-- Accounts users only see the Excise tab; recipes say whether they're a beer or an RTD for excise.
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role = any (array['admin','user','accounts']));
alter table public.recipes add column if not exists is_rtd boolean not null default false;
