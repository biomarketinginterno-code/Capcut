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

export async function login(password, ip) {
  if (!(await getRaw('admin_hash'))) throw new HttpError(503, 'El CRM todavía no tiene contraseña configurada.');
  const a = await db.one('select n, until_at from login_attempts where ip = $1', [ip]);
  const locked = a && Date.parse(a.until_at) > Date.now() && a.n >= MAX_ATTEMPTS;
  if (locked) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.');
  if (!(await passwordOk(password))) {
    const n = (a && Date.parse(a.until_at) > Date.now() ? a.n : 0) + 1;
    await db.query(
      `insert into login_attempts (ip, n, until_at) values ($1, $2, $3::timestamptz)
       on conflict (ip) do update set n = excluded.n, until_at = excluded.until_at`,
      [ip, n, new Date(Date.now() + LOCK_MS).toISOString()],
    );
    throw new HttpError(401, 'Contraseña incorrecta');
  }
  await db.query('delete from login_attempts where ip = $1', [ip]);
  return makeToken();
}

export async function changePassword(current, next) {
  if (!(await passwordOk(current))) throw new HttpError(401, 'La contraseña actual no es correcta');
  if (String(next || '').length < 8) throw new HttpError(400, 'La contraseña nueva tiene que tener al menos 8 caracteres');
  await setRaw('admin_hash', await db.val("select extensions.crypt($1, extensions.gen_salt('bf', 10))", [String(next)]));
  // cambiar la contraseña invalida todas las sesiones abiertas
  await setRaw('session_secret', await db.val("select encode(extensions.gen_random_bytes(32), 'hex')"));
}

export async function setInitialPassword(password) {
  await setRaw('admin_hash', await db.val("select extensions.crypt($1, extensions.gen_salt('bf', 10))", [String(password)]));
}
