// @ts-nocheck
// Driver de Postgres para Supabase Edge Functions (Deno). Usa la conexión que Supabase inyecta en SUPABASE_DB_URL.
import postgres from 'npm:postgres@3.4.5';
import { wrapPostgres, PG_OPTIONS } from './pgwrap.ts';

export const pgDriver = (url) => wrapPostgres(postgres(url, PG_OPTIONS));
