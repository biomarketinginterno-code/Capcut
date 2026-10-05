'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,                 -- internacional, solo dígitos: 5492234567890
  phone_key TEXT NOT NULL UNIQUE,      -- últimos 10 dígitos (detecta duplicados y cruza respuestas)
  email TEXT NOT NULL DEFAULT '',
  child_name TEXT NOT NULL DEFAULT '',
  child_age TEXT NOT NULL DEFAULT '',
  kids_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'nuevo',
  tags TEXT NOT NULL DEFAULT '',       -- ",vip,sala-1,"  (coma a cada lado para poder filtrar con LIKE)
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  opted_out INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  last_inbound_at TEXT,                -- abre la ventana de 24 h de WhatsApp
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_last_msg ON contacts(last_message_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,             -- in | out
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',   -- text | template
  status TEXT NOT NULL,                -- received | sent | delivered | read | failed
  wa_id TEXT,
  error TEXT,
  source TEXT NOT NULL DEFAULT '',     -- manual | campaña: X | automatización: X | respuesta
  campaign_id INTEGER,
  automation_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_wa ON messages(wa_id);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  template TEXT,                       -- JSON {name, lang, params:[...]} o NULL
  filter TEXT NOT NULL DEFAULT '{}',   -- JSON {statuses:[], tags:[]}
  scheduled_at TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,               -- contact_created | status_changed | before_event | after_event | keyword
  config TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  template TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Un contacto recibe cada automatización (no keyword) una sola vez.
CREATE TABLE IF NOT EXISTS automation_runs (
  automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (automation_id, contact_id)
);

-- Cola de envío: todo lo que sale por WhatsApp pasa por acá (reintentos, ritmo, opt-out).
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,                  -- texto con {{variables}}, se completa al enviar
  template TEXT,
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed | cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  automation_id INTEGER REFERENCES automations(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT '',
  ignore_optout INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(status, send_at);
CREATE INDEX IF NOT EXISTS idx_outbox_campaign ON outbox(campaign_id);
`);

const nowIso = () => new Date().toISOString();

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Configuración editable desde el panel ----
const SETTING_DEFAULTS = {
  event_name: 'Fiesta de los Peques',
  event_at_local: '',                         // "2026-11-15T16:00" (hora local del evento)
  event_place: '',
  event_address: '',
  timezone: 'America/Argentina/Buenos_Aires',
  default_country: '54',
  default_area: '223',                        // para números cargados sin código de área
};

function getSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.key in SETTING_DEFAULTS) out[r.key] = r.value;
  }
  return out;
}

function saveSettings(patch) {
  const up = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in SETTING_DEFAULTS) up.run(k, String(v ?? ''));
    }
  });
  return getSettings();
}

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
const placeholders = (n) => Array(n).fill('?').join(',');

module.exports = { db, nowIso, transaction, getSettings, saveSettings, SETTING_DEFAULTS, HttpError, likeEscape, placeholders };
