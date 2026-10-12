-- Pull stock and sales every morning at 5:30am Perth (21:30 UTC) so a daily snapshot builds up.
select cron.schedule('stock-daily-sync', '30 21 * * *', $$
  select net.http_post(
    url := 'https://aalplzzyijrmucgkxoko.supabase.co/functions/v1/stock-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='sync_cron_secret' limit 1)),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
