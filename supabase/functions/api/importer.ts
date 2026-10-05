// @ts-nocheck
import { db, getSettings, HttpError, placeholders } from './db.ts';
import * as contacts from './contacts.ts';
import { parseDelimited } from './csv.ts';
import { normalizePhone } from './phone.ts';
import * as automations from './automations.ts';

const FIELDS = ['name', 'phone', 'email', 'child_name', 'child_age', 'kids_count', 'tags', 'notes'];

// Se evalúan en este orden: "Nombre del peque" cae en child_name antes que en name.
const HEADER_RULES = [
  ['child_age', /\bedad\b/],
  ['kids_count', /(cantidad|cant|numero de)\s*(de\s*)?(ninos|ninas|peques|hijos|chicos)/],
  ['child_name', /(hijo|hija|nene|nena|peque|nino|nina|chico|chica)/],
  ['email', /(mail|correo)/],
  ['phone', /(telefono|celular|\bcel\b|whatsapp|wsp|wpp|movil|\btel\b|phone|numero|\bnro\b)/],
  ['tags', /(etiqueta|tag|grupo|categoria)/],
  ['notes', /(nota|observ|comentario|\bobs\b)/],
  ['name', /(nombre|apellido|contacto|padre|madre|papa|mama|responsable|tutor|name|adulto)/],
];

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function guessMapping(headers) {
  const mapping = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, re] of HEADER_RULES) {
      if (mapping[field] === undefined && re.test(n)) { mapping[field] = i; break; }
    }
  });
  return mapping;
}

// Planilla sin encabezados: la columna con más teléfonos válidos es el teléfono; la primera de texto, el nombre.
function guessMappingByContent(rows, phoneOpts) {
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0); // (Math.max(...) revienta con cientos de miles de filas)
  let phoneCol = -1;
  let best = 0;
  for (let c = 0; c < cols; c++) {
    const hits = rows.slice(0, 20).filter((r) => normalizePhone(r[c], phoneOpts).valid).length;
    if (hits > best) { best = hits; phoneCol = c; }
  }
  if (phoneCol < 0) return {};
  const nameCol = [...Array(cols).keys()].find((c) => c !== phoneCol && rows.slice(0, 20).some((r) => /[a-záéíóúñ]/i.test(r[c] || '')));
  return { phone: phoneCol, ...(nameCol !== undefined ? { name: nameCol } : {}) };
}

async function analyze(text, mappingIn, hasHeaderIn) {
  const all = parseDelimited(text);
  if (all.length < 1) throw new HttpError(400, 'El archivo está vacío');
  const s = await getSettings();
  const phoneOpts = { country: s.default_country, area: s.default_area };

  let headers = all[0];
  let body = all.slice(1);
  let firstLine = 2;
  let hasHeader = true;
  const asData = () => { // la primera fila ya es un contacto: la planilla no tiene encabezados
    body = all;
    firstLine = 1;
    hasHeader = false;
    headers = headers.map((_, i) => `Columna ${i + 1}`);
  };
  if (hasHeaderIn === false) asData();
  let mapping = mappingIn && Object.keys(mappingIn).length ? mappingIn : guessMapping(headers);
  if (!mappingIn && hasHeaderIn === undefined && mapping.phone === undefined) {
    // no se reconoció la columna de teléfono por el encabezado: se busca por contenido
    const byContent = guessMappingByContent(all, phoneOpts);
    if (byContent.phone !== undefined) {
      mapping = { ...byContent, ...mapping };
      if (normalizePhone(all[0][byContent.phone], phoneOpts).valid) asData();
    }
  }
  // normaliza el mapping a { campo: índice }
  const map = {};
  for (const f of FIELDS) {
    const v = mapping[f];
    if (v !== undefined && v !== null && v !== '' && Number(v) >= 0 && Number(v) < headers.length) map[f] = Number(v);
  }

  // 1ª pasada: normalizar teléfonos. 2ª: una sola consulta para saber cuáles ya existen.
  const parsed = body.map((r, i) => {
    const data = {};
    for (const f of FIELDS) data[f] = map[f] === undefined ? '' : (r[map[f]] ?? '');
    return { line: i + firstLine, data, p: normalizePhone(data.phone, phoneOpts) };
  });
  const keys = [...new Set(parsed.filter((x) => x.p.valid).map((x) => x.p.key))];
  const existing = new Map();
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    for (const r of await db.query(`select phone_key, name from contacts where phone_key in (${placeholders(chunk.length)})`, chunk)) existing.set(r.phone_key, r.name);
  }

  const seen = new Set();
  const rows = parsed.map(({ line, data, p }) => {
    if (!p.valid) return { line, data, state: 'invalid', reason: data.phone ? `Teléfono inválido (${p.reason})` : 'Sin teléfono' };
    if (seen.has(p.key)) return { line, data, state: 'duplicate', reason: 'Repetido en el archivo' };
    seen.add(p.key);
    if (existing.has(p.key)) return { line, data, state: 'duplicate', reason: `Ya existe (${existing.get(p.key)})` };
    return { line, data: { ...data, phone: p.phone }, key: p.key, state: 'ok' };
  });
  return { headers, mapping: map, rows, hasHeader };
}

function summarize(a) {
  const count = (st) => a.rows.filter((r) => r.state === st).length;
  return {
    headers: a.headers,
    mapping: a.mapping,
    has_header: a.hasHeader,
    total: a.rows.length,
    ok: count('ok'),
    invalid: count('invalid'),
    duplicate: count('duplicate'),
    sample: a.rows.slice(0, 8),
    problems: a.rows.filter((r) => r.state !== 'ok').slice(0, 50),
  };
}

export async function preview(text, mapping, hasHeader) {
  return summarize(await analyze(text, mapping, hasHeader));
}

/**
 * Importa las filas válidas (todo o nada), en tandas: una sentencia INSERT cada 200 contactos, no una consulta por fila
 * (la función serverless tiene un par de segundos de CPU). Los teléfonos de quienes ya pidieron la baja entran dados de baja.
 * `welcome` dispara las automatizaciones de "contacto nuevo" para los que no están de baja.
 */
export async function commit(text, mapping, { tags = [], source = 'importación', consent = false, welcome = false, hasHeader } = {}) {
  if (!consent) throw new HttpError(400, 'Tenés que confirmar que estas personas aceptaron recibir mensajes por WhatsApp');
  const a = await analyze(text, mapping, hasHeader);
  const ok = a.rows.filter((r) => r.state === 'ok');
  const suppressed = await contacts.suppressedKeys(ok.map((r) => r.key));
  const baseTags = contacts.normalizeTags(tags);
  const note = `Importación (${String(source).slice(0, 80)}): el responsable confirmó el consentimiento`;
  const created = [];
  await db.tx(async () => {
    for (let i = 0; i < ok.length; i += 200) {
      const chunk = ok.slice(i, i + 200);
      const params = [];
      const values = chunk.map((r) => {
        const c = contacts.clean({ ...r.data, name: r.data.name || 'Sin nombre', source });
        const rowTags = contacts.tagsToDb([...baseTags, ...contacts.normalizeTags(r.data.tags)]);
        params.push(c.name, r.data.phone, r.key, c.email, c.child_name, c.child_age, c.kids_count, rowTags, c.notes, c.source, suppressed.has(r.key), note);
        const n = params.length - 12;
        return `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},'nuevo',$${n + 8},$${n + 9},$${n + 10},$${n + 11},now(),$${n + 12})`;
      });
      const rows = await db.query(
        `insert into contacts (name, phone, phone_key, email, child_name, child_age, kids_count, status, tags, notes, source, opted_out, consent_at, consent_note)
         values ${values.join(',')} on conflict (phone_key) do nothing returning *`,
        params,
      );
      created.push(...rows.map(contacts.toApi));
    }
  });
  if (welcome) await automations.onContactsCreated(created);
  return { created: created.length, skipped: a.rows.length - created.length };
}
