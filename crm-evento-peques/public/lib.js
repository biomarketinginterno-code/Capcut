// Utilidades compartidas por todas las pantallas.

export const state = { meta: null };

// ---- HTML seguro: todo valor interpolado se escapa salvo que venga de raw()/html`` ----
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v == null ? '' : esc(v));
export const html = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));
// Acepta html``, un array de html`` (listas) o texto plano (se muestra como texto, nunca como HTML).
export const mount = (el, tpl) => {
  if (tpl instanceof Raw) el.innerHTML = tpl.s;
  else if (Array.isArray(tpl)) el.innerHTML = val(tpl);
  else el.textContent = tpl == null ? '' : String(tpl);
  return el;
};

// ---- API ----
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/api/login') {
    window.dispatchEvent(new Event('crm:unauthorized'));
    throw new Error('Tu sesión venció. Volvé a entrar.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Error ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
export const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])).toString();

// ---- avisos ----
export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'bad' ? 6000 : 3200);
}
export const fail = (e) => toast(e.message || 'Algo salió mal', 'bad');

// ---- modales (<dialog> nativo: foco, Esc y fondo bloqueado incluidos) ----
export function modal({ title, body, foot = '', wide = false, onMount }) {
  const dlg = document.createElement('dialog');
  if (wide) dlg.className = 'wide';
  mount(dlg, html`<div class="dlg-head"><h2>${title}</h2><button class="btn icon ghost" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="dlg-body">${body}</div>${foot ? html`<div class="dlg-foot">${foot}</div>` : ''}`);
  document.body.append(dlg);
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  dlg.showModal();
  onMount?.(dlg, close);
  return { el: dlg, close };
}
export function confirmBox(message, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'Confirmá',
      body: html`<p style="margin:0">${message}</p>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ok">${okLabel}</button>`,
      onMount: (el) => {
        el.querySelector('#ok').onclick = () => { resolve(true); m.close(); };
        el.addEventListener('close', () => resolve(false));
      },
    });
  });
}

// ---- íconos ----
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>', check: '<path d="M20 6L9 17l-5-5"/>',
  wa: '<path d="M3 21l1.65-4.9A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 10c0 3 2 5 5 5l1.2-1.4-2-1-.8.7c-.9-.4-1.6-1.1-2-2l.7-.8-1-2z"/>',
};
export const icon = (n) => raw(`<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`);

// ---- formato ----
export function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now - 86400000);
  if (d.toDateString() === yest.toDateString()) return 'ayer';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : {}) });
}
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
export const statusInfo = (id) => state.meta.statuses.find((s) => s.id === id) || { id, label: id, color: '#6b7280' };
export const statusBadge = (id) => { const s = statusInfo(id); return html`<span class="badge" style="--c:${s.color}">${s.label}</span>`; };
export const statusOptions = (selected, withAll = '') => html`${withAll ? html`<option value="">${withAll}</option>` : ''}${state.meta.statuses.map((s) => html`<option value="${s.id}" ${s.id === selected ? raw('selected') : ''}>${s.label}</option>`)}`;
export const waLink = (phone, text = '') => `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Vista previa de mensajes con datos de ejemplo + los del evento (mismo formato que el servidor)
export function sampleVars(contact = {}) {
  const s = state.meta.settings;
  const at = s.event_at_local ? new Date(s.event_at_local) : null;
  const first = String(contact.name || 'Laura').split(/\s+/)[0];
  return {
    nombre: first, nombre_completo: contact.name || 'Laura Gómez', hijo: contact.child_name || 'Juana', edad: contact.child_age || '5',
    cantidad_ninos: String(contact.kids_count || 2), evento: s.event_name || 'el evento',
    fecha: at ? new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(at).replace(',', '') : '(fecha del evento)',
    hora: at ? `${new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(at)} hs` : '(hora)',
    lugar: s.event_place || '(lugar)', direccion: s.event_address || '(dirección)',
  };
}
export const renderText = (text, vars) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');

/** Chips que insertan {{variable}} en el textarea indicado. */
export function variableChips(targetId) {
  return html`<div class="small muted">Variables: ${state.meta.variables.map((v) => html`<button type="button" class="chip btn-chip" data-var="${v.name}" data-target="${targetId}" title="${v.desc}">{{${v.name}}}</button>`)}</div>`;
}
export function wireVariableChips(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-var]');
    if (!b) return;
    const ta = root.querySelector(`#${b.dataset.target}`);
    const at = ta.selectionStart ?? ta.value.length;
    ta.setRangeText(`{{${b.dataset.var}}}`, at, ta.selectionEnd ?? at, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Campos de plantilla de WhatsApp (se reutiliza en campañas, automatizaciones y bandeja). */
export const templateFields = (t = {}) => html`
  <details ${t && t.name ? raw('open') : ''}>
    <summary class="small" style="cursor:pointer;font-weight:650">Plantilla de WhatsApp (para contactos que no te escribieron en las últimas 24 h)</summary>
    <div class="stack-sm" style="margin-top:.6rem">
      <div class="cols3">
        <label class="f"><span>Nombre de la plantilla</span><input type="text" name="tpl_name" value="${t?.name || ''}" placeholder="recordatorio_evento"></label>
        <label class="f"><span>Idioma</span><input type="text" name="tpl_lang" value="${t?.lang || 'es_AR'}"></label>
        <label class="f"><span>Variables en orden</span><input type="text" name="tpl_params" value="${(t?.params || []).join(', ')}" placeholder="nombre, evento, hora"></label>
      </div>
      <div class="small muted">Debe existir y estar aprobada en tu cuenta de Meta con el mismo nombre. Las variables llenan {{1}}, {{2}}… de la plantilla en ese orden. Mirá el README.</div>
    </div>
  </details>`;
export function readTemplate(form) {
  const name = form.elements.tpl_name?.value.trim();
  if (!name) return null;
  return { name, lang: form.elements.tpl_lang.value.trim() || 'es_AR', params: form.elements.tpl_params.value };
}
