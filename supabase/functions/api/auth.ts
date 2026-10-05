// @ts-nocheck
// Acceso con una contraseña compartida del equipo.
//  - La contraseña vive en la base como hash bcrypt (pgcrypto): settings.admin_hash.
//  - La sesión es un token firmado (HMAC) que viaja en el header Authorization: no hace falta memoria del
//    servidor, que en una función serverless se apaga entre llamadas.
import { db, getRaw, setRaw, HttpError } from './db.ts';
import { hmacHex, safeEqual } from './whatsapp.ts';

const SESSION_MS = 7 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 8;
const LOCK_MS = 10 * 60 * 1000;

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export async function makeToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_MS }));
  return `${payload}.${await hmacHex(await getRaw('session_secret'), payload)}`;
}

export async function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const secret = await getRaw('session_secret');
  if (!secret || !safeEqual(await hmacHex(secret, payload), sig)) return false;
  try { return JSON.parse(unb64url(payload)).exp > Date.now(); } catch { return false; }
}

export const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

/** El hash se compara dentro de Postgres (crypt): así no hace falta una librería de bcrypt en la función. */
async function passwordOk(password) {
  const row = await db.one("select (value = extensions.crypt($1, value)) as ok from settings where key = 'admin_hash'", [String(password ?? '')]);
  return Boolean(row?.ok);
}

/**
 * Cuenta el intento ANTES de mirar la contraseña, en una sola sentencia atómica: con peticiones simultáneas cada una
 * recibe un número distinto y solo las primeras MAX_ATTEMPTS llegan a probar la contraseña. La ventana es fija
 * (no se extiende mientras está bloqueado) y se vacía al entrar bien.
 */
async function countAttempt(bucket) {
  return db.val(
    `insert into login_attempts (ip, n, until_at) values ($1, 1, now() + ($2::int * interval '1 second'))
     on conflict (ip) do update set
       n = case when login_attempts.until_at <= now() then 1 else login_attempts.n + 1 end,
       until_at = case when login_attempts.until_at <= now() then excluded.until_at else login_attempts.until_at end
     returning n`,
    [bucket, LOCK_MS / 1000],
  );
}

const tooMany = () => new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.');

export async function login(password, ip) {
  if (!(await getRaw('admin_hash'))) throw new HttpError(503, 'El CRM todavía no tiene contraseña configurada.');
  if ((await countAttempt(ip)) > MAX_ATTEMPTS) throw tooMany();
  if (!(await passwordOk(String(password ?? '').slice(0, 200)))) throw new HttpError(401, 'Contraseña incorrecta');
  await db.query('delete from login_attempts where ip = $1', [ip]);
  return makeToken();
}

export async function changePassword(current, next, ip = 'unknown') {
  if ((await countAttempt(`pw:${ip}`)) > MAX_ATTEMPTS) throw tooMany();
  if (!(await passwordOk(String(current ?? '').slice(0, 200)))) throw new HttpError(401, 'La contraseña actual no es correcta');
  const pass = String(next ?? '');
  if (pass.trim().length < 8) throw new HttpError(400, 'La contraseña nueva tiene que tener al menos 8 caracteres (sin contar espacios de los costados)');
  if (pass.length > 72) throw new HttpError(400, 'La contraseña nueva puede tener hasta 72 caracteres');
  await setRaw('admin_hash', await db.val("select extensions.crypt($1, extensions.gen_salt('bf', 10))", [pass]));
  // cambiar la contraseña invalida todas las sesiones abiertas
  await setRaw('session_secret', await db.val("select encode(extensions.gen_random_bytes(32), 'hex')"));
  await db.query('delete from login_attempts where ip = $1', [`pw:${ip}`]);
}

export async function setInitialPassword(password) {
  await setRaw('admin_hash', await db.val("select extensions.crypt($1, extensions.gen_salt('bf', 10))", [String(password)]));
}
