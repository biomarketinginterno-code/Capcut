// @ts-nocheck
import { db, getSettings } from './db.ts';
import * as contacts from './contacts.ts';
import * as automations from './automations.ts';
import { bus } from './bus.ts';
import { normalizePhone, phoneKey } from './phone.ts';

// Orden de los estados de entrega: nunca se retrocede (leído -> entregado).
const RANK_SQL = "(case status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end)";
const RANK = { sent: 1, delivered: 2, read: 3 };

// Tipos que no son una respuesta de la persona (reacciones, avisos del sistema): no abren la ventana de 24 h ni cuentan como mensaje.
const IGNORED_TYPES = new Set(['reaction', 'system', 'request_welcome', 'ephemeral']);

function textOf(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || m.button?.payload || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    default: return '';
  }
}

/**
 * Registra un mensaje recibido de `fromPhone`, crea el contacto si no existe y aplica la baja / palabras clave.
 * Todo ocurre en una transacción: o queda guardado el mensaje CON sus efectos (la baja incluida), o no queda nada
 * y el reintento de Meta lo vuelve a procesar entero.
 */
export async function receive({ fromPhone, text, name = '', waId = null, kindLabel = '' }) {
  const digits = String(fromPhone ?? '').replace(/\D/g, '');
  if (digits.length < 8) {
    console.warn('[entrante] mensaje sin número de teléfono utilizable (¿usuario de WhatsApp sin número?): se ignora');
    return null;
  }
  const s = await getSettings();
  // Meta manda siempre el número completo con código de país: se lo trata como internacional (un +598 no es un celular argentino)
  const p = normalizePhone('+' + digits, { country: s.default_country, area: s.default_area });
  const phone = p.valid ? p.phone : digits;
  const key = p.valid ? p.key : phoneKey(digits);
  const body = text || kindLabel || '[mensaje sin texto]';

  return db.tx(async () => {
    let row = await db.one('select * from contacts where phone_key = $1', [key]);
    let created = false;
    if (!row) {
      const suppressed = (await contacts.suppressedKeys([key])).has(key);
      const made = await db.query(
        `insert into contacts (name, phone, phone_key, status, source, opted_out, consent_at, consent_note)
         values ($1, $2, $3, 'nuevo', 'whatsapp', $4, now(), 'Escribió por WhatsApp')
         on conflict (phone_key) do nothing returning *`,
        [name || 'Sin nombre', phone, key, suppressed],
      );
      created = made.length > 0;
      row = made[0] || (await db.one('select * from contacts where phone_key = $1', [key]));
    }

    // el mismo wa_id no se registra dos veces (Meta reintenta entregas): si ya estaba, no hay nada más que hacer
    const saved = await db.query(
      "insert into messages (contact_id, direction, body, kind, status, wa_id, source) values ($1, 'in', $2, 'text', 'received', $3, 'respuesta') on conflict do nothing returning id",
      [row.id, body, waId],
    );
    if (!saved.length) return null;
    await db.query('update contacts set last_inbound_at = now(), last_message_at = now(), unread = unread + 1, updated_at = now() where id = $1', [row.id]);

    const contact = await contacts.get(row.id);
    if (created) await bus.fire('contact:created', contact);
    await automations.onInbound(contact, text);
    return contact;
  });
}

/**
 * Procesa el JSON del webhook de WhatsApp Cloud API (mensajes entrantes y estados de entrega).
 * Cada mensaje se procesa por separado: si uno falla, los demás igual se guardan, y se devuelve `errors` para que
 * el endpoint responda con error y Meta reintente (lo ya guardado se descarta como repetido).
 */
export async function processWebhook(payload) {
  let messages = 0;
  let statuses = 0;
  let errors = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const m of v.messages || []) {
        if (IGNORED_TYPES.has(m.type)) continue;
        try {
          const profile = (v.contacts || []).find((c) => c.wa_id === m.from)?.profile?.name || '';
          const text = textOf(m);
          const out = await receive({ fromPhone: m.from, text, name: profile, waId: m.id, kindLabel: text ? '' : `[${m.type || 'mensaje'}]` });
          if (out) messages++;
        } catch (e) {
          errors++;
          console.error('[webhook] no se pudo procesar un mensaje entrante:', e);
        }
      }
      for (const st of v.statuses || []) {
        try {
          if (st.status === 'failed') {
            const err = st.errors?.[0];
            const msg = err ? `${err.title || err.message || 'Error'}${err.code ? ` (código ${err.code})` : ''}` : 'WhatsApp no pudo entregar el mensaje';
            const r = await db.query(`update messages set status = 'failed', error = $1 where wa_id = $2 and direction = 'out' and ${RANK_SQL} < 2 returning id`, [msg, st.id]);
            statuses += r.length;
          } else if (RANK[st.status]) {
            const r = await db.query(`update messages set status = $1, error = null where wa_id = $2 and direction = 'out' and ${RANK_SQL} < $3 returning id`, [st.status, st.id, RANK[st.status]]);
            statuses += r.length;
          }
        } catch (e) {
          errors++;
          console.error('[webhook] no se pudo procesar un estado de entrega:', e);
        }
      }
    }
  }
  return { messages, statuses, errors };
}
