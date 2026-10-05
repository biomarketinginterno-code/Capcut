'use strict';
const { db, nowIso, getSettings } = require('./db');
const contacts = require('./contacts');
const automations = require('./automations');
const bus = require('./bus');
const { normalizePhone, phoneKey } = require('./phone');

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
function receive({ fromPhone, text, name = '', waId = null, kindLabel = '' }) {
  const s = getSettings();
  const p = normalizePhone(fromPhone, { country: s.default_country, area: s.default_area });
  const key = p.valid ? p.key : phoneKey(fromPhone);
  if (waId && db.prepare("SELECT 1 FROM messages WHERE wa_id = ? AND direction = 'in'").get(waId)) return null; // Meta reintenta entregas

  let row = db.prepare('SELECT * FROM contacts WHERE phone_key = ?').get(key);
  let created = false;
  if (!row) {
    const phone = p.valid ? p.phone : String(fromPhone).replace(/\D/g, '');
    const now = nowIso();
    const r = db.prepare(`INSERT INTO contacts (name, phone, phone_key, status, source, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(name || 'Sin nombre', phone, key, 'nuevo', 'whatsapp', now, now);
    row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(r.lastInsertRowid));
    created = true;
  }

  const body = text || kindLabel || '[mensaje sin texto]';
  const now = nowIso();
  db.prepare("INSERT INTO messages (contact_id, direction, body, kind, status, wa_id, source, created_at) VALUES (?, 'in', ?, 'text', 'received', ?, 'respuesta', ?)")
    .run(row.id, body, waId, now);
  db.prepare('UPDATE contacts SET last_inbound_at = ?, last_message_at = ?, unread = unread + 1, updated_at = ? WHERE id = ?')
    .run(now, now, now, row.id);

  const contact = contacts.get(row.id);
  if (created) bus.fire('contact:created', contact);
  automations.onInbound(contact, text);
  return contact;
}

/** Procesa el JSON del webhook de WhatsApp Cloud API (mensajes entrantes y estados de entrega). */
function processWebhook(payload) {
  let messages = 0;
  let statuses = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const m of v.messages || []) {
        const profile = (v.contacts || []).find((c) => c.wa_id === m.from)?.profile?.name || '';
        const text = textOf(m);
        const out = receive({ fromPhone: m.from, text, name: profile, waId: m.id, kindLabel: text ? '' : `[${m.type || 'mensaje'}]` });
        if (out) messages++;
      }
      for (const st of v.statuses || []) {
        const row = db.prepare('SELECT id, status FROM messages WHERE wa_id = ?').get(st.id);
        if (!row) continue;
        if (st.status === 'failed') {
          if (RANK[row.status] >= RANK.delivered) continue;
          const err = st.errors?.[0];
          db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?")
            .run(err ? `${err.title || err.message || 'Error'}${err.code ? ` (código ${err.code})` : ''}` : 'WhatsApp no pudo entregar el mensaje', row.id);
          statuses++;
        } else if (RANK[st.status] > (RANK[row.status] || 0)) { // nunca retroceder (read -> delivered)
          db.prepare('UPDATE messages SET status = ?, error = NULL WHERE id = ?').run(st.status, row.id);
          statuses++;
        }
      }
    }
  }
  return { messages, statuses };
}

module.exports = { receive, processWebhook };
