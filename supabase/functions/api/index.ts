// @ts-nocheck
// Punto de entrada de la Edge Function `api` (Supabase). Toda la lógica está en app.ts.
// Rutas: /session /login /contacts … /webhook/whatsapp (Meta) /internal/tick (cron).
import { setDriver } from './db.ts';
import { handle } from './app.ts';
import { pgDriver } from './pg.ts';

const dbUrl = Deno.env.get('SUPABASE_DB_URL');
if (!dbUrl) console.error('Falta SUPABASE_DB_URL: la función no puede conectarse a la base de datos.');
setDriver(pgDriver(dbUrl));

Deno.serve(handle);
