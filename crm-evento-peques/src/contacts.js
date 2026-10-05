'use strict';
const { db, nowIso, getSettings, HttpError, likeEscape, placeholders, transaction } = require('./db');
const { normalizePhone, formatPhone, digitsOnly } = require('./phone');
const bus = require('./bus');

const STATUSES = [
  { id: 'nuevo', label: 'Nuevo', color: '#6b7280' },
  { id: 'contactado', label: 'Contactado', color: '#3b82f6' },
  { id: 'interesado', label: 'Interesado', color: '#f59e0b' },
  { id: 'confirmado', label: 'Confirmado', color: '#10b981' },
  { id: 'asistio', label: 'Asistió', color: '#8b5cf6' },
  { id: 'no_asistio', label: 'No asistió', color: '#ef4444' },
];
const STATUS_IDS = STATUSES.map((s) => s.id);

// ---- etiquetas: guardadas como ",a,b," para filtrar con LIKE ----
function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[,;]/);
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().replace(/[\s,]+/g, '-')).filter(Boolean))];
}
const tagsToDb = (arr) => (arr.length ? `,${arr.join(',')},` : '');
const tagsFromDb = (s) => String(s || '').split(',').filter(Boolean);

function toApi(row) {
  if (!row) return row;
  return { ...row, tags: tagsFromDb(row.tags), opted_out: !!row.opted_out, phone_display: formatPhone(row.phone) };
}

const getRaw = (id) => db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
function get(id) {
  const row = getRaw(id);
  if (!row) throw new HttpError(404, 'Contacto no encontrado');
  return toApi(row);
}

function phoneOptions() {
  const s = getSettings();
  return { country: s.default_country, area: s.default_area };
}

function clean(input) {
  const kids = Number.parseInt(input.kids_count, 10);
  return {
    name: String(input.name ?? '').trim().slice(0, 120),
    email: String(input.email ?? '').trim().slice(0, 160),
    child_name: String(input.child_name ?? '').trim().slice(0, 120),
    child_age: String(input.child_age ?? '').trim().slice(0, 40),
    kids_count: Number.isFinite(kids) && kids > 0 ? Math.min(kids, 50) : 1,
    notes: String(input.notes ?? '').slice(0, 2000),
    source: String(input.source ?? '').trim().slice(0, 80),
  };
}

function checkStatus(status) {
  if (!STATUS_IDS.includes(status)) throw new HttpError(400, `Estado inválido: ${status}`);
  return status;
}

/** Crea un contacto. emit=false evita disparar automatizaciones (se usa en importaciones masivas). */
function create(input, { emit = true } = {}) {
  const c = clean(input);
  if (!c.name) throw new HttpError(400, 'Falta el nombre');
  const p = normalizePhone(input.phone, phoneOptions());
  if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
  const dup = db.prepare('SELECT id, name FROM contacts WHERE phone_key = ?').get(p.key);
  if (dup) throw new HttpError(409, `Ya existe un contacto con ese teléfono (${dup.name})`, { existing_id: dup.id });

  const status = input.status ? checkStatus(input.status) : 'nuevo';
  const now = nowIso();
  const r = db.prepare(`INSERT INTO contacts
    (name, phone, phone_key, email, child_name, child_age, kids_count, status, tags, notes, source, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    c.name, p.phone, p.key, c.email, c.child_name, c.child_age, c.kids_count, status,
    tagsToDb(normalizeTags(input.tags)), c.notes, c.source, now, now,
  );
  const contact = get(Number(r.lastInsertRowid));
  if (emit) bus.fire('contact:created', contact);
  return contact;
}

function update(id, input) {
  const cur = get(id);
  const c = clean({ ...cur, ...input });
  if (!c.name) throw new HttpError(400, 'Falta el nombre');

  let { phone, phone_key: key } = db.prepare('SELECT phone, phone_key FROM contacts WHERE id = ?').get(id);
  if (input.phone !== undefined && digitsOnly(input.phone) !== digitsOnly(cur.phone)) {
    const p = normalizePhone(input.phone, phoneOptions());
    if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
    const dup = db.prepare('SELECT id, name FROM contacts WHERE phone_key = ? AND id <> ?').get(p.key, id);
    if (dup) throw new HttpError(409, `Ese teléfono ya pertenece a ${dup.name}`, { existing_id: dup.id });
    phone = p.phone;
    key = p.key;
  }
  const tags = input.tags !== undefined ? tagsToDb(normalizeTags(input.tags)) : db.prepare('SELECT tags FROM contacts WHERE id = ?').get(id).tags;
  const optedOut = input.opted_out !== undefined ? (input.opted_out ? 1 : 0) : (cur.opted_out ? 1 : 0);

  db.prepare(`UPDATE contacts SET name=?, phone=?, phone_key=?, email=?, child_name=?, child_age=?, kids_count=?,
    notes=?, source=?, tags=?, opted_out=?, updated_at=? WHERE id=?`).run(
    c.name, phone, key, c.email, c.child_name, c.child_age, c.kids_count, c.notes, c.source, tags, optedOut, nowIso(), id,
  );
  if (input.status !== undefined && input.status !== cur.status) setStatus(id, input.status);
  return get(id);
}

function setStatus(id, status) {
  checkStatus(status);
  const cur = get(id);
  if (cur.status === status) return cur;
  db.prepare('UPDATE contacts SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  const contact = get(id);
  bus.fire('contact:status', contact, cur.status);
  return contact;
}

function addTags(id, tags) {
  const cur = tagsFromDb(db.prepare('SELECT tags FROM contacts WHERE id = ?').get(id)?.tags);
  const next = normalizeTags([...cur, ...normalizeTags(tags)]);
  db.prepare('UPDATE contacts SET tags = ?, updated_at = ? WHERE id = ?').run(tagsToDb(next), nowIso(), id);
}

function removeTags(id, tags) {
  const drop = new Set(normalizeTags(tags));
  const cur = tagsFromDb(db.prepare('SELECT tags FROM contacts WHERE id = ?').get(id)?.tags);
  db.prepare('UPDATE contacts SET tags = ?, updated_at = ? WHERE id = ?').run(tagsToDb(cur.filter((t) => !drop.has(t))), nowIso(), id);
}

function setOptOut(id, value) {
  db.prepare('UPDATE contacts SET opted_out = ?, updated_at = ? WHERE id = ?').run(value ? 1 : 0, nowIso(), id);
}

function remove(id) {
  const r = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'Contacto no encontrado');
}

// Búsqueda sin mayúsculas ni acentos ("jose" encuentra "José"). SQLite solo ignora mayúsculas ASCII,
// por eso se hace en JS (el volumen de un evento, miles de contactos, lo permite de sobra).
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function searchPredicate(search) {
  const q = fold(search).trim();
  if (!q) return null;
  const digits = digitsOnly(q);
  return (r) => fold(`${r.name} ${r.child_name} ${r.email} ${r.notes}`).includes(q) || (digits.length >= 3 && r.phone.includes(digits));
}

/**
 * Filtro común a listado, exportación, campañas y automatizaciones.
 * f: { search, ids:[], statuses:[], tags:[] (cualquiera), optedOut: 'exclude'|'only'|undefined }
 * (`search` se aplica aparte, en list(), con searchPredicate)
 */
function filterSql(f = {}) {
  const where = [];
  const params = [];
  const only = (f.ids || []).map(Number).filter(Number.isInteger).slice(0, 5000);
  if (only.length) { where.push(`id IN (${placeholders(only.length)})`); params.push(...only); }
  const statuses = (f.statuses || (f.status ? [f.status] : [])).filter(Boolean);
  if (statuses.length) { where.push(`status IN (${placeholders(statuses.length)})`); params.push(...statuses); }
  const tags = normalizeTags(f.tags || (f.tag ? [f.tag] : []));
  if (tags.length) {
    where.push(`(${tags.map(() => "tags LIKE ? ESCAPE '\\'").join(' OR ')})`);
    params.push(...tags.map((t) => `%,${likeEscape(t)},%`));
  }
  if (f.optedOut === 'exclude') where.push('opted_out = 0');
  if (f.optedOut === 'only') where.push('opted_out = 1');
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function list(f = {}, limit = 5000) {
  const { sql, params } = filterSql(f);
  const match = searchPredicate(f.search);
  const rows = db.prepare(`SELECT * FROM contacts ${sql} ORDER BY id DESC`).all(...params);
  return (match ? rows.filter(match) : rows).slice(0, limit).map(toApi);
}

function ids(f = {}) {
  return list(f, Infinity).map((c) => c.id).sort((a, b) => a - b);
}

function allTags() {
  const set = new Map();
  for (const r of db.prepare("SELECT tags FROM contacts WHERE tags <> ''").all()) {
    for (const t of tagsFromDb(r.tags)) set.set(t, (set.get(t) || 0) + 1);
  }
  return [...set.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Acciones masivas sobre una lista de ids. */
function bulk(idList, action, value) {
  const list = [...new Set(idList.map(Number).filter(Number.isInteger))];
  let n = 0;
  transaction(() => {
    for (const id of list) {
      if (!getRaw(id)) continue;
      switch (action) {
        case 'status': setStatus(id, value); break;
        case 'add_tag': addTags(id, value); break;
        case 'remove_tag': removeTags(id, value); break;
        case 'optout': setOptOut(id, true); break;
        case 'optin': setOptOut(id, false); break;
        case 'delete': db.prepare('DELETE FROM contacts WHERE id = ?').run(id); break;
        default: throw new HttpError(400, 'Acción inválida');
      }
      n++;
    }
  });
  return n;
}

module.exports = {
  STATUSES, STATUS_IDS, create, update, get, getRaw, setStatus, addTags, removeTags, setOptOut, remove,
  list, ids, allTags, bulk, filterSql, toApi, normalizeTags, tagsFromDb,
};
