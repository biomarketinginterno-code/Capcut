// Prepara la carpeta `dist/` que se publica en Netlify: la interfaz (public/) + la dirección de la API de Supabase.
//
//   CRM_API_URL=https://<proyecto>.supabase.co/functions/v1/api node scripts/build-netlify.mjs
//   (o pasando la URL como primer argumento)
//
// Netlify lo ejecuta solo (ver netlify.toml en la raíz del repositorio). También sirve para generar la carpeta y
// arrastrarla a https://app.netlify.com/drop.
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const out = path.join(root, 'dist');
const api = String(process.env.CRM_API_URL || process.argv[2] || '').trim().replace(/\/+$/, '');

if (!/^https:\/\/[a-z0-9.-]+\/functions\/v1\/[\w-]+$/i.test(api) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/functions\/v1\/[\w-]+$/i.test(api)) {
  console.error('Falta la dirección de la API o no es válida.\n' +
    'Ejemplo: CRM_API_URL=https://abcdefgh.supabase.co/functions/v1/api node scripts/build-netlify.mjs');
  process.exit(1);
}
if (!existsSync(src)) { console.error(`No encuentro la carpeta ${src}`); process.exit(1); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });

// la interfaz lee su configuración de /config.js
writeFileSync(path.join(out, 'config.js'),
  `// Generado por scripts/build-netlify.mjs\nwindow.CRM_API = ${JSON.stringify(api)};\n`);

// Cabeceras de seguridad de Netlify. connect-src deja hablar SOLO con esta API (y con el propio sitio).
const apiOrigin = new URL(api).origin;
writeFileSync(path.join(out, '_headers'), `/*
  Content-Security-Policy: default-src 'self'; connect-src 'self' ${apiOrigin}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Strict-Transport-Security: max-age=31536000

/config.js
  Cache-Control: no-cache
`);

console.log(`Sitio listo en ${path.relative(process.cwd(), out) || out}\nAPI: ${api}`);
