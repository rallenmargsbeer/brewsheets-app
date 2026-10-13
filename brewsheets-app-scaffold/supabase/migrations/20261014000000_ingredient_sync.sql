-- Ingredients sync from Unleashed (ingredient-sync function, daily): new ones are flagged
-- for an editor to check.
alter table public.ingredients add column if not exists needs_review boolean not null default false;
alter table public.ingredients add column if not exists synced_at timestamptz;
grant select, insert, update on public.ingredients to service_role;

-- Daily at 05:35 Perth (21:35 UTC), just after the stock sync.
select cron.schedule(
  'ingredient-daily-sync',
  '35 21 * * *',
  $$select net.http_post(
    url := 'https://aalplzzyijrmucgkxoko.supabase.co/functions/v1/ingredient-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret' limit 1)),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  )$$
);
