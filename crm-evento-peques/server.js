'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./src/config');
const { HttpError } = require('./src/db');
const { routes } = require('./src/api');
const queue = require('./src/queue');
const automations = require('./src/automations');
const { seedDefaults } = require('./src/seed');
const wa = require('./src/whatsapp');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};
const MAX_BODY = 10 * 1024 * 1024; // 10 MB (planillas grandes)
const SESSION_MS = 7 * 24 * 3600 * 1000;

// ---- contraseña de acceso ----
function resolvePassword() {
  if (config.adminPassword) return config.adminPassword;
  const file = path.join(config.dataDir, 'admin-password.txt');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* se genera abajo */ }
  const pwd = crypto.randomBytes(9).toString('base64url');
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, pwd + '\n', { mode: 0o600 });
  console.log(`\n  Contraseña generada para entrar al CRM: ${pwd}\n  (guardada en ${file}; definí ADMIN_PASSWORD para cambiarla)\n`);
  return pwd;
}
const PASSWORD = resolvePassword();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// ---- sesiones y límite de intentos de login ----
const sessions = new Map();
const attempts = new Map();
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter((p) => p[0]));
function sessionOf(req) {
  const token = parseCookies(req.headers.cookie).crm_sid;
  const exp = token && sessions.get(token);
  if (!exp) return null;
  if (exp < Date.now()) { sessions.delete(token); return null; }
  return token;
}
const clientIp = (req) => (config.cookieSecure && req.headers['x-forwarded-for']
  ? String(req.headers['x-forwarded-for']).split(',').pop().trim()
  : req.socket.remoteAddress) || 'unknown';
const cookie = (value, maxAgeSec) =>
  `crm_sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${config.cookieSecure ? '; Secure' : ''}`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Archivo demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  // detrás de HTTPS (COOKIE_SECURE=1) el navegador no vuelve a entrar por HTTP
  ...(config.cookieSecure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, data, headers = {}) =>
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, JSON.stringify(data));

async function handleApi(req, res, url) {
  const isWebhook = url.pathname.startsWith('/webhook/');

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const a = attempts.get(ip);
    if (a && a.until > Date.now() && a.n >= 8) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Se esperaba JSON');
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON inválido'); }
    if (!crypto.timingSafeEqual(sha(body.password ?? ''), sha(PASSWORD))) {
      attempts.set(ip, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 10 * 60000 });
      throw new HttpError(401, 'Contraseña incorrecta');
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(token, SESSION_MS / 1000) });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const token = sessionOf(req);
    if (token) sessions.delete(token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (url.pathname === '/api/session') return sendJson(res, 200, { authenticated: Boolean(sessionOf(req)) });

  const match = routes.map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m && x.r.method === req.method);
  if (!match) {
    if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Método no permitido');
    throw new HttpError(404, 'No encontrado');
  }
  const { r, m } = match;
  if (!r.public && !sessionOf(req)) throw new HttpError(401, 'Sesión vencida');

  const raw = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
  let body = {};
  if (!r.rawBody && raw.length) {
    // exigir JSON bloquea formularios de otros sitios (CSRF) sin necesidad de tokens
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Se esperaba JSON');
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
  }
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const out = await r.handler({ req, params, query: url.searchParams, body, raw });
  if (out && out.__raw) return send(res, out.__raw.status, { 'Cache-Control': 'no-store', ...out.__raw.headers }, out.__raw.body);
  return sendJson(res, 200, out ?? { ok: true });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, {}, 'Prohibido');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'No encontrado');
    send(res, 200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhook/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
    if (e instanceof URIError) return sendJson(res, 400, { error: 'URL inválida' });
    console.error('[error]', e);
    return sendJson(res, 500, { error: 'Error interno del servidor' });
  }
});

function start() {
  seedDefaults();
  automations.start();
  queue.start();
  server.listen(config.port, () => {
    const s = wa.status();
    console.log(`CRM del evento de los peques en http://localhost:${config.port}`);
    console.log(`WhatsApp: ${s.mode === 'cloud' ? 'conectado (Cloud API)' : 'MODO SIMULACIÓN (no envía mensajes reales)'}`);
    for (const i of s.issues || []) console.log(`  ! ${i}`);
  });
}

if (require.main === module) start();

module.exports = { server, start };
