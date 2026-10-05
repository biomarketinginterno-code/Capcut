// @ts-nocheck
import { db, nowIso, getSettings, HttpError, likeEscape, placeholders, isUniqueViolation } from './db.ts';
import { normalizePhone, formatPhone, digitsOnly } from './phone.ts';
import { bus } from './bus.ts';

export const STATUSES = [
  { id: 'nuevo', label: 'Nuevo', color: '#6b7280' },
  { id: 'contactado', label: 'Contactado', color: '#3b82f6' },
  { id: 'interesado', label: 'Interesado', color: '#f59e0b' },
  { id: 'confirmado', label: 'Confirmado', color: '#10b981' },
  { id: 'asistio', label: 'Asistió', color: '#8b5cf6' },
  { id: 'no_asistio', label: 'No asistió', color: '#ef4444' },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);

// ---- etiquetas: guardadas como ",a,b," para filtrar con LIKE ----
export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[,;]/);
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().replace(/[\s,]+/g, '-')).filter(Boolean))];
}
export const tagsToDb = (arr) => (arr.length ? `,${arr.join(',')},` : '');
export const tagsFromDb = (s) => String(s || '').split(',').filter(Boolean);

export function toApi(row) {
  if (!row) return row;
  return { ...row, tags: tagsFromDb(row.tags), phone_display: formatPhone(row.phone) };
}

export const getRaw = (id) => db.one('select * from contacts where id = $1', [id]);
export async function get(id) {
  const row = await getRaw(id);
  if (!row) throw new HttpError(404, 'Contacto no encontrado');
  return toApi(row);
}

async function phoneOptions() {
  const s = await getSettings();
  return { country: s.default_country, area: s.default_area };
}

export function clean(input) {
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

/** Teléfonos de quienes pidieron la baja: la lista sobrevive al borrado del contacto y a una nueva importación. */
export async function suppressedKeys(keys) {
  const out = new Set();
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (!chunk.length) continue;
    for (const r of await db.query(`select phone_key from suppressions where phone_key in (${placeholders(chunk.length)})`, chunk)) out.add(r.phone_key);
  }
  return out;
}

/** Crea un contacto. emit=false evita disparar automatizaciones (importaciones masivas). */
export async function create(input, { emit = true } = {}) {
  const c = clean(input);
  if (!c.name) throw new HttpError(400, 'Falta el nombre');
  const p = normalizePhone(input.phone, await phoneOptions());
  if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
  const dup = await db.one('select id, name from contacts where phone_key = $1', [p.key]);
  if (dup) throw new HttpError(409, `Ya existe un contacto con ese teléfono (${dup.name})`, { existing_id: dup.id });

  const status = input.status ? checkStatus(input.status) : 'nuevo';
  const suppressed = (await suppressedKeys([p.key])).has(p.key); // si ya había pedido la baja, vuelve a entrar dado de baja
  const consentNote = String(input.consent_note ?? '').trim().slice(0, 200);
  let id;
  try {
    id = await db.val(
      `insert into contacts (name, phone, phone_key, email, child_name, child_age, kids_count, status, tags, notes, source, opted_out, consent_at, consent_note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, case when $13::text <> '' then now() end, $13::text) returning id`,
      [c.name, p.phone, p.key, c.email, c.child_name, c.child_age, c.kids_count, status, tagsToDb(normalizeTags(input.tags)), c.notes, c.source, suppressed, consentNote],
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, 'Ya existe un contacto con ese teléfono');
    throw e;
  }
  const contact = await get(id);
  if (emit) await bus.fire('contact:created', contact);
  return contact;
}

export async function update(id, input) {
  if (input.status !== undefined) checkStatus(input.status); // se valida antes de guardar nada
  const cur = await get(id);
  const c = clean({ ...cur, ...input });
  if (!c.name) throw new HttpError(400, 'Falta el nombre');

  let { phone, phone_key: key } = cur;
  if (input.phone !== undefined && digitsOnly(input.phone) !== digitsOnly(cur.phone)) {
    const p = normalizePhone(input.phone, await phoneOptions());
    if (!p.valid) throw new HttpError(400, `Teléfono inválido: ${p.reason}`);
    const dup = await db.one('select id, name from contacts where phone_key = $1 and id <> $2', [p.key, id]);
    if (dup) throw new HttpError(409, `Ese teléfono ya pertenece a ${dup.name}`, { existing_id: dup.id });
    phone = p.phone;
    key = p.key;
  }
  const tags = input.tags !== undefined ? tagsToDb(normalizeTags(input.tags)) : tagsToDb(cur.tags);
  const optedOut = input.opted_out !== undefined ? Boolean(input.opted_out) : cur.opted_out;

  return db.tx(async () => {
    try {
      await db.query(
        `update contacts set name=$1, phone=$2, phone_key=$3, email=$4, child_name=$5, child_age=$6, kids_count=$7,
           notes=$8, source=$9, tags=$10, updated_at=now() where id=$11`,
        [c.name, phone, key, c.email, c.child_name, c.child_age, c.kids_count, c.notes, c.source, tags, id],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'Ese teléfono ya pertenece a otro contacto');
      throw e;
    }
    if (optedOut !== cur.opted_out) await setOptOut(id, optedOut);
    if (input.status !== undefined && input.status !== cur.status) await setStatus(id, input.status);
    return get(id);
  });
}

export async function setStatus(id, status) {
  checkStatus(status);
  const cur = await get(id);
  if (cur.status === status) return cur;
  await db.query('update contacts set status = $1, updated_at = now() where id = $2', [status, id]);
  const contact = await get(id);
  await bus.fire('contact:status', contact, cur.status);
  return contact;
}

async function currentTags(id) {
  return tagsFromDb((await db.one('select tags from contacts where id = $1', [id]))?.tags);
}
const saveTags = (id, arr) => db.query('update contacts set tags = $1, updated_at = now() where id = $2', [tagsToDb(arr), id]);

export async function addTags(id, tags) {
  await saveTags(id, normalizeTags([...(await currentTags(id)), ...normalizeTags(tags)]));
}
export async function removeTags(id, tags) {
  const drop = new Set(normalizeTags(tags));
  await saveTags(id, (await currentTags(id)).filter((t) => !drop.has(t)));
}
/** Dar de baja / volver a habilitar. La baja también va a la lista de supresión (sobrevive al borrado y a reimportar). */
export async function setOptOut(id, value) {
  await db.tx(async () => {
    await db.query('update contacts set opted_out = $1, updated_at = now() where id = $2', [Boolean(value), id]);
    if (value) await db.query('insert into suppressions (phone_key) select phone_key from contacts where id = $1 on conflict do nothing', [id]);
    else await db.query('delete from suppressions where phone_key = (select phone_key from contacts where id = $1)', [id]);
  });
}

export async function remove(id) {
  const rows = await db.query('delete from contacts where id = $1 returning id', [id]);
  if (!rows.length) throw new HttpError(404, 'Contacto no encontrado');
}

// Búsqueda sin mayúsculas ni acentos ("jose" encuentra "José"). Se hace en JS: el volumen de un evento
// (miles de contactos) lo permite y evita depender de extensiones de Postgres.
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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
export function filterSql(f = {}) {
  const where = [];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  const only = (f.ids || []).map(Number).filter(Number.isInteger).slice(0, 5000);
  if (only.length) where.push(`id in (${only.map(add).join(',')})`);
  const statuses = (f.statuses || (f.status ? [f.status] : [])).filter(Boolean);
  if (statuses.length) where.push(`status in (${statuses.map(add).join(',')})`);
  const tags = normalizeTags(f.tags || (f.tag ? [f.tag] : []));
  if (tags.length) where.push(`(${tags.map((t) => `tags like ${add(`%,${likeEscape(t)},%`)} escape '\\'`).join(' or ')})`);
  if (f.optedOut === 'exclude') where.push('opted_out = false');
  if (f.optedOut === 'only') where.push('opted_out = true');
  return { sql: where.length ? `where ${where.join(' and ')}` : '', params };
}

export async function list(f = {}, limit = 5000) {
  const { sql, params } = filterSql(f);
  const match = searchPredicate(f.search);
  const rows = await db.query(`select * from contacts ${sql} order by id desc`, params);
  return (match ? rows.filter(match) : rows).slice(0, limit).map(toApi);
}

export async function ids(f = {}) {
  return (await list(f, Infinity)).map((c) => c.id).sort((a, b) => a - b);
}

export async function allTags() {
  const set = new Map();
  for (const r of await db.query("select tags from contacts where tags <> ''")) {
    for (const t of tagsFromDb(r.tags)) set.set(t, (set.get(t) || 0) + 1);
  }
  return [...set.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Acciones masivas sobre una lista de ids (todo o nada). Por lotes: unas pocas consultas cada 500 contactos. */
export async function bulk(idList, action, value) {
  const all = [...new Set(idList.map(Number).filter(Number.isInteger))];
  if (!['status', 'add_tag', 'remove_tag', 'optout', 'optin', 'delete'].includes(action)) throw new HttpError(400, 'Acción inválida');
  if (action === 'status') checkStatus(value);
  let n = 0;
  await db.tx(async () => {
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      const inIds = placeholders(chunk.length);
      const rows = await db.query(`select * from contacts where id in (${inIds})`, chunk);
      if (!rows.length) continue;
      const ids = rows.map((r) => r.id);
      switch (action) {
        case 'status': {
          const changed = rows.filter((r) => r.status !== value);
          if (changed.length) {
            await db.query(`update contacts set status = $1, updated_at = now() where id in (${placeholders(changed.length, 2)})`, [value, ...changed.map((r) => r.id)]);
            await bus.fire('contacts:status', (await db.query(`select * from contacts where id in (${placeholders(changed.length)})`, changed.map((r) => r.id))).map(toApi));
          }
          break;
        }
        case 'add_tag':
        case 'remove_tag': {
          const tagList = normalizeTags(value);
          const upd = rows.map((r) => {
            const cur = tagsFromDb(r.tags);
            const next = action === 'add_tag' ? normalizeTags([...cur, ...tagList]) : cur.filter((t) => !tagList.includes(t));
            return { id: r.id, tags: tagsToDb(next) };
          });
          await db.query(
            `update contacts set tags = v.tags, updated_at = now()
             from (values ${upd.map((_, k) => `($${k * 2 + 1}::int, $${k * 2 + 2}::text)`).join(',')}) as v(id, tags) where contacts.id = v.id`,
            upd.flatMap((u) => [u.id, u.tags]),
          );
          break;
        }
        case 'optout':
          await db.query(`update contacts set opted_out = true, updated_at = now() where id in (${placeholders(ids.length)})`, ids);
          await db.query(`insert into suppressions (phone_key) select phone_key from contacts where id in (${placeholders(ids.length)}) on conflict do nothing`, ids);
          break;
        case 'optin':
          await db.query(`delete from suppressions where phone_key in (select phone_key from contacts where id in (${placeholders(ids.length)}))`, ids);
          await db.query(`update contacts set opted_out = false, updated_at = now() where id in (${placeholders(ids.length)})`, ids);
          break;
        case 'delete':
          await db.query(`delete from contacts where id in (${placeholders(ids.length)})`, ids);
          break;
      }
      n += ids.length;
    }
  });
  return n;
}
