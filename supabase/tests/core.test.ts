// @ts-nocheck
// Lógica de negocio contra Postgres real (PGlite) con el mismo esquema que Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, saveSettings } from '../functions/api/db.ts';
import * as contacts from '../functions/api/contacts.ts';
import * as importer from '../functions/api/importer.ts';
import * as campaigns from '../functions/api/campaigns.ts';
import * as automations from '../functions/api/automations.ts';
import * as inbound from '../functions/api/inbound.ts';
import * as queue from '../functions/api/queue.ts';
import { setup, reset, sent, openWindow, teardown } from './helpers.ts';

test.before(setup);
test.beforeEach(reset);
test.after(teardown);

const outboxCount = () => db.val('select count(*)::int from outbox');

test('contactos: alta, duplicados por variante de número, etiquetas y filtros', async () => {
  const a = await contacts.create({ name: 'Ana Pérez', phone: '0223 15 456-7890', child_name: 'Tomi', tags: 'VIP, Sala 1' });
  assert.equal(a.phone, '5492234567890');
  assert.deepEqual(a.tags, ['vip', 'sala-1']);
  await assert.rejects(contacts.create({ name: 'Otra', phone: '+54 9 223 456 7890' }), (e) => e.status === 409);
  await assert.rejects(contacts.create({ name: 'X', phone: '12' }), (e) => e.status === 400);
  await assert.rejects(contacts.create({ phone: '2234567891' }), (e) => e.status === 400);

  const b = await contacts.create({ name: 'Beto', phone: '2234567891', status: 'confirmado', kids_count: 3 });
  assert.equal((await contacts.list({ statuses: ['confirmado'] })).length, 1);
  assert.equal((await contacts.list({ tags: ['vip'] }))[0].id, a.id);
  assert.equal((await contacts.list({ search: 'tomi' }))[0].id, a.id);
  assert.equal((await contacts.list({ search: '456 7891' }))[0].id, b.id, 'busca por teléfono ignorando espacios y guiones');
  const jose = await contacts.create({ name: 'JOSÉ Álvarez', phone: '2234567892' });
  assert.equal((await contacts.list({ search: 'jose alvarez' }))[0].id, jose.id, 'ignora mayúsculas y acentos');
  assert.equal((await contacts.list({ search: '100%' })).length, 0, 'el % no actúa como comodín');
  assert.equal(typeof (await contacts.get(a.id)).created_at, 'string', 'las fechas salen como texto ISO');

  await contacts.bulk([a.id, b.id], 'add_tag', 'grupo-a');
  await contacts.bulk([a.id], 'remove_tag', 'vip');
  assert.deepEqual((await contacts.get(a.id)).tags, ['sala-1', 'grupo-a']);
  await assert.rejects(contacts.bulk([a.id], 'status', 'inexistente'), (e) => e.status === 400);
  assert.deepEqual((await contacts.allTags()).map((t) => t.tag), ['grupo-a', 'sala-1']);
});

test('importación: detecta columnas, valida teléfonos y descarta repetidos', async () => {
  await contacts.create({ name: 'Ya existe', phone: '223 400 0001' });
  const csv = [
    'Nombre y apellido;Celular;Nombre del peque;Edad;Cantidad de niños;Email',
    'Laura Gómez;223 400-0002;Juana;4;2;laura@mail.com',
    'Pedro Ruiz;(0223) 15 400 0003;Lucas;6;1;',
    'Repetido;2234000002;;;;',
    'Existente;2234000001;;;;',
    'Sin teléfono;;;;;',
    'Mal número;12345;;;;',
  ].join('\n');
  const p = await importer.preview(csv);
  assert.deepEqual([p.total, p.ok, p.duplicate, p.invalid], [6, 2, 2, 2]);
  assert.equal(p.mapping.child_name, 2);
  assert.equal(p.mapping.name, 0);

  await assert.rejects(importer.commit(csv, p.mapping, { consent: false }), (e) => e.status === 400);
  const r = await importer.commit(csv, p.mapping, { consent: true, tags: ['evento-2026'] });
  assert.deepEqual(r, { created: 2, skipped: 4 });
  const laura = (await contacts.list({ search: 'laura' }))[0];
  assert.equal(laura.child_name, 'Juana');
  assert.equal(laura.kids_count, 2);
  assert.deepEqual(laura.tags, ['evento-2026']);
  assert.equal(await outboxCount(), 0, 'importar no envía nada por defecto');
});

test('importación: planilla sin encabezados y pegada desde Sheets (tabs)', async () => {
  const text = 'Marta\t223 411 1111\nRoque\t223 411 2222';
  const p = await importer.preview(text);
  assert.equal(p.ok, 2);
  assert.equal(p.mapping.phone, 1);
  assert.equal(p.mapping.name, 0);
  assert.equal(p.has_header, false);
  assert.equal((await importer.preview(text, { name: 0, phone: 1 }, p.has_header)).ok, 2, 'corregir el mapeo no pierde la primera fila');
  assert.equal((await importer.preview('Nombre,Cel\nAna,2234113333', { name: 0, phone: 1 }, true)).ok, 1);
});

test('importación: un error a mitad de camino no deja contactos a medias', async () => {
  const csv = 'Nombre,Celular\nUno,2234001111\nDos,2234001112';
  const p = await importer.preview(csv);
  await db.query("alter table contacts add constraint solo_uno check (name <> 'Dos')");
  try {
    await assert.rejects(importer.commit(csv, p.mapping, { consent: true }));
    assert.equal(await db.val('select count(*)::int from contacts'), 0, 'se deshizo todo');
  } finally {
    await db.query('alter table contacts drop constraint solo_uno');
  }
});

test('importación: con "bienvenida" dispara la automatización de alta', async () => {
  const welcome = (await automations.list()).find((a) => a.trigger === 'contact_created');
  await automations.setActive(welcome.id, true);
  await saveSettings({ event_at_local: '2099-11-15T16:00', event_place: 'Plaza' });
  await importer.commit('Nombre,Celular\nSofi,2234112233', undefined, { consent: true, welcome: true });
  assert.equal(await outboxCount(), 1);
});

test('cola: campaña a un segmento, respeta bajas y la ventana de 24 h', async () => {
  const a = await contacts.create({ name: 'Ana', phone: '2235550001', status: 'confirmado' });
  const b = await contacts.create({ name: 'Beto', phone: '2235550002', status: 'confirmado' });
  const c = await contacts.create({ name: 'Cami', phone: '2235550003', status: 'confirmado' });
  const d = await contacts.create({ name: 'Dani', phone: '2235550004', status: 'nuevo' });
  await contacts.setOptOut(c.id, true);
  await openWindow(a.id); // solo Ana respondió hace poco

  assert.deepEqual(await campaigns.preview({ statuses: ['confirmado'] }), { eligible: 2, excluded_optout: 1, outside_window: 1 });
  await assert.rejects(campaigns.create({ name: 'Vacía', body: 'hola', filter: { statuses: ['asistio'] } }), (e) => e.status === 400);

  // sin plantilla: Ana (dentro de la ventana) recibe, Beto (fuera) falla con explicación
  const camp = await campaigns.create({ name: 'Aviso', body: 'Hola {{nombre}}!', filter: { statuses: ['confirmado'] } });
  assert.equal(camp.total, 2);
  await queue.tick();
  assert.equal((await sent(a.id))[0].body, 'Hola Ana!');
  assert.equal((await sent(a.id))[0].status, 'sent');
  assert.equal((await sent(b.id))[0].status, 'failed');
  assert.match((await sent(b.id))[0].error, /24 h/);
  assert.equal((await sent(c.id)).length, 0);
  assert.equal((await sent(d.id)).length, 0);

  // con plantilla: Beto (fuera de la ventana) recibe la plantilla con variables ya reemplazadas
  await campaigns.create({
    name: 'Con plantilla', body: 'Hola {{nombre}}', filter: { statuses: ['confirmado'] },
    template: { name: 'recordatorio_evento', lang: 'es_AR', params: 'nombre, evento' },
  });
  await queue.tick();
  const tb = (await sent(b.id)).at(-1);
  assert.equal(tb.status, 'sent');
  assert.equal(tb.kind, 'template');
  assert.equal((await sent(a.id)).at(-1).kind, 'text', 'dentro de la ventana se prefiere texto libre');

  const stats = (await campaigns.get(camp.id)).stats;
  assert.equal(stats.sent, 1);
  assert.equal(stats.failed, 1);
});

test('cola: campaña programada a futuro no sale hasta su hora y se puede cancelar', async () => {
  const a = await contacts.create({ name: 'Ana', phone: '2235550001' });
  await openWindow(a.id);
  const later = new Date(Date.now() + 3600e3).toISOString();
  const camp = await campaigns.create({ name: 'Futura', body: 'hola', scheduled_at: later, filter: {} });
  assert.equal(await queue.tick(), 0);
  assert.equal((await sent(a.id)).length, 0);
  await campaigns.cancel(camp.id);
  await db.query("update outbox set send_at = now() - interval '1 second'");
  await queue.tick();
  assert.equal((await sent(a.id)).length, 0);
  assert.equal((await campaigns.get(camp.id)).stats.cancelled, 1);
});

test('cola: dos ejecuciones simultáneas no envían el mismo mensaje dos veces', async () => {
  for (let i = 0; i < 12; i++) {
    const c = await contacts.create({ name: `Fam ${i}`, phone: `22355600${String(i).padStart(2, '0')}` });
    await openWindow(c.id);
  }
  await campaigns.create({ name: 'Masiva', body: 'Hola {{nombre}}', filter: {} });
  const [x, y] = await Promise.all([queue.tick(), queue.tick()]);
  assert.equal(x + y, 12);
  assert.equal(await db.val("select count(*)::int from messages where direction = 'out'"), 12);
});

test('cola: un mensaje trabado en "sending" vuelve a la cola', async () => {
  const a = await contacts.create({ name: 'Ana', phone: '2235550001' });
  await openWindow(a.id);
  await queue.enqueue({ contactId: a.id, body: 'hola' });
  await db.query("update outbox set status = 'sending', claimed_at = now() - interval '10 minutes'");
  assert.equal(await queue.tick(), 1);
  assert.equal((await sent(a.id)).length, 1);
});

test('palabras clave: gana la más larga, cambia estado y responde', async () => {
  const a = await contacts.create({ name: 'Ana', phone: '2235550001' });
  assert.equal((await automations.matchKeyword('¡SÍ!'))?.name, 'Respuesta: SI (confirma asistencia)');
  assert.equal((await automations.matchKeyword('Si, vamos los 3'))?.config.set_status, 'confirmado');
  assert.equal((await automations.matchKeyword('no puedo ir'))?.config.set_status, 'no_asistio');
  assert.equal((await automations.matchKeyword('No quiero recibir más mensajes'))?.config.opt_out, true, 'gana "no quiero recibir mas" sobre "no"');
  assert.equal(await automations.matchKeyword('Simón dice hola'), null, '"si" no coincide con "simón"');
  assert.equal(await automations.matchKeyword('a qué hora es?'), null);

  await saveSettings({ event_at_local: '2099-11-15T16:00', event_place: 'Plaza' });
  await inbound.receive({ fromPhone: '5492235550001', text: 'SI', waId: 'in1' });
  assert.equal((await contacts.get(a.id)).status, 'confirmado');
  assert.equal((await contacts.get(a.id)).unread, 1);
  await queue.tick();
  assert.match((await sent(a.id))[0].body, /Quedaron confirmados/);
});

test('baja: marca al contacto, confirma la baja y no recibe nada más', async () => {
  const a = await contacts.create({ name: 'Ana', phone: '2235550001' });
  await contacts.create({ name: 'Beto', phone: '2235550002' });
  await inbound.receive({ fromPhone: '5492235550001', text: 'BAJA', waId: 'in2' });
  assert.equal((await contacts.get(a.id)).opted_out, true);
  await queue.tick();
  assert.match((await sent(a.id))[0].body, /no te vamos a escribir/);
  assert.equal((await campaigns.preview({})).eligible, 1);
  await assert.rejects(campaigns.create({ name: 'x', body: 'hola', filter: { ids: [a.id] } }), (e) => e.status === 400);
});

test('recordatorios por fecha: una sola vez, solo al segmento, con tolerancia', async () => {
  const rec = (await automations.list()).find((a) => a.name === 'Recordatorio: 1 día antes');
  await automations.setActive(rec.id, true);
  const ok = await contacts.create({ name: 'Confirmada', phone: '2235550001', status: 'confirmado' });
  await contacts.create({ name: 'Nueva', phone: '2235550002', status: 'nuevo' });
  const baja = await contacts.create({ name: 'Baja', phone: '2235550003', status: 'confirmado' });
  await contacts.setOptOut(baja.id, true);
  const eventAt = new Date('2099-11-15T19:00:00Z'); // 16:00 hs en Buenos Aires
  await saveSettings({ event_at_local: '2099-11-15T16:00', timezone: 'America/Argentina/Buenos_Aires' });

  const dayBefore = eventAt.getTime() - 24 * 3600e3;
  assert.equal(await automations.schedulerTick(dayBefore - 60e3), 0, 'todavía no es la hora');
  assert.equal(await automations.schedulerTick(dayBefore + 60e3), 1);
  assert.equal(await automations.schedulerTick(dayBefore + 120e3), 0, 'no se repite');
  assert.equal(await automations.schedulerTick(dayBefore + 8 * 3600e3), 0, 'ya pasó la tolerancia');

  await contacts.create({ name: 'Tarde', phone: '2235550004', status: 'confirmado' });
  assert.equal(await automations.schedulerTick(dayBefore + 3600e3), 1, 'quien se confirma dentro de la tolerancia también recibe');
  assert.equal(await automations.schedulerTick(eventAt.getTime() + 1), 0, 'después del evento no hay recordatorio previo');

  // el mensaje toma la fecha vigente al momento de enviarlo
  await saveSettings({ event_place: 'Parque Camet' });
  await openWindow(ok.id);
  await queue.tick();
  assert.match((await sent(ok.id))[0].body, /Parque Camet/);
  assert.match((await sent(ok.id))[0].body, /16:00 hs/);
});

test('cambio de estado dispara su automatización una sola vez', async () => {
  const a = await automations.create({ name: 'Gracias por confirmar', trigger: 'status_changed', config: { status: 'confirmado' }, body: 'Gracias {{nombre}}', active: true });
  const c = await contacts.create({ name: 'Ana', phone: '2235550001' });
  await contacts.setStatus(c.id, 'interesado');
  assert.equal(await outboxCount(), 0);
  await contacts.setStatus(c.id, 'confirmado');
  await contacts.setStatus(c.id, 'asistio');
  await contacts.setStatus(c.id, 'confirmado');
  assert.equal(await outboxCount(), 1);
  await automations.remove(a.id);
});

test('mensajes entrantes: contacto desconocido se crea, se ignoran repetidos y los estados no retroceden', async () => {
  await inbound.receive({ fromPhone: '5492235559999', text: 'Hola, ¿hay lugar?', name: 'Rosa', waId: 'wamid.A' });
  await inbound.receive({ fromPhone: '5492235559999', text: 'Hola, ¿hay lugar?', name: 'Rosa', waId: 'wamid.A' });
  const rosa = await contacts.list({ search: 'rosa' });
  assert.equal(rosa.length, 1);
  assert.equal(rosa[0].source, 'whatsapp');
  assert.equal(rosa[0].unread, 1);
  assert.equal(await db.val("select count(*)::int from messages where direction = 'in'"), 1);

  // acuses de recibo: sent -> delivered -> read, y un "delivered" tardío no pisa "read"
  const id = rosa[0].id;
  await db.query("insert into messages (contact_id, direction, body, status, wa_id) values ($1, 'out', 'x', 'sent', 'wamid.OUT')", [id]);
  const status = (s) => inbound.processWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.OUT', status: s }] } }] }] });
  const get = () => db.one("select status from messages where wa_id = 'wamid.OUT'");
  await status('delivered'); assert.equal((await get()).status, 'delivered');
  await status('read'); assert.equal((await get()).status, 'read');
  await status('delivered'); assert.equal((await get()).status, 'read');
  await status('failed'); assert.equal((await get()).status, 'read', 'un mensaje ya leído no pasa a fallido');
});

test('validación de automatizaciones', async () => {
  await assert.rejects(automations.create({ name: 'x', trigger: 'nope', body: 'a' }), (e) => e.status === 400);
  await assert.rejects(automations.create({ name: 'x', trigger: 'keyword', config: { keywords: [] }, body: 'a' }), (e) => e.status === 400);
  await assert.rejects(automations.create({ name: 'x', trigger: 'before_event', config: { offset_minutes: -5 }, body: 'a' }), (e) => e.status === 400);
  await assert.rejects(automations.create({ name: 'x', trigger: 'contact_created', config: {}, body: '' }), (e) => e.status === 400);
  const k = await automations.create({ name: 'solo etiqueta', trigger: 'keyword', config: { keywords: 'Info, INFORMACIÓN', add_tag: 'Pidió Info' }, body: '' });
  assert.deepEqual(k.config.keywords, ['info', 'informacion']);
  assert.equal(k.config.add_tag, 'pidió-info');
  const edited = await automations.update(k.id, { body: 'Te mandamos la info' });
  assert.deepEqual(edited.config.keywords, ['info', 'informacion'], 'editar el texto no pierde la configuración');
  await automations.remove(k.id);
});

// ---------------------------------------------------------------------------------------------
// Endurecimiento (revisión independiente)
// ---------------------------------------------------------------------------------------------

test('baja: frases naturales sí, preguntas y respuestas normales no', () => {
  for (const t of ['BAJA', 'baja', 'Stop', 'STOP!', 'Baja por favor', 'No me escribas más', 'no me escriban mas', 'No quiero recibir más mensajes',
    'Por favor dejen de escribirme', 'sacame de la lista', 'Quiero darme de baja', 'cancelar suscripción', 'Basta']) {
    assert.equal(automations.isOptOut(t), true, t);
  }
  for (const t of ['Sí', 'No puedo ir', 'No voy a poder', 'Hola', 'a qué hora es?', '2 nenes', 'Van a bajar la música?', 'Gracias', '']) {
    assert.equal(automations.isOptOut(t), false, t || '(vacío)');
  }
});

test('palabras clave: sin falsos positivos por prefijo, y entiende «Siii»', async () => {
  const name = async (t) => (await automations.matchKeyword(t))?.name;
  assert.equal(await name('2 nenes'), undefined, '«2 nenes» no es la opción 2');
  assert.equal(await name('1 nene y 1 nena'), undefined);
  assert.equal(await name('Voy a consultar'), undefined);
  assert.equal(await name('No sé todavía'), undefined);
  assert.equal(await name('Si necesito llevar algo?'), undefined, 'una pregunta la lee una persona');
  assert.equal(await name('Sí, estuvimos hablando con la familia y ahora vemos'), undefined, 'mensaje largo');
  assert.equal(await name('Siii'), 'Respuesta: SI (confirma asistencia)');
  assert.equal(await name('Dale!'), 'Respuesta: SI (confirma asistencia)');
  assert.equal(await name('2'), 'Respuesta: NO (no puede asistir)');
  assert.equal(await name('Sí, vamos'), 'Respuesta: SI (confirma asistencia)');
});

test('un «sí» después del evento no cambia a quien ya figura como asistió', async () => {
  const a = await contacts.create({ name: 'Ana', phone: '2235550001', status: 'asistio' });
  await inbound.receive({ fromPhone: '5492235550001', text: 'Sí, estuvo genial', waId: 'g1' });
  assert.equal((await contacts.get(a.id)).status, 'asistio');
});

test('importación masiva por tandas: 600 filas, números extranjeros, y quien pidió la baja no se re-suscribe', async () => {
  const gone = await contacts.create({ name: 'Baja Previa', phone: '2235559999' });
  await contacts.setOptOut(gone.id, true);
  await contacts.remove(gone.id); // el contacto desaparece, la baja queda
  const rows = Array.from({ length: 600 }, (_, i) => `Familia ${i},223${String(5000000 + i)}`);
  rows.push('Uruguaya,+598 99 123 456', 'Baja Previa,223 555 9999');
  const welcome = (await automations.list()).find((a) => a.trigger === 'contact_created');
  await automations.setActive(welcome.id, true);
  const r = await importer.commit('Nombre,Teléfono\n' + rows.join('\n'), undefined, { consent: true, welcome: true, tags: ['evento'] });
  assert.deepEqual(r, { created: 602, skipped: 0 });
  assert.equal((await contacts.list({ search: 'uruguaya' }))[0].phone, '59899123456', 'el +598 se respeta (antes la importación fallaba entera)');
  const baja = (await contacts.list({ search: 'baja previa' }))[0];
  assert.equal(baja.opted_out, true);
  assert.equal(await outboxCount(), 601, 'la bienvenida sale para todos menos para quien pidió la baja');
  const c = await db.one("select consent_at, consent_note, tags from contacts where name = 'Familia 5'");
  assert.ok(c.consent_at, 'se registra cuándo se confirmó el consentimiento');
  assert.match(c.consent_note, /consentimiento/);
  assert.equal(c.tags, ',evento,');
});

test('acciones masivas por lotes: etiquetas, estado (dispara automatizaciones), baja y borrado de 1200 contactos', async () => {
  const values = Array.from({ length: 1200 }, (_, i) => `('M${i}', '549223${String(7000000 + i)}', '223${String(7000000 + i)}', ',a,')`).join(',');
  await db.query(`insert into contacts (name, phone, phone_key, tags) values ${values}`);
  const ids = (await db.query('select id from contacts order by id')).map((r) => r.id);

  assert.equal(await contacts.bulk(ids, 'add_tag', 'grupo-b'), 1200);
  assert.equal(await db.val("select count(*)::int from contacts where tags = ',a,grupo-b,'"), 1200);
  await contacts.bulk(ids, 'remove_tag', 'a');
  assert.equal(await db.val("select count(*)::int from contacts where tags = ',grupo-b,'"), 1200);

  const thanks = await automations.create({ name: 'Al confirmar', trigger: 'status_changed', config: { status: 'confirmado' }, body: 'Gracias {{nombre}}', active: true });
  assert.equal(await contacts.bulk(ids, 'status', 'confirmado'), 1200);
  assert.equal(await db.val('select count(*)::int from outbox where automation_id = $1', [thanks.id]), 1200);
  assert.equal(await contacts.bulk(ids, 'status', 'confirmado'), 1200);
  assert.equal(await db.val('select count(*)::int from outbox where automation_id = $1', [thanks.id]), 1200, 'una sola vez por contacto');
  await assert.rejects(contacts.bulk(ids, 'status', 'inventado'), (e) => e.status === 400);

  await contacts.bulk(ids.slice(0, 10), 'optout');
  assert.equal(await db.val('select count(*)::int from suppressions'), 10);
  await contacts.bulk(ids.slice(0, 4), 'optin');
  assert.equal(await db.val('select count(*)::int from suppressions'), 6);
  assert.equal(await contacts.bulk(ids, 'delete'), 1200);
  assert.equal(await db.val('select count(*)::int from contacts'), 0);
  assert.equal(await db.val('select count(*)::int from suppressions'), 6, 'borrar los contactos no borra las bajas');
});

test('apagar o borrar una automatización cancela lo que dejó encolado', async () => {
  const welcome = (await automations.list()).find((a) => a.trigger === 'contact_created');
  await automations.update(welcome.id, { active: true, config: { delay_minutes: 60 } });
  await contacts.create({ name: 'Ana', phone: '2235550001' });
  await contacts.create({ name: 'Beto', phone: '2235550002' });
  assert.equal(await db.val("select count(*)::int from outbox where status = 'pending'"), 2);
  await automations.setActive(welcome.id, false);
  assert.equal(await db.val("select count(*)::int from outbox where status = 'pending'"), 0);
  assert.equal(await db.val("select count(*)::int from outbox where status = 'cancelled'"), 2);

  await automations.setActive(welcome.id, true);
  await contacts.create({ name: 'Cami', phone: '2235550003' });
  await automations.remove(welcome.id);
  assert.equal(await db.val("select count(*)::int from outbox where status = 'pending'"), 0);
});

test('recordatorios: una sola sentencia por automatización, y un error en una no frena a las demás', async () => {
  await saveSettings({ event_at_local: '2099-11-15T16:00', event_place: 'Plaza' });
  const eventAt = Date.parse('2099-11-15T19:00:00Z'); // 16:00 en Buenos Aires
  await contacts.create({ name: 'Ana', phone: '2235550001', status: 'confirmado' });
  const [broken] = (await automations.list()).filter((a) => a.trigger === 'before_event');
  await automations.setActive(broken.id, true);
  await db.query("update automations set config = '{\"offset_minutes\": 120, \"filter\": {\"statuses\": \"x\"}}'::jsonb where id = $1", [broken.id]); // config rota a propósito (primera en el orden)
  await automations.create({ name: 'Sana', trigger: 'before_event', config: { offset_minutes: 120 }, body: 'x', active: true });
  const now = eventAt - 119 * 60000;
  assert.equal(await automations.schedulerTick(now), 1, 'la sana se encola aunque la anterior falle');
  assert.equal(await automations.schedulerTick(now + 60000), 0, 'y no se repite');
});

test('mensajes de contactos sin nombre saludan «familia» y no «Sin»', async () => {
  const { contactVars } = await import('../functions/api/template.ts');
  assert.equal(contactVars({ name: 'Sin nombre' }, {}).nombre, 'familia');
  assert.equal(contactVars({ name: 'laura gómez' }, {}).nombre, 'Laura');
});
