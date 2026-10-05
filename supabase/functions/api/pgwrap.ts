// @ts-nocheck
// Adaptador entre el cliente `postgres` (porsager) y el "driver" que usa db.ts. No importa nada: así lo comparten
// Supabase (Deno, npm:postgres) y los tests (Node, postgres de node_modules) y se prueba el mismo código.
export function wrapPostgres(sql) {
  const wrap = (s) => ({
    query: async (text, params = []) => Array.from(await s.unsafe(text, params)),
    transaction: (fn) => s.begin((tx) => fn(wrap(tx))),
  });
  return wrap(sql);
}

// prepare:false: compatible con el pooler de conexiones de Supabase (modo transacción)
export const PG_OPTIONS = { max: 4, prepare: false, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} };
