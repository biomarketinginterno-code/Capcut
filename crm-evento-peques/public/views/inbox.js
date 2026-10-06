import {
  state, html, raw, mount, get, post, put, icon, toast, fail, statusOptions, statusInfo, waLink,
  fmtWhen, fmtDateTime, initials, templateFields, readTemplate, poll,
} from '../lib.js';

const tick = (m) => {
  if (m.status === 'failed') return html`<span class="tick failed">⚠ no enviado</span>`;
  if (m.status === 'read') return html`<span class="tick read">✓✓</span>`;
  if (m.status === 'delivered') return html`<span class="tick">✓✓</span>`;
  if (m.status === 'sent') return html`<span class="tick">✓</span>`;
  return '';
};

export async function render(view, { pollUnread }) {
  const simulated = state.meta.whatsapp.mode !== 'cloud';
  let convs = [];
  let active = null;     // id del contacto que se ve en pantalla (se asigna junto con `thread`)
  let thread = null;
  let lastSig = '';
  let lastUnread;
  let openSeq = 0;       // cada pedido lleva su número: una respuesta vieja (de otro chat o de un sondeo anterior) se descarta
  let refreshSeq = 0;
  let sending = false;
  let gone = false;      // se salió de la pantalla: lo que quede en vuelo (pedidos, temporizadores) no hace nada
  let fails = 0;

  mount(view, html`
    <div class="page-head"><div><h1>Conversaciones</h1><p>Las respuestas de las familias llegan acá. ${simulated ? 'Estás en modo simulación: podés probar respuestas desde cada chat.' : ''}</p></div></div>
    <div class="banner warn hidden" id="conn" role="status" style="margin-bottom:.8rem"><div><b>Sin conexión con el servidor</b>Esta pantalla no se está actualizando. Seguimos reintentando.</div></div>
    <div class="card flush"><div class="inbox" id="inbox"><div class="list" id="clist"></div><div class="thread" id="thread"></div></div></div>`);
  const $ = (s) => view.querySelector(s);

  function drawList() {
    mount($('#clist'), convs.length ? convs.map((c) => html`<div class="conv ${c.id === active ? 'on' : ''}" data-open="${c.id}" tabindex="0" role="button">
      <div class="avatar">${initials(c.name)}</div>
      <div class="meta"><b>${c.name}</b><div class="muted small">${c.last_direction === 'out' ? 'Vos: ' : ''}${c.last_body || ''}</div></div>
      <div class="when">${fmtWhen(c.last_message_at)}${c.unread ? html`<br><span class="unread">${c.unread}</span>` : ''}</div></div>`)
      : html`<div class="empty"><div class="big">💬</div><p>Todavía no hay conversaciones.</p><p class="small">Aparecen cuando enviás un mensaje o una familia te escribe. Podés abrir un chat desde <a href="#/contactos">Contactos</a>.</p></div>`);
  }

  function drawMessages(scroll) {
    const box = $('#msgs');
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    mount(box, thread.messages.length ? thread.messages.map((m) => html`<div class="bubble ${m.direction}"><div class="txt">${m.body}</div>
      <div class="meta">${m.direction === 'out' && m.source && m.source !== 'manual' ? html`<span>${m.source}</span>` : ''}${m.kind === 'template' ? html`<span>plantilla</span>` : ''}<span>${fmtDateTime(m.created_at)}</span>${m.direction === 'out' ? tick(m) : ''}</div>
      ${m.error ? html`<div class="err">${m.error}</div>` : ''}</div>`) : html`<div class="empty muted small">Todavía no hay mensajes con este contacto.</div>`);
    if (scroll || near) box.scrollTop = box.scrollHeight;
  }

  function drawComposer() {
    const c = thread.contact;
    const box = $('#composer');
    if (c.opted_out) {
      return mount(box, html`<div class="banner bad"><div><b>${c.name} pidió no recibir mensajes</b>Podés volver a habilitarla desde Contactos → Editar.</div></div>`);
    }
    mount(box, html`<form id="send" class="stack-sm">
      ${!thread.window_open && html`<div class="banner warn"><div><b>Pasaron más de 24 h desde su última respuesta</b>WhatsApp solo permite escribirle con una <b>plantilla aprobada</b> (el texto libre no se envía). Completá la plantilla o esperá a que responda.</div></div>${templateFields(null, true)}`}
      <div class="line">${thread.window_open && html`<textarea name="text" rows="1" placeholder="Escribí un mensaje…" aria-label="Mensaje para ${c.name}"></textarea>`}
        <button class="btn primary" type="submit" ${sending ? raw('disabled') : ''}>${icon('send')} Enviar</button></div>
      ${simulated && html`<div class="row small muted"><span>🧪 Simular respuesta de ${c.name}:</span><input type="text" id="sim" style="max-width:220px" placeholder='ej: SI'><button class="btn sm" type="button" id="simgo">Simular</button></div>`}
    </form>`);
  }

  // Vuelve a dibujar el compositor sin perder lo tipeado (texto, plantilla, simulador) ni el foco
  function redrawComposer() {
    const kept = new Map();
    let focus = null;
    for (const el of $('#send')?.querySelectorAll('input, textarea') || []) {
      const key = el.name || el.id;
      if (!key) continue;
      kept.set(key, el.value);
      if (el === document.activeElement) focus = { key, from: el.selectionStart, to: el.selectionEnd };
    }
    drawComposer();
    for (const el of $('#send')?.querySelectorAll('input, textarea') || []) {
      const key = el.name || el.id;
      if (kept.has(key)) el.value = kept.get(key);
      if (focus && focus.key === key) { el.focus(); try { el.setSelectionRange(focus.from, focus.to); } catch { /* no todos los inputs lo permiten */ } }
    }
  }

  function drawThread(scroll = true) {
    const c = thread.contact;
    $('#thread').innerHTML = '';
    mount($('#thread'), html`<div class="thread-head"><button class="btn icon ghost back" id="back" aria-label="Volver">${icon('back')}</button>
        <div class="avatar">${initials(c.name)}</div>
        <div class="grow"><b>${c.name}</b><div class="muted small">${c.phone_display}${c.child_name ? ` · ${c.child_name}` : ''}</div></div>
        <select class="status" id="tstatus" style="--c:${statusInfo(c.status).color}" aria-label="Estado">${statusOptions(c.status)}</select>
        <a class="btn icon ghost" href="${waLink(c.phone)}" target="_blank" rel="noopener" title="Abrir en WhatsApp" aria-label="Abrir en WhatsApp">${icon('wa')}</a></div>
      <div class="msgs" id="msgs"></div><div class="composer" id="composer"></div>`);
    drawMessages(scroll);
    drawComposer();
    $('#inbox').classList.add('open');
  }

  const unreadTotal = () => convs.reduce((n, c) => n + c.unread, 0);

  async function loadConvs() {
    convs = await get('/api/conversations');
    lastUnread = unreadTotal();
    drawList();
  }

  async function open(id) {
    const my = ++openSeq;
    const t = await get(`/api/contacts/${id}/messages`);
    if (my !== openSeq || gone) return; // mientras tanto abrió otro chat (o volvió a la lista)
    refreshSeq++; // un sondeo que venía de camino quedó viejo
    active = id;
    thread = t;
    lastSig = sig();
    const c = convs.find((x) => x.id === id);
    if (c) { c.unread = 0; lastUnread = unreadTotal(); } // pedir los mensajes ya los marcó como leídos en el servidor
    drawThread();
    drawList();
    pollUnread();
  }
  const sig = () => thread.messages.map((m) => `${m.id}:${m.status}`).join('|') + thread.window_open + thread.contact.opted_out;
  const composerSig = () => `${thread.window_open}${thread.contact.opted_out}`;

  async function refresh() {
    if (gone || document.hidden) return; // pedir los mensajes los marca como leídos: no hacerlo si nadie está mirando
    try { await sync(); fails = 0; $('#conn').classList.add('hidden'); } catch (err) {
      if (++fails >= 2) $('#conn').classList.remove('hidden'); // la API no responde: que se note en vez de parecer que no hay novedades
      throw err;
    }
  }

  async function sync() {
    const id = active;
    const my = ++refreshSeq;
    const fresh = id ? await get(`/api/contacts/${id}/messages`) : null; // primero los mensajes, así la lista ya trae el chat abierto como leído
    const list = await get('/api/conversations');
    if (gone || my !== refreshSeq || id !== active) return;
    convs = list;
    drawList();
    const unread = unreadTotal();
    if (unread !== lastUnread) { lastUnread = unread; pollUnread(); }
    if (!fresh) return;
    const before = sig();
    const beforeComposer = composerSig();
    thread = fresh;
    const sel = $('#tstatus'); // una automatización pudo cambiar el estado (ej: respondió «SI»)
    if (sel && sel.value !== thread.contact.status) { sel.value = thread.contact.status; sel.style.setProperty('--c', statusInfo(thread.contact.status).color); }
    if (sig() !== before) drawMessages(false);
    if (composerSig() !== beforeComposer) redrawComposer(); // solo si cambió algo que lo afecta (ventana de 24 h, baja)
  }

  $('#clist').addEventListener('click', (e) => { const r = e.target.closest('[data-open]'); if (r) open(Number(r.dataset.open)).catch(fail); });
  $('#clist').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.click?.(); });
  view.addEventListener('click', async (e) => {
    if (e.target.closest('#back')) { openSeq++; $('#inbox').classList.remove('open'); active = null; drawList(); }
    if (e.target.closest('#simgo')) {
      const input = $('#sim');
      if (!input.value.trim()) return;
      try { await post('/api/dev/inbound', { contact_id: thread.contact.id, text: input.value }); input.value = ''; setTimeout(() => refresh().catch(() => {}), 900); } catch (err) { fail(err); }
    }
  });
  view.addEventListener('change', async (e) => {
    if (e.target.id === 'tstatus') {
      try { await put(`/api/contacts/${thread.contact.id}`, { status: e.target.value }); e.target.style.setProperty('--c', statusInfo(e.target.value).color); toast('Estado actualizado', 'good'); } catch (err) { fail(err); }
    }
  });
  view.addEventListener('submit', async (e) => {
    if (e.target.id !== 'send') return;
    e.preventDefault();
    if (sending) return;
    const form = e.target;
    const field = form.elements.text; // fuera de las 24 h no hay campo de texto: solo plantilla
    const text = field ? field.value.trim() : '';
    const template = readTemplate(form);
    if (!text && !template) return;
    if (!thread.window_open && !template) return toast('Fuera de las 24 h hace falta una plantilla', 'bad');
    const to = thread.contact.id; // el chat que se ve en pantalla
    sending = true;
    form.querySelector('button[type=submit]').disabled = true;
    if (field) field.value = ''; // se vacía antes de esperar: otro Enter no reenvía lo mismo
    try {
      await post(`/api/contacts/${to}/messages`, { text, template });
      setTimeout(() => refresh().catch(() => {}), 700);
    } catch (err) {
      fail(err);
      const box = text && !gone && thread.contact.id === to ? $('#send textarea') : null; // el compositor pudo haberse redibujado
      if (box) box.value = box.value ? `${text}\n${box.value}` : text;
    }
    sending = false;
    const btn = $('#send button[type=submit]');
    if (btn) btn.disabled = false;
  });
  view.addEventListener('keydown', (e) => {
    // Enter envía solo con mouse (puntero preciso): en el celular tiene que poder escribir un salto de línea (está el botón Enviar);
    // y con un teclado predictivo (IME) Enter confirma la palabra
    if (e.target.name === 'text' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && matchMedia('(pointer: fine)').matches) { e.preventDefault(); e.target.form.requestSubmit(); }
  });

  await loadConvs();
  const wanted = Number(sessionStorage.getItem('crm:open_chat'));
  sessionStorage.removeItem('crm:open_chat');
  if (wanted) await open(wanted).catch(fail);
  else if (convs[0] && !document.hidden && matchMedia('(min-width: 861px)').matches) await open(convs[0].id).catch(fail);
  else mount($('#thread'), html`<div class="empty"><div class="big">🎈</div><p>Elegí una conversación</p></div>`);

  const stop = poll(refresh, 15000);
  return () => { gone = true; stop(); };
}
