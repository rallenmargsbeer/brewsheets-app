-- Copy the Unleashed bills of materials (beers and packaged products) daily, after the
-- ingredient sync. Read-only toward Unleashed.
select cron.schedule('bom-daily-sync', '45 21 * * *', $$
  select net.http_post(
    url := 'https://aalplzzyijrmucgkxoko.supabase.co/functions/v1/unleashed-bom',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret' limit 1)),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  )
$$);
