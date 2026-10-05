// @ts-nocheck
import postgres from 'postgres';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createDatabase } from '../dev/pglite.ts';
import { setDriver, db } from '../functions/api/db.ts';
import { setInitialPassword } from '../functions/api/auth.ts';
import { ensureSeed, resetSeedFlag } from '../functions/api/seed.ts';
import { wrapPostgres, PG_OPTIONS } from '../functions/api/pgwrap.ts';

/**
 * Base nueva (PGlite) con el esquema real, contraseña "clave-test" y las automatizaciones de arranque.
 *   TEST_DRIVER=postgres  -> la app habla con la base usando `postgres` (porsager), el MISMO cliente que usa
 *                            Supabase en producción, a través del protocolo de red de Postgres.
 *   (por defecto)          -> directo contra PGlite.
 * Las diferencias entre drivers ya causaron un bug real (los parámetros ::jsonb se codifican distinto),
 * por eso la batería completa corre con ambos.
 */
export async function setup() {
  const { pg, driver } = await createDatabase();
  if (process.env.TEST_DRIVER === 'postgres') {
    const port = 51000 + Math.floor(Math.random() * 8000);
    const server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' });
    await server.start();
    const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`, { ...PG_OPTIONS, max: 1, ssl: false });
    setDriver(wrapPostgres(sql));
    globalThis.__closeTestDb = async () => { await sql.end({ timeout: 1 }).catch(() => {}); await server.stop().catch(() => {}); };
  } else {
    setDriver(driver);
  }
  resetSeedFlag();
  await setInitialPassword('clave-test');
  await ensureSeed();
  return pg;
}

/** Cierra las conexiones (con el driver `postgres` el proceso no termina si quedan abiertas). */
export const teardown = () => globalThis.__closeTestDb?.();

/** Vacía los datos de prueba entre tests y apaga las automatizaciones que no son de respuesta. */
export async function reset() {
  await db.query('truncate outbox, messages, automation_runs, campaigns, contacts restart identity cascade');
  await db.query("update automations set active = false where trigger <> 'keyword'");
  await db.query("delete from settings where key in ('event_at_local','event_place','event_address','event_name')");
}

export const sent = (contactId) => db.query("select * from messages where contact_id = $1 and direction = 'out' order by id", [contactId]);
export const openWindow = (id) => db.query('update contacts set last_inbound_at = now() where id = $1', [id]);
