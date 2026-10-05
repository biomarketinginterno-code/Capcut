// @ts-nocheck
import { getRaw, setRaw, delRaw, env } from './db.ts';

// Errores de la Cloud API que conviene explicar en castellano.
const FRIENDLY = {
  131047: 'Pasaron más de 24 h desde la última respuesta del contacto: WhatsApp solo permite enviar una plantilla aprobada.',
  131026: 'El número no tiene WhatsApp o no se pudo entregar.',
  131030: 'El número no está en la lista de destinatarios permitidos (en modo de prueba de Meta hay que agregarlo).',
  131056: 'Demasiados mensajes al mismo número en poco tiempo. Se reintenta más tarde.',
  132000: 'La plantilla espera otra cantidad de variables.',
  132001: 'La plantilla no existe o no está aprobada en ese idioma.',
  190: 'El token de WhatsApp venció o es inválido. Generá uno nuevo (token permanente) y cargalo en Ajustes.',
  100: 'Meta rechazó el pedido (parámetro inválido). Revisá el número y la plantilla.',
};

export class SendError extends Error {
  constructor(message, { retryable = false, code } = {}) {
    super(message);
    this.retryable = retryable;
    this.code = code;
  }
}

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Credenciales de WhatsApp. Se cargan desde Ajustes (quedan en la tabla `settings`, que la API pública no puede leer)
 * o, si existen, desde variables de entorno / secretos de la función (tienen prioridad).
 */
export async function waConfig() {
  const [token, phoneNumberId, verifyToken, appSecret, apiVersion] = await Promise.all(
    ['wa_token', 'wa_phone_number_id', 'wa_verify_token', 'wa_app_secret', 'wa_api_version'].map(getRaw),
  );
  return {
    token: env('WHATSAPP_TOKEN') || token,
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID') || phoneNumberId,
    verifyToken: env('WHATSAPP_VERIFY_TOKEN') || verifyToken,
    appSecret: env('WHATSAPP_APP_SECRET') || appSecret,
    apiBase: (env('WHATSAPP_API_BASE') || 'https://graph.facebook.com').replace(/\/+$/, ''),
    apiVersion: env('WHATSAPP_API_VERSION') || apiVersion || 'v25.0',
    arDrop9: env('WHATSAPP_AR_DROP_9') === '1',
  };
}

export const isCloud = (cfg) => Boolean(cfg.token && cfg.phoneNumberId);

/** El token de verificación del webhook se genera solo la primera vez (Meta lo pide al registrar la URL). */
export async function ensureVerifyToken() {
  const cfg = await waConfig();
  if (cfg.verifyToken) return cfg.verifyToken;
  const t = randomHex(12);
  await setRaw('wa_verify_token', t);
  return t;
}

/** Guarda lo que llegue; los campos vacíos no pisan lo ya guardado (el panel nunca recibe el token de vuelta). */
export async function saveWaConfig(input) {
  const map = { token: 'wa_token', phone_number_id: 'wa_phone_number_id', app_secret: 'wa_app_secret', verify_token: 'wa_verify_token', api_version: 'wa_api_version' };
  for (const [field, key] of Object.entries(map)) {
    const v = String(input[field] ?? '').trim();
    if (v) await setRaw(key, v.slice(0, 600));
  }
  if (input.clear === true) for (const key of ['wa_token', 'wa_phone_number_id', 'wa_app_secret']) await delRaw(key);
}

/** Modo simulación: no sale nada a WhatsApp. Sirve para probar todo el flujo. */
const simulated = {
  mode: 'simulado',
  async send(_cfg, to, payload) {
    return { waId: `sim.${randomHex(8)}`, simulated: true, to, payload };
  },
};

const cloud = {
  mode: 'cloud',
  async send(cfg, to, payload) {
    const dest = cfg.arDrop9 && /^549\d{10}$/.test(to) ? '54' + to.slice(3) : to;
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
      res = await fetch(`${cfg.apiBase}/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
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

export async function getProvider() {
  const cfg = await waConfig();
  const p = isCloud(cfg) ? cloud : simulated;
  return { mode: p.mode, send: (to, payload) => p.send(cfg, to, payload) };
}

export async function status() {
  const cfg = await waConfig();
  if (!isCloud(cfg)) {
    return {
      mode: 'simulado', ready: false,
      message: 'Modo simulación: los mensajes NO se envían de verdad. Cargá tus datos de WhatsApp en Ajustes para conectar tu número.',
    };
  }
  const issues = [];
  if (!cfg.verifyToken) issues.push('Falta el token de verificación del webhook.');
  if (!cfg.appSecret) issues.push('Falta la clave secreta de la app de Meta (App Secret): sin ella no se aceptan respuestas entrantes.');
  return {
    mode: 'cloud', ready: issues.length === 0, issues,
    phone_number_id: cfg.phoneNumberId,
    message: issues.length ? 'Conectado para enviar, pero la recepción no está completa.' : 'Conectado a WhatsApp Cloud API.',
  };
}

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

/** Valida X-Hub-Signature-256 de los webhooks de Meta (HMAC-SHA256 del cuerpo crudo con el App Secret). */
export async function verifySignature(rawBytes, header, secret) {
  if (!secret || !header) return false;
  return safeEqual('sha256=' + (await hmacHex(secret, rawBytes)), header);
}
