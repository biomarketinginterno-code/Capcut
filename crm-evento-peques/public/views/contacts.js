import {
  state, html, raw, mount, get, post, put, del, qs, icon, toast, fail, modal, confirmBox, download,
  statusInfo, statusOptions, waLink, debounce, initials,
} from '../lib.js';

const PAGE = 100;

export async function render(view) {
  const f = { search: '', status: '', tag: '' };
  let contacts = [];
  let tags = [];
  let shown = PAGE;
  const selected = new Set();

  mount(view, html`
    <div class="page-head"><div><h1>Contactos</h1><p>Cargá a las familias, seguí su estado y escribiles por WhatsApp.</p></div>
      <div class="row"><a class="btn" id="export" href="#">${icon('download')} Exportar</a><button class="btn" id="import">${icon('upload')} Importar</button><button class="btn primary" id="new">${icon('plus')} Nuevo contacto</button></div></div>
    <div class="card flush">
      <div class="toolbar">
        <input type="search" id="q" placeholder="Buscar nombre, teléfono o peque" aria-label="Buscar">
        <select id="fs" aria-label="Filtrar por estado"></select>
        <select id="ft" aria-label="Filtrar por etiqueta"></select>
        <span class="muted small grow right" id="count"></span>
      </div>
      <div id="bulk"></div>
      <div id="list"></div>
    </div>`);

  const $ = (s) => view.querySelector(s);

  async function load() {
    [contacts, tags] = await Promise.all([get(`/api/contacts?${qs(f)}`), get('/api/tags')]);
    for (const id of [...selected]) if (!contacts.some((c) => c.id === id)) selected.delete(id);
    $('#ft').innerHTML = html`<option value="">Todas las etiquetas</option>${tags.map((t) => html`<option value="${t.tag}" ${t.tag === f.tag ? raw('selected') : ''}>${t.tag} (${t.count})</option>`)}`.s;
    $('#fs').innerHTML = statusOptions(f.status, 'Todos los estados').s;
    draw();
  }

  function draw() {
    $('#count').textContent = `${contacts.length} contacto${contacts.length === 1 ? '' : 's'}`;
    drawBulk();
    if (!contacts.length) {
      const filtered = f.search || f.status || f.tag;
      mount($('#list'), html`<div class="empty"><div class="big">🎈</div><h3>${filtered ? 'No hay contactos con ese filtro' : 'Todavía no hay contactos'}</h3>
        <p>${filtered ? 'Probá con otra búsqueda.' : 'Importá tu lista desde Excel o agregá el primero a mano.'}</p>
        ${!filtered && html`<button class="btn primary" data-act="import">${icon('upload')} Importar contactos</button>`}</div>`);
      return;
    }
    const rows = contacts.slice(0, shown);
    const allOn = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
    mount($('#list'), html`<div class="table-wrap"><table class="rows">
      <thead><tr><th style="width:36px"><input type="checkbox" id="all" aria-label="Seleccionar todos" ${allOn ? raw('checked') : ''}></th><th>Contacto</th><th class="hide-sm">Peque</th><th>Estado</th><th class="hide-sm">Etiquetas</th><th></th></tr></thead>
      <tbody>${rows.map((c) => html`<tr data-id="${c.id}">
        <td class="sel"><input type="checkbox" data-sel="${c.id}" aria-label="Seleccionar ${c.name}" ${selected.has(c.id) ? raw('checked') : ''}></td>
        <td class="name"><b>${c.name}</b><span class="sub">${c.phone_display}${c.opted_out ? html` · <span class="badge" style="--c:var(--bad)">Pidió la baja</span>` : ''}</span></td>
        <td class="hide-sm kid">${c.child_name || '—'}${c.child_age ? html` <span class="muted">(${c.child_age})</span>` : ''}${c.kids_count > 1 ? html`<div class="sub muted">${c.kids_count} peques</div>` : ''}</td>
        <td class="st"><select class="status" data-status="${c.id}" style="--c:${statusInfo(c.status).color}" aria-label="Estado de ${c.name}">${statusOptions(c.status)}</select></td>
        <td class="hide-sm tg">${c.tags.map((t) => html`<span class="chip">${t}</span>`)}</td>
        <td class="right nowrap act">
          <a class="btn icon ghost" href="${waLink(c.phone)}" target="_blank" rel="noopener" title="Abrir en WhatsApp" aria-label="Abrir en WhatsApp">${icon('wa')}</a>
          <button class="btn icon ghost" data-chat="${c.id}" title="Ver conversación" aria-label="Ver conversación">${icon('chat')}</button>
          <button class="btn icon ghost" data-edit="${c.id}" title="Editar" aria-label="Editar">${icon('edit')}</button></td></tr>`)}</tbody></table></div>
      ${contacts.length > shown && html`<div style="padding:1rem;text-align:center"><button class="btn" data-act="more">Mostrar más (${contacts.length - shown} restantes)</button></div>`}`);
  }

  function drawBulk() {
    const n = selected.size;
    mount($('#bulk'), n ? html`<div class="bulkbar"><span>${n} seleccionado${n === 1 ? '' : 's'}</span>
      <select id="bulk-status" aria-label="Cambiar estado"><option value="">Cambiar estado…</option>${statusOptions('')}</select>
      <button class="btn sm" data-act="tag">Etiquetar</button>
      <button class="btn sm primary" data-act="campaign">${icon('send')} Enviarles un mensaje</button>
      <button class="btn sm" data-act="optout">Dar de baja</button>
      <button class="btn sm danger" data-act="delete">Eliminar</button>
      <button class="btn sm ghost" data-act="clear">Quitar selección</button></div>` : '');
  }

  // ---- alta / edición ----
  function contactModal(c = null) {
    const isNew = !c;
    const m = modal({
      title: isNew ? 'Nuevo contacto' : 'Editar contacto',
      body: html`<form id="cf" class="stack-sm" autocomplete="off">
        <div class="cols2"><label class="f"><span>Nombre del adulto *</span><input type="text" name="name" required value="${c?.name || ''}" autofocus></label>
          <label class="f"><span>Teléfono / WhatsApp *</span><input type="tel" name="phone" required value="${c?.phone_display || ''}" placeholder="223 456-7890"></label></div>
        <div class="cols3"><label class="f"><span>Nombre del peque</span><input type="text" name="child_name" value="${c?.child_name || ''}"></label>
          <label class="f"><span>Edad</span><input type="text" name="child_age" value="${c?.child_age || ''}" placeholder="5"></label>
          <label class="f"><span>Cantidad de peques</span><input type="number" min="1" max="50" name="kids_count" value="${c?.kids_count || 1}"></label></div>
        <div class="cols2"><label class="f"><span>Estado</span><select name="status">${statusOptions(c?.status || 'nuevo')}</select></label>
          <label class="f"><span>Email</span><input type="email" name="email" value="${c?.email || ''}"></label></div>
        <label class="f"><span>Etiquetas <small>(separadas por coma)</small></span><input type="text" name="tags" value="${(c?.tags || []).join(', ')}" placeholder="vip, sala-1" list="taglist"></label>
        <datalist id="taglist">${tags.map((t) => html`<option value="${t.tag}">`)}</datalist>
        <label class="f"><span>Notas</span><textarea name="notes">${c?.notes || ''}</textarea></label>
        ${!isNew && html`<label class="check"><input type="checkbox" name="opted_out" ${c.opted_out ? raw('checked') : ''}><span>Pidió la baja (no recibe más mensajes)</span></label>`}
      </form>`,
      foot: html`${!isNew && html`<button class="btn danger left" type="button" id="del">${icon('trash')} Eliminar</button>`}<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" type="submit" form="cf">Guardar</button>`,
      onMount: (el) => {
        el.querySelector('#cf').onsubmit = async (e) => {
          e.preventDefault();
          const fd = e.target.elements;
          const body = { name: fd.name.value, phone: fd.phone.value, email: fd.email.value, child_name: fd.child_name.value, child_age: fd.child_age.value, kids_count: fd.kids_count.value, status: fd.status.value, tags: fd.tags.value, notes: fd.notes.value };
          if (fd.opted_out) body.opted_out = fd.opted_out.checked;
          try {
            if (isNew) await post('/api/contacts', body); else await put(`/api/contacts/${c.id}`, body);
            toast(isNew ? 'Contacto agregado' : 'Cambios guardados', 'good');
            m.close();
            load();
          } catch (err) { fail(err); }
        };
        el.querySelector('#del')?.addEventListener('click', async () => {
          if (!(await confirmBox(`¿Eliminar a ${c.name} y toda su conversación? No se puede deshacer.`, 'Eliminar', true))) return;
          try { await del(`/api/contacts/${c.id}`); toast('Contacto eliminado'); m.close(); load(); } catch (err) { fail(err); }
        });
      },
    });
  }

  // ---- importación ----
  function importModal() {
    let text = '';
    let mapping;
    let hasHeader;
    let pv = null;
    const FIELD_LABELS = [['name', 'Nombre del adulto'], ['phone', 'Teléfono'], ['child_name', 'Nombre del peque'], ['child_age', 'Edad'], ['kids_count', 'Cantidad de peques'], ['email', 'Email'], ['tags', 'Etiquetas'], ['notes', 'Notas']];

    const m = modal({
      title: 'Importar contactos', wide: true,
      body: html`<div class="stack">
        <div class="banner info"><div><b>Subí tu lista de Excel o Google Sheets</b>Guardala como <b>CSV</b> (Archivo → Descargar/Guardar como → CSV) o copiá las celdas y pegalas abajo. Con una columna de teléfono alcanza; si tiene encabezados como «Nombre», «Celular», «Hijo/a», «Edad», los reconocemos solos.</div></div>
        <div class="cols2"><label class="f"><span>Archivo CSV</span><input type="file" id="file" accept=".csv,.tsv,.txt,text/csv"></label>
          <label class="f"><span>…o pegá las filas acá</span><textarea id="paste" placeholder="Nombre&#9;Celular&#9;Hijo&#10;Laura Gómez&#9;223 456-7890&#9;Juana" style="min-height:3.2rem"></textarea></label></div>
        <div id="pv"></div></div>`,
      foot: html`<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" id="go" disabled>Importar</button>`,
      onMount: (el) => {
        const $m = (s) => el.querySelector(s);
        const ready = () => {
          const ok = pv && pv.ok > 0 && $m('#consent')?.checked;
          $m('#go').disabled = !ok;
          $m('#go').textContent = pv?.ok ? `Importar ${pv.ok} contacto${pv.ok === 1 ? '' : 's'}` : 'Importar';
        };
        async function review() {
          if (!text.trim()) { pv = null; mount($m('#pv'), ''); return ready(); }
          try {
            pv = await post('/api/import/preview', { text, mapping, has_header: hasHeader });
            mapping = pv.mapping;
            hasHeader = pv.has_header;
          } catch (err) { pv = null; mount($m('#pv'), html`<div class="banner bad">${err.message}</div>`); return ready(); }
          drawPreview();
          ready();
        }
        function drawPreview() {
          mount($m('#pv'), html`<div class="stack">
            <div class="row"><span class="badge" style="--c:var(--good)">✔ ${pv.ok} listos para importar</span>
              ${pv.duplicate ? html`<span class="badge" style="--c:var(--warn)">${pv.duplicate} repetidos (se saltean)</span>` : ''}
              ${pv.invalid ? html`<span class="badge" style="--c:var(--bad)">${pv.invalid} con teléfono inválido</span>` : ''}</div>
            <div><h3 style="margin-bottom:.4rem">¿Qué es cada columna?</h3><div class="cols3">${FIELD_LABELS.map(([k, l]) => html`<label class="f"><span>${l}</span><select data-map="${k}"><option value="">— no usar —</option>${pv.headers.map((h, i) => html`<option value="${i}" ${pv.mapping[k] === i ? raw('selected') : ''}>${h || `Columna ${i + 1}`}</option>`)}</select></label>`)}</div></div>
            ${pv.mapping.phone === undefined ? html`<div class="banner bad">Elegí qué columna tiene el teléfono.</div>` : ''}
            <div class="table-wrap card flush"><table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Peque</th><th></th></tr></thead><tbody>
              ${pv.sample.map((r) => html`<tr><td>${r.data.name || '—'}</td><td>${r.data.phone || '—'}</td><td>${r.data.child_name || '—'}</td><td>${r.state === 'ok' ? html`<span class="badge" style="--c:var(--good)">ok</span>` : html`<span class="badge" style="--c:var(--bad)">${r.reason}</span>`}</td></tr>`)}</tbody></table></div>
            ${pv.problems.length ? html`<details><summary class="small" style="cursor:pointer">Ver filas con problemas (${pv.duplicate + pv.invalid})</summary><ul class="small">${pv.problems.map((r) => html`<li>Fila ${r.line}: ${r.reason} — ${r.data.name || ''} ${r.data.phone || ''}</li>`)}</ul></details>` : ''}
            <div class="cols2"><label class="f"><span>Etiqueta para todos <small>(opcional)</small></span><input type="text" id="itag" placeholder="evento-2026"></label></div>
            <label class="check"><input type="checkbox" id="consent"><span><b>Confirmo que estas personas aceptaron recibir mensajes por WhatsApp</b> de este evento. Es un requisito de WhatsApp y de la ley de protección de datos.</span></label>
            <label class="check"><input type="checkbox" id="welcome"><span>Enviarles ahora el mensaje de <b>Bienvenida</b> (si esa automatización está activa)</span></label></div>`);
        }
        const useText = (t) => { text = t; mapping = undefined; hasHeader = undefined; review(); };
        $m('#paste').addEventListener('input', debounce((e) => useText(e.target.value), 400));
        $m('#file').addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          if (/\.xlsx?$/i.test(file.name)) { e.target.value = ''; return toast('Guardá el Excel como CSV (Archivo → Guardar como → CSV) o copiá y pegá las celdas', 'bad'); }
          const buf = await file.arrayBuffer();
          let t;
          try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { t = new TextDecoder('windows-1252').decode(buf); } // CSV de Excel viejo
          $m('#paste').value = '';
          useText(t);
        });
        el.addEventListener('change', (e) => {
          if (e.target.dataset.map) {
            const next = {};
            el.querySelectorAll('[data-map]').forEach((s) => { if (s.value !== '') next[s.dataset.map] = Number(s.value); });
            mapping = next;
            review();
          }
          if (e.target.id === 'consent') ready();
        });
        $m('#go').onclick = async () => {
          $m('#go').disabled = true;
          try {
            const r = await post('/api/import/commit', { text, mapping, has_header: hasHeader, consent: true, welcome: $m('#welcome').checked, tags: $m('#itag').value });
            toast(`Se importaron ${r.created} contactos${r.skipped ? ` (${r.skipped} se saltearon)` : ''}`, 'good');
            m.close();
            load();
          } catch (err) { fail(err); ready(); }
        };
      },
    });
  }

  function tagModal(ids) {
    const m = modal({
      title: `Etiquetar ${ids.length} contacto${ids.length === 1 ? '' : 's'}`,
      body: html`<form id="tf"><label class="f"><span>Etiqueta</span><input type="text" name="tag" list="taglist2" required autofocus placeholder="vip"></label><datalist id="taglist2">${tags.map((t) => html`<option value="${t.tag}">`)}</datalist></form>`,
      foot: html`<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" type="submit" form="tf">Agregar etiqueta</button>`,
      onMount: (el) => {
        el.querySelector('#tf').onsubmit = async (e) => {
          e.preventDefault();
          try { await post('/api/contacts/bulk', { ids, action: 'add_tag', value: e.target.tag.value }); toast('Etiqueta agregada', 'good'); m.close(); load(); } catch (err) { fail(err); }
        };
      },
    });
  }

  async function bulk(action, value) {
    try { const r = await post('/api/contacts/bulk', { ids: [...selected], action, value }); toast(`${r.affected} contactos actualizados`, 'good'); return true; } catch (err) { fail(err); return false; }
  }

  // ---- eventos ----
  $('#q').addEventListener('input', debounce((e) => { f.search = e.target.value; shown = PAGE; load(); }));
  $('#fs').addEventListener('change', (e) => { f.status = e.target.value; shown = PAGE; load(); });
  $('#ft').addEventListener('change', (e) => { f.tag = e.target.value; shown = PAGE; load(); });
  $('#export').onclick = async (e) => {
    e.preventDefault();
    try { await download(`/api/contacts/export.csv?${qs(f)}`, 'contactos.csv'); } catch (err) { fail(err); }
  };
  $('#new').onclick = () => contactModal();
  $('#import').onclick = importModal;

  view.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'all') { contacts.forEach((c) => (t.checked ? selected.add(c.id) : selected.delete(c.id))); draw(); }
    else if (t.dataset.sel) { const id = Number(t.dataset.sel); if (t.checked) selected.add(id); else selected.delete(id); drawBulk(); }
    else if (t.dataset.status) {
      try { await put(`/api/contacts/${t.dataset.status}`, { status: t.value }); t.style.setProperty('--c', statusInfo(t.value).color); toast('Estado actualizado', 'good'); contacts.find((c) => c.id === Number(t.dataset.status)).status = t.value; }
      catch (err) { fail(err); load(); }
    } else if (t.id === 'bulk-status' && t.value) { if (await bulk('status', t.value)) { selected.clear(); load(); } }
  });
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act],[data-edit],[data-chat]');
    if (!b) return;
    if (b.dataset.edit) return contactModal(contacts.find((c) => c.id === Number(b.dataset.edit)));
    if (b.dataset.chat) { sessionStorage.setItem('crm:open_chat', b.dataset.chat); location.hash = '#/conversaciones'; return; }
    const ids = [...selected];
    switch (b.dataset.act) {
      case 'import': importModal(); break;
      case 'more': shown += PAGE; draw(); break;
      case 'clear': selected.clear(); draw(); break;
      case 'tag': tagModal(ids); break;
      case 'campaign': sessionStorage.setItem('crm:campaign_ids', JSON.stringify(ids)); location.hash = '#/campanas'; break;
      case 'optout': if (await confirmBox(`¿Dar de baja a ${ids.length} contacto(s)? Dejarán de recibir mensajes.`, 'Dar de baja', true) && await bulk('optout')) { selected.clear(); load(); } break;
      case 'delete': if (await confirmBox(`¿Eliminar ${ids.length} contacto(s) y sus conversaciones? No se puede deshacer.`, 'Eliminar', true) && await bulk('delete')) { selected.clear(); load(); } break;
      default:
    }
  });

  await load();
}
