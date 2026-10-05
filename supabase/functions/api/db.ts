// @ts-nocheck
// Acceso a Postgres. Un "driver" ({ query, transaction }) se inyecta al arrancar:
//   - en Supabase: `postgres` (pg.ts) contra SUPABASE_DB_URL
//   - en los tests / dev local: PGlite (Postgres en memoria)
// Todo el SQL usa parámetros $1, $2… y es idéntico en ambos.
import { AsyncLocalStorage } from 'node:async_hooks';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const env = (k) => (typeof Deno !== 'undefined' ? Deno.env.get(k) : globalThis.process?.env?.[k]) ?? '';

let driver = null;
const als = new AsyncLocalStorage(); // dentro de db.tx(), las consultas usan la conexión de la transacción
export const setDriver = (d) => { driver = d; };
const current = () => als.getStore() || driver;

// Las fechas salen como texto ISO, igual que en la API: el resto del código no distingue Date de string.
const fixRow = (r) => {
  const o = { ...r };
  for (const k of Object.keys(o)) if (o[k] instanceof Date) o[k] = o[k].toISOString();
  return o;
};

export const db = {
  async query(text, params = []) {
    if (!current()) throw new Error('Base de datos no inicializada');
    return (await current().query(text, params)).map(fixRow);
  },
  async one(text, params = []) {
    return (await db.query(text, params))[0];
  },
  async val(text, params = []) {
    const r = await db.one(text, params);
    return r ? Object.values(r)[0] : undefined;
  },
  /** Transacción: todo lo que corra adentro (aunque llame a otros módulos) usa la misma conexión. */
  async tx(fn) {
    if (als.getStore()) return fn(); // ya estamos en una
    return driver.transaction((t) => als.run(t, fn));
  },
};

export const nowIso = () => new Date().toISOString();
export const placeholders = (n, from = 1) => Array.from({ length: n }, (_, i) => `$${i + from}`).join(',');
export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
export const isUniqueViolation = (e) => e?.code === '23505' || /duplicate key|unique constraint/i.test(String(e?.message));

// ---- Configuración editable desde el panel ----
export const SETTING_DEFAULTS = {
  event_name: 'Fiesta de los Peques',
  event_at_local: '',                         // "2026-11-15T16:00" (hora local del evento)
  event_place: '',
  event_address: '',
  timezone: 'America/Argentina/Buenos_Aires',
  default_country: '54',
  default_area: '223',                        // para números cargados sin código de área
};

export async function getSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const r of await db.query('select key, value from settings')) if (r.key in SETTING_DEFAULTS) out[r.key] = r.value;
  return out;
}

export async function saveSettings(patch) {
  await db.tx(async () => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in SETTING_DEFAULTS) await setRaw(k, String(v ?? ''));
    }
  });
  return getSettings();
}

// Claves internas (secretos, credenciales de WhatsApp): nunca salen por la API de ajustes.
export const getRaw = async (key) => (await db.one('select value from settings where key = $1', [key]))?.value ?? '';
export const setRaw = (key, value) =>
  db.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, value]);
export const delRaw = (key) => db.query('delete from settings where key = $1', [key]);
