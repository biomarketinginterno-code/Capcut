-- Endurecimiento (tras la revisión independiente):
--  1) Lista de supresión: quien pidió la baja sigue dado de baja aunque se borre el contacto o se reimporte la planilla.
--  2) Registro del consentimiento: cuándo y cómo aceptó recibir mensajes cada contacto.

create table if not exists public.suppressions (
  phone_key text primary key,
  created_at timestamptz not null default now()
);
alter table public.suppressions enable row level security;

alter table public.contacts add column if not exists consent_at timestamptz;
alter table public.contacts add column if not exists consent_note text not null default '';

-- los que ya pidieron la baja entran a la lista
insert into public.suppressions (phone_key)
select phone_key from public.contacts where opted_out
on conflict do nothing;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.suppressions from anon, authenticated';
  end if;
end $$;

-- cancelar lo encolado de una automatización al apagarla/borrarla
create index if not exists idx_outbox_automation on public.outbox (automation_id);
