// @ts-nocheck
// Servidor de desarrollo: reproduce la nube en tu máquina, sin cuentas ni internet.
//   - API   (Edge Function)  en  http://localhost:54321/functions/v1/api   -> el mismo código que corre en Supabase
//   - Web   (lo que va a Netlify) en http://localhost:5173                 -> carpeta dist/ con las mismas cabeceras
//   - Base de datos: PGlite (Postgres en memoria; con DATA_DIR queda guardada en disco)
// Como la web y la API están en puertos distintos, también se prueba el acceso entre dominios (CORS).
//
//   cd crm-evento-peques && CRM_API_URL=http://localhost:54321/functions/v1/api node scripts/build-netlify.mjs
//   cd supabase && npm install && npm run dev      (contraseña: ADMIN_PASSWORD, por defecto "dev-clave")
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDatabase } from './dev/pglite.ts';
import { setDriver, db } from './functions/api/db.ts';
import { handle } from './functions/api/app.ts';
import { setInitialPassword } from './functions/api/auth.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../crm-evento-peques/dist');
const API_PORT = Number(process.env.API_PORT) || 54321;
const WEB_PORT = Number(process.env.WEB_PORT) || 5173;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

// en Supabase la URL pública sale de SUPABASE_URL; acá la definimos a mano (es la que se pega en Meta)
process.env.PUBLIC_API_URL ||= `http://localhost:${API_PORT}/functions/v1/api`;

const { driver } = await createDatabase(process.env.DATA_DIR);
setDriver(driver);
if (!(await db.val("select value from settings where key = 'admin_hash'"))) {
  await setInitialPassword(process.env.ADMIN_PASSWORD || 'dev-clave');
}

// --- API: adapta http de Node a Request/Response (igual que hace Supabase) ---
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(',') : v);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
  const out = await handle(new Request(`http://localhost:${API_PORT}${req.url}`, { method: req.method, headers, body }));
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(API_PORT, () => console.log(`API  http://localhost:${API_PORT}/functions/v1/api`));

// --- "pg_cron": cada 5 s (en Supabase es cada minuto) ---
setInterval(async () => {
  try {
    const key = await db.val("select value from settings where key = 'cron_secret'");
    await handle(new Request(`http://localhost:${API_PORT}/functions/v1/api/internal/tick`, { method: 'POST', headers: { 'x-cron-secret': key } }));
  } catch (e) { console.error('[cron]', e.message); }
}, 5000).unref?.();

// --- Web estática con las cabeceras de _headers (CSP incluida), como Netlify ---
function headersFor() {
  if (!existsSync(path.join(DIST, '_headers'))) return {};
  const out = {};
  for (const line of readFileSync(path.join(DIST, '_headers'), 'utf8').split('\n')) {
    if (/^\/\*/.test(line)) continue;
    if (/^\//.test(line)) break; // solo las de /*
    const m = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const SECURITY = headersFor();
http.createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { ...SECURITY, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('No encontrado (¿corriste scripts/build-netlify.mjs?)');
  }
}).listen(WEB_PORT, () => console.log(`Web  http://localhost:${WEB_PORT}   (contraseña: ${process.env.ADMIN_PASSWORD || 'dev-clave'})`));
