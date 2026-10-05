'use strict';
const config = require('./config');
const { db, nowIso, getSettings } = require('./db');
const { provider, SendError } = require('./whatsapp');
const { contactVars, render, renderTemplate } = require('./template');

const WINDOW_MS = 24 * 60 * 60 * 1000; // ventana de servicio de WhatsApp
const MAX_ATTEMPTS = 3;
const TICK_MS = 5000;

const inWindow = (contact) =>
  Boolean(contact.last_inbound_at) && Date.now() - Date.parse(contact.last_inbound_at) < WINDOW_MS;

/**
 * Encola un mensaje. `body` y `template` se completan con los datos del contacto al momento de enviar
 * (así un recordatorio programado toma la fecha/lugar vigentes).
 */
function enqueue({ contactId, body = '', template = null, sendAt = new Date(), campaignId = null, automationId = null, source = '', ignoreOptout = false }) {
  const r = db.prepare(`INSERT INTO outbox
    (contact_id, body, template, send_at, campaign_id, automation_id, source, ignore_optout, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    contactId, body, template ? JSON.stringify(template) : null,
    new Date(sendAt).toISOString(), campaignId, automationId, source, ignoreOptout ? 1 : 0, nowIso(),
  );
  return Number(r.lastInsertRowid);
}

function recordMessage(contactId, { body, kind, status, waId = null, error = null, source, campaignId = null, automationId = null }) {
  const now = nowIso();
  db.prepare(`INSERT INTO messages (contact_id, direction, body, kind, status, wa_id, error, source, campaign_id, automation_id, created_at)
    VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(contactId, body, kind, status, waId, error, source, campaignId, automationId, now);
  db.prepare('UPDATE contacts SET last_message_at = ? WHERE id = ?').run(now, contactId);
}

function finish(row, status, error = null) {
  db.prepare('UPDATE outbox SET status = ?, error = ? WHERE id = ?').run(status, error, row.id);
}

async function processOne(row) {
  // reclama la fila de forma atómica (por si hubiera dos ciclos solapados)
  const claimed = db.prepare("UPDATE outbox SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status = 'pending'").run(row.id);
  if (!claimed.changes) return;

  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(row.contact_id);
  if (!contact) return finish(row, 'cancelled', 'El contacto fue eliminado');
  if (contact.opted_out && !row.ignore_optout) return finish(row, 'cancelled', 'El contacto pidió no recibir mensajes');

  const vars = contactVars(contact, getSettings());
  const text = render(row.body, vars).trim();
  const tpl = row.template ? renderTemplate(JSON.parse(row.template), vars) : null;
  // Regla de WhatsApp (también en simulación): texto libre solo dentro de las 24 h de la última
  // respuesta del contacto; fuera de esa ventana hace falta una plantilla aprobada.
  const asText = Boolean(text) && inWindow(contact);
  const kind = asText ? 'text' : 'template';
  const shown = asText ? text : text || `[Plantilla ${tpl?.name}: ${tpl?.params.join(' | ')}]`;

  try {
    if (!asText && !tpl) {
      throw new SendError(text
        ? 'Fuera de la ventana de 24 h: WhatsApp solo permite enviar una plantilla aprobada. Cargá el nombre de la plantilla en el mensaje.'
        : 'El mensaje está vacío');
    }
    const { waId } = await provider().send(contact.phone, asText ? { text } : { template: tpl });
    recordMessage(contact.id, { body: shown, kind, status: 'sent', waId, source: row.source, campaignId: row.campaign_id, automationId: row.automation_id });
    finish(row, 'sent');
  } catch (e) {
    if (e.retryable && row.attempts + 1 < MAX_ATTEMPTS) {
      const wait = 30 * 1000 * 4 ** row.attempts; // 30 s, 2 min
      db.prepare("UPDATE outbox SET status = 'pending', send_at = ?, error = ? WHERE id = ?")
        .run(new Date(Date.now() + wait).toISOString(), e.message, row.id);
    } else {
      finish(row, 'failed', e.message);
      recordMessage(contact.id, { body: shown, kind, status: 'failed', error: e.message, source: row.source, campaignId: row.campaign_id, automationId: row.automation_id });
    }
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const due = db.prepare("SELECT * FROM outbox WHERE status = 'pending' AND send_at <= ? ORDER BY send_at, id LIMIT ?")
      .all(nowIso(), config.sendBatch);
    for (const row of due) await processOne(row);
  } catch (e) {
    console.error('[cola] error:', e);
  } finally {
    running = false;
  }
}

let timer = null;
function start() {
  // si el servidor se cayó enviando, esos mensajes vuelven a la cola
  db.prepare("UPDATE outbox SET status = 'pending' WHERE status = 'sending'").run();
  if (!timer) {
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }
}
function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { enqueue, tick, start, stop, inWindow, WINDOW_MS };
