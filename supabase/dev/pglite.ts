// @ts-nocheck
// Postgres en memoria (PGlite) con el mismo esquema que Supabase. Lo usan los tests y el servidor de desarrollo;
// NO se despliega.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

export function pgliteDriver(pg) {
  const wrap = (c) => ({
    query: async (text, params = []) => (await c.query(text, params)).rows,
    transaction: (fn) => c.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(pg);
}

/** Crea una base nueva, aplica las migraciones y devuelve { pg, driver }. dataDir opcional = persistente. */
export async function createDatabase(dataDir) {
  const pg = new PGlite({ ...(dataDir ? { dataDir } : {}), extensions: { pgcrypto } });
  await pg.waitReady;
  // las migraciones de pg_cron/pg_net son solo de Supabase (nombre *_cron.sql)
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && !n.includes('_cron')).sort()) {
    await pg.exec(readFileSync(MIGRATIONS + f, 'utf8'));
  }
  return { pg, driver: pgliteDriver(pg) };
}
