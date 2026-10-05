// @ts-nocheck
import { db, HttpError, placeholders } from './db.ts';
import * as contacts from './contacts.ts';
import { cleanTemplate } from './template.ts';

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

export async function preview(filter) {
  const ids = await eligible(filter);
  const all = (await contacts.ids(cleanFilter(filter))).length;
  return { eligible: ids.length, excluded_optout: all - ids.length };
}

async function stats(id) {
  const out = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const r of await db.query("select status, count(*)::int n from messages where campaign_id = $1 and direction = 'out' group by status", [id])) {
    if (r.status === 'failed') out.failed += r.n;
    else {
      out.sent += r.n;
      if (r.status === 'delivered' || r.status === 'read') out.delivered += r.n;
      if (r.status === 'read') out.read += r.n;
    }
  }
  const o = await db.one(
    `select (count(*) filter (where status in ('pending','sending')))::int as pending,
            (count(*) filter (where status = 'cancelled'))::int as cancelled
     from outbox where campaign_id = $1`, [id]);
  return { ...out, pending: o?.pending || 0, cancelled: o?.cancelled || 0 };
}

const toApi = async (r) => ({ ...r, filter: r.filter || {}, template: r.template || null, stats: await stats(r.id) });

export async function list() {
  return Promise.all((await db.query('select * from campaigns order by id desc')).map(toApi));
}

export async function get(id) {
  const r = await db.one('select * from campaigns where id = $1', [id]);
  if (!r) throw new HttpError(404, 'Campaña no encontrada');
  return toApi(r);
}

export async function create(input) {
  const name = String(input.name || '').trim();
  const body = String(input.body || '').trim();
  const t = cleanTemplate(input.template);
  if (!name) throw new HttpError(400, 'Poné un nombre a la campaña');
  if (!body && !t) throw new HttpError(400, 'Escribí el mensaje');
  const when = input.scheduled_at ? new Date(input.scheduled_at) : new Date();
  if (Number.isNaN(when.getTime())) throw new HttpError(400, 'Fecha de envío inválida');
  const filter = cleanFilter(input.filter);
  const ids = await eligible(filter);
  if (!ids.length) throw new HttpError(400, 'Ningún contacto cumple ese filtro (o todos pidieron la baja)');

  const id = await db.tx(async () => {
    const campaignId = await db.val(
      'insert into campaigns (name, body, template, filter, scheduled_at, total) values ($1,$2,$3::text::jsonb,$4::text::jsonb,$5::timestamptz,$6) returning id',
      [name, body, t ? JSON.stringify(t) : null, JSON.stringify(filter), when.toISOString(), ids.length],
    );
    // un solo INSERT … SELECT para toda la lista (en tandas, por el límite de parámetros)
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      await db.query(
        `insert into outbox (contact_id, body, template, send_at, campaign_id, source)
         select id, $1::text, $2::text::jsonb, $3::timestamptz, $4::int, $5::text from contacts where id in (${placeholders(chunk.length, 6)})`,
        [body, t ? JSON.stringify(t) : null, when.toISOString(), campaignId, `campaña: ${name}`, ...chunk],
      );
    }
    return campaignId;
  });
  return get(id);
}

export async function cancel(id) {
  await get(id);
  await db.query("update outbox set status = 'cancelled', error = 'Campaña cancelada' where campaign_id = $1 and status = 'pending'", [id]);
  await db.query('update campaigns set cancelled = true where id = $1', [id]);
  return get(id);
}
