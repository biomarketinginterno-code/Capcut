// @ts-nocheck
import { db, nowIso, getSettings, getRaw, setRaw, delRaw } from './db.ts';
import { getProvider, SendError } from './whatsapp.ts';
import { contactVars, render, renderTemplate, missingEventVars, varsIn } from './template.ts';

export const WINDOW_MS = 24 * 60 * 60 * 1000; // ventana de servicio de WhatsApp
const MAX_ATTEMPTS = 3;
const HOLD_MS = 10 * 60 * 1000;                 // espera cuando algo bloquea TODOS los envíos (cuenta, token, datos del evento)
const MAX_HOLD_MS = 48 * 60 * 60 * 1000;        // un mensaje que lleva más que esto esperando se da por fallido
const MAX_PER_TICK = 150;                       // tope por ejecución: la función serverless tiene poco tiempo de CPU

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

/** El mensaje no puede salir ahora por algo que no es suyo (cuenta bloqueada, token vencido, falta la fecha del evento): vuelve a la cola sin gastar un intento. */
async function hold(row, reason) {
  if (Date.now() - Date.parse(row.created_at) > MAX_HOLD_MS) return finish(row, 'failed', reason);
  await db.query("update outbox set status = 'pending', attempts = greatest(attempts - 1, 0), send_at = $1::timestamptz, error = $2 where id = $3 and status = 'sending'",
    [new Date(Date.now() + HOLD_MS).toISOString(), reason, row.id]);
}

const setAlert = (message) => setRaw('wa_alert', JSON.stringify({ at: nowIso(), message }));

/**
 * `row` ya viene reclamada (status 'sending') con attempts incrementado.
 * Devuelve 'sent' | 'held' | 'blocked' | 'failed' | 'cancelled' | 'retry'; 'blocked' = problema de la cuenta que afecta a todos los envíos.
 */
async function processOne(row) {
  const contact = await db.one('select * from contacts where id = $1', [row.contact_id]);
  if (!contact) { await finish(row, 'cancelled', 'El contacto fue eliminado'); return 'cancelled'; }
  if (contact.opted_out && !row.ignore_optout) { await finish(row, 'cancelled', 'El contacto pidió no recibir mensajes'); return 'cancelled'; }

  const vars = contactVars(contact, await getSettings());
  const text = render(row.body, vars).trim();
  const tpl = row.template ? renderTemplate(row.template, vars) : null;

  // Regla de WhatsApp (también en simulación): texto libre solo dentro de las 24 h de la última
  // respuesta del contacto; fuera de esa ventana hace falta una plantilla aprobada.
  const asText = Boolean(text) && inWindow(contact);
  const kind = asText ? 'text' : 'template';
  const shown = asText ? text : tpl ? `[Plantilla ${tpl.name}: ${tpl.params.join(' | ')}]` : text;
  const links = { campaignId: row.campaign_id, automationId: row.automation_id };

  // Faltan datos del evento: no se manda un mensaje con huecos, se espera a que se completen en Ajustes.
  const used = asText ? varsIn(row.body) : (row.template?.params || []);
  const missing = missingEventVars(used, vars);
  if (missing.length) {
    const what = [...new Set(missing.map((k) => (k === 'lugar' ? 'el lugar del evento' : 'la fecha y hora del evento')))];
    await hold(row, `Falta completar en Ajustes: ${what.join(' y ')}.`);
    return 'held';
  }

  let waId;
  try {
    if (!asText && !tpl) {
      throw new SendError(text
        ? 'Fuera de la ventana de 24 h: WhatsApp solo permite enviar una plantilla aprobada. Cargá el nombre de la plantilla en el mensaje.'
        : 'El mensaje está vacío');
    }
    const provider = await getProvider();
    try {
      ({ waId } = await provider.send(contact.phone, asText ? { text } : { template: tpl }));
    } catch (e) {
      // Meta dice que la ventana de 24 h ya se cerró aunque nosotros la creíamos abierta: se manda la plantilla
      if (asText && tpl && e instanceof SendError && e.code === 131047) {
        ({ waId } = await provider.send(contact.phone, { template: tpl }));
      } else throw e;
    }
  } catch (e) {
    if (e instanceof SendError && e.systemic) {
      await setAlert(e.message).catch(() => {});
      await hold(row, e.message);
      return 'blocked';
    }
    if (e instanceof SendError && e.retryable && row.attempts < MAX_ATTEMPTS) {
      const wait = 30 * 1000 * 4 ** (row.attempts - 1); // 30 s, 2 min
      // si la campaña se canceló mientras este envío estaba en vuelo, no se reintenta
      await db.query(
        `update outbox set status = case when exists (select 1 from campaigns c where c.id = outbox.campaign_id and c.cancelled) then 'cancelled' else 'pending' end,
           send_at = $1::timestamptz, error = $2 where id = $3`,
        [new Date(Date.now() + wait).toISOString(), e.message, row.id]);
      return 'retry';
    }
    const msg = e instanceof SendError ? e.message : `Error inesperado: ${e.message}`;
    await finish(row, 'failed', msg);
    await recordMessage(contact.id, { body: shown, kind, status: 'failed', error: msg, source: row.source, ...links });
    return 'failed';
  }

  // Desde acá el mensaje YA salió: lo que falle al registrarlo nunca lo marca como fallido (ni se reenvía).
  try {
    await recordMessage(contact.id, { body: shown, kind, status: 'sent', waId, source: row.source, ...links });
  } catch (e) {
    console.error('[cola] el mensaje salió pero no se pudo registrar en el historial:', e);
  }
  await finish(row, 'sent').catch((e) => console.error('[cola] no se pudo marcar como enviado:', e));
  return 'sent';
}

/**
 * Envía lo que esté vencido. Se llama desde el cron (cada minuto) y, para que las respuestas salgan al instante,
 * después de cada acción del panel o mensaje entrante. Reclamar con SKIP LOCKED permite que dos ejecuciones
 * simultáneas no se pisen. Devuelve cuántos mensajes procesó.
 */
export async function tick({ budgetMs = 25000, concurrency = 5, max = MAX_PER_TICK } = {}) {
  const started = Date.now();
  // si una ejecución anterior murió a mitad de camino, esos mensajes vuelven a la cola
  await db.query("update outbox set status = 'pending' where status = 'sending' and claimed_at < now() - interval '5 minutes'");
  let processed = 0;
  let sentAny = false;
  let blocked = false;
  while (!blocked && processed < max && Date.now() - started < budgetMs) {
    const rows = await db.query(
      `update outbox set status = 'sending', attempts = attempts + 1, claimed_at = now()
       where id in (select id from outbox where status = 'pending' and send_at <= now()
                    order by send_at, id limit $1 for update skip locked)
       returning *`,
      [Math.min(concurrency, max - processed)],
    );
    if (!rows.length) break;
    const results = await Promise.all(rows.map((r) => processOne(r).catch(async (e) => {
      console.error('[cola] error:', e);
      await finish(r, 'failed', `Error inesperado: ${e.message}`).catch(() => {});
      return 'failed';
    })));
    if (results.includes('sent')) sentAny = true;
    // un problema de la cuenta frena el resto de la tanda: iban a fallar todos igual
    if (results.includes('blocked')) blocked = true;
    processed += rows.length;
  }
  if (sentAny && (await getRaw('wa_alert'))) await delRaw('wa_alert'); // WhatsApp volvió a aceptar envíos
  return processed;
}
