'use strict';
// Prueba de integración: servidor HTTP real del CRM + un "Meta" falso que imita la Cloud API.
process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 'clave-test';
process.env.WHATSAPP_TOKEN = 'token-de-prueba';
process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
process.env.WHATSAPP_VERIFY_TOKEN = 'verificador';
process.env.WHATSAPP_APP_SECRET = 'secreto-app';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

let base;          // URL del CRM
let metaCalls;     // pedidos que recibió el Meta falso
let metaQueue;     // respuestas a devolver (en orden); si está vacía, éxito
let cookie = '';
let db; let queue; let automations;
const closers = []; // se cierran al terminar (un `after` dentro de `before` corre apenas termina el `before`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(20); }
  throw new Error('timeout esperando condición');
}

async function api(method, path, body, { headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(raw === undefined && body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer()); // text() descartaría el BOM del CSV
  const text = buf.toString('utf8');
  let json; try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, text, buf, headers: res.headers };
}

const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
const webhook = (payload, signature) => {
  const raw = JSON.stringify(payload);
  return api('POST', '/webhook/whatsapp', undefined, { raw, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? sign(raw) } });
};
const inboundText = (from, text, id) => ({
  entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Mamá Test' } }], messages: [{ from, id, type: 'text', text: { body: text } }] } }] }],
});

test.before(async () => {
  let n = 0;
  metaCalls = [];
  metaQueue = [];
  const meta = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      metaCalls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(data) });
      const next = metaQueue.shift() || { status: 200, json: { messages: [{ id: `wamid.MOCK${++n}` }] } };
      res.writeHead(next.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(next.json));
    });
  });
  await new Promise((r) => meta.listen(0, '127.0.0.1', r));
  process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${meta.address().port}`;

  ({ db } = require('../src/db'));
  queue = require('../src/queue');
  automations = require('../src/automations');
  const { seedDefaults } = require('../src/seed');
  const { server } = require('../server');
  seedDefaults();
  automations.start();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  closers.push(() => { server.close(); meta.close(); automations.stop(); queue.stop(); });
});

test.after(() => closers.forEach((fn) => fn()));

test('acceso: sin sesión no entra, con contraseña sí, y se exige JSON', async () => {
  assert.equal((await api('GET', '/api/contacts')).status, 401);
  assert.equal((await api('POST', '/api/login', { password: 'incorrecta' })).status, 401);
  assert.equal((await api('POST', '/api/login', undefined, { raw: 'password=clave-test', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);

  const ok = await api('POST', '/api/login', { password: 'clave-test' });
  assert.equal(ok.status, 200);
  const set = ok.headers.get('set-cookie');
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  cookie = set.split(';')[0];
  assert.equal((await api('GET', '/api/contacts')).status, 200);

  // un formulario de otro sitio (no JSON) no puede escribir aunque tenga la cookie
  const csrf = await api('POST', '/api/contacts', undefined, { raw: 'name=x&phone=2234445555', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(csrf.status, 415);
});

test('API: contactos, duplicados, exportación CSV y panel', async () => {
  const a = await api('POST', '/api/contacts', { name: 'Ana', phone: '223 555-0001', child_name: 'Tomi', status: 'interesado', tags: ['vip'] });
  assert.equal(a.status, 200);
  assert.equal(a.json.phone, '5492235550001');
  const dup = await api('POST', '/api/contacts', { name: 'Ana 2', phone: '+54 9 223 555 0001' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.existing_id, a.json.id);
  assert.equal((await api('POST', '/api/contacts', { name: 'Mal', phone: '12' })).status, 400);

  const csv = await api('GET', '/api/contacts/export.csv?status=interesado');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.text.startsWith('﻿Nombre,Teléfono'));
  assert.match(csv.text, /Ana,5492235550001,,Tomi/);

  const st = await api('GET', '/api/stats');
  assert.equal(st.json.total, 1);
  assert.equal(st.json.by_status.interesado, 1);
  assert.equal((await api('GET', '/api/meta')).json.whatsapp.mode, 'cloud');
  assert.equal((await api('GET', '/api/nada')).status, 404);
});

test('webhook: verificación de Meta (GET)', async () => {
  const q = (t) => `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=12345`;
  const noCookie = { headers: { cookie: '' } };
  const good = await api('GET', q('verificador'), undefined, noCookie);
  assert.equal(good.status, 200);
  assert.equal(good.text, '12345');
  assert.equal((await api('GET', q('otro'), undefined, noCookie)).status, 403);
});

test('webhook: rechaza mensajes sin firma o con firma falsa', async () => {
  const payload = inboundText('5492235550001', 'SI', 'wamid.FAKE');
  assert.equal((await webhook(payload, 'sha256=' + '0'.repeat(64))).status, 401);
  assert.equal((await webhook(payload, '')).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE direction = 'in'").get().n, 0);
});

test('webhook: respuesta "SI" confirma, y el CRM contesta por la Cloud API con el formato correcto', async () => {
  metaCalls.length = 0;
  const res = await webhook(inboundText('5492235550001', 'Sí!', 'wamid.IN1'));
  assert.equal(res.status, 200);
  assert.equal(res.text, 'EVENT_RECEIVED');

  await waitFor(() => metaCalls.length === 1);
  const call = metaCalls[0];
  assert.equal(call.url, '/v25.0/1234567890/messages');
  assert.equal(call.auth, 'Bearer token-de-prueba');
  assert.equal(call.body.messaging_product, 'whatsapp');
  assert.equal(call.body.to, '5492235550001');
  assert.equal(call.body.type, 'text');
  assert.match(call.body.text.body, /¡Perfecto Ana! ✅/);

  const c = (await api('GET', '/api/contacts')).json[0];
  assert.equal(c.status, 'confirmado');
  assert.equal(c.unread, 1);

  // el hilo muestra recibido + enviado, y abrirlo marca como leído
  const thread = (await api('GET', `/api/contacts/${c.id}/messages`)).json;
  assert.equal(thread.window_open, true);
  assert.deepEqual(thread.messages.map((m) => m.direction), ['in', 'out']);
  assert.equal((await api('GET', `/api/contacts/${c.id}`)).json.unread, 0);

  // el mismo mensaje reenviado por Meta no se procesa dos veces
  await webhook(inboundText('5492235550001', 'Sí!', 'wamid.IN1'));
  await sleep(100);
  assert.equal(metaCalls.length, 1);
});

test('webhook: acuses de entrega actualizan el estado del mensaje', async () => {
  const out = db.prepare("SELECT wa_id FROM messages WHERE direction = 'out'").get();
  const st = (s, extra = {}) => webhook({ entry: [{ changes: [{ value: { statuses: [{ id: out.wa_id, status: s, ...extra }] } }] }] });
  await st('delivered');
  assert.equal(db.prepare('SELECT status FROM messages WHERE wa_id = ?').get(out.wa_id).status, 'delivered');
  await st('read');
  assert.equal(db.prepare('SELECT status FROM messages WHERE wa_id = ?').get(out.wa_id).status, 'read');
});

test('campaña con plantilla: fuera de la ventana de 24 h sale como plantilla con variables', async () => {
  const b = (await api('POST', '/api/contacts', { name: 'Beto López', phone: '2235550002', status: 'confirmado' })).json;
  await api('PUT', '/api/settings', { event_name: 'Fiesta Peques', event_at_local: '2099-11-15T16:00', event_place: 'Plaza Mitre' });
  metaCalls.length = 0;

  const camp = await api('POST', '/api/campaigns', {
    name: 'Recordatorio', body: 'Hola {{nombre}}', filter: { statuses: ['confirmado'], tags: [] },
    template: { name: 'recordatorio_evento', lang: 'es_AR', params: 'nombre, evento, hora, lugar' },
  });
  assert.equal(camp.status, 200);
  assert.equal(camp.json.total, 2);
  await waitFor(() => metaCalls.length === 2);

  // Ana respondió hace instantes -> texto libre; Beto no -> plantilla
  const toBeto = metaCalls.find((c) => c.body.to === '5492235550002').body;
  assert.equal(toBeto.type, 'template');
  assert.equal(toBeto.template.name, 'recordatorio_evento');
  assert.equal(toBeto.template.language.code, 'es_AR');
  assert.deepEqual(toBeto.template.components, [{
    type: 'body',
    parameters: ['Beto', 'Fiesta Peques', '16:00 hs', 'Plaza Mitre'].map((text) => ({ type: 'text', text })),
  }]);
  assert.equal(metaCalls.find((c) => c.body.to === '5492235550001').body.type, 'text');
  assert.equal(b.status, 'confirmado');
});

test('errores de Meta: 5xx se reintenta, 131047 falla con explicación', async () => {
  const c = (await api('POST', '/api/contacts', { name: 'Caro', phone: '2235550003' })).json;
  metaCalls.length = 0;

  // caída temporal de Meta: queda pendiente con reintento programado
  metaQueue.push({ status: 503, json: { error: { message: 'Service Unavailable' } } });
  const r1 = await api('POST', '/api/campaigns', { name: 'Reintento', body: 'x', template: { name: 'plantilla_ok', lang: 'es_AR', params: '' }, filter: { tags: [] }, scheduled_at: new Date(Date.now() + 86400e3).toISOString() });
  assert.equal(r1.status, 200);
  db.prepare("UPDATE outbox SET send_at = ? WHERE contact_id = ? AND status = 'pending'").run(new Date(Date.now() - 1000).toISOString(), c.id);
  await queue.tick();
  const row = db.prepare('SELECT * FROM outbox WHERE contact_id = ? ORDER BY id DESC').get(c.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.ok(Date.parse(row.send_at) > Date.now(), 'reintento a futuro');
  assert.match(row.error, /Service Unavailable/);

  // segundo intento: Meta responde que ya pasó la ventana (error permanente)
  metaQueue.push({ status: 400, json: { error: { code: 131047, message: 'Re-engagement message', error_data: { details: 'x' } } } });
  db.prepare('UPDATE outbox SET send_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), row.id);
  await queue.tick();
  const failed = db.prepare('SELECT * FROM outbox WHERE id = ?').get(row.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /24 h/);
  const msg = db.prepare("SELECT status, error FROM messages WHERE contact_id = ? AND direction = 'out' ORDER BY id DESC").get(c.id);
  assert.equal(msg.status, 'failed');
});

test('mensaje manual desde la bandeja: bloquea fuera de ventana y a quienes pidieron la baja', async () => {
  const list = (await api('GET', '/api/contacts')).json;
  const caro = list.find((x) => x.name === 'Caro');
  const ana = list.find((x) => x.name === 'Ana');

  const closed = await api('POST', `/api/contacts/${caro.id}/messages`, { text: 'hola' });
  assert.equal(closed.status, 409);
  assert.match(closed.json.error, /24 h/);

  metaCalls.length = 0;
  const open = await api('POST', `/api/contacts/${ana.id}/messages`, { text: 'Cualquier duda nos escribís' });
  assert.equal(open.status, 200);
  await waitFor(() => metaCalls.length === 1);
  assert.equal(metaCalls[0].body.text.body, 'Cualquier duda nos escribís');

  await webhook(inboundText('5492235550001', 'BAJA', 'wamid.IN2'));
  await waitFor(() => metaCalls.length === 2); // confirmación de la baja
  assert.match(metaCalls[1].body.text.body, /no te vamos a escribir/);
  assert.equal((await api('POST', `/api/contacts/${ana.id}/messages`, { text: 'hola' })).status, 409);
});

test('importación por API: vista previa y confirmación con consentimiento', async () => {
  const text = 'Nombre,Teléfono,Hijo\nLuz Paz,2235558001,Mili\nRepetida,2235558001,\nSin tel,,';
  const pv = await api('POST', '/api/import/preview', { text });
  assert.deepEqual([pv.json.total, pv.json.ok, pv.json.duplicate, pv.json.invalid], [3, 1, 1, 1]);
  assert.equal((await api('POST', '/api/import/commit', { text, mapping: pv.json.mapping })).status, 400);
  const done = await api('POST', '/api/import/commit', { text, mapping: pv.json.mapping, consent: true, tags: ['evento'] });
  assert.deepEqual(done.json, { created: 1, skipped: 2 });
});

test('automatizaciones por API: listar, editar y activar', async () => {
  const list = (await api('GET', '/api/automations')).json;
  assert.ok(list.length >= 7);
  const rec = list.find((a) => a.name === 'Recordatorio: 1 día antes');
  assert.equal(rec.active, false);
  const on = await api('POST', `/api/automations/${rec.id}/toggle`, { active: true });
  assert.equal(on.json.active, true);
  const edit = await api('PUT', `/api/automations/${rec.id}`, { body: 'Mañana es {{evento}}!' });
  assert.equal(edit.json.body, 'Mañana es {{evento}}!');
  assert.deepEqual(edit.json.config.filter.statuses, ['confirmado'], 'editar el texto no pierde el filtro');
});

test('login: bloquea tras demasiados intentos fallidos', async () => {
  cookie = '';
  let last;
  for (let i = 0; i < 9; i++) last = await api('POST', '/api/login', { password: 'mal' + i });
  assert.equal(last.status, 429);
  assert.equal((await api('POST', '/api/login', { password: 'clave-test' })).status, 429);
});
