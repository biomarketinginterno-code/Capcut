-- CRM Peques: esquema de la base de datos.
-- Se aplica igual en Supabase (Postgres) y en los tests (PGlite).
-- Todas las tablas quedan con RLS activado y SIN políticas: la API pública de Supabase (anon/authenticated)
-- no puede leer ni escribir nada. Solo accede la Edge Function `api`, con credenciales de servidor.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.settings (
  key text primary key,
  value text not null
);

create table if not exists public.contacts (
  id integer generated always as identity primary key,
  name text not null,
  phone text not null,                       -- internacional, solo dígitos: 5492234567890
  phone_key text not null unique,            -- últimos 10 dígitos (duplicados y cruce de respuestas)
  email text not null default '',
  child_name text not null default '',
  child_age text not null default '',
  kids_count integer not null default 1,
  status text not null default 'nuevo',
  tags text not null default '',             -- ",vip,sala-1,"  (comas a los lados para filtrar con LIKE)
  notes text not null default '',
  source text not null default '',
  opted_out boolean not null default false,
  unread integer not null default 0,
  last_inbound_at timestamptz,               -- abre la ventana de 24 h de WhatsApp
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_contacts_status on public.contacts (status);
create index if not exists idx_contacts_last_msg on public.contacts (last_message_at);

create table if not exists public.messages (
  id integer generated always as identity primary key,
  contact_id integer not null references public.contacts (id) on delete cascade,
  direction text not null,                   -- in | out
  body text not null,
  kind text not null default 'text',         -- text | template
  status text not null,                      -- received | sent | delivered | read | failed
  wa_id text,
  error text,
  source text not null default '',
  campaign_id integer,
  automation_id integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_contact on public.messages (contact_id, id);
create index if not exists idx_messages_wa on public.messages (wa_id);
create index if not exists idx_messages_campaign on public.messages (campaign_id);
-- Meta puede reenviar un mismo mensaje entrante; el id de WhatsApp no se registra dos veces.
create unique index if not exists uq_messages_in_wa on public.messages (wa_id) where direction = 'in' and wa_id is not null;

create table if not exists public.campaigns (
  id integer generated always as identity primary key,
  name text not null,
  body text not null,
  template jsonb,
  filter jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null,
  total integer not null default 0,
  cancelled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.automations (
  id integer generated always as identity primary key,
  name text not null,
  trigger text not null,                     -- contact_created | status_changed | before_event | after_event | keyword
  config jsonb not null default '{}'::jsonb,
  body text not null default '',
  template jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cada contacto recibe cada automatización (salvo palabras clave) una sola vez.
create table if not exists public.automation_runs (
  automation_id integer not null references public.automations (id) on delete cascade,
  contact_id integer not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (automation_id, contact_id)
);

-- Cola de envío: todo lo que sale por WhatsApp pasa por acá (reintentos, ritmo, bajas).
create table if not exists public.outbox (
  id integer generated always as identity primary key,
  contact_id integer not null references public.contacts (id) on delete cascade,
  body text not null,                        -- texto con {{variables}}; se completa al enviar
  template jsonb,
  send_at timestamptz not null,
  status text not null default 'pending',    -- pending | sending | sent | failed | cancelled
  attempts integer not null default 0,
  error text,
  campaign_id integer references public.campaigns (id) on delete set null,
  automation_id integer references public.automations (id) on delete set null,
  source text not null default '',
  ignore_optout boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_outbox_due on public.outbox (status, send_at);
create index if not exists idx_outbox_campaign on public.outbox (campaign_id);

-- Intentos fallidos de login por IP (límite sin estado en memoria: la función se apaga entre llamadas).
create table if not exists public.login_attempts (
  ip text primary key,
  n integer not null default 0,
  until_at timestamptz not null
);

-- Secretos generados una sola vez: firma de sesiones y llave del cron.
insert into public.settings (key, value) values
  ('session_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Seguridad: RLS sin políticas = nadie por la API pública.
alter table public.settings enable row level security;
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.campaigns enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.outbox enable row level security;
alter table public.login_attempts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
  end if;
end $$;
