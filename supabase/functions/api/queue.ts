// @ts-nocheck
import { db, nowIso, getSettings } from './db.ts';
import { getProvider, SendError } from './whatsapp.ts';
import { contactVars, render, renderTemplate } from './template.ts';

export const WINDOW_MS = 24 * 60 * 60 * 1000; // ventana de servicio de WhatsApp
const MAX_ATTEMPTS = 3;

export const inWindow = (contact) =>
  Boolean(contact.last_inbound_at) && Date.now() - Date.parse(contact.last_inbound_at) < WINDOW_MS;

/**
 * Encola un mensaje. `body` y `template` se completan con los datos del contacto al momento de enviar
 * (así un recordatorio programado toma la fecha/lugar vigentes).
 */
export async function enqueue({ contactId, body = '', template = null, sendAt = new Date(), campaignId = null, automationId = null, source = '', ignoreOptout = false }) {
  return db.val(
    `insert into outbox (contact_id, body, template, send_at, campaign_id, automation_id, source, ignore_optout)
     values ($1, $2, $3::text::jsonb, $4::timestamptz, $5, $6, $7, $8) returning id`,
    [contactId, body, template ? JSON.stringify(template) : null, new Date(sendAt).toISOString(), campaignId, automationId, source, ignoreOptout],
  );
}

async function recordMessage(contactId, { body, kind, status, waId = null, error = null, source, campaignId = null, automationId = null }) {
  await db.query(
    `insert into messages (contact_id, direction, body, kind, status, wa_id, error, source, campaign_id, automation_id)
     values ($1, 'out', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [contactId, body, kind, status, waId, error, source, campaignId, automationId],
  );
  await db.query('update contacts set last_message_at = $1::timestamptz where id = $2', [nowIso(), contactId]);
}

const finish = (row, status, error = null) =>
  db.query('update outbox set status = $1, error = $2 where id = $3', [status, error, row.id]);

/** `row` ya viene reclamada (status 'sending') con attempts incrementado. */
async function processOne(row) {
  const contact = await db.one('select * from contacts where id = $1', [row.contact_id]);
  if (!contact) return finish(row, 'cancelled', 'El contacto fue eliminado');
  if (contact.opted_out && !row.ignore_optout) return finish(row, 'cancelled', 'El contacto pidió no recibir mensajes');

  const vars = contactVars(contact, await getSettings());
  const text = render(row.body, vars).trim();
  const tpl = row.template ? renderTemplate(row.template, vars) : null;

  // Regla de WhatsApp (también en simulación): texto libre solo dentro de las 24 h de la última
  // respuesta del contacto; fuera de esa ventana hace falta una plantilla aprobada.
  const asText = Boolean(text) && inWindow(contact);
  const kind = asText ? 'text' : 'template';
  const shown = asText ? text : text || `[Plantilla ${tpl?.name}: ${tpl?.params.join(' | ')}]`;
  const links = { campaignId: row.campaign_id, automationId: row.automation_id };

  try {
    if (!asText && !tpl) {
      throw new SendError(text
        ? 'Fuera de la ventana de 24 h: WhatsApp solo permite enviar una plantilla aprobada. Cargá el nombre de la plantilla en el mensaje.'
        : 'El mensaje está vacío');
    }
    const provider = await getProvider();
    const { waId } = await provider.send(contact.phone, asText ? { text } : { template: tpl });
    await recordMessage(contact.id, { body: shown, kind, status: 'sent', waId, source: row.source, ...links });
    await finish(row, 'sent');
  } catch (e) {
    if (e instanceof SendError && e.retryable && row.attempts < MAX_ATTEMPTS) {
      const wait = 30 * 1000 * 4 ** (row.attempts - 1); // 30 s, 2 min
      await db.query("update outbox set status = 'pending', send_at = $1::timestamptz, error = $2 where id = $3",
        [new Date(Date.now() + wait).toISOString(), e.message, row.id]);
    } else {
      const msg = e instanceof SendError ? e.message : `Error inesperado: ${e.message}`;
      await finish(row, 'failed', msg);
      await recordMessage(contact.id, { body: shown, kind, status: 'failed', error: msg, source: row.source, ...links });
    }
  }
}

/**
 * Envía lo que esté vencido. Se llama desde el cron (cada minuto) y, para que las respuestas salgan al instante,
 * después de cada acción del panel o mensaje entrante. Reclamar con SKIP LOCKED permite que dos ejecuciones
 * simultáneas no se pisen. Devuelve cuántos mensajes procesó.
 */
export async function tick({ budgetMs = 40000, concurrency = 5 } = {}) {
  const started = Date.now();
  // si una ejecución anterior murió a mitad de camino, esos mensajes vuelven a la cola
  await db.query("update outbox set status = 'pending' where status = 'sending' and claimed_at < now() - interval '5 minutes'");
  let processed = 0;
  while (Date.now() - started < budgetMs) {
    const rows = await db.query(
      `update outbox set status = 'sending', attempts = attempts + 1, claimed_at = now()
       where id in (select id from outbox where status = 'pending' and send_at <= now()
                    order by send_at, id limit $1 for update skip locked)
       returning *`,
      [concurrency],
    );
    if (!rows.length) break;
    await Promise.all(rows.map((r) => processOne(r).catch(async (e) => {
      console.error('[cola] error:', e);
      await finish(r, 'failed', `Error inesperado: ${e.message}`).catch(() => {});
    })));
    processed += rows.length;
  }
  return processed;
}
