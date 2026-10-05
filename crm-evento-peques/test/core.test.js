'use strict';
process.env.DB_PATH = ':memory:';
delete process.env.WHATSAPP_TOKEN; // modo simulación
delete process.env.WHATSAPP_PHONE_NUMBER_ID;

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, saveSettings } = require('../src/db');
const contacts = require('../src/contacts');
const importer = require('../src/importer');
const campaigns = require('../src/campaigns');
const automations = require('../src/automations');
const inbound = require('../src/inbound');
const queue = require('../src/queue');
const { seedDefaults } = require('../src/seed');

seedDefaults();
automations.start();

const sent = (contactId) => db.prepare("SELECT * FROM messages WHERE contact_id = ? AND direction = 'out' ORDER BY id").all(contactId);
const reset = () => {
  db.exec('DELETE FROM outbox; DELETE FROM messages; DELETE FROM automation_runs; DELETE FROM campaigns; DELETE FROM contacts;');
  db.exec('UPDATE automations SET active = 0 WHERE trigger <> \'keyword\'');
};
const openWindow = (id) => db.prepare('UPDATE contacts SET last_inbound_at = ? WHERE id = ?').run(new Date().toISOString(), id);

test('contactos: alta, duplicados por variante de número, etiquetas y filtros', () => {
  reset();
  const a = contacts.create({ name: 'Ana Pérez', phone: '0223 15 456-7890', child_name: 'Tomi', tags: 'VIP, Sala 1' });
  assert.equal(a.phone, '5492234567890');
  assert.deepEqual(a.tags, ['vip', 'sala-1']);
  assert.throws(() => contacts.create({ name: 'Otra', phone: '+54 9 223 456 7890' }), (e) => e.status === 409);
  assert.throws(() => contacts.create({ name: 'X', phone: '12' }), (e) => e.status === 400);
  assert.throws(() => contacts.create({ phone: '2234567891' }), (e) => e.status === 400);

  const b = contacts.create({ name: 'Beto', phone: '2234567891', status: 'confirmado', kids_count: 3 });
  assert.equal(contacts.list({ statuses: ['confirmado'] }).length, 1);
  assert.equal(contacts.list({ tags: ['vip'] })[0].id, a.id);
  assert.equal(contacts.list({ search: 'tomi' })[0].id, a.id);
  assert.equal(contacts.list({ search: '456 7891' })[0].id, b.id, 'busca por teléfono ignorando espacios y guiones');
  assert.equal(contacts.list({ search: '4567891' })[0].id, b.id);
  const jose = contacts.create({ name: 'JOSÉ Álvarez', phone: '2234567892' });
  assert.equal(contacts.list({ search: 'jose alvarez' })[0].id, jose.id, 'ignora mayúsculas y acentos');
  assert.equal(contacts.list({ search: '100%' }).length, 0, 'el % no actúa como comodín');

  contacts.bulk([a.id, b.id], 'add_tag', 'grupo-a');
  contacts.bulk([a.id], 'remove_tag', 'vip');
  assert.deepEqual(contacts.get(a.id).tags, ['sala-1', 'grupo-a']);
  assert.throws(() => contacts.bulk([a.id], 'status', 'inexistente'), (e) => e.status === 400);
});

test('importación: detecta columnas, valida teléfonos y descarta repetidos', () => {
  reset();
  contacts.create({ name: 'Ya existe', phone: '223 400 0001' });
  const csv = [
    'Nombre y apellido;Celular;Nombre del peque;Edad;Cantidad de niños;Email',
    'Laura Gómez;223 400-0002;Juana;4;2;laura@mail.com',
    'Pedro Ruiz;(0223) 15 400 0003;Lucas;6;1;',
    'Repetido;2234000002;;;;',
    'Existente;2234000001;;;;',
    'Sin teléfono;;;;;',
    'Mal número;12345;;;;',
  ].join('\n');
  const p = importer.preview(csv);
  assert.deepEqual([p.total, p.ok, p.duplicate, p.invalid], [6, 2, 2, 2]);
  assert.equal(p.mapping.child_name, 2);
  assert.equal(p.mapping.name, 0);

  assert.throws(() => importer.commit(csv, p.mapping, { consent: false }), (e) => e.status === 400);
  const r = importer.commit(csv, p.mapping, { consent: true, tags: ['evento-2026'] });
  assert.deepEqual(r, { created: 2, skipped: 4 });
  const laura = contacts.list({ search: 'laura' })[0];
  assert.equal(laura.child_name, 'Juana');
  assert.equal(laura.kids_count, 2);
  assert.deepEqual(laura.tags, ['evento-2026']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n, 0, 'importar no envía nada por defecto');
});

test('importación: planilla sin encabezados y pegada desde Sheets (tabs)', () => {
  reset();
  const p = importer.preview('Marta\t223 411 1111\nRoque\t223 411 2222');
  assert.equal(p.ok, 2);
  assert.equal(p.mapping.phone, 1);
  assert.equal(p.mapping.name, 0);
  assert.equal(p.has_header, false);
  // si la persona corrige el mapeo en pantalla, no se pierde la primera fila
  const again = importer.preview('Marta\t223 411 1111\nRoque\t223 411 2222', { name: 0, phone: 1 }, p.has_header);
  assert.equal(again.ok, 2);
  assert.equal(importer.preview('Nombre,Cel\nAna,2234113333', { name: 0, phone: 1 }, true).ok, 1);
});

test('importación: con "bienvenida" dispara la automatización de alta', () => {
  reset();
  const welcome = automations.list().find((a) => a.trigger === 'contact_created');
  automations.setActive(welcome.id, true);
  saveSettings({ event_at_local: '2099-11-15T16:00', event_place: 'Plaza' });
  importer.commit('Nombre,Celular\nSofi,2234112233', undefined, { consent: true, welcome: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n, 1);
  automations.setActive(welcome.id, false);
});

test('cola: campaña a un segmento, respeta bajas y la ventana de 24 h', async () => {
  reset();
  const a = contacts.create({ name: 'Ana', phone: '2235550001', status: 'confirmado' });
  const b = contacts.create({ name: 'Beto', phone: '2235550002', status: 'confirmado' });
  const c = contacts.create({ name: 'Cami', phone: '2235550003', status: 'confirmado' });
  const d = contacts.create({ name: 'Dani', phone: '2235550004', status: 'nuevo' });
  contacts.setOptOut(c.id, true);
  openWindow(a.id); // solo Ana respondió hace poco

  assert.deepEqual(campaigns.preview({ statuses: ['confirmado'] }), { eligible: 2, excluded_optout: 1 });
  assert.throws(() => campaigns.create({ name: 'Vacía', body: 'hola', filter: { statuses: ['asistio'] } }), (e) => e.status === 400);

  // sin plantilla: Ana (dentro de la ventana) recibe, Beto (fuera) falla con explicación
  const camp = campaigns.create({ name: 'Aviso', body: 'Hola {{nombre}}!', filter: { statuses: ['confirmado'] } });
  assert.equal(camp.total, 2);
  await queue.tick();
  assert.equal(sent(a.id)[0].body, 'Hola Ana!');
  assert.equal(sent(a.id)[0].status, 'sent');
  assert.equal(sent(b.id)[0].status, 'failed');
  assert.match(sent(b.id)[0].error, /24 h/);
  assert.equal(sent(c.id).length, 0);
  assert.equal(sent(d.id).length, 0);

  // con plantilla: Beto (fuera de la ventana) recibe la plantilla con variables ya reemplazadas
  campaigns.create({
    name: 'Con plantilla', body: 'Hola {{nombre}}', filter: { statuses: ['confirmado'] },
    template: { name: 'recordatorio_evento', lang: 'es_AR', params: 'nombre, evento' },
  });
  await queue.tick();
  const tb = sent(b.id).at(-1);
  assert.equal(tb.status, 'sent');
  assert.equal(tb.kind, 'template');
  assert.equal(sent(a.id).at(-1).kind, 'text', 'dentro de la ventana se prefiere texto libre');

  const stats = campaigns.get(camp.id).stats;
  assert.equal(stats.sent, 1);
  assert.equal(stats.failed, 1);
});

test('cola: campaña programada a futuro no sale hasta su hora y se puede cancelar', async () => {
  reset();
  const a = contacts.create({ name: 'Ana', phone: '2235550001' });
  openWindow(a.id);
  const later = new Date(Date.now() + 3600e3).toISOString();
  const camp = campaigns.create({ name: 'Futura', body: 'hola', scheduled_at: later, filter: {} });
  await queue.tick();
  assert.equal(sent(a.id).length, 0);
  campaigns.cancel(camp.id);
  db.prepare('UPDATE outbox SET send_at = ?').run(new Date(Date.now() - 1000).toISOString());
  await queue.tick();
  assert.equal(sent(a.id).length, 0);
  assert.equal(campaigns.get(camp.id).stats.cancelled, 1);
});

test('palabras clave: gana la más larga, cambia estado y responde', async () => {
  reset();
  const a = contacts.create({ name: 'Ana', phone: '2235550001' });
  assert.equal(automations.matchKeyword('¡SÍ!')?.name, 'Respuesta: SI (confirma asistencia)');
  assert.equal(automations.matchKeyword('Si, vamos los 3')?.config.set_status, 'confirmado');
  assert.equal(automations.matchKeyword('no puedo ir')?.config.set_status, 'no_asistio');
  assert.equal(automations.matchKeyword('No quiero recibir más mensajes')?.config.opt_out, true, 'gana "no quiero recibir mas" sobre "no"');
  assert.equal(automations.matchKeyword('Simón dice hola'), null, '"si" no coincide con "simón"');
  assert.equal(automations.matchKeyword('a qué hora es?'), null);

  inbound.receive({ fromPhone: '5492235550001', text: 'SI', waId: 'in1' });
  assert.equal(contacts.get(a.id).status, 'confirmado');
  assert.equal(contacts.get(a.id).unread, 1);
  await queue.tick();
  assert.match(sent(a.id)[0].body, /Quedaron confirmados/);
});

test('baja: marca al contacto, confirma la baja y no recibe nada más', async () => {
  reset();
  const a = contacts.create({ name: 'Ana', phone: '2235550001' });
  inbound.receive({ fromPhone: '5492235550001', text: 'BAJA', waId: 'in2' });
  assert.equal(contacts.get(a.id).opted_out, true);
  await queue.tick();
  assert.match(sent(a.id)[0].body, /no te vamos a escribir/);
  assert.throws(() => campaigns.create({ name: 'x', body: 'hola', filter: {} }), (e) => e.status === 400, 'sin destinatarios habilitados no hay campaña');
});

test('baja: una campaña posterior ya no la incluye', () => {
  reset();
  const a = contacts.create({ name: 'Ana', phone: '2235550001' });
  contacts.create({ name: 'Beto', phone: '2235550002' });
  inbound.receive({ fromPhone: '5492235550001', text: 'stop', waId: 'in3' });
  assert.equal(campaigns.preview({}).eligible, 1);
  assert.equal(contacts.get(a.id).opted_out, true);
});

test('recordatorios por fecha: una sola vez, solo al segmento, con tolerancia', async () => {
  reset();
  const rec = automations.list().find((a) => a.name === 'Recordatorio: 1 día antes');
  automations.setActive(rec.id, true);
  const ok = contacts.create({ name: 'Confirmada', phone: '2235550001', status: 'confirmado' });
  contacts.create({ name: 'Nueva', phone: '2235550002', status: 'nuevo' });
  const baja = contacts.create({ name: 'Baja', phone: '2235550003', status: 'confirmado' });
  contacts.setOptOut(baja.id, true);
  const eventAt = new Date('2099-11-15T19:00:00Z'); // 16:00 hs en Buenos Aires
  saveSettings({ event_at_local: '2099-11-15T16:00', timezone: 'America/Argentina/Buenos_Aires' });

  const dayBefore = eventAt.getTime() - 24 * 3600e3;
  assert.equal(automations.schedulerTick(dayBefore - 60e3), 0, 'todavía no es la hora');
  assert.equal(automations.schedulerTick(dayBefore + 60e3), 1);
  assert.equal(automations.schedulerTick(dayBefore + 120e3), 0, 'no se repite');
  assert.equal(automations.schedulerTick(dayBefore + 8 * 3600e3), 0, 'ya pasó la tolerancia');

  contacts.create({ name: 'Tarde', phone: '2235550004', status: 'confirmado' });
  assert.equal(automations.schedulerTick(dayBefore + 3600e3), 1, 'quien se confirma dentro de la tolerancia también recibe');
  assert.equal(automations.schedulerTick(eventAt.getTime() + 1), 0, 'después del evento no hay recordatorio previo');

  // el mensaje toma la fecha vigente al momento de enviarlo
  saveSettings({ event_place: 'Parque Camet' });
  openWindow(ok.id);
  await queue.tick();
  assert.match(sent(ok.id)[0].body, /Parque Camet/);
  assert.match(sent(ok.id)[0].body, /16:00 hs/);
  automations.setActive(rec.id, false);
});

test('cambio de estado dispara su automatización una sola vez', () => {
  reset();
  const a = automations.create({ name: 'Gracias por confirmar', trigger: 'status_changed', config: { status: 'confirmado' }, body: 'Gracias {{nombre}}', active: true });
  const c = contacts.create({ name: 'Ana', phone: '2235550001' });
  contacts.setStatus(c.id, 'interesado');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n, 0);
  contacts.setStatus(c.id, 'confirmado');
  contacts.setStatus(c.id, 'asistio');
  contacts.setStatus(c.id, 'confirmado');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n, 1);
  automations.remove(a.id);
});

test('mensajes entrantes: contacto desconocido se crea, se ignoran repetidos y los estados no retroceden', async () => {
  reset();
  inbound.receive({ fromPhone: '5492235559999', text: 'Hola, ¿hay lugar?', name: 'Rosa', waId: 'wamid.A' });
  inbound.receive({ fromPhone: '5492235559999', text: 'Hola, ¿hay lugar?', name: 'Rosa', waId: 'wamid.A' });
  const rosa = contacts.list({ search: 'rosa' });
  assert.equal(rosa.length, 1);
  assert.equal(rosa[0].source, 'whatsapp');
  assert.equal(rosa[0].unread, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE direction = 'in'").get().n, 1);

  // acuses de recibo: sent -> delivered -> read, y un "delivered" tardío no pisa "read"
  const id = rosa[0].id;
  db.prepare("INSERT INTO messages (contact_id, direction, body, status, wa_id, created_at) VALUES (?, 'out', 'x', 'sent', 'wamid.OUT', ?)").run(id, new Date().toISOString());
  const status = (s) => inbound.processWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.OUT', status: s }] } }] }] });
  const get = () => db.prepare("SELECT status, error FROM messages WHERE wa_id = 'wamid.OUT'").get();
  status('delivered'); assert.equal(get().status, 'delivered');
  status('read'); assert.equal(get().status, 'read');
  status('delivered'); assert.equal(get().status, 'read');
  status('failed'); assert.equal(get().status, 'read', 'un mensaje ya leído no pasa a fallido');
});

test('validación de automatizaciones', () => {
  assert.throws(() => automations.create({ name: 'x', trigger: 'nope', body: 'a' }), (e) => e.status === 400);
  assert.throws(() => automations.create({ name: 'x', trigger: 'keyword', config: { keywords: [] }, body: 'a' }), (e) => e.status === 400);
  assert.throws(() => automations.create({ name: 'x', trigger: 'before_event', config: { offset_minutes: -5 }, body: 'a' }), (e) => e.status === 400);
  assert.throws(() => automations.create({ name: 'x', trigger: 'contact_created', config: {}, body: '' }), (e) => e.status === 400);
  const k = automations.create({ name: 'solo etiqueta', trigger: 'keyword', config: { keywords: 'Info, INFORMACIÓN', add_tag: 'Pidió Info' }, body: '' });
  assert.deepEqual(k.config.keywords, ['info', 'informacion']);
  assert.equal(k.config.add_tag, 'pidió-info');
  automations.remove(k.id);
});
