-- Cron del CRM (solo Supabase: usa pg_cron + pg_net; por eso el nombre termina en _cron y los tests lo saltean).
-- Cada minuto llama a la función `api` (/internal/tick) con una llave compartida:
--   - envía los mensajes pendientes de la cola (reintentos y campañas programadas)
--   - dispara los recordatorios por fecha del evento
-- La dirección de la función y la llave salen de la tabla `settings` (api_url y cron_secret), así esta migración
-- sirve para cualquier proyecto: solo hay que cargar api_url (ver README).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'crm-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.settings where key = 'api_url') || '/internal/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.settings where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
