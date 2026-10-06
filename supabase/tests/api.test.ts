// @ts-nocheck
// La API completa (handle(Request) -> Response) contra Postgres real y un "Meta" falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { db } from '../functions/api/db.ts';
import { handle } from '../functions/api/app.ts';
import { setup, reset, teardown } from './helpers.ts';

const BASE = 'http://localhost/functions/v1/api';
let token = '';
let metaCalls = [];
let metaQueue = [];
let meta;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, { headers = {}, rawBody, auth = true } = {}) {
  const h = { ...headers };
  if (auth && token) h.authorization = `Bearer ${token}`;
  if (rawBody === undefined && body !== undefined) h['content-type'] = 'application/json';
  const res = await handle(new Request(BASE + path, { method, headers: h, body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined }));
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json; try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, json, text, buf, headers: res.headers };
}

const APP_SECRET = 'secreto-de-la-app';
const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
const webhook = (payload, signature) => {
  const raw = JSON.stringify(payload);
  return api('POST', '/webhook/whatsapp', undefined, { rawBody: raw, auth: false, headers: { 'x-hub-signature-256': signature ?? sign(raw) } });
};
const inboundText = (from, text, id) => ({
  entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Mamá Test' } }], messages: [{ from, id, type: 'text', text: { body: text } }] } }] }],
});

test.before(async () => {
  await setup();
  let n = 0;
  meta = http.createServer((req, res) => {
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
});
test.after(async () => { meta?.close(); await teardown(); });

test('acceso: sin sesión no entra, con contraseña sí, y el token no se puede falsificar', async () => {
  assert.equal((await api('GET', '/contacts', undefined, { auth: false })).status, 401);
  assert.equal((await api('POST', '/login', { password: 'incorrecta' }, { auth: false })).status, 401);

  const ok = await api('POST', '/login', { password: 'clave-test' }, { auth: false });
  assert.equal(ok.status, 200);
  assert.match(ok.json.token, /^[\w-]+\.[0-9a-f]{64}$/);
  token = ok.json.token;
  assert.equal((await api('GET', '/contacts')).status, 200);
  assert.equal((await api('GET', '/session')).json.authenticated, true);

  const [payload] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url')}.${'0'.repeat(64)}`;
  for (const bad of [forged, `${payload}.${'a'.repeat(64)}`, 'basura', '']) {
    assert.equal((await api('GET', '/contacts', undefined, { auth: false, headers: { authorization: `Bearer ${bad}` } })).status, 401, bad.slice(0, 12));
  }
  // un token vencido no sirve aunque la firma sea válida: se firma a mano con la llave real
  const secret = (await db.one("select value from settings where key = 'session_secret'")).value;
  const expired = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(expired).digest('hex');
  assert.equal((await api('GET', '/contacts', undefined, { auth: false, headers: { authorization: `Bearer ${expired}.${sig}` } })).status, 401);
});

test('CORS: la interfaz (otro dominio) puede llamar, y cada respuesta lo permite', async () => {
  const pre = await handle(new Request(BASE + '/contacts', { method: 'OPTIONS', headers: { origin: 'https://crm.netlify.app', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  assert.equal((await api('GET', '/contacts')).headers.get('access-control-allow-origin'), '*');
  assert.equal((await api('GET', '/nada')).status, 404);
  assert.equal((await api('GET', '/nada', undefined, { auth: false })).headers.get('access-control-allow-origin'), '*');
});

test('rutas: funcionan con el prefijo de Supabase y sin él', async () => {
  for (const url of ['http://x/functions/v1/api/session', 'http://x/api/session', 'http://x/session']) {
    const res = await handle(new Request(url, { headers: { authorization: `Bearer ${token}` } }));
    assert.equal((await res.json()).authenticated, true, url);
  }
});

test('API: contactos, duplicados, exportación CSV y panel', async () => {
  await reset();
  const a = await api('POST', '/contacts', { name: 'Ana', phone: '223 555-0001', child_name: 'Tomi', status: 'interesado', tags: ['vip'] });
  assert.equal(a.status, 200);
  assert.equal(a.json.phone, '5492235550001');
  const dup = await api('POST', '/contacts', { name: 'Ana 2', phone: '+54 9 223 555 0001' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.existing_id, a.json.id);
  assert.equal((await api('POST', '/contacts', { name: 'Mal', phone: '12' })).status, 400);
  assert.equal((await api('POST', '/contacts', undefined, { rawBody: '{roto' })).status, 400);

  const csv = await api('GET', '/contacts/export.csv?status=interesado');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.deepEqual([...csv.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM para que Excel respete los acentos');
  assert.match(csv.text, /Ana,5492235550001,,Tomi/);

  const st = await api('GET', '/stats');
  assert.equal(st.json.total, 1);
  assert.equal(st.json.by_status.interesado, 1);
  const m = (await api('GET', '/meta')).json;
  assert.equal(m.whatsapp.mode, 'simulado');
  assert.equal(m.credentials_editable, true);
  assert.equal(m.statuses.length, 6);
});

test('credenciales de WhatsApp desde Ajustes: se guardan, no se devuelven y activan el modo real', async () => {
  const before = (await api('GET', '/whatsapp/config')).json;
  assert.equal(before.token_set, false);
  assert.match(before.verify_token, /^[0-9a-f]{24}$/, 'el token de verificación se genera solo');

  const put = await api('PUT', '/whatsapp/config', { token: 'token-secreto-de-meta', phone_number_id: '1234567890', app_secret: APP_SECRET });
  assert.equal(put.status, 200);
  assert.equal(put.json.status.mode, 'cloud');
  assert.equal(put.json.status.ready, true);

  const after = await api('GET', '/whatsapp/config');
  assert.equal(after.json.token_set, true);
  assert.equal(after.json.app_secret_set, true);
  assert.equal(after.json.phone_number_id, '1234567890');
  assert.ok(!after.text.includes('token-secreto-de-meta') && !after.text.includes(APP_SECRET), 'el panel nunca recibe los secretos');
  assert.ok(!(await api('GET', '/settings')).text.includes('token-secreto'), 'ni por ajustes');
  assert.equal((await api('GET', '/whatsapp/config', undefined, { auth: false })).status, 401);

  // guardar con campos vacíos no borra lo existente
  await api('PUT', '/whatsapp/config', { token: '', phone_number_id: '' });
  assert.equal((await api('GET', '/whatsapp/config')).json.token_set, true);
});

test('webhook: verificación de Meta (GET) con el token generado', async () => {
  const vt = (await api('GET', '/whatsapp/config')).json.verify_token;
  const q = (t) => `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=12345`;
  const good = await api('GET', q(vt), undefined, { auth: false });
  assert.equal(good.status, 200);
  assert.equal(good.text, '12345');
  assert.equal((await api('GET', q('otro'), undefined, { auth: false })).status, 403);
  assert.equal((await api('GET', q(''), undefined, { auth: false })).status, 403);
});

test('webhook: rechaza mensajes sin firma o con firma falsa', async () => {
  const payload = inboundText('5492235550001', 'SI', 'wamid.FAKE');
  assert.equal((await webhook(payload, 'sha256=' + '0'.repeat(64))).status, 401);
  assert.equal((await webhook(payload, '')).status, 401);
  assert.equal(await db.val("select count(*)::int from messages where direction = 'in'"), 0);
});

test('webhook: respuesta "SI" confirma, y el CRM contesta por la Cloud API con el formato correcto', async () => {
  await api('PUT', '/settings', { event_name: 'Fiesta Peques', event_at_local: '2099-11-15T16:00', event_place: 'Plaza Mitre' }); // sin estos datos el mensaje queda en espera
  metaCalls.length = 0;
  const res = await webhook(inboundText('5492235550001', 'Sí!', 'wamid.IN1'));
  assert.equal(res.status, 200);
  assert.equal(res.text, 'EVENT_RECEIVED');

  assert.equal(metaCalls.length, 1);
  const call = metaCalls[0];
  assert.equal(call.url, '/v25.0/1234567890/messages');
  assert.equal(call.auth, 'Bearer token-secreto-de-meta');
  assert.equal(call.body.messaging_product, 'whatsapp');
  assert.equal(call.body.to, '5492235550001');
  assert.equal(call.body.type, 'text');
  assert.match(call.body.text.body, /¡Perfecto Ana! ✅/);

  const c = (await api('GET', '/contacts')).json[0];
  assert.equal(c.status, 'confirmado');
  assert.equal(c.unread, 1);

  const thread = (await api('GET', `/contacts/${c.id}/messages`)).json;
  assert.equal(thread.window_open, true);
  assert.deepEqual(thread.messages.map((m) => m.direction), ['in', 'out']);
  assert.equal((await api('GET', `/contacts/${c.id}`)).json.unread, 0);

  await webhook(inboundText('5492235550001', 'Sí!', 'wamid.IN1')); // Meta reenvía el mismo mensaje
  assert.equal(metaCalls.length, 1, 'no se procesa dos veces');
});

test('webhook: acuses de entrega actualizan el estado del mensaje', async () => {
  const out = await db.one("select wa_id from messages where direction = 'out'");
  const st = (s) => webhook({ entry: [{ changes: [{ value: { statuses: [{ id: out.wa_id, status: s }] } }] }] });
  await st('delivered');
  assert.equal((await db.one('select status from messages where wa_id = $1', [out.wa_id])).status, 'delivered');
  await st('read');
  assert.equal((await db.one('select status from messages where wa_id = $1', [out.wa_id])).status, 'read');
});

test('campaña con plantilla: fuera de la ventana de 24 h sale como plantilla con variables', async () => {
  await api('POST', '/contacts', { name: 'Beto López', phone: '2235550002', status: 'confirmado' });
  await api('PUT', '/settings', { event_name: 'Fiesta Peques', event_at_local: '2099-11-15T16:00', event_place: 'Plaza Mitre' });
  metaCalls.length = 0;

  const camp = await api('POST', '/campaigns', {
    name: 'Recordatorio', body: 'Hola {{nombre}}', filter: { statuses: ['confirmado'], tags: [] },
    template: { name: 'recordatorio_evento', lang: 'es_AR', params: 'nombre, evento, hora, lugar' },
  });
  assert.equal(camp.status, 200);
  assert.equal(camp.json.total, 2);
  assert.equal(metaCalls.length, 2);

  const toBeto = metaCalls.find((c) => c.body.to === '5492235550002').body;
  assert.equal(toBeto.type, 'template');
  assert.equal(toBeto.template.name, 'recordatorio_evento');
  assert.equal(toBeto.template.language.code, 'es_AR');
  assert.deepEqual(toBeto.template.components, [{
    type: 'body',
    parameters: ['Beto', 'Fiesta Peques', '16:00 hs', 'Plaza Mitre'].map((text) => ({ type: 'text', text })),
  }]);
  assert.equal(metaCalls.find((c) => c.body.to === '5492235550001').body.type, 'text', 'Ana respondió hace instantes -> texto libre');
});

test('errores de Meta: 5xx se reintenta (desde el cron), 131047 falla con explicación', async () => {
  const c = (await api('POST', '/contacts', { name: 'Caro', phone: '2235550003' })).json;
  metaCalls.length = 0;

  metaQueue.push({ status: 503, json: { error: { message: 'Service Unavailable' } } });
  const r1 = await api('POST', '/campaigns', { name: 'Reintento', body: 'x', template: { name: 'plantilla_ok', lang: 'es_AR', params: '' }, filter: { ids: [c.id] } });
  assert.equal(r1.status, 200);
  let row = await db.one('select * from outbox where contact_id = $1 order by id desc', [c.id]);
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.ok(Date.parse(row.send_at) > Date.now(), 'reintento programado a futuro');
  assert.match(row.error, /Service Unavailable/);

  // el cron corre pero todavía no es la hora del reintento
  const cron = await db.val("select value from settings where key = 'cron_secret'");
  assert.equal((await api('POST', '/internal/tick', {}, { auth: false })).status, 401);
  assert.equal((await api('POST', '/internal/tick', {}, { auth: false, headers: { 'x-cron-secret': 'incorrecta' } })).status, 401);
  const idle = await api('POST', '/internal/tick', {}, { auth: false, headers: { 'x-cron-secret': cron } });
  assert.equal(idle.status, 200);
  assert.equal(idle.json.sent, 0);

  // llega la hora: Meta responde que ya pasó la ventana (error permanente)
  metaQueue.push({ status: 400, json: { error: { code: 131047, message: 'Re-engagement message', error_data: { details: 'x' } } } });
  await db.query("update outbox set send_at = now() - interval '1 second' where id = $1", [row.id]);
  const run = await api('POST', '/internal/tick', {}, { auth: false, headers: { 'x-cron-secret': cron } });
  assert.equal(run.json.sent, 1);
  row = await db.one('select * from outbox where id = $1', [row.id]);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /24 h/);
  assert.equal((await db.one("select status from messages where contact_id = $1 and direction = 'out' order by id desc", [c.id])).status, 'failed');
});

test('mensaje manual desde la bandeja: bloquea fuera de ventana y a quienes pidieron la baja', async () => {
  const list = (await api('GET', '/contacts')).json;
  const caro = list.find((x) => x.name === 'Caro');
  const ana = list.find((x) => x.name === 'Ana');

  const closed = await api('POST', `/contacts/${caro.id}/messages`, { text: 'hola' });
  assert.equal(closed.status, 409);
  assert.match(closed.json.error, /24 h/);

  metaCalls.length = 0;
  assert.equal((await api('POST', `/contacts/${ana.id}/messages`, { text: 'Cualquier duda nos escribís' })).status, 200);
  assert.equal(metaCalls[0].body.text.body, 'Cualquier duda nos escribís');

  await webhook(inboundText('5492235550001', 'BAJA', 'wamid.IN2'));
  assert.match(metaCalls[1].body.text.body, /no te vamos a escribir/);
  assert.equal((await api('POST', `/contacts/${ana.id}/messages`, { text: 'hola' })).status, 409);
});

test('importación por API: vista previa y confirmación con consentimiento', async () => {
  const text = 'Nombre,Teléfono,Hijo\nLuz Paz,2235558001,Mili\nRepetida,2235558001,\nSin tel,,';
  const pv = await api('POST', '/import/preview', { text });
  assert.deepEqual([pv.json.total, pv.json.ok, pv.json.duplicate, pv.json.invalid], [3, 1, 1, 1]);
  assert.equal((await api('POST', '/import/commit', { text, mapping: pv.json.mapping })).status, 400);
  const done = await api('POST', '/import/commit', { text, mapping: pv.json.mapping, consent: true, tags: ['evento'] });
  assert.deepEqual(done.json, { created: 1, skipped: 2 });
});

test('automatizaciones por API: listar, editar y activar', async () => {
  const list = (await api('GET', '/automations')).json;
  assert.ok(list.length >= 7);
  const rec = list.find((a) => a.name === 'Recordatorio: 1 día antes');
  assert.equal(rec.active, false);
  assert.equal((await api('POST', `/automations/${rec.id}/toggle`, { active: true })).json.active, true);
  const edit = await api('PUT', `/automations/${rec.id}`, { body: 'Mañana es {{evento}}!' });
  assert.equal(edit.json.body, 'Mañana es {{evento}}!');
  assert.deepEqual(edit.json.config.filter.statuses, ['confirmado'], 'editar el texto no pierde el filtro');
});

test('contraseña: se puede cambiar, invalida las sesiones viejas y exige la actual', async () => {
  assert.equal((await api('PUT', '/password', { current: 'mala', next: 'nueva-clave-segura' })).status, 401);
  assert.equal((await api('PUT', '/password', { current: 'clave-test', next: 'corta' })).status, 400);
  const old = token;
  const ch = await api('PUT', '/password', { current: 'clave-test', next: 'nueva-clave-segura' });
  assert.equal(ch.status, 200);
  assert.equal((await api('GET', '/contacts', undefined, { auth: false, headers: { authorization: `Bearer ${old}` } })).status, 401, 'la sesión anterior ya no vale');
  token = ch.json.token;
  assert.equal((await api('GET', '/contacts')).status, 200);
  assert.equal((await api('POST', '/login', { password: 'clave-test' }, { auth: false })).status, 401);
  assert.equal((await api('POST', '/login', { password: 'nueva-clave-segura' }, { auth: false })).status, 200);
  assert.ok(!(await db.val("select value from settings where key = 'admin_hash'")).includes('nueva-clave'), 'se guarda solo el hash');
});

test('login: bloquea tras demasiados intentos fallidos (por IP)', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await api('POST', '/login', { password: 'mal' + i }, { auth: false, headers: { 'cf-connecting-ip': '203.0.113.9' } });
  assert.equal(last.status, 429);
  assert.equal((await api('POST', '/login', { password: 'nueva-clave-segura' }, { auth: false, headers: { 'cf-connecting-ip': '203.0.113.9' } })).status, 429);
  assert.equal((await api('POST', '/login', { password: 'nueva-clave-segura' }, { auth: false, headers: { 'cf-connecting-ip': '198.51.100.7' } })).status, 200, 'otra IP no se ve afectada');
});

test('seguridad: las tablas no son legibles por la API pública de Supabase (RLS activo)', async () => {
  const rows = await db.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'");
  assert.ok(rows.length >= 8);
  assert.deepEqual(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname), [], 'todas con RLS');
});

// ---------------------------------------------------------------------------------------------
// Endurecimiento (revisión independiente)
// ---------------------------------------------------------------------------------------------

const EVENT = { event_name: 'Fiesta Peques', event_at_local: '2099-11-15T16:00', event_place: 'Plaza Mitre' };
const cronTick = async () => api('POST', '/internal/tick', {}, { auth: false, headers: { 'x-cron-secret': await db.val("select value from settings where key = 'cron_secret'") } });
const batch = (...messages) => ({ entry: [{ changes: [{ value: { contacts: [], messages } }] }] });
const msg = (from, text, id) => ({ from, id, type: 'text', text: { body: text } });

test('login: 30 intentos simultáneos no esquivan el límite (solo los primeros 8 prueban la contraseña)', async () => {
  await reset();
  const ip = { 'cf-connecting-ip': '203.0.113.77' };
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => api('POST', '/login', { password: 'x' + i }, { auth: false, headers: ip })));
  const count = (st) => results.filter((r) => r.status === st).length;
  assert.equal(count(401), 8);
  assert.equal(count(429), 22);
  assert.equal((await api('POST', '/login', { password: 'nueva-clave-segura' }, { auth: false, headers: ip })).status, 429, 'bloqueado aunque la contraseña sea la correcta');
  const until = await db.val("select until_at from login_attempts where ip = '203.0.113.77'");
  await api('POST', '/login', { password: 'otra' }, { auth: false, headers: ip });
  assert.equal(await db.val("select until_at from login_attempts where ip = '203.0.113.77'"), until, 'seguir insistiendo no extiende el bloqueo');
});

test('login: las direcciones IPv6 de un mismo /64 comparten el cupo, y X-Forwarded-For no sirve para evadirlo', async () => {
  await reset();
  for (let i = 0; i < 8; i++) await api('POST', '/login', { password: 'mal' }, { auth: false, headers: { 'cf-connecting-ip': `2001:db8:1:2:${i}::1` } });
  assert.equal((await api('POST', '/login', { password: 'mal' }, { auth: false, headers: { 'cf-connecting-ip': '2001:0db8:0001:0002:ffff::9' } })).status, 429);
  for (let i = 0; i < 8; i++) await api('POST', '/login', { password: 'mal' }, { auth: false, headers: { 'x-forwarded-for': `10.0.0.${i}` } });
  assert.equal((await api('POST', '/login', { password: 'mal' }, { auth: false, headers: { 'x-forwarded-for': '10.9.9.9' } })).status, 429, 'sin cf-connecting-ip todos comparten un cupo');
});

test('entradas raras: JSON "null" o con forma inválida da 400, y un cuerpo enorme en una ruta pública 413', async () => {
  await reset();
  assert.equal((await api('POST', '/login', undefined, { rawBody: 'null', auth: false })).status, 400);
  assert.equal((await api('POST', '/login', undefined, { rawBody: '[1,2]', auth: false })).status, 400);
  assert.equal((await api('POST', '/login', undefined, { rawBody: '"x"', auth: false })).status, 400);
  assert.equal((await api('POST', '/login', undefined, { rawBody: 'x'.repeat(1.2 * 1024 * 1024), auth: false })).status, 413);
});

test('baja: funciona aunque se borre la automatización de BAJA, entiende frases naturales y sobrevive al borrado del contacto', async () => {
  await reset();
  await api('PUT', '/settings', EVENT);
  for (const a of (await api('GET', '/automations')).json.filter((x) => x.config.opt_out)) await api('DELETE', `/automations/${a.id}`);
  const ana = (await api('POST', '/contacts', { name: 'Ana', phone: '2235550001' })).json;
  metaCalls.length = 0;
  assert.equal((await webhook(inboundText('5492235550001', 'No me escribas más', 'wamid.B1'))).status, 200);
  const c = (await api('GET', `/contacts/${ana.id}`)).json;
  assert.equal(c.opted_out, true);
  assert.equal(c.status, 'nuevo', '«No me escribas más» no se toma como un NO asistirá');
  assert.match(metaCalls[0].body.text.body, /no te vamos a escribir/, 'se confirma la baja con el texto de fábrica');

  // quien dio de baja no vuelve a entrar por reimportar la planilla
  assert.equal((await api('DELETE', `/contacts/${ana.id}`)).status, 200);
  assert.equal((await api('POST', '/import/commit', { text: 'Nombre,Teléfono\nAna,2235550001', consent: true })).json.created, 1);
  const again = (await api('GET', '/contacts')).json[0];
  assert.equal(again.opted_out, true, 'reimportar no la vuelve a suscribir');
  const manual = await api('POST', '/contacts', { name: 'Otra', phone: '2235550002' });
  await api('DELETE', `/contacts/${manual.json.id}`);

  // volver a habilitarla es una decisión explícita y limpia la lista
  assert.equal((await api('PUT', `/contacts/${again.id}`, { opted_out: false })).json.opted_out, false);
  assert.equal(await db.val('select count(*)::int from suppressions'), 0);
});

test('webhook: si algo falla se responde 500 (Meta reintenta), un mensaje roto no tira a los demás y la baja no se pierde', async () => {
  await reset();
  await api('PUT', '/settings', EVENT);
  const a = (await api('POST', '/contacts', { name: 'Ana', phone: '2235550001' })).json;
  await api('POST', '/contacts', { name: 'Beto', phone: '2235550002' });
  await db.query(`create function test_fail_optout() returns trigger language plpgsql as $$
    begin if new.opted_out and not old.opted_out and new.phone_key = '2235550001' then raise exception 'falla simulada'; end if; return new; end $$`);
  await db.query('create trigger test_fail before update on contacts for each row execute function test_fail_optout()');
  try {
    const payload = batch(msg('5492235550001', 'BAJA', 'wamid.P1'), msg('5492235550002', 'hola', 'wamid.P2'));
    assert.equal((await webhook(payload)).status, 500);
    assert.equal(await db.val("select count(*)::int from messages where wa_id = 'wamid.P2'"), 1, 'el mensaje siguiente sí se guardó');
    assert.equal(await db.val("select count(*)::int from messages where wa_id = 'wamid.P1'"), 0, 'la baja no quedó a medias: se reintenta entera');
    assert.equal((await api('GET', `/contacts/${a.id}`)).json.opted_out, false);

    await db.query('drop trigger test_fail on contacts'); // la base se recupera y Meta reenvía
    assert.equal((await webhook(payload)).status, 200);
    assert.equal((await api('GET', `/contacts/${a.id}`)).json.opted_out, true, 'la baja se aplicó en el reintento');
    assert.equal(await db.val("select count(*)::int from messages where wa_id = 'wamid.P2'"), 1, 'lo ya guardado no se duplica');
  } finally {
    await db.query('drop trigger if exists test_fail on contacts');
    await db.query('drop function if exists test_fail_optout()');
  }
});

test('webhook: un mensaje sin número (usuario de WhatsApp sin teléfono) se ignora y no se mezcla con nadie', async () => {
  await reset();
  const noPhone = batch({ id: 'wamid.U1', type: 'text', text: { body: 'hola' }, from_user_id: 'US.123' }, { from: '', id: 'wamid.U2', type: 'text', text: { body: 'chau' } });
  assert.equal((await webhook(noPhone)).status, 200);
  assert.equal(await db.val('select count(*)::int from contacts'), 0);
  assert.equal(await db.val('select count(*)::int from messages'), 0);
  // una reacción tampoco cuenta como respuesta ni abre la ventana de 24 h
  await api('POST', '/contacts', { name: 'Ana', phone: '2235550001' });
  assert.equal((await webhook(batch({ from: '5492235550001', id: 'wamid.R1', type: 'reaction', reaction: { emoji: '👍' } }))).status, 200);
  assert.equal(await db.val('select last_inbound_at from contacts'), null);
});

test('número extranjero que escribe: queda con su número real, no como un celular argentino', async () => {
  await reset();
  assert.equal((await webhook(batch(msg('59899123456', 'hola', 'wamid.F1')))).status, 200);
  assert.equal(await db.val('select phone from contacts'), '59899123456');
});

test('error general de WhatsApp (token vencido): los mensajes esperan, se avisa en el panel y salen cuando se arregla', async () => {
  await reset();
  await api('PUT', '/settings', EVENT);
  const ids = [];
  for (const [n, p] of [['Caro', '2235550003'], ['Dani', '2235550004']]) ids.push((await api('POST', '/contacts', { name: n, phone: p })).json.id);
  const bad = { status: 401, json: { error: { code: 190, message: 'Invalid OAuth access token' } } };
  metaQueue.push(bad, bad);
  const camp = await api('POST', '/campaigns', { name: 'Aviso', body: 'x', template: { name: 'plantilla_ok', lang: 'es_AR', params: '' }, filter: { ids } });
  assert.equal(camp.status, 200);
  const rows = await db.query('select status, attempts, error from outbox order by id');
  assert.deepEqual(rows.map((r) => r.status), ['pending', 'pending'], 'nada se descarta');
  assert.deepEqual(rows.map((r) => r.attempts), [0, 0], 'y no se gastan intentos');
  assert.match(rows[0].error, /token/i);
  const st = (await api('GET', '/whatsapp/status')).json;
  assert.equal(st.ready, false);
  assert.match(st.issues.join(' '), /en pausa/);
  assert.match((await api('GET', '/stats')).json.send_alert.message, /token/i);
  assert.equal(await db.val("select count(*)::int from messages where status = 'failed'"), 0);

  await db.query("update outbox set send_at = now() - interval '1 second'"); // se corrigió el token
  assert.equal((await cronTick()).json.sent, 2);
  assert.deepEqual((await db.query('select status from outbox order by id')).map((r) => r.status), ['sent', 'sent']);
  assert.equal((await api('GET', '/whatsapp/status')).json.ready, true, 'el aviso se borra solo');
  assert.equal((await api('GET', '/stats')).json.send_alert, null);
});

test('límite de velocidad de Meta (HTTP 400 + código 130429): se reintenta, no es un fallo permanente', async () => {
  await reset();
  const c = (await api('POST', '/contacts', { name: 'Eli', phone: '2235550005' })).json;
  metaQueue.push({ status: 400, json: { error: { code: 130429, message: 'Rate limit hit' } } });
  await api('POST', '/campaigns', { name: 'Velocidad', body: 'x', template: { name: 'plantilla_ok', lang: 'es_AR', params: '' }, filter: { ids: [c.id] } });
  const row = await db.one('select * from outbox where contact_id = $1', [c.id]);
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
});

test('si Meta dice que la ventana de 24 h ya se cerró, se manda la plantilla en vez de fallar', async () => {
  await reset();
  await api('PUT', '/settings', EVENT);
  const c = (await api('POST', '/contacts', { name: 'Fran', phone: '2235550006' })).json;
  await db.query('update contacts set last_inbound_at = now() where id = $1', [c.id]); // creemos que la ventana está abierta
  metaCalls.length = 0;
  metaQueue.push({ status: 400, json: { error: { code: 131047, message: 'Re-engagement message' } } });
  await api('POST', '/campaigns', { name: 'Caída', body: 'Hola {{nombre}}', template: { name: 'plantilla_ok', lang: 'es_AR', params: 'nombre' }, filter: { ids: [c.id] } });
  assert.deepEqual(metaCalls.map((m) => m.body.type), ['text', 'template']);
  assert.equal((await db.one('select status from outbox where contact_id = $1', [c.id])).status, 'sent');
});

test('sin fecha/lugar del evento los mensajes no salen con huecos: esperan a que se completen en Ajustes', async () => {
  await reset(); // sin datos del evento
  const c = (await api('POST', '/contacts', { name: 'Gabi', phone: '2235550007' })).json;
  metaCalls.length = 0;
  await api('POST', '/campaigns', { name: 'Fecha', body: 'x', template: { name: 'plantilla_ok', lang: 'es_AR', params: 'nombre, fecha, lugar' }, filter: { ids: [c.id] } });
  assert.equal(metaCalls.length, 0);
  const row = await db.one('select * from outbox where contact_id = $1', [c.id]);
  assert.equal(row.status, 'pending');
  assert.match(row.error, /Falta completar en Ajustes/);

  await api('PUT', '/settings', EVENT);
  await db.query("update outbox set send_at = now() - interval '1 second'");
  assert.equal((await cronTick()).json.sent, 1);
  assert.deepEqual(metaCalls[0].body.template.components[0].parameters.map((p) => p.text), ['Gabi', 'domingo 15 de noviembre', 'Plaza Mitre']);
});

test('cron: deja latido, el panel lo muestra, y el tope por ejecución cuida el tiempo de CPU', async () => {
  await reset();
  assert.equal((await api('GET', '/stats')).json.scheduler.last_tick_at, null);
  assert.equal((await cronTick()).status, 200);
  assert.match((await api('GET', '/stats')).json.scheduler.last_tick_at, /^\d{4}-\d\d-\d\dT/);

  const ids = [];
  const rows = Array.from({ length: 200 }, (_, i) => `Fam ${i},223${5100000 + i}`).join('\n');
  assert.equal((await api('POST', '/import/commit', { text: 'Nombre,Teléfono\n' + rows, consent: true })).json.created, 200);
  for (const r of await db.query('select id from contacts')) ids.push(r.id);
  metaCalls.length = 0;
  await api('PUT', '/settings', EVENT);
  const camp = await api('POST', '/campaigns', { name: 'Masiva', body: 'x', template: { name: 'plantilla_ok', lang: 'es_AR', params: '' }, filter: { ids } });
  assert.equal(camp.json.total, 200);
  assert.equal(metaCalls.length, 150, 'una ejecución envía como mucho 150 mensajes');
  assert.equal((await cronTick()).json.sent, 50, 'el resto sale en la siguiente (cada minuto)');
});

test('contacto: un estado inválido no guarda nada, y editar sin mandar opted_out no reactiva a quien se dio de baja', async () => {
  await reset();
  const c = (await api('POST', '/contacts', { name: 'Hugo', phone: '2235550008' })).json;
  await api('POST', '/contacts/bulk', { ids: [c.id], action: 'optout' });
  const bad = await api('PUT', `/contacts/${c.id}`, { name: 'Hugo Nuevo', status: 'zzz' });
  assert.equal(bad.status, 400);
  assert.equal((await api('GET', `/contacts/${c.id}`)).json.name, 'Hugo', 'no quedó guardado a medias');
  const ok = await api('PUT', `/contacts/${c.id}`, { notes: 'alérgico al maní' });
  assert.equal(ok.json.opted_out, true);
  assert.equal(ok.json.notes, 'alérgico al maní');
});

test('exportación: no se corta en 5000 contactos', async () => {
  await reset();
  await db.query("insert into contacts (name, phone, phone_key) select 'C' || i, '549223' || (6000000 + i), '223' || (6000000 + i) from generate_series(0, 5299) i");
  const csv = await api('GET', '/contacts/export.csv');
  assert.equal(csv.text.trim().split('\n').length, 5301);
});

test('prueba de WhatsApp: no se envía a un número que pidió la baja', async () => {
  await reset();
  await api('PUT', '/settings', EVENT);
  await db.query("insert into suppressions (phone_key) values ('2235550009')");
  metaCalls.length = 0;
  assert.equal((await api('POST', '/whatsapp/test', { phone: '2235550009' })).status, 409);
  assert.equal(metaCalls.length, 0);
});

test('ajustes: fechas imposibles se rechazan, y un recordatorio «0 minutos antes» no se puede crear', async () => {
  for (const bad of ['2026-02-31T10:00', '2026-11-15T25:61', '2026-11-15 16:00', 'mañana']) {
    assert.equal((await api('PUT', '/settings', { event_at_local: bad })).status, 400, bad);
  }
  assert.equal((await api('PUT', '/settings', { event_at_local: '2099-11-15T16:00' })).status, 200);
  assert.equal((await api('POST', '/automations', { name: 'Ya', trigger: 'before_event', config: { offset_minutes: 0 }, body: 'x' })).status, 400);
  assert.equal((await api('POST', '/automations', { name: 'Ya', trigger: 'before_event', config: { offset_minutes: 5 }, body: 'x' })).status, 200);
});
