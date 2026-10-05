-- Cron más robusto (solo Supabase; el nombre termina en _cron_fix y los tests lo saltean):
--  - la dirección de la función tolera una barra final en settings.api_url
--  - limpia el historial de ejecuciones de pg_cron (crecía sin límite)
-- (cron.schedule con el mismo nombre reemplaza el trabajo existente)
select cron.schedule(
  'crm-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := rtrim(coalesce((select value from public.settings where key = 'api_url'), ''), '/') || '/internal/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select value from public.settings where key = 'cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

select cron.schedule(
  'crm-cron-cleanup',
  '17 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '2 days'; $$
);
