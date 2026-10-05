// @ts-nocheck
import { db, getSettings, isUniqueViolation } from './db.ts';
import * as contacts from './contacts.ts';
import * as automations from './automations.ts';
import { bus } from './bus.ts';
import { normalizePhone, phoneKey } from './phone.ts';

// Orden de los estados de entrega: nunca se retrocede (leído -> entregado).
const RANK_SQL = "(case status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end)";
const RANK = { sent: 1, delivered: 2, read: 3 };

function textOf(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || m.button?.payload || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    default: return '';
  }
}

/** Registra un mensaje recibido de `fromPhone`, crea el contacto si no existe y corre las palabras clave. */
export async function receive({ fromPhone, text, name = '', waId = null, kindLabel = '' }) {
  const s = await getSettings();
  const p = normalizePhone(fromPhone, { country: s.default_country, area: s.default_area });
  const key = p.valid ? p.key : phoneKey(fromPhone);
  if (waId && (await db.one("select 1 as x from messages where wa_id = $1 and direction = 'in'", [waId]))) return null; // Meta reintenta entregas

  let row = await db.one('select * from contacts where phone_key = $1', [key]);
  let created = false;
  if (!row) {
    const phone = p.valid ? p.phone : String(fromPhone).replace(/\D/g, '');
    await db.query(
      `insert into contacts (name, phone, phone_key, status, source) values ($1, $2, $3, 'nuevo', 'whatsapp')
       on conflict (phone_key) do nothing`,
      [name || 'Sin nombre', phone, key],
    );
    row = await db.one('select * from contacts where phone_key = $1', [key]);
    created = true;
  }

  const body = text || kindLabel || '[mensaje sin texto]';
  try {
    await db.query("insert into messages (contact_id, direction, body, kind, status, wa_id, source) values ($1, 'in', $2, 'text', 'received', $3, 'respuesta')", [row.id, body, waId]);
  } catch (e) {
    if (isUniqueViolation(e)) return null; // llegó duplicado en simultáneo
    throw e;
  }
  await db.query('update contacts set last_inbound_at = now(), last_message_at = now(), unread = unread + 1, updated_at = now() where id = $1', [row.id]);

  const contact = await contacts.get(row.id);
  if (created) await bus.fire('contact:created', contact);
  await automations.onInbound(contact, text);
  return contact;
}

/** Procesa el JSON del webhook de WhatsApp Cloud API (mensajes entrantes y estados de entrega). */
export async function processWebhook(payload) {
  let messages = 0;
  let statuses = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const m of v.messages || []) {
        const profile = (v.contacts || []).find((c) => c.wa_id === m.from)?.profile?.name || '';
        const text = textOf(m);
        const out = await receive({ fromPhone: m.from, text, name: profile, waId: m.id, kindLabel: text ? '' : `[${m.type || 'mensaje'}]` });
        if (out) messages++;
      }
      for (const st of v.statuses || []) {
        if (st.status === 'failed') {
          const err = st.errors?.[0];
          const msg = err ? `${err.title || err.message || 'Error'}${err.code ? ` (código ${err.code})` : ''}` : 'WhatsApp no pudo entregar el mensaje';
          const r = await db.query(`update messages set status = 'failed', error = $1 where wa_id = $2 and direction = 'out' and ${RANK_SQL} < 2 returning id`, [msg, st.id]);
          statuses += r.length;
        } else if (RANK[st.status]) {
          const r = await db.query(`update messages set status = $1, error = null where wa_id = $2 and direction = 'out' and ${RANK_SQL} < $3 returning id`, [st.status, st.id, RANK[st.status]]);
          statuses += r.length;
        }
      }
    }
  }
  return { messages, statuses };
}
