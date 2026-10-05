// @ts-nocheck
import { db, getSettings, HttpError } from './db.ts';
import * as contacts from './contacts.ts';
import * as queue from './queue.ts';
import { bus } from './bus.ts';
import { localToDate } from './time.ts';
import { cleanTemplate } from './template.ts';

export const TRIGGERS = {
  contact_created: 'Cuando se agrega un contacto',
  status_changed: 'Cuando un contacto cambia de estado',
  before_event: 'Un tiempo antes del evento',
  after_event: 'Un tiempo después del evento',
  keyword: 'Cuando el contacto responde una palabra clave',
};

const BEFORE_GRACE_MS = 6 * 3600 * 1000;   // si el cron estuvo caído, un recordatorio se puede enviar hasta 6 h tarde
const AFTER_GRACE_MS = 48 * 3600 * 1000;

const toApi = (r) => ({ ...r, config: r.config || {}, template: r.template || null });

export function normalizeText(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanConfig(trigger, c = {}) {
  const filter = {
    statuses: (c.filter?.statuses || []).filter((s) => contacts.STATUS_IDS.includes(s)),
    tags: contacts.normalizeTags(c.filter?.tags || []),
  };
  switch (trigger) {
    case 'contact_created':
      return { delay_minutes: Math.max(0, Number(c.delay_minutes) || 0) };
    case 'status_changed':
      if (!contacts.STATUS_IDS.includes(c.status)) throw new HttpError(400, 'Elegí el estado que dispara la automatización');
      return { status: c.status, delay_minutes: Math.max(0, Number(c.delay_minutes) || 0) };
    case 'before_event':
    case 'after_event': {
      const offset = Math.round(Number(c.offset_minutes));
      if (!(offset >= 0)) throw new HttpError(400, 'Indicá cuánto tiempo antes/después del evento');
      return { offset_minutes: offset, filter };
    }
    case 'keyword': {
      const keywords = [...new Set((Array.isArray(c.keywords) ? c.keywords : String(c.keywords || '').split(/[,\n]/))
        .map(normalizeText).filter(Boolean))]; // «si» y «sí» son la misma palabra
      if (!keywords.length) throw new HttpError(400, 'Indicá al menos una palabra clave');
      const out = { keywords };
      if (c.set_status && contacts.STATUS_IDS.includes(c.set_status)) out.set_status = c.set_status;
      if (c.add_tag) out.add_tag = contacts.normalizeTags([c.add_tag])[0];
      if (c.opt_out) out.opt_out = true;
      return out;
    }
    default:
      throw new HttpError(400, 'Disparador inválido');
  }
}

function validate(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new HttpError(400, 'Falta el nombre');
  if (!TRIGGERS[input.trigger]) throw new HttpError(400, 'Disparador inválido');
  const config = cleanConfig(input.trigger, input.config);
  const body = String(input.body || '').trim();
  const template = cleanTemplate(input.template);
  // una palabra clave puede limitarse a hacer algo (cambiar estado, etiquetar, dar de baja) sin responder
  const hasAction = input.trigger === 'keyword' && (config.set_status || config.add_tag || config.opt_out);
  if (!body && !template && !hasAction) throw new HttpError(400, 'Escribí el mensaje');
  return { name, trigger: input.trigger, config, body, template, active: Boolean(input.active) };
}

export async function list() {
  return (await db.query('select * from automations order by id')).map(toApi);
}

export async function get(id) {
  const r = await db.one('select * from automations where id = $1', [id]);
  if (!r) throw new HttpError(404, 'Automatización no encontrada');
  return toApi(r);
}

export async function create(input) {
  const v = validate(input);
  const id = await db.val(
    'insert into automations (name, trigger, config, body, template, active) values ($1,$2,$3::text::jsonb,$4,$5::text::jsonb,$6) returning id',
    [v.name, v.trigger, JSON.stringify(v.config), v.body, v.template ? JSON.stringify(v.template) : null, v.active],
  );
  return get(id);
}

export async function update(id, input) {
  const cur = await get(id);
  const v = validate({ ...cur, ...input, config: input.config ?? cur.config, template: input.template === undefined ? cur.template : input.template });
  await db.query('update automations set name=$1, trigger=$2, config=$3::text::jsonb, body=$4, template=$5::text::jsonb, active=$6 where id=$7',
    [v.name, v.trigger, JSON.stringify(v.config), v.body, v.template ? JSON.stringify(v.template) : null, v.active, id]);
  return get(id);
}

export async function setActive(id, active) {
  await get(id);
  await db.query('update automations set active = $1 where id = $2', [Boolean(active), id]);
  return get(id);
}

export async function remove(id) {
  if (!(await db.query('delete from automations where id = $1 returning id', [id])).length) throw new HttpError(404, 'Automatización no encontrada');
}

// ---- ejecución ----

/** Encola el mensaje de la automatización para el contacto, una sola vez por contacto. */
async function runFor(a, contact, delayMinutes = 0) {
  if (contact.opted_out) return false;
  const fresh = await db.query(
    'insert into automation_runs (automation_id, contact_id) values ($1, $2) on conflict do nothing returning automation_id',
    [a.id, contact.id],
  );
  if (!fresh.length) return false;
  await queue.enqueue({
    contactId: contact.id, body: a.body, template: a.template,
    sendAt: new Date(Date.now() + delayMinutes * 60000),
    automationId: a.id, source: `automatización: ${a.name}`,
  });
  return true;
}

const active = async (trigger) =>
  (await db.query('select * from automations where active = true and trigger = $1 order by id', [trigger])).map(toApi);

export async function onContactCreated(contact) {
  for (const a of await active('contact_created')) await runFor(a, contact, a.config.delay_minutes);
}

export async function onStatusChanged(contact) {
  for (const a of await active('status_changed')) {
    if (a.config.status === contact.status) await runFor(a, contact, a.config.delay_minutes);
  }
}

// Se registran una vez por instancia de la función (al importar el módulo).
bus.on('contact:created', onContactCreated);
bus.on('contact:status', onStatusChanged);

/** Recordatorios/agradecimientos relativos a la fecha del evento. Lo llama el cron cada minuto. */
export async function schedulerTick(now = Date.now()) {
  const s = await getSettings();
  const eventAt = localToDate(s.event_at_local, s.timezone);
  if (!eventAt) return 0;
  let queued = 0;
  for (const a of [...(await active('before_event')), ...(await active('after_event'))]) {
    const before = a.trigger === 'before_event';
    const target = eventAt.getTime() + (before ? -1 : 1) * a.config.offset_minutes * 60000;
    const late = now - target;
    if (late < 0) continue;                                           // todavía no es la hora
    if (late > (before ? BEFORE_GRACE_MS : AFTER_GRACE_MS)) continue; // ya pasó demasiado
    if (before && now >= eventAt.getTime()) continue;                 // el evento ya empezó
    const f = a.config.filter || {};
    for (const c of await contacts.list({ statuses: f.statuses, tags: f.tags, optedOut: 'exclude' })) {
      if (await runFor(a, c)) queued++;
    }
  }
  return queued;
}

// ---- respuestas por palabra clave ----

/** Devuelve la automatización de palabra clave que coincide (gana la palabra más larga). */
export async function matchKeyword(text) {
  const t = normalizeText(text);
  if (!t) return null;
  let best = null;
  for (const a of await active('keyword')) {
    for (const k of a.config.keywords || []) {
      if ((t === k || t.startsWith(k + ' ')) && (!best || k.length > best.len)) best = { a, len: k.length };
    }
  }
  return best?.a || null;
}

export async function onInbound(contact, text) {
  const a = await matchKeyword(text);
  if (!a) return null;
  const c = a.config;
  if (c.opt_out) await contacts.setOptOut(contact.id, true);
  if (c.add_tag) await contacts.addTags(contact.id, [c.add_tag]);
  if (c.set_status) await contacts.setStatus(contact.id, c.set_status);
  if (a.body || a.template) {
    await queue.enqueue({
      contactId: contact.id, body: a.body, template: a.template,
      automationId: a.id, source: `automatización: ${a.name}`,
      ignoreOptout: Boolean(c.opt_out), // la confirmación de la baja sí se envía
    });
  }
  return a;
}
