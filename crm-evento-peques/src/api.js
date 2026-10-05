'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { db, nowIso, getSettings, saveSettings, HttpError } = require('./db');
const contacts = require('./contacts');
const automations = require('./automations');
const campaigns = require('./campaigns');
const importer = require('./importer');
const inbound = require('./inbound');
const queue = require('./queue');
const wa = require('./whatsapp');
const { VARIABLES, cleanTemplate } = require('./template');
const { normalizePhone } = require('./phone');
const { localToDate } = require('./time');
const { toCSV } = require('./csv');

const int = (v) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n)) throw new HttpError(400, 'Id inválido');
  return n;
};
const csvResponse = (name, body) => ({
  __raw: { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }, body },
});
const filterFromQuery = (q) => ({
  search: q.get('search') || '',
  statuses: q.get('status') ? q.get('status').split(',') : [],
  tags: q.get('tag') ? q.get('tag').split(',') : [],
  optedOut: q.get('optout') === 'only' ? 'only' : q.get('optout') === 'exclude' ? 'exclude' : undefined,
});

function validTimezone(tz) {
  try { new Intl.DateTimeFormat('es-AR', { timeZone: tz }); return true; } catch { return false; }
}

function stats() {
  const s = getSettings();
  const by = Object.fromEntries(contacts.STATUS_IDS.map((id) => [id, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM contacts GROUP BY status').all()) by[r.status] = r.n;
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  const msg = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const r of db.prepare("SELECT status, COUNT(*) n FROM messages WHERE direction = 'out' AND created_at >= ? GROUP BY status").all(week)) {
    if (r.status === 'failed') msg.failed += r.n;
    else {
      msg.sent += r.n;
      if (r.status === 'delivered' || r.status === 'read') msg.delivered += r.n;
      if (r.status === 'read') msg.read += r.n;
    }
  }
  const at = localToDate(s.event_at_local, s.timezone);
  return {
    total: db.prepare('SELECT COUNT(*) n FROM contacts').get().n,
    by_status: by,
    opted_out: db.prepare('SELECT COUNT(*) n FROM contacts WHERE opted_out = 1').get().n,
    kids_confirmed: db.prepare("SELECT COALESCE(SUM(kids_count), 0) n FROM contacts WHERE status = 'confirmado'").get().n,
    unread: db.prepare('SELECT COALESCE(SUM(unread), 0) n FROM contacts').get().n,
    messages_7d: msg,
    replies_7d: db.prepare("SELECT COUNT(*) n FROM messages WHERE direction = 'in' AND created_at >= ?").get(week).n,
    pending: db.prepare("SELECT COUNT(*) n FROM outbox WHERE status IN ('pending','sending')").get().n,
    event: { name: s.event_name, place: s.event_place, at: at ? at.toISOString() : null, local: s.event_at_local, timezone: s.timezone },
  };
}

function conversations() {
  const rows = db.prepare(`SELECT c.id, c.name, c.phone, c.status, c.unread, c.opted_out, c.last_message_at, c.last_inbound_at,
      (SELECT body FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT direction FROM messages m WHERE m.contact_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_direction
    FROM contacts c WHERE c.last_message_at IS NOT NULL ORDER BY c.last_message_at DESC LIMIT 300`).all();
  return rows.map((r) => ({ ...r, opted_out: !!r.opted_out, window_open: queue.inWindow(r) }));
}

const EXPORT_HEADER = ['Nombre', 'Teléfono', 'Email', 'Peque', 'Edad', 'Cantidad de peques', 'Estado', 'Etiquetas', 'Notas', 'Pidió la baja', 'Origen', 'Alta'];

const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, ...opts });
};

// ---- meta / panel ----
route('GET', '/api/meta', () => ({
  statuses: contacts.STATUSES,
  variables: VARIABLES,
  triggers: automations.TRIGGERS,
  whatsapp: wa.status(),
  settings: getSettings(),
  webhook_path: '/webhook/whatsapp',
}));
route('GET', '/api/stats', () => stats());
route('GET', '/api/settings', () => getSettings());
route('PUT', '/api/settings', ({ body }) => {
  const patch = {};
  if (body.event_at_local !== undefined) {
    if (body.event_at_local && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.event_at_local)) throw new HttpError(400, 'Fecha y hora del evento inválidas');
    patch.event_at_local = body.event_at_local;
  }
  if (body.timezone !== undefined) {
    if (!validTimezone(body.timezone)) throw new HttpError(400, 'Zona horaria inválida');
    patch.timezone = body.timezone;
  }
  for (const k of ['event_name', 'event_place', 'event_address']) if (body[k] !== undefined) patch[k] = String(body[k]).trim().slice(0, 200);
  if (body.default_country !== undefined) patch.default_country = String(body.default_country).replace(/\D/g, '') || '54';
  if (body.default_area !== undefined) patch.default_area = String(body.default_area).replace(/\D/g, '').slice(0, 4);
  return saveSettings(patch);
});

// ---- contactos ----
route('GET', '/api/contacts', ({ query }) => contacts.list(filterFromQuery(query)));
route('POST', '/api/contacts', ({ body }) => contacts.create({ ...body, source: body.source || 'manual' }));
route('POST', '/api/contacts/bulk', ({ body }) => {
  if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError(400, 'No hay contactos seleccionados');
  return { affected: contacts.bulk(body.ids, body.action, body.value) };
});
route('GET', '/api/contacts/export.csv', ({ query }) => {
  const rows = contacts.list(filterFromQuery(query)).map((c) => [
    c.name, c.phone, c.email, c.child_name, c.child_age, c.kids_count,
    contacts.STATUSES.find((s) => s.id === c.status)?.label || c.status,
    c.tags.join(', '), c.notes, c.opted_out ? 'Sí' : '', c.source, c.created_at.slice(0, 10),
  ]);
  return csvResponse(`contactos-${nowIso().slice(0, 10)}.csv`, toCSV(EXPORT_HEADER, rows));
});
route('GET', '/api/contacts/:id', ({ params }) => contacts.get(int(params.id)));
route('PUT', '/api/contacts/:id', ({ params, body }) => contacts.update(int(params.id), body));
route('DELETE', '/api/contacts/:id', ({ params }) => { contacts.remove(int(params.id)); return { ok: true }; });
route('GET', '/api/tags', () => contacts.allTags());

// ---- importación ----
route('POST', '/api/import/preview', ({ body }) => importer.preview(String(body.text || ''), body.mapping, body.has_header));
route('POST', '/api/import/commit', ({ body }) => importer.commit(String(body.text || ''), body.mapping, {
  tags: body.tags || [], consent: body.consent === true, welcome: body.welcome === true,
  source: body.source || 'importación', hasHeader: body.has_header,
}));

// ---- conversaciones ----
route('GET', '/api/conversations', () => conversations());
route('GET', '/api/contacts/:id/messages', ({ params }) => {
  const id = int(params.id);
  const contact = contacts.get(id);
  db.prepare('UPDATE contacts SET unread = 0 WHERE id = ?').run(id);
  const messages = db.prepare('SELECT * FROM messages WHERE contact_id = ? ORDER BY id DESC LIMIT 300').all(id).reverse();
  return { contact, window_open: queue.inWindow(contact), messages };
});
route('POST', '/api/contacts/:id/messages', ({ params, body }) => {
  const contact = contacts.get(int(params.id));
  const text = String(body.text || '').trim();
  const template = cleanTemplate(body.template);
  if (!text && !template) throw new HttpError(400, 'Escribí el mensaje');
  if (contact.opted_out) throw new HttpError(409, 'Este contacto pidió no recibir mensajes');
  if (!queue.inWindow(contact) && !template) {
    throw new HttpError(409, 'Pasaron más de 24 h desde su última respuesta. WhatsApp solo permite enviar una plantilla aprobada.');
  }
  queue.enqueue({ contactId: contact.id, body: text, template, source: 'manual' });
  queue.tick();
  return { queued: true };
});
route('POST', '/api/dev/inbound', ({ body }) => {
  if (wa.isCloud()) throw new HttpError(403, 'Solo disponible en modo simulación');
  const c = body.contact_id ? contacts.get(int(body.contact_id)) : null;
  const phone = c ? c.phone : body.phone;
  if (!phone) throw new HttpError(400, 'Indicá el contacto o el teléfono');
  const p = normalizePhone(phone, { country: getSettings().default_country, area: getSettings().default_area });
  if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
  inbound.receive({ fromPhone: p.phone, text: String(body.text || ''), name: body.name || '', waId: `sim.in.${crypto.randomBytes(6).toString('hex')}` });
  queue.tick();
  return { ok: true };
});

// ---- campañas ----
route('GET', '/api/campaigns', () => campaigns.list());
route('POST', '/api/campaigns/preview', ({ body }) => campaigns.preview(body.filter));
route('POST', '/api/campaigns', ({ body }) => {
  const c = campaigns.create(body);
  queue.tick();
  return c;
});
route('GET', '/api/campaigns/:id', ({ params }) => campaigns.get(int(params.id)));
route('POST', '/api/campaigns/:id/cancel', ({ params }) => campaigns.cancel(int(params.id)));

// ---- automatizaciones ----
route('GET', '/api/automations', () => automations.list());
route('POST', '/api/automations', ({ body }) => automations.create(body));
route('PUT', '/api/automations/:id', ({ params, body }) => automations.update(int(params.id), body));
route('POST', '/api/automations/:id/toggle', ({ params, body }) => automations.setActive(int(params.id), body.active === true));
route('DELETE', '/api/automations/:id', ({ params }) => { automations.remove(int(params.id)); return { ok: true }; });

// ---- WhatsApp ----
route('GET', '/api/whatsapp/status', () => wa.status());
route('POST', '/api/whatsapp/test', async ({ body }) => {
  const s = getSettings();
  const p = normalizePhone(body.phone, { country: s.default_country, area: s.default_area });
  if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
  if (!wa.isCloud()) return { ok: true, simulated: true, message: 'Modo simulación: no se envió nada real.' };
  try {
    await wa.provider().send(p.phone, { template: { name: 'hello_world', lang: 'en_US', params: [] } });
    return { ok: true, message: 'Enviado. Si el número está permitido en Meta, te llega "Hello World".' };
  } catch (e) {
    throw new HttpError(502, e.message);
  }
});

// ---- webhook de Meta (sin sesión: se autentica por token / firma) ----
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
route('GET', '/webhook/whatsapp', ({ query }) => {
  const ok = query.get('hub.mode') === 'subscribe' && config.wa.verifyToken && safeEq(query.get('hub.verify_token') || '', config.wa.verifyToken);
  if (!ok) throw new HttpError(403, 'Token de verificación inválido');
  return { __raw: { status: 200, headers: { 'Content-Type': 'text/plain' }, body: query.get('hub.challenge') || '' } };
}, { public: true });
route('POST', '/webhook/whatsapp', ({ raw, req }) => {
  if (!config.wa.appSecret) {
    console.error('[webhook] Falta WHATSAPP_APP_SECRET: se rechaza el mensaje entrante.');
    throw new HttpError(503, 'Webhook sin configurar');
  }
  if (!wa.verifySignature(raw, req.headers['x-hub-signature-256'])) throw new HttpError(401, 'Firma inválida');
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
  try {
    inbound.processWebhook(payload);
    queue.tick();
  } catch (e) {
    console.error('[webhook] error procesando:', e); // se responde 200 igual para que Meta no reintente en bucle
  }
  return { __raw: { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'EVENT_RECEIVED' } };
}, { public: true, rawBody: true });

module.exports = { routes };
