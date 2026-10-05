// @ts-nocheck
import { db, getSettings, HttpError, placeholders } from './db.ts';
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

// ---- baja (BAJA / STOP): reconocida siempre, sin depender de ninguna automatización editable ----
export const OPT_OUT_REPLY = 'Listo, no te vamos a escribir más. Si fue un error, escribinos y te volvemos a sumar.';
const OPT_OUT_FIRST = new Set(['baja', 'stop', 'parar', 'basta', 'unsubscribe', 'desuscribir', 'desuscribirme', 'desuscribirse']);
const OPT_OUT_PHRASES = [
  /\bno (me |nos )?(quiero|queremos|quiere|quieren) (recibir|mas mensajes|mas msj|que (me |nos )?(escriban|escribas|manden|mandes|envien|envies))/,
  /\bno (me|nos) (escriban|escribas|escriba|manden|mandes|envien|envies|molesten|molestes|contacten|contactes|hablen|hables|llamen|llames|sigan)\b/,
  /\b(darme|dar|dame|denme|deme|danme|dennos|dennos) de baja\b/,
  /\bde baja\b.*\b(favor|lista|mensajes)\b/,
  /\bcancel(ar|en|a) (la |mi )?suscripcion\b/,
  /\b(dej(a|en|ar|ame|enme)|paren|pare) (de )?(escribir|escribirme|mandar|mandarme|enviar|enviarme|molestar)/,
  /\b(saquen|sacame|sacar|saquenme|borren|borrame|eliminen|eliminame)( me)? (de )?(la |esta )?(lista|base|agenda)/,
];

/** ¿El mensaje pide no recibir más mensajes? Se evalúa antes que cualquier palabra clave («No me escribas más» no es un «NO»). */
export function isOptOut(text) {
  const t = normalizeText(text).replace(/(.)\1{2,}/g, '$1');
  if (!t) return false;
  if (OPT_OUT_FIRST.has(t.split(' ')[0])) return true;
  return OPT_OUT_PHRASES.some((re) => re.test(t));
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
      if (!(offset >= (trigger === 'before_event' ? 1 : 0))) throw new HttpError(400, trigger === 'before_event' ? 'Indicá cuánto tiempo antes del evento (al menos 1 minuto)' : 'Indicá cuánto tiempo después del evento');
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

/** Lo que una automatización dejó en la cola y todavía no salió se cancela cuando se apaga o se borra. */
const cancelQueued = (id) =>
  db.query("update outbox set status = 'cancelled', error = 'La automatización se apagó o se borró' where automation_id = $1 and status = 'pending'", [id]);

export async function update(id, input) {
  const cur = await get(id);
  const v = validate({ ...cur, ...input, config: input.config ?? cur.config, template: input.template === undefined ? cur.template : input.template });
  await db.tx(async () => {
    await db.query('update automations set name=$1, trigger=$2, config=$3::text::jsonb, body=$4, template=$5::text::jsonb, active=$6 where id=$7',
      [v.name, v.trigger, JSON.stringify(v.config), v.body, v.template ? JSON.stringify(v.template) : null, v.active, id]);
    if (cur.active && !v.active) await cancelQueued(id);
  });
  return get(id);
}

export async function setActive(id, active) {
  await get(id);
  await db.tx(async () => {
    await db.query('update automations set active = $1 where id = $2', [Boolean(active), id]);
    if (!active) await cancelQueued(id);
  });
  return get(id);
}

export async function remove(id) {
  await db.tx(async () => {
    await cancelQueued(id);
    if (!(await db.query('delete from automations where id = $1 returning id', [id])).length) throw new HttpError(404, 'Automatización no encontrada');
  });
}

// ---- ejecución ----

const outboxFor = (a, sendAt, n) => ({
  sql: `insert into outbox (contact_id, body, template, send_at, automation_id, source)
        select id, $1::text, $2::text::jsonb, $3::timestamptz, $4::int, $5::text from contacts
        where opted_out = false and id in (${placeholders(n, 6)})`,
  params: [a.body, a.template ? JSON.stringify(a.template) : null, sendAt, a.id, `automatización: ${a.name}`],
});

/** Marca «ya corrió» y encola, en una sola transacción: no puede quedar lo uno sin lo otro. */
async function enqueueFresh(a, freshIds, sendAt) {
  for (let i = 0; i < freshIds.length; i += 1000) {
    const chunk = freshIds.slice(i, i + 1000);
    const o = outboxFor(a, sendAt, chunk.length);
    await db.query(o.sql, [...o.params, ...chunk]);
  }
}

/** Encola el mensaje de la automatización para cada contacto, una sola vez por contacto (por lotes). Devuelve cuántos. */
async function runForMany(a, list, delayMinutes = 0) {
  const ids = list.filter((c) => !c.opted_out).map((c) => c.id);
  const sendAt = new Date(Date.now() + delayMinutes * 60000).toISOString();
  let n = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    n += await db.tx(async () => {
      const fresh = await db.query(
        `insert into automation_runs (automation_id, contact_id)
         select $1::int, id from contacts where opted_out = false and id in (${placeholders(chunk.length, 2)})
         on conflict do nothing returning contact_id`,
        [a.id, ...chunk],
      );
      await enqueueFresh(a, fresh.map((r) => r.contact_id), sendAt);
      return fresh.length;
    });
  }
  return n;
}

const runFor = async (a, contact, delayMinutes = 0) => (await runForMany(a, [contact], delayMinutes)) > 0;

const active = async (trigger) =>
  (await db.query('select * from automations where active = true and trigger = $1 order by id', [trigger])).map(toApi);

export async function onContactCreated(contact) {
  for (const a of await active('contact_created')) await runFor(a, contact, a.config.delay_minutes);
}

/** Importación masiva: una consulta por automatización, no por contacto. */
export async function onContactsCreated(list) {
  for (const a of await active('contact_created')) await runForMany(a, list, a.config.delay_minutes);
}

export async function onStatusChanged(contact) {
  for (const a of await active('status_changed')) {
    if (a.config.status === contact.status) await runFor(a, contact, a.config.delay_minutes);
  }
}

export async function onStatusChangedMany(list) {
  for (const a of await active('status_changed')) {
    await runForMany(a, list.filter((c) => c.status === a.config.status), a.config.delay_minutes);
  }
}

// Se registran una vez por instancia de la función (al importar el módulo).
bus.on('contact:created', onContactCreated);
bus.on('contact:status', onStatusChanged);
bus.on('contacts:status', onStatusChangedMany);

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
    try {
      const f = a.config.filter || {};
      const { sql, params } = contacts.filterSql({ statuses: f.statuses, tags: f.tags, optedOut: 'exclude' });
      // una sola sentencia por automatización (los que ya recibieron el mensaje no se repiten); un error no frena a las demás
      queued += await db.tx(async () => {
        const fresh = await db.query(
          `insert into automation_runs (automation_id, contact_id) select $${params.length + 1}::int, id from contacts ${sql}
           on conflict do nothing returning contact_id`,
          [...params, a.id],
        );
        await enqueueFresh(a, fresh.map((r) => r.contact_id), new Date().toISOString());
        return fresh.length;
      });
    } catch (e) {
      console.error(`[recordatorios] error en «${a.name}»:`, e);
    }
  }
  return queued;
}

// ---- respuestas por palabra clave ----

const MAX_PREFIX_WORDS = 5; // una respuesta corta ("si vamos", "no puedo ir") cuenta; un mensaje largo lo lee una persona
const HEDGE = /\b(consult\w*|ver|veo|veremos|aviso|avisar\w*|avisamos|quiza\w*|tal vez|depende\w*|creo|no se|puede ser|pregunt\w*|despues|luego|mas tarde|dudo|duda)\b/;

/** Devuelve la automatización de palabra clave que coincide (gana la palabra más larga). */
export async function matchKeyword(text) {
  const t = normalizeText(text).replace(/(.)\1{2,}/g, '$1'); // «siii» -> «si»
  if (!t) return null;
  const words = t.split(' ');
  const shortReply = !String(text).includes('?') && words.length <= MAX_PREFIX_WORDS && !HEDGE.test(t);
  let best = null;
  for (const a of await active('keyword')) {
    for (const k of a.config.keywords || []) {
      // «2 nenes» no es la opción «2»: las palabras clave numéricas solo valen solas
      const hit = t === k || (shortReply && /\D/.test(k) && t.startsWith(k + ' '));
      if (hit && (!best || k.length > best.len)) best = { a, len: k.length };
    }
  }
  return best?.a || null;
}

/** Respuesta de confirmación de la baja: la de la automatización de baja si existe y está activa, si no la de fábrica. */
async function optOutReply() {
  const a = (await active('keyword')).find((x) => x.config.opt_out && (x.body || x.template));
  return a ? { body: a.body, template: a.template, automationId: a.id, source: `automatización: ${a.name}` }
           : { body: OPT_OUT_REPLY, template: null, automationId: null, source: 'baja' };
}

export async function onInbound(contact, text) {
  if (isOptOut(text)) {
    if (!contact.opted_out) {
      await contacts.setOptOut(contact.id, true);
      const r = await optOutReply();
      await queue.enqueue({ contactId: contact.id, body: r.body, template: r.template, automationId: r.automationId, source: r.source, ignoreOptout: true });
    }
    return { name: 'baja', opt_out: true };
  }
  const a = await matchKeyword(text);
  if (!a) return null;
  const c = a.config;
  if (c.opt_out) await contacts.setOptOut(contact.id, true);
  if (c.add_tag) await contacts.addTags(contact.id, [c.add_tag]);
  if (c.set_status && contact.status !== 'asistio') await contacts.setStatus(contact.id, c.set_status); // un «sí» después del evento no lo "des-asiste"
  if (a.body || a.template) {
    await queue.enqueue({
      contactId: contact.id, body: a.body, template: a.template,
      automationId: a.id, source: `automatización: ${a.name}`,
      ignoreOptout: Boolean(c.opt_out), // la confirmación de la baja sí se envía
    });
  }
  return a;
}
