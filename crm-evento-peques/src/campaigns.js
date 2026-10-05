'use strict';
const { db, nowIso, transaction, HttpError } = require('./db');
const contacts = require('./contacts');
const queue = require('./queue');
const { cleanTemplate } = require('./template');

const parse = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };

function cleanFilter(f = {}) {
  const filter = {
    statuses: (f.statuses || []).filter((s) => contacts.STATUS_IDS.includes(s)),
    tags: contacts.normalizeTags(f.tags || []),
  };
  // campaña a una selección puntual de contactos (desde la tabla)
  const ids = (f.ids || []).map(Number).filter(Number.isInteger).slice(0, 5000);
  if (ids.length) filter.ids = ids;
  return filter;
}

const eligible = (filter) => contacts.ids({ ...cleanFilter(filter), optedOut: 'exclude' });

function preview(filter) {
  const ids = eligible(filter);
  const all = contacts.ids(cleanFilter(filter)).length;
  return { eligible: ids.length, excluded_optout: all - ids.length };
}

function stats(id) {
  const out = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const r of db.prepare("SELECT status, COUNT(*) n FROM messages WHERE campaign_id = ? AND direction = 'out' GROUP BY status").all(id)) {
    if (r.status === 'failed') out.failed += r.n;
    else {
      out.sent += r.n;
      if (r.status === 'delivered' || r.status === 'read') out.delivered += r.n;
      if (r.status === 'read') out.read += r.n;
    }
  }
  const o = db.prepare(`SELECT
      SUM(status IN ('pending','sending')) pending, SUM(status = 'cancelled') cancelled
      FROM outbox WHERE campaign_id = ?`).get(id);
  return { ...out, pending: o.pending || 0, cancelled: o.cancelled || 0 };
}

const toApi = (r) => ({ ...r, cancelled: !!r.cancelled, filter: parse(r.filter, {}), template: parse(r.template, null), stats: stats(r.id) });

const list = () => db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all().map(toApi);

function get(id) {
  const r = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Campaña no encontrada');
  return toApi(r);
}

function create(input) {
  const name = String(input.name || '').trim();
  const body = String(input.body || '').trim();
  const t = cleanTemplate(input.template);
  if (!name) throw new HttpError(400, 'Poné un nombre a la campaña');
  if (!body && !t) throw new HttpError(400, 'Escribí el mensaje');
  const when = input.scheduled_at ? new Date(input.scheduled_at) : new Date();
  if (Number.isNaN(when.getTime())) throw new HttpError(400, 'Fecha de envío inválida');
  const filter = cleanFilter(input.filter);
  const ids = eligible(filter);
  if (!ids.length) throw new HttpError(400, 'Ningún contacto cumple ese filtro (o todos pidieron la baja)');

  return transaction(() => {
    const r = db.prepare('INSERT INTO campaigns (name, body, template, filter, scheduled_at, total, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(name, body, t ? JSON.stringify(t) : null, JSON.stringify(filter), when.toISOString(), ids.length, nowIso());
    const id = Number(r.lastInsertRowid);
    for (const contactId of ids) {
      queue.enqueue({ contactId, body, template: t, sendAt: when, campaignId: id, source: `campaña: ${name}` });
    }
    return get(id);
  });
}

function cancel(id) {
  get(id);
  db.prepare("UPDATE outbox SET status = 'cancelled', error = 'Campaña cancelada' WHERE campaign_id = ? AND status = 'pending'").run(id);
  db.prepare('UPDATE campaigns SET cancelled = 1 WHERE id = ?').run(id);
  return get(id);
}

module.exports = { preview, list, get, create, cancel };
