// @ts-nocheck
import { db, nowIso, getSettings, saveSettings, getRaw, setRaw, env, HttpError } from './db.ts';
import * as contacts from './contacts.ts';
import * as automations from './automations.ts';
import * as campaigns from './campaigns.ts';
import * as importer from './importer.ts';
import * as inbound from './inbound.ts';
import * as queue from './queue.ts';
import * as wa from './whatsapp.ts';
import * as auth from './auth.ts';
import { VARIABLES, cleanTemplate } from './template.ts';
import { normalizePhone } from './phone.ts';
import { localToDate } from './time.ts';
import { toCSV } from './csv.ts';

const int = (v) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n)) throw new HttpError(400, 'Id inválido');
  return n;
};
const raw = (status, headers, body) => ({ __raw: { status, headers, body } });
const filterFromQuery = (q) => ({
  search: q.get('search') || '',
  statuses: q.get('status') ? q.get('status').split(',') : [],
  tags: q.get('tag') ? q.get('tag').split(',') : [],
  optedOut: q.get('optout') === 'only' ? 'only' : q.get('optout') === 'exclude' ? 'exclude' : undefined,
});

/** «2026-11-15T16:00» con fecha y hora que existen (rechaza 2026-02-31 o 25:61). */
function validLocalDateTime(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v));
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60;
}

function validTimezone(tz) {
  try { new Intl.DateTimeFormat('es-AR', { timeZone: tz }); return true; } catch { return false; }
}

/** URL pública de la API (la que se pega en Meta para el webhook). */
function publicApiUrl() {
  return (env('PUBLIC_API_URL') || (env('SUPABASE_URL') ? `${env('SUPABASE_URL')}/functions/v1/api` : '')).replace(/\/+$/, '');
}

async function stats() {
  const s = await getSettings();
  const by = Object.fromEntries(contacts.STATUS_IDS.map((id) => [id, 0]));
  for (const r of await db.query('select status, count(*)::int n from contacts group by status')) by[r.status] = r.n;
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  const msg = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const r of await db.query("select status, count(*)::int n from messages where direction = 'out' and created_at >= $1::timestamptz group by status", [week])) {
    if (r.status === 'failed') msg.failed += r.n;
    else {
      msg.sent += r.n;
      if (r.status === 'delivered' || r.status === 'read') msg.delivered += r.n;
      if (r.status === 'read') msg.read += r.n;
    }
  }
  const at = localToDate(s.event_at_local, s.timezone);
  return {
    total: await db.val('select count(*)::int from contacts'),
    by_status: by,
    opted_out: await db.val('select count(*)::int from contacts where opted_out = true'),
    kids_confirmed: await db.val("select coalesce(sum(kids_count), 0)::int from contacts where status = 'confirmado'"),
    unread: await db.val('select coalesce(sum(unread), 0)::int from contacts'),
    messages_7d: msg,
    replies_7d: await db.val("select count(*)::int from messages where direction = 'in' and created_at >= $1::timestamptz", [week]),
    pending: await db.val("select count(*)::int from outbox where status in ('pending','sending')"),
    scheduler: { last_tick_at: (await getRaw('cron_last_tick')) || null },
    send_alert: await wa.sendAlert(),
    event: { name: s.event_name, place: s.event_place, at: at ? at.toISOString() : null, local: s.event_at_local, timezone: s.timezone },
  };
}

async function conversations() {
  const rows = await db.query(`select c.id, c.name, c.phone, c.status, c.unread, c.opted_out, c.last_message_at, c.last_inbound_at,
      (select body from messages m where m.contact_id = c.id order by m.id desc limit 1) as last_body,
      (select direction from messages m where m.contact_id = c.id order by m.id desc limit 1) as last_direction
    from contacts c where c.last_message_at is not null order by c.last_message_at desc limit 300`);
  return rows.map((r) => ({ ...r, window_open: queue.inWindow(r) }));
}

const EXPORT_HEADER = ['Nombre', 'Teléfono', 'Email', 'Peque', 'Edad', 'Cantidad de peques', 'Estado', 'Etiquetas', 'Notas', 'Pidió la baja', 'Origen', 'Alta'];

export const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, ...opts });
};

// ---- sesión (públicas) ----
route('GET', '/', () => ({ ok: true, service: 'crm-peques' }), { public: true });
route('GET', '/session', async ({ req }) => ({ authenticated: await auth.verifyToken(auth.bearer(req)) }), { public: true });
route('POST', '/login', async ({ body, ip }) => ({ ok: true, token: await auth.login(body.password, ip) }), { public: true });
route('POST', '/logout', () => ({ ok: true }), { public: true }); // el token vive en el navegador: salir = borrarlo
route('PUT', '/password', async ({ body, ip }) => { await auth.changePassword(body.current, body.next, ip); return { ok: true, token: await auth.makeToken() }; });

// ---- meta / panel ----
route('GET', '/meta', async () => ({
  statuses: contacts.STATUSES,
  variables: VARIABLES,
  triggers: automations.TRIGGERS,
  whatsapp: await wa.status(),
  settings: await getSettings(),
  webhook_url: `${publicApiUrl()}/webhook/whatsapp`,
  credentials_editable: true,
}));
route('GET', '/stats', () => stats());
route('GET', '/settings', () => getSettings());
route('PUT', '/settings', async ({ body }) => {
  const patch = {};
  if (body.event_at_local !== undefined) {
    if (body.event_at_local && !validLocalDateTime(body.event_at_local)) throw new HttpError(400, 'Fecha y hora del evento inválidas');
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
route('GET', '/contacts', ({ query }) => contacts.list(filterFromQuery(query)));
route('POST', '/contacts', ({ body, defer }) => {
  return contacts.create({ ...body, source: body.source || 'manual' }).then((c) => { defer(queue.tick()); return c; });
});
route('POST', '/contacts/bulk', async ({ body, defer }) => {
  if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError(400, 'No hay contactos seleccionados');
  const affected = await contacts.bulk(body.ids, body.action, body.value);
  defer(queue.tick());
  return { affected };
});
route('GET', '/contacts/export.csv', async ({ query }) => {
  const rows = (await contacts.list(filterFromQuery(query), Infinity)).map((c) => [
    c.name, c.phone, c.email, c.child_name, c.child_age, c.kids_count,
    contacts.STATUSES.find((s) => s.id === c.status)?.label || c.status,
    c.tags.join(', '), c.notes, c.opted_out ? 'Sí' : '', c.source, String(c.created_at).slice(0, 10),
  ]);
  return raw(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="contactos-${nowIso().slice(0, 10)}.csv"` }, toCSV(EXPORT_HEADER, rows));
});
route('GET', '/contacts/:id', ({ params }) => contacts.get(int(params.id)));
route('PUT', '/contacts/:id', async ({ params, body, defer }) => {
  const c = await contacts.update(int(params.id), body);
  defer(queue.tick());
  return c;
});
route('DELETE', '/contacts/:id', async ({ params }) => { await contacts.remove(int(params.id)); return { ok: true }; });
route('GET', '/tags', () => contacts.allTags());

// ---- importación ----
route('POST', '/import/preview', ({ body }) => importer.preview(String(body.text || ''), body.mapping, body.has_header));
route('POST', '/import/commit', async ({ body, defer }) => {
  const r = await importer.commit(String(body.text || ''), body.mapping, {
    tags: body.tags || [], consent: body.consent === true, welcome: body.welcome === true,
    source: body.source || 'importación', hasHeader: body.has_header,
  });
  defer(queue.tick());
  return r;
});

// ---- conversaciones ----
route('GET', '/conversations', () => conversations());
route('GET', '/contacts/:id/messages', async ({ params }) => {
  const id = int(params.id);
  const contact = await contacts.get(id);
  await db.query('update contacts set unread = 0 where id = $1', [id]);
  const messages = (await db.query('select * from messages where contact_id = $1 order by id desc limit 300', [id])).reverse();
  return { contact, window_open: queue.inWindow(contact), messages };
});
route('POST', '/contacts/:id/messages', async ({ params, body, defer }) => {
  const contact = await contacts.get(int(params.id));
  const text = String(body.text || '').trim();
  const template = cleanTemplate(body.template);
  if (!text && !template) throw new HttpError(400, 'Escribí el mensaje');
  if (contact.opted_out) throw new HttpError(409, 'Este contacto pidió no recibir mensajes');
  if (!queue.inWindow(contact) && !template) {
    throw new HttpError(409, 'Pasaron más de 24 h desde su última respuesta. WhatsApp solo permite enviar una plantilla aprobada.');
  }
  await queue.enqueue({ contactId: contact.id, body: text, template, source: 'manual' });
  defer(queue.tick());
  return { queued: true };
});
route('POST', '/dev/inbound', async ({ body, defer }) => {
  if (wa.isCloud(await wa.waConfig())) throw new HttpError(403, 'Solo disponible en modo simulación');
  const c = body.contact_id ? await contacts.get(int(body.contact_id)) : null;
  const phone = c ? c.phone : body.phone;
  if (!phone) throw new HttpError(400, 'Indicá el contacto o el teléfono');
  const s = await getSettings();
  const p = normalizePhone(phone, { country: s.default_country, area: s.default_area });
  if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
  await inbound.receive({ fromPhone: p.phone, text: String(body.text || ''), name: body.name || '', waId: `sim.in.${crypto.randomUUID()}` });
  defer(queue.tick());
  return { ok: true };
});

// ---- campañas ----
route('GET', '/campaigns', () => campaigns.list());
route('POST', '/campaigns/preview', ({ body }) => campaigns.preview(body.filter));
route('POST', '/campaigns', async ({ body, defer }) => {
  const c = await campaigns.create(body);
  defer(queue.tick());
  return c;
});
route('GET', '/campaigns/:id', ({ params }) => campaigns.get(int(params.id)));
route('POST', '/campaigns/:id/cancel', ({ params }) => campaigns.cancel(int(params.id)));

// ---- automatizaciones ----
route('GET', '/automations', () => automations.list());
route('POST', '/automations', ({ body }) => automations.create(body));
route('PUT', '/automations/:id', ({ params, body }) => automations.update(int(params.id), body));
route('POST', '/automations/:id/toggle', ({ params, body }) => automations.setActive(int(params.id), body.active === true));
route('DELETE', '/automations/:id', async ({ params }) => { await automations.remove(int(params.id)); return { ok: true }; });

// ---- WhatsApp ----
route('GET', '/whatsapp/status', () => wa.status());
route('GET', '/whatsapp/config', async () => {
  const cfg = await wa.waConfig();
  return {
    token_set: Boolean(cfg.token),
    phone_number_id: cfg.phoneNumberId,
    app_secret_set: Boolean(cfg.appSecret),
    verify_token: await wa.ensureVerifyToken(),
    api_version: cfg.apiVersion,
    from_env: Boolean(env('WHATSAPP_TOKEN')),
  };
});
route('PUT', '/whatsapp/config', async ({ body }) => { await wa.saveWaConfig(body); return { ok: true, status: await wa.status() }; });
route('POST', '/whatsapp/test', async ({ body }) => {
  const s = await getSettings();
  const p = normalizePhone(body.phone, { country: s.default_country, area: s.default_area });
  if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
  if (await db.val('select 1 from contacts where phone_key = $1 and opted_out = true union select 1 from suppressions where phone_key = $1', [p.key])) {
    throw new HttpError(409, 'Ese número pidió no recibir mensajes: no se le puede enviar ni siquiera una prueba.');
  }
  const provider = await wa.getProvider();
  if (provider.mode !== 'cloud') return { ok: true, simulated: true, message: 'Modo simulación: no se envió nada real.' };
  try {
    await provider.send(p.phone, { template: { name: 'hello_world', lang: 'en_US', params: [] } });
    return { ok: true, message: 'Enviado. Si el número está permitido en Meta, te llega "Hello World".' };
  } catch (e) {
    throw new HttpError(502, e.message);
  }
});

// ---- webhook de Meta (sin sesión: se autentica por token / firma) ----
route('GET', '/webhook/whatsapp', async ({ query }) => {
  const cfg = await wa.waConfig();
  const ok = query.get('hub.mode') === 'subscribe' && cfg.verifyToken && wa.safeEqual(query.get('hub.verify_token') || '', cfg.verifyToken);
  if (!ok) throw new HttpError(403, 'Token de verificación inválido');
  return raw(200, { 'Content-Type': 'text/plain' }, query.get('hub.challenge') || '');
}, { public: true });
route('POST', '/webhook/whatsapp', async ({ raw: bytes, req, defer }) => {
  const cfg = await wa.waConfig();
  if (!cfg.appSecret) {
    console.error('[webhook] Falta el App Secret: se rechaza el mensaje entrante.');
    throw new HttpError(503, 'Webhook sin configurar');
  }
  if (!(await wa.verifySignature(bytes, req.headers.get('x-hub-signature-256'), cfg.appSecret))) throw new HttpError(401, 'Firma inválida');
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'JSON inválido'); }
  let result;
  try {
    result = await inbound.processWebhook(payload);
  } catch (e) {
    console.error('[webhook] error procesando:', e);
    result = { errors: 1 };
  }
  defer(queue.tick());
  // Si algo no se pudo guardar (una baja, por ejemplo) se responde con error: Meta reintenta durante días y lo que ya
  // se guardó se descarta como repetido. Responder 200 acá lo perdería para siempre.
  if (result.errors) throw new HttpError(500, 'No se pudo procesar el mensaje; Meta lo reenviará');
  return raw(200, { 'Content-Type': 'text/plain' }, 'EVENT_RECEIVED');
}, { public: true, rawBody: true });

// ---- cron: lo llama pg_cron cada minuto con una llave compartida ----
route('POST', '/internal/tick', async ({ req }) => {
  const key = req.headers.get('x-cron-secret') || '';
  const secret = await getRaw('cron_secret');
  if (!secret || !wa.safeEqual(key, secret)) throw new HttpError(401, 'No autorizado');
  await setRaw('cron_last_tick', nowIso()); // latido: el panel avisa si pasan minutos sin que llegue
  await db.query("delete from login_attempts where until_at < now() - interval '1 day'"); // limpieza de bloqueos viejos
  let queued = 0;
  try { queued = await automations.schedulerTick(); } catch (e) { console.error('[cron] recordatorios:', e); }
  const sent = await queue.tick({ budgetMs: 25000 }); // el cron espera hasta 55 s la respuesta (pg_net)
  return { ok: true, queued, sent };
}, { public: true });
