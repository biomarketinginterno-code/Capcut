import {
  state, html, raw, mount, get, post, icon, toast, fail, modal, confirmBox, statusInfo, fmtDateTime,
  variableChips, wireVariableChips, templateFields, readTemplate, sampleVars, renderText, debounce, poll,
} from '../lib.js';

const DEFAULT_BODY = '¡Hola {{nombre}}! 🎈 Te contamos novedades de *{{evento}}*: será el {{fecha}} a las {{hora}} en {{lugar}}. ¡Los esperamos! Si no querés recibir más mensajes, respondé BAJA.';

function describeFilter(f = {}) {
  const parts = [];
  if (f.ids?.length) parts.push(`${f.ids.length} contactos elegidos a mano`);
  if (f.statuses?.length) parts.push(`estado: ${f.statuses.map((s) => statusInfo(s).label).join(', ')}`);
  if (f.tags?.length) parts.push(`etiqueta: ${f.tags.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'todos los contactos';
}

export async function render(view) {
  let list = [];
  mount(view, html`<div class="page-head"><div><h1>Campañas</h1><p>Mandá un mensaje a un grupo de familias (por estado o etiqueta), ahora o programado.</p></div>
    <button class="btn primary" id="new">${icon('plus')} Nueva campaña</button></div><div class="stack" id="list"></div>`);
  const $ = (s) => view.querySelector(s);

  function draw() {
    if (!list.length) {
      return mount($('#list'), html`<div class="card empty"><div class="big">📣</div><h3>Todavía no mandaste ninguna campaña</h3><p>Por ejemplo: avisar a todos los «Interesados» que quedan pocos lugares.</p><button class="btn primary" data-act="new">${icon('plus')} Crear la primera</button></div>`);
    }
    mount($('#list'), list.map((c) => {
      const s = c.stats;
      const done = s.sent + s.failed;
      const pct = (n) => (c.total ? (n / c.total) * 100 : 0);
      const future = Date.parse(c.scheduled_at) > Date.now() && s.pending > 0;
      return html`<div class="card"><div class="row"><div class="grow"><h3>${c.name} ${c.cancelled ? html`<span class="badge" style="--c:var(--muted)">cancelada</span>` : future ? html`<span class="badge" style="--c:var(--info)">programada</span>` : s.pending ? html`<span class="badge" style="--c:var(--warn)">enviando…</span>` : html`<span class="badge" style="--c:var(--good)">enviada</span>`}</h3>
          <div class="muted small">${future ? `Sale el ${fmtDateTime(c.scheduled_at)}` : `Creada el ${fmtDateTime(c.created_at)}`} · ${c.total} destinatarios · ${describeFilter(c.filter)}</div></div>
        ${s.pending > 0 && html`<button class="btn sm danger" data-cancel="${c.id}">Cancelar pendientes</button>`}</div>
        <div class="bar" style="margin:.9rem 0" title="${done} de ${c.total} procesados"><i style="width:${pct(s.read)}%;--c:var(--good)"></i><i style="width:${pct(s.delivered - s.read)}%;--c:#34d399"></i><i style="width:${pct(s.sent - s.delivered)}%;--c:var(--primary)"></i><i style="width:${pct(s.failed)}%;--c:var(--bad)"></i></div>
        <div class="row small"><span><b>${s.sent}</b> enviados</span><span><b>${s.delivered}</b> entregados</span><span><b>${s.read}</b> leídos</span>${s.failed ? html`<span style="color:var(--bad)"><b>${s.failed}</b> fallidos</span>` : ''}${s.pending ? html`<span><b>${s.pending}</b> pendientes</span>` : ''}${s.cancelled ? html`<span><b>${s.cancelled}</b> cancelados</span>` : ''}</div>
        <details style="margin-top:.6rem"><summary class="small" style="cursor:pointer">Ver mensaje${c.template ? ` (plantilla ${c.template.name})` : ''}</summary><p class="small" style="white-space:pre-wrap">${c.body || '(solo plantilla)'}</p></details>
        ${s.failed ? html`<p class="small muted" style="margin:.4rem 0 0">Para ver por qué falló cada envío abrí la conversación del contacto.</p>` : ''}</div>`;
    }));
  }

  async function load() { list = await get('/api/campaigns'); draw(); }

  async function newCampaign(preIds = null) {
    const tags = await get('/api/tags');
    const m = modal({
      title: 'Nueva campaña', wide: true,
      body: html`<form id="cf" class="stack" autocomplete="off">
        <label class="f"><span>Nombre <small>(solo para vos)</small></span><input type="text" name="name" required placeholder="Aviso de lugares disponibles" autofocus></label>
        ${preIds ? html`<div class="banner info"><div><b>${preIds.length} contacto${preIds.length === 1 ? '' : 's'} elegido${preIds.length === 1 ? '' : 's'} a mano</b>Se enviará solo a esas familias.</div></div>` : html`
          <div class="stack-sm"><b class="small">¿A quiénes?</b>
            <div class="row">${state.meta.statuses.map((s) => html`<label class="check"><input type="checkbox" name="st" value="${s.id}"><span class="badge" style="--c:${s.color}">${s.label}</span></label>`)}</div>
            <label class="f"><span>Con etiqueta <small>(opcional, separadas por coma)</small></span><input type="text" name="tags" list="tl" placeholder="vip, sala-1"></label><datalist id="tl">${tags.map((t) => html`<option value="${t.tag}">`)}</datalist>
            <div class="small muted">Sin marcar ningún estado se envía a todos.</div></div>`}
        <div id="count" class="banner info"><div>Calculando destinatarios…</div></div>
        <div class="cols2" style="align-items:start">
          <div class="stack-sm"><label class="f"><span>Mensaje</span><textarea name="body" id="body" rows="7">${DEFAULT_BODY}</textarea></label>${variableChips('body')}</div>
          <div><div class="small muted" style="margin-bottom:.3rem">Así lo ve la familia (con datos de ejemplo)</div><div class="bubble out txt" id="prev" style="max-width:100%"></div></div></div>
        ${templateFields(null)}
        <div class="stack-sm"><b class="small">¿Cuándo?</b>
          <label class="check"><input type="radio" name="when" value="now" checked><span>Ahora</span></label>
          <label class="check"><input type="radio" name="when" value="later"><span>Programar <input type="datetime-local" name="at" style="width:auto;margin-left:.4rem"></span></label></div>
        <div class="banner warn"><div><b>Ojo con las 24 horas</b>WhatsApp solo deja mandar texto libre a quien te escribió en las últimas 24 h. A todos los demás hay que enviarles una <b>plantilla aprobada</b>: completá la sección de plantilla de arriba. Las cuentas nuevas también tienen un tope diario de contactos nuevos.</div></div>
      </form>`,
      foot: html`<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" type="submit" form="cf" id="go">Enviar campaña</button>`,
      onMount: (el) => {
        const form = el.querySelector('#cf');
        wireVariableChips(el);
        const filter = () => (preIds ? { ids: preIds } : {
          statuses: [...form.querySelectorAll('[name=st]:checked')].map((i) => i.value),
          tags: form.elements.tags.value.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
        });
        const updatePreview = () => { el.querySelector('#prev').textContent = renderText(form.elements.body.value, sampleVars()) || '…'; };
        const go = el.querySelector('#go');
        let last = null;  // última vista previa del servidor (outside_window solo lo informa la versión en la nube)
        let counted = ''; // filtro al que corresponde `last`
        let asked = '';   // filtro del último pedido
        let seq = 0;      // número del último pedido: una respuesta vieja no pisa a la actual
        const late = () => last && last.outside_window > 0 && !form.elements.tpl_name.value.trim(); // texto libre a quien no escribió en 24 h
        const drawCount = () => {
          if (!last) return;
          const n = last.eligible;
          const warn = late();
          const notes = [warn && `${last.outside_window} no te escribieron en las últimas 24 h: sin plantilla el texto libre no les llega. Completá la plantilla.`,
            last.excluded_optout ? `${last.excluded_optout} más se excluyen porque pidieron la baja.` : 'Se excluyen automáticamente quienes pidieron la baja.'].filter(Boolean).join(' ');
          mount(el.querySelector('#count'), html`<div><b>${warn ? `Solo ${n - last.outside_window} de ${n} contactos recibirán este mensaje` : `${n} contacto${n === 1 ? '' : 's'} recibirá${n === 1 ? '' : 'n'} este mensaje`}</b>${notes}</div>`);
          el.querySelector('#count').className = `banner ${n === 0 ? 'bad' : warn ? 'warn' : 'info'}`;
        };
        const updateCount = debounce(async () => {
          const f = filter();
          const key = JSON.stringify(f);
          if (key === asked) return; // el filtro no cambió (se escribió en otro campo): no hace falta volver a pedir
          asked = key;
          const my = ++seq;
          go.disabled = true; // hasta que llegue el conteo no se puede enviar
          try {
            const r = await post('/api/campaigns/preview', { filter: f });
            if (my !== seq) return;
            last = r;
            counted = key;
            drawCount();
            go.disabled = r.eligible === 0;
          } catch (err) { if (my === seq) { asked = ''; fail(err); } }
        }, 250);
        form.addEventListener('input', () => { updatePreview(); drawCount(); updateCount(); });
        updatePreview();
        updateCount();
        form.onsubmit = async (e) => {
          e.preventDefault();
          const fd = form.elements;
          const later = form.querySelector('[name=when]:checked').value === 'later';
          if (later && !fd.at.value) return toast('Elegí cuándo se envía', 'bad');
          if (later && new Date(fd.at.value) <= Date.now() + 60000) return toast('Elegí una fecha y hora futura', 'bad');
          if (counted !== JSON.stringify(filter())) return toast('Esperá un momento: todavía se está calculando a quiénes les llega', 'bad');
          const n = last.eligible;
          if (!(await confirmBox(`Vas a enviar «${fd.name.value}» a ${n} contacto${n === 1 ? '' : 's'}${late() ? ` (a ${last.outside_window} no les llega sin plantilla)` : ''}${later ? ` el ${new Date(fd.at.value).toLocaleString('es-AR')}` : ' ahora mismo'}. ¿Seguimos?`, 'Sí, enviar'))) return;
          go.disabled = true;
          try {
            await post('/api/campaigns', {
              name: fd.name.value, body: fd.body.value, filter: filter(), template: readTemplate(form),
              scheduled_at: later ? new Date(fd.at.value).toISOString() : undefined,
            });
            toast(later ? 'Campaña programada' : 'Campaña en marcha', 'good');
            m.close();
            load();
          } catch (err) { fail(err); go.disabled = false; }
        };
      },
    });
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel],[data-act],#new');
    if (!b) return;
    if (b.id === 'new' || b.dataset.act === 'new') return newCampaign();
    if (b.dataset.cancel && await confirmBox('¿Cancelar los envíos que todavía no salieron? Los ya enviados no se pueden deshacer.', 'Cancelar envíos', true)) {
      try { await post(`/api/campaigns/${b.dataset.cancel}/cancel`); toast('Envíos cancelados'); load(); } catch (err) { fail(err); }
    }
  });

  await load();
  const ids = JSON.parse(sessionStorage.getItem('crm:campaign_ids') || 'null');
  sessionStorage.removeItem('crm:campaign_ids');
  if (ids?.length) newCampaign(ids);

  return poll(async () => { if (list.some((c) => c.stats.pending > 0)) await load(); }, 15000);
}
