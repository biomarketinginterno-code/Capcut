'use strict';
const crypto = require('node:crypto');
const config = require('./config');

// Errores de la Cloud API que conviene explicar en castellano.
const FRIENDLY = {
  131047: 'Pasaron más de 24 h desde la última respuesta del contacto: WhatsApp solo permite enviar una plantilla aprobada.',
  131026: 'El número no tiene WhatsApp o no se pudo entregar.',
  131030: 'El número no está en la lista de destinatarios permitidos (en modo de prueba de Meta hay que agregarlo).',
  131056: 'Demasiados mensajes al mismo número en poco tiempo. Se reintenta más tarde.',
  132000: 'La plantilla espera otra cantidad de variables.',
  132001: 'La plantilla no existe o no está aprobada en ese idioma.',
  190: 'El token de WhatsApp venció o es inválido. Generá uno nuevo (token permanente) y actualizá WHATSAPP_TOKEN.',
  100: 'Meta rechazó el pedido (parámetro inválido). Revisá el número y la plantilla.',
};

class SendError extends Error {
  constructor(message, { retryable = false, code } = {}) {
    super(message);
    this.retryable = retryable;
    this.code = code;
  }
}

/** Modo simulación: no sale nada a WhatsApp. Sirve para probar todo el flujo. */
const simulated = {
  mode: 'simulado',
  async send(to, payload) {
    return { waId: `sim.${crypto.randomBytes(8).toString('hex')}`, simulated: true, to, payload };
  },
};

const cloud = {
  mode: 'cloud',
  async send(to, payload) {
    const { wa } = config;
    const dest = wa.arDrop9 && /^549\d{10}$/.test(to) ? '54' + to.slice(3) : to;
    const body = { messaging_product: 'whatsapp', to: dest };
    if (payload.template) {
      const t = payload.template;
      Object.assign(body, {
        type: 'template',
        template: {
          name: t.name,
          language: { code: t.lang },
          components: t.params.length ? [{ type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) }] : [],
        },
      });
    } else {
      Object.assign(body, { type: 'text', text: { body: payload.text, preview_url: false } });
    }

    let res;
    try {
      res = await fetch(`${wa.apiBase}/${wa.apiVersion}/${wa.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${wa.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new SendError(`Sin conexión con WhatsApp: ${e.message}`, { retryable: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error || {};
      const detail = err.error_data?.details || err.message || `HTTP ${res.status}`;
      const msg = FRIENDLY[err.code] ? `${FRIENDLY[err.code]} (${detail})` : detail;
      throw new SendError(msg, { retryable: res.status === 429 || res.status >= 500, code: err.code });
    }
    const waId = data.messages?.[0]?.id;
    if (!waId) throw new SendError('WhatsApp no devolvió el id del mensaje', { retryable: true });
    return { waId };
  },
};

const isCloud = () => Boolean(config.wa.token && config.wa.phoneNumberId);
const provider = () => (isCloud() ? cloud : simulated);

function status() {
  const { wa } = config;
  if (!isCloud()) {
    return {
      mode: 'simulado', ready: false,
      message: 'Modo simulación: los mensajes NO se envían de verdad. Configurá las variables WHATSAPP_* para conectar tu número.',
    };
  }
  const issues = [];
  if (!wa.verifyToken) issues.push('Falta WHATSAPP_VERIFY_TOKEN (necesario para registrar el webhook).');
  if (!wa.appSecret) issues.push('Falta WHATSAPP_APP_SECRET: sin esto no se aceptan respuestas entrantes.');
  return {
    mode: 'cloud', ready: issues.length === 0, issues,
    phone_number_id: wa.phoneNumberId,
    message: issues.length ? 'Conectado para enviar, pero la recepción no está completa.' : 'Conectado a WhatsApp Cloud API.',
  };
}

/** Valida la firma X-Hub-Signature-256 de los webhooks de Meta (HMAC-SHA256 del cuerpo crudo). */
function verifySignature(rawBody, header) {
  if (!config.wa.appSecret || !header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.wa.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { provider, status, isCloud, verifySignature, SendError };
