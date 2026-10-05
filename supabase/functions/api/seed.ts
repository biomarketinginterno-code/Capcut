// @ts-nocheck
import { db } from './db.ts';
import * as automations from './automations.ts';

// Automatizaciones de arranque. Las que envían mensajes por calendario/alta vienen APAGADAS:
// primero cargá la fecha del evento y revisá los textos. Las de respuesta (SI / NO / BAJA) vienen activas.
// Los nombres de plantilla coinciden con los del README (hay que crearlas y aprobarlas en Meta).
export const DEFAULTS = [
  {
    name: 'Bienvenida',
    trigger: 'contact_created',
    config: { delay_minutes: 0 },
    body: '¡Hola {{nombre}}! 🎈 Gracias por tu interés en *{{evento}}*. Será el {{fecha}} a las {{hora}} en {{lugar}}. ¿Querés reservar lugar para tus peques? Respondé *SI* y los anotamos. Si no querés recibir más mensajes, respondé *BAJA*.',
    template: { name: 'bienvenida_evento', lang: 'es_AR', params: ['nombre', 'evento', 'fecha', 'hora', 'lugar'] },
    active: false,
  },
  {
    name: 'Recordatorio: 1 día antes',
    trigger: 'before_event',
    config: { offset_minutes: 24 * 60, filter: { statuses: ['confirmado'] } },
    body: '¡Hola {{nombre}}! 🎉 Te recordamos que mañana es *{{evento}}*. ⏰ {{hora}} 📍 {{lugar}}. ¡Los esperamos!',
    template: { name: 'recordatorio_evento', lang: 'es_AR', params: ['nombre', 'evento', 'hora', 'lugar'] },
    active: false,
  },
  {
    name: 'Recordatorio: 2 horas antes',
    trigger: 'before_event',
    config: { offset_minutes: 120, filter: { statuses: ['confirmado'] } },
    body: '¡Hola {{nombre}}! Hoy es el gran día 🎈 Los esperamos a las {{hora}} en {{lugar}} ({{direccion}}).',
    template: { name: 'recordatorio_hoy', lang: 'es_AR', params: ['nombre', 'hora', 'lugar', 'direccion'] },
    active: false,
  },
  {
    name: 'Agradecimiento después del evento',
    trigger: 'after_event',
    config: { offset_minutes: 180, filter: { statuses: ['confirmado', 'asistio'] } },
    body: '¡Gracias por venir a *{{evento}}*, {{nombre}}! 💛 Esperamos que los peques la hayan pasado genial. Contanos qué te pareció respondiendo este mensaje.',
    template: { name: 'gracias_evento', lang: 'es_AR', params: ['nombre', 'evento'] },
    active: false,
  },
  {
    name: 'Respuesta: SI (confirma asistencia)',
    trigger: 'keyword',
    config: { keywords: ['si', 'sí', 'dale', 'confirmo', 'confirmado', 'voy', 'vamos', '1'], set_status: 'confirmado' },
    body: '¡Perfecto {{nombre}}! ✅ Quedaron confirmados para *{{evento}}*: {{fecha}}, {{hora}} en {{lugar}}. ¡Los esperamos! 🎈',
    template: null,
    active: true,
  },
  {
    name: 'Respuesta: NO (no puede asistir)',
    trigger: 'keyword',
    config: { keywords: ['no', 'no puedo', 'no voy', 'no vamos', '2'], set_status: 'no_asistio' },
    body: 'Gracias por avisarnos, {{nombre}}. ¡Ojalá nos veamos en la próxima! 💛',
    template: null,
    active: true,
  },
  {
    name: 'Respuesta: BAJA (no recibir más mensajes)',
    trigger: 'keyword',
    config: { keywords: ['baja', 'stop', 'parar', 'no quiero recibir mas', 'no me escriban mas', 'cancelar suscripcion'], opt_out: true },
    body: 'Listo, no te vamos a escribir más. Si fue un error, escribinos y te volvemos a sumar.',
    template: null,
    active: true,
  },
];

let done = false;

/**
 * Crea las automatizaciones de arranque la primera vez. Queda una marca (settings.seeded): si más adelante se borran
 * todas, no reaparecen, y si dos instancias arrancan a la vez (arranque en frío) solo una siembra (cerrojo de Postgres).
 */
export async function ensureSeed() {
  if (done) return false;
  const seeded = await db.tx(async () => {
    await db.query('select pg_advisory_xact_lock(7101)');
    if (await db.val("select 1 from settings where key = 'seeded'")) return false;
    const n = await db.val('select count(*)::int from automations'); // bases anteriores a la marca: ya estaban sembradas
    if (n === 0) for (const a of DEFAULTS) await automations.create(a);
    await db.query("insert into settings (key, value) values ('seeded', '1') on conflict (key) do nothing");
    return n === 0;
  });
  done = true;
  return seeded;
}

export const resetSeedFlag = () => { done = false; };
