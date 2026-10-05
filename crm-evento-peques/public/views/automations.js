import {
  state, html, raw, mount, get, post, put, del, icon, toast, fail, modal, confirmBox, statusInfo, statusOptions,
  variableChips, wireVariableChips, templateFields, readTemplate, sampleVars, renderText,
} from '../lib.js';

const UNITS = [['minutos', 1], ['horas', 60], ['días', 1440]];

function fmtOffset(min) {
  if (min >= 1440 && min % 1440 === 0) { const n = min / 1440; return `${n} ${n === 1 ? 'día' : 'días'}`; }
  if (min >= 60 && min % 60 === 0) { const n = min / 60; return `${n} ${n === 1 ? 'hora' : 'horas'}`; }
  return `${min} ${min === 1 ? 'minuto' : 'minutos'}`;
}

function audience(f = {}) {
  const parts = [];
  if (f.statuses?.length) parts.push(f.statuses.map((s) => statusInfo(s).label).join(', '));
  if (f.tags?.length) parts.push(`etiqueta ${f.tags.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'todos';
}

function describe(a) {
  const c = a.config;
  switch (a.trigger) {
    case 'contact_created': return `Cuando se agrega un contacto${c.delay_minutes ? ` (espera ${fmtOffset(c.delay_minutes)})` : ''}`;
    case 'status_changed': return `Cuando un contacto pasa a «${statusInfo(c.status).label}»`;
    case 'before_event': return `${fmtOffset(c.offset_minutes)} antes del evento · a: ${audience(c.filter)}`;
    case 'after_event': return `${fmtOffset(c.offset_minutes)} después del evento · a: ${audience(c.filter)}`;
    case 'keyword': {
      const acts = [c.set_status && `pasa a «${statusInfo(c.set_status).label}»`, c.add_tag && `etiqueta ${c.add_tag}`, c.opt_out && 'se da de baja'].filter(Boolean);
      return `Si responde: ${c.keywords.map((k) => `«${k}»`).join(', ')}${acts.length ? ` → ${acts.join(', ')}` : ''}`;
    }
    default: return a.trigger;
  }
}

export async function render(view) {
  let list = [];
  mount(view, html`<div class="page-head"><div><h1>Automatizaciones</h1><p>Mensajes que salen solos: bienvenida, recordatorios antes del evento y respuestas a palabras clave como «SI» o «BAJA».</p></div>
    <button class="btn primary" id="new">${icon('plus')} Nueva automatización</button></div>
    <div class="banner info" style="margin-bottom:1rem"><div><b>Cómo funciona</b>Cada familia recibe cada automatización <b>una sola vez</b>. Los recordatorios usan la fecha del evento de <a href="#/ajustes">Ajustes</a>. Vienen apagadas para que revises los textos antes de activarlas.</div></div>
    <div class="stack" id="list"></div>`);
  const $ = (s) => view.querySelector(s);

  function draw() {
    mount($('#list'), list.map((a) => html`<div class="card">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
        <label class="switch" title="${a.active ? 'Activa' : 'Apagada'}"><input type="checkbox" data-toggle="${a.id}" ${a.active ? raw('checked') : ''} aria-label="Activar ${a.name}"><i></i></label>
        <div class="grow"><h3>${a.name}</h3><div class="muted small">${describe(a)}</div></div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn icon ghost" data-edit="${a.id}" aria-label="Editar" title="Editar">${icon('edit')}</button><button class="btn icon ghost" data-del="${a.id}" aria-label="Eliminar" title="Eliminar">${icon('trash')}</button></div></div>
      ${a.body ? html`<div class="small" style="margin-top:.7rem;white-space:pre-wrap;background:var(--surface-2);border-radius:12px;padding:.55rem .75rem">${a.body}</div>` : ''}
      ${a.template ? html`<div class="small muted" style="margin-top:.4rem">Plantilla de WhatsApp: <span class="chip">${a.template.name}</span> variables: ${a.template.params.join(', ') || '—'}</div>` : ''}</div>`));
  }
  async function load() { list = await get('/api/automations'); draw(); }

  function editor(a = null) {
    const isNew = !a;
    let trigger = a?.trigger || 'before_event';
    const cur = a?.config || {};
    const offUnit = [...UNITS].reverse().find(([, m]) => cur.offset_minutes >= m && cur.offset_minutes % m === 0) || UNITS[1];

    const cfgHtml = (t) => {
      switch (t) {
        case 'contact_created': return html`<label class="f"><span>Esperar antes de enviar <small>(minutos, 0 = enseguida)</small></span><input type="number" min="0" name="delay" value="${cur.delay_minutes || 0}"></label>`;
        case 'status_changed': return html`<div class="cols2"><label class="f"><span>Cuando pasa a</span><select name="status">${statusOptions(cur.status || 'confirmado')}</select></label>
          <label class="f"><span>Esperar <small>(minutos)</small></span><input type="number" min="0" name="delay" value="${cur.delay_minutes || 0}"></label></div>`;
        case 'before_event':
        case 'after_event': return html`<div class="stack-sm"><div class="cols2"><label class="f"><span>Cuánto ${t === 'before_event' ? 'antes' : 'después'} del evento</span>
            <div class="row" style="flex-wrap:nowrap"><input type="number" min="0" name="amount" value="${cur.offset_minutes === undefined ? 1 : cur.offset_minutes / offUnit[1]}" required><select name="unit" style="width:auto">${UNITS.map(([l, m]) => html`<option value="${m}" ${m === offUnit[1] ? raw('selected') : ''}>${l}</option>`)}</select></div></label></div>
          <b class="small">¿A quiénes?</b><div class="row">${state.meta.statuses.map((s) => html`<label class="check"><input type="checkbox" name="st" value="${s.id}" ${(cur.filter?.statuses || (t === 'before_event' ? ['confirmado'] : [])).includes(s.id) ? raw('checked') : ''}><span class="badge" style="--c:${s.color}">${s.label}</span></label>`)}</div>
          <label class="f"><span>Con etiqueta <small>(opcional)</small></span><input type="text" name="tags" value="${(cur.filter?.tags || []).join(', ')}"></label>
          <div class="small muted">Sin marcar ningún estado se envía a todos. ${t === 'before_event' ? 'Si el servidor estuvo apagado, los recordatorios salen hasta 6 h tarde; después ya no.' : ''}</div></div>`;
        case 'keyword': return html`<div class="stack-sm"><label class="f"><span>Palabras clave <small>(separadas por coma; no importan mayúsculas ni tildes)</small></span><textarea name="keywords" rows="2" required>${(cur.keywords || []).join(', ')}</textarea></label>
          <div class="cols3"><label class="f"><span>Cambiar estado a</span><select name="set_status"><option value="">— no cambiar —</option>${statusOptions(cur.set_status || '')}</select></label>
            <label class="f"><span>Agregar etiqueta</span><input type="text" name="add_tag" value="${cur.add_tag || ''}"></label>
            <label class="check" style="align-self:end;padding-bottom:.5rem"><input type="checkbox" name="opt_out" ${cur.opt_out ? raw('checked') : ''}><span>Dar de baja (no más mensajes)</span></label></div>
          <div class="small muted">Se compara con el inicio de la respuesta: «Sí, vamos» activa «si». Si coinciden varias, gana la palabra más larga.</div></div>`;
        default: return '';
      }
    };

    const m = modal({
      title: isNew ? 'Nueva automatización' : 'Editar automatización', wide: true,
      body: html`<form id="af" class="stack" autocomplete="off">
        <div class="cols2"><label class="f"><span>Nombre</span><input type="text" name="name" required value="${a?.name || ''}" autofocus></label>
          <label class="f"><span>¿Cuándo se dispara?</span><select name="trigger">${Object.entries(state.meta.triggers).map(([k, l]) => html`<option value="${k}" ${k === trigger ? raw('selected') : ''}>${l}</option>`)}</select></label></div>
        <div id="cfg" class="stack-sm"></div>
        <div class="cols2" style="align-items:start">
          <div class="stack-sm"><label class="f"><span>Mensaje <small>(texto libre: se usa dentro de las 24 h de la última respuesta)</small></span><textarea name="body" id="abody" rows="7">${a?.body || ''}</textarea></label>${variableChips('abody')}</div>
          <div><div class="small muted" style="margin-bottom:.3rem">Vista previa (datos de ejemplo)</div><div class="bubble out txt" id="aprev" style="max-width:100%"></div></div></div>
        ${templateFields(a?.template)}
        ${isNew && html`<label class="check"><input type="checkbox" name="active"><span>Activarla ahora</span></label>`}
      </form>`,
      foot: html`<button class="btn" data-close type="button">Cancelar</button><button class="btn primary" type="submit" form="af">Guardar</button>`,
      onMount: (el) => {
        const form = el.querySelector('#af');
        wireVariableChips(el);
        const drawCfg = () => mount(el.querySelector('#cfg'), cfgHtml(trigger));
        const prev = () => { el.querySelector('#aprev').textContent = renderText(form.elements.body.value, sampleVars()) || '…'; };
        drawCfg();
        prev();
        form.elements.trigger.addEventListener('change', (e) => { trigger = e.target.value; drawCfg(); });
        form.addEventListener('input', prev);
        form.onsubmit = async (e) => {
          e.preventDefault();
          const fd = form.elements;
          const tags = fd.tags ? fd.tags.value : '';
          const config = {
            contact_created: () => ({ delay_minutes: Number(fd.delay.value) || 0 }),
            status_changed: () => ({ status: fd.status.value, delay_minutes: Number(fd.delay.value) || 0 }),
            before_event: () => ({ offset_minutes: Math.round(Number(fd.amount.value) * Number(fd.unit.value)), filter: { statuses: [...form.querySelectorAll('[name=st]:checked')].map((i) => i.value), tags: tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean) } }),
            keyword: () => ({ keywords: fd.keywords.value, set_status: fd.set_status.value || undefined, add_tag: fd.add_tag.value || undefined, opt_out: fd.opt_out.checked }),
          };
          config.after_event = config.before_event;
          const payload = { name: fd.name.value, trigger, config: config[trigger](), body: fd.body.value, template: readTemplate(form) || null };
          if (isNew) payload.active = fd.active.checked;
          const btn = el.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            if (isNew) await post('/api/automations', payload); else await put(`/api/automations/${a.id}`, payload);
            toast('Guardado', 'good');
            m.close();
            load();
          } catch (err) { fail(err); btn.disabled = false; }
        };
      },
    });
  }

  view.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.dataset.toggle) return;
    const a = list.find((x) => x.id === Number(t.dataset.toggle));
    try {
      const r = await post(`/api/automations/${a.id}/toggle`, { active: t.checked });
      a.active = r.active;
      toast(r.active ? `«${a.name}» activada` : `«${a.name}» apagada`, r.active ? 'good' : '');
      if (r.active && /event$/.test(a.trigger) && !state.meta.settings.event_at_local) toast('Falta cargar la fecha y hora del evento en Ajustes', 'bad');
      if (r.active && a.trigger === 'contact_created') toast('Se enviará a los contactos que se agreguen de ahora en adelante');
    } catch (err) { fail(err); t.checked = !t.checked; }
  });
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-edit],[data-del],#new');
    if (!b) return;
    if (b.id === 'new') return editor();
    if (b.dataset.edit) return editor(list.find((x) => x.id === Number(b.dataset.edit)));
    const a = list.find((x) => x.id === Number(b.dataset.del));
    if (await confirmBox(`¿Eliminar la automatización «${a.name}»?`, 'Eliminar', true)) {
      try { await del(`/api/automations/${a.id}`); toast('Eliminada'); load(); } catch (err) { fail(err); }
    }
  });

  await load();
}
