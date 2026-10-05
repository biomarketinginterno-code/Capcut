'use strict';
const { db, nowIso, getSettings, HttpError } = require('./db');
const contacts = require('./contacts');
const queue = require('./queue');
const bus = require('./bus');
const { localToDate } = require('./time');
const { cleanTemplate } = require('./template');

const TRIGGERS = {
  contact_created: 'Cuando se agrega un contacto',
  status_changed: 'Cuando un contacto cambia de estado',
  before_event: 'Un tiempo antes del evento',
  after_event: 'Un tiempo después del evento',
  keyword: 'Cuando el contacto responde una palabra clave',
};

const SCHEDULER_MS = 30 * 1000;
const BEFORE_GRACE_MS = 6 * 3600 * 1000;   // si el servidor estuvo caído, un recordatorio se puede enviar hasta 6 h tarde
const AFTER_GRACE_MS = 48 * 3600 * 1000;

const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const toApi = (r) => ({ ...r, active: !!r.active, config: parse(r.config, {}), template: parse(r.template, null) });

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
      if (c.set_status) out.set_status = contacts.STATUS_IDS.includes(c.set_status) ? c.set_status : undefined;
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
  return { name, trigger: input.trigger, config: JSON.stringify(config), body, template: template ? JSON.stringify(template) : null, active: input.active ? 1 : 0 };
}

const list = () => db.prepare('SELECT * FROM automations ORDER BY id').all().map(toApi);
function get(id) {
  const r = db.prepare('SELECT * FROM automations WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Automatización no encontrada');
  return toApi(r);
}

function create(input) {
  const v = validate(input);
  const r = db.prepare('INSERT INTO automations (name, trigger, config, body, template, active, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(v.name, v.trigger, v.config, v.body, v.template, v.active, nowIso());
  return get(Number(r.lastInsertRowid));
}

function update(id, input) {
  const cur = get(id);
  const v = validate({ ...cur, ...input, config: input.config ?? cur.config, template: input.template === undefined ? cur.template : input.template });
  db.prepare('UPDATE automations SET name=?, trigger=?, config=?, body=?, template=?, active=? WHERE id=?')
    .run(v.name, v.trigger, v.config, v.body, v.template, v.active, id);
  return get(id);
}

function setActive(id, active) {
  get(id);
  db.prepare('UPDATE automations SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return get(id);
}

function remove(id) {
  if (!db.prepare('DELETE FROM automations WHERE id = ?').run(id).changes) throw new HttpError(404, 'Automatización no encontrada');
}

// ---- ejecución ----

/** Encola el mensaje de la automatización para el contacto, una sola vez por contacto. */
function runFor(a, contact, delayMinutes = 0) {
  if (contact.opted_out) return false;
  const fresh = db.prepare('INSERT OR IGNORE INTO automation_runs (automation_id, contact_id, created_at) VALUES (?,?,?)')
    .run(a.id, contact.id, nowIso());
  if (!fresh.changes) return false;
  queue.enqueue({
    contactId: contact.id, body: a.body, template: a.template,
    sendAt: new Date(Date.now() + delayMinutes * 60000),
    automationId: a.id, source: `automatización: ${a.name}`,
  });
  return true;
}

const active = (trigger) => list().filter((a) => a.active && a.trigger === trigger);

function onContactCreated(contact) {
  for (const a of active('contact_created')) runFor(a, contact, a.config.delay_minutes);
}

function onStatusChanged(contact) {
  for (const a of active('status_changed')) {
    if (a.config.status === contact.status) runFor(a, contact, a.config.delay_minutes);
  }
}

/** Recordatorios/agradecimientos relativos a la fecha del evento. Se llama cada 30 s. */
function schedulerTick(now = Date.now()) {
  const s = getSettings();
  const eventAt = localToDate(s.event_at_local, s.timezone);
  if (!eventAt) return 0;
  let queued = 0;
  for (const a of [...active('before_event'), ...active('after_event')]) {
    const before = a.trigger === 'before_event';
    const target = eventAt.getTime() + (before ? -1 : 1) * a.config.offset_minutes * 60000;
    const late = now - target;
    if (late < 0) continue;                                   // todavía no es la hora
    if (late > (before ? BEFORE_GRACE_MS : AFTER_GRACE_MS)) continue; // ya pasó demasiado
    if (before && now >= eventAt.getTime()) continue;         // el evento ya empezó
    const f = a.config.filter || {};
    for (const c of contacts.list({ statuses: f.statuses, tags: f.tags, optedOut: 'exclude' })) {
      if (runFor(a, c)) queued++;
    }
  }
  return queued;
}

// ---- respuestas por palabra clave ----

function normalizeText(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Devuelve la automatización de palabra clave que coincide (gana la palabra más larga). */
function matchKeyword(text) {
  const t = normalizeText(text);
  if (!t) return null;
  let best = null;
  for (const a of active('keyword')) {
    for (const k of a.config.keywords) {
      if ((t === k || t.startsWith(k + ' ')) && (!best || k.length > best.len)) best = { a, len: k.length };
    }
  }
  return best?.a || null;
}

function onInbound(contact, text) {
  const a = matchKeyword(text);
  if (!a) return null;
  const c = a.config;
  if (c.opt_out) contacts.setOptOut(contact.id, true);
  if (c.add_tag) contacts.addTags(contact.id, [c.add_tag]);
  if (c.set_status) contacts.setStatus(contact.id, c.set_status);
  if (a.body || a.template) {
    queue.enqueue({
      contactId: contact.id, body: a.body, template: a.template,
      automationId: a.id, source: `automatización: ${a.name}`,
      ignoreOptout: Boolean(c.opt_out), // la confirmación de la baja sí se envía
    });
  }
  return a;
}

let timer = null;
function start() {
  bus.on('contact:created', onContactCreated);
  bus.on('contact:status', onStatusChanged);
  if (!timer) {
    timer = setInterval(() => { try { schedulerTick(); } catch (e) { console.error('[automatizaciones]', e); } }, SCHEDULER_MS);
    timer.unref?.();
  }
}
function stop() {
  clearInterval(timer);
  timer = null;
  bus.removeListener('contact:created', onContactCreated);
  bus.removeListener('contact:status', onStatusChanged);
}

module.exports = {
  TRIGGERS, list, get, create, update, setActive, remove,
  onContactCreated, onStatusChanged, schedulerTick, matchKeyword, onInbound, normalizeText, start, stop,
};
