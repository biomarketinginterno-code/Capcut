import { state, html, mount, get, icon, statusInfo } from '../lib.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function countdown(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return { n: '🎉', l: 'el evento ya empezó' };
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return { n: days, l: days === 1 ? 'día para el evento' : 'días para el evento' };
  const h = Math.floor(ms / 3600000);
  return { n: h, l: h === 1 ? 'hora para el evento' : 'horas para el evento' };
}

export async function render(view) {
  const [s, autos] = await Promise.all([get('/api/stats'), get('/api/automations')]);
  const wa = state.meta.whatsapp;
  const ev = s.event;
  const cd = countdown(ev.at);
  const max = Math.max(1, ...Object.values(s.by_status));
  const m = s.messages_7d;
  const hasAuto = autos.some((a) => a.active && a.trigger !== 'keyword');

  const steps = [
    { done: Boolean(ev.at), t: 'Cargá la fecha y el lugar del evento', href: '#/ajustes' },
    { done: s.total > 0, t: 'Importá o agregá tus contactos', href: '#/contactos' },
    { done: wa.mode === 'cloud', t: 'Conectá tu número de WhatsApp (hoy está en simulación)', href: '#/ajustes' },
    { done: hasAuto, t: 'Activá las automatizaciones (bienvenida y recordatorios)', href: '#/automatizaciones' },
  ];
  const pending = steps.filter((x) => !x.done).length;

  mount(view, html`
    <div class="page-head"><div><h1>Panel</h1><p>Resumen del evento y de tus mensajes.</p></div>
      <div class="row"><a class="btn" href="#/contactos">${icon('upload')} Importar contactos</a><a class="btn primary" href="#/campanas">${icon('send')} Nueva campaña</a></div></div>
    <div class="stack">
      <div class="card hero"><div><h2>${ev.name || 'Tu evento'}</h2>
        <p>${ev.at ? html`${new Date(ev.at).toLocaleString('es-AR', { timeZone: ev.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}${ev.place ? ` · ${ev.place}` : ''}` : html`Todavía no cargaste la fecha · <a href="#/ajustes" style="color:#fff">configurarla</a>`}</p></div>
        ${cd && html`<div class="count">${cd.n}<small>${cd.l}</small></div>`}</div>

      ${wa.mode !== 'cloud' && html`<div class="banner warn"><div><b>WhatsApp en modo simulación</b>Todo funciona, pero los mensajes no salen de verdad. ${state.meta.credentials_editable ? html`Para conectar tu número cargá tus datos de WhatsApp en <a href="#/ajustes">Ajustes</a>.` : 'Para conectar tu número seguí la guía del README y cargá las variables WHATSAPP_*.'}</div></div>`}
      ${wa.mode === 'cloud' && wa.issues?.length ? html`<div class="banner bad"><div><b>WhatsApp conectado, pero incompleto</b>${wa.issues.join(' ')}</div></div>` : ''}

      <div class="grid kpis">
        <div class="card kpi"><div class="l">Contactos</div><div class="n">${s.total}</div><div class="s">${s.opted_out ? `${s.opted_out} pidieron la baja` : 'ninguna baja'}</div></div>
        <div class="card kpi"><div class="l">Confirmados</div><div class="n">${s.by_status.confirmado}</div><div class="s">${s.kids_confirmed} peques en total</div></div>
        <div class="card kpi"><div class="l">Mensajes enviados (7 días)</div><div class="n">${m.sent}</div><div class="s">${pct(m.delivered, m.sent)}% entregados · ${pct(m.read, m.sent)}% leídos${m.failed ? ` · ${m.failed} fallidos` : ''}</div></div>
        <div class="card kpi"><div class="l">Respuestas (7 días)</div><div class="n">${s.replies_7d}</div><div class="s">${s.unread ? html`<a href="#/conversaciones">${s.unread} sin leer</a>` : 'todo al día'}${s.pending ? ` · ${s.pending} en cola` : ''}</div></div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div class="card"><h2>Embudo de asistencia</h2><div class="funnel">
          ${state.meta.statuses.map((st) => html`<div class="r"><span>${st.label}</span><div class="bar"><i style="width:${pct(s.by_status[st.id], max)}%;--c:${statusInfo(st.id).color}"></i></div><b class="right">${s.by_status[st.id]}</b></div>`)}</div></div>
        <div class="card"><h2>${pending ? `Para dejarlo andando (${pending} pendiente${pending > 1 ? 's' : ''})` : '¡Todo listo! 🎉'}</h2>
          <ul class="steps">${steps.map((x, i) => html`<li class="${x.done ? 'done' : ''}"><span class="dot">${x.done ? icon('check') : i + 1}</span><span class="t grow">${x.done ? x.t : html`<a href="${x.href}">${x.t}</a>`}</span></li>`)}</ul></div>
      </div>
    </div>`);
}
