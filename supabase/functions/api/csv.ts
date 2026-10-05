// @ts-nocheck
// CSV/TSV mínimo: detecta separador (coma, punto y coma, tab), respeta comillas y saltos de línea.

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let best = ',';
  let max = 0;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let inQ = false;
    for (const ch of firstLine) {
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) n++;
    }
    if (n > max) { max = n; best = d; }
  }
  return best;
}

function parseDelimited(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => r.map((c) => c.trim()));
}

// Evita "inyección de fórmulas" al abrir el CSV en Excel/Sheets.
function safeCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(header, rows) {
  const lines = [header.map(safeCell).join(',')];
  for (const r of rows) lines.push(r.map(safeCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // BOM: Excel respeta los acentos
}

export { parseDelimited, toCSV };
