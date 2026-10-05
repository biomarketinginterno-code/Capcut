'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// Mini cargador de .env (sin dependencias). Las variables ya definidas en el entorno ganan.
function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile(path.join(root, '.env'));

const env = process.env;
const dataDir = path.resolve(root, env.DATA_DIR || './data');

module.exports = {
  root,
  port: Number(env.PORT) || 3000,
  dataDir,
  dbPath: env.DB_PATH || path.join(dataDir, 'crm.sqlite'),
  adminPassword: env.ADMIN_PASSWORD || '',
  cookieSecure: env.COOKIE_SECURE === '1',
  sendBatch: Math.max(1, Number(env.SEND_BATCH) || 5),
  wa: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    apiBase: (env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/+$/, ''),
    apiVersion: env.WHATSAPP_API_VERSION || 'v25.0',
    arDrop9: env.WHATSAPP_AR_DROP_9 === '1',
  },
};
