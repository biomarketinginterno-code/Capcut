// @ts-nocheck
// Manejador HTTP con estándares web (Request/Response): corre igual en Supabase Edge Functions (Deno),
// en el servidor de desarrollo (Node) y en los tests.
import { HttpError } from './db.ts';
import { routes } from './api.ts';
import * as auth from './auth.ts';
import { ensureSeed } from './seed.ts';

// La interfaz vive en otro dominio (Netlify) y se autentica con un token en el header Authorization
// (no con cookies), así que CORS abierto no expone nada a sitios de terceros.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
  'Access-Control-Max-Age': '86400',
};
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...CORS };
const MAX_BODY = 10 * 1024 * 1024; // 10 MB (planillas grandes)

const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_HEADERS } });

/** Trabajo en segundo plano (enviar mensajes): en Supabase sigue después de responder; en Node/tests se espera. */
async function flush(pending) {
  const all = Promise.allSettled(pending);
  if (globalThis.EdgeRuntime?.waitUntil) globalThis.EdgeRuntime.waitUntil(all);
  else await all;
}

// Supabase entrega la ruta como /<función>/… o /functions/v1/<función>/…; las rutas de la API son /contacts, /login, etc.
const routePath = (pathname) => (pathname.replace(/^\/functions\/v1/, '').replace(/^\/api(?=\/|$)/, '').replace(/\/+$/, '') || '/');

// cf-connecting-ip lo pone la red de Supabase (Cloudflare) y el cliente no puede falsificarlo.
const clientIp = (req) =>
  req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

export async function handle(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const pending = [];
  const defer = (p) => { pending.push(Promise.resolve(p).catch((e) => console.error('[segundo plano]', e))); };
  try {
    await ensureSeed().catch((e) => console.error('[seed]', e));
    const url = new URL(req.url);
    const path = routePath(url.pathname);

    const match = routes.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m && x.r.method === req.method);
    if (!match) {
      if (routes.some((r) => r.re.test(path))) throw new HttpError(405, 'Método no permitido');
      throw new HttpError(404, 'No encontrado');
    }
    const { r, m } = match;
    if (!r.public && !(await auth.verifyToken(auth.bearer(req)))) throw new HttpError(401, 'Sesión vencida');

    let bytes = new Uint8Array(0);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length > MAX_BODY) throw new HttpError(413, 'Archivo demasiado grande');
    }
    let body = {};
    if (!r.rawBody && bytes.length) {
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'JSON inválido'); }
    }
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const out = await r.handler({ req, params, query: url.searchParams, body, raw: bytes, ip: clientIp(req), defer });

    const res = out && out.__raw
      ? new Response(out.__raw.body, { status: out.__raw.status, headers: { ...BASE_HEADERS, ...out.__raw.headers } })
      : json(200, out ?? { ok: true });
    await flush(pending);
    return res;
  } catch (e) {
    await flush(pending);
    if (e instanceof HttpError) return json(e.status, { error: e.message, ...(e.extra || {}) });
    if (e instanceof URIError) return json(400, { error: 'URL inválida' });
    console.error('[error]', e);
    return json(500, { error: 'Error interno del servidor' });
  }
}
