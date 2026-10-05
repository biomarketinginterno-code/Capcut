import { state, html, mount, put, post, toast, fail, icon } from '../lib.js';

export async function render(view, { refreshMeta }) {
  const s = state.meta.settings;
  const wa = state.meta.whatsapp;
  const webhookUrl = `${location.origin}${state.meta.webhook_path}`;
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [s.timezone];

  mount(view, html`
    <div class="page-head"><div><h1>Ajustes</h1><p>Datos del evento (se usan en los mensajes) y conexión con WhatsApp.</p></div></div>
    <div class="stack" style="max-width:820px">
      <form class="card stack" id="evf" autocomplete="off">
        <h2>El evento</h2>
        <div class="cols2"><label class="f"><span>Nombre del evento</span><input type="text" name="event_name" value="${s.event_name}" required></label>
          <label class="f"><span>Fecha y hora</span><input type="datetime-local" name="event_at_local" value="${s.event_at_local}"></label></div>
        <div class="cols2"><label class="f"><span>Lugar</span><input type="text" name="event_place" value="${s.event_place}" placeholder="Parque Camet"></label>
          <label class="f"><span>Dirección</span><input type="text" name="event_address" value="${s.event_address}" placeholder="Av. Constitución 1234"></label></div>
        <div class="cols3"><label class="f"><span>Zona horaria</span><input type="text" name="timezone" value="${s.timezone}" list="zones"></label><datalist id="zones">${zones.map((z) => html`<option value="${z}">`)}</datalist>
          <label class="f"><span>País por defecto <small>(código)</small></span><input type="text" name="default_country" value="${s.default_country}" inputmode="numeric"></label>
          <label class="f"><span>Código de área por defecto</span><input type="text" name="default_area" value="${s.default_area}" inputmode="numeric" placeholder="223"></label></div>
        <div class="small muted">El código de área se agrega a los teléfonos cargados sin él (por ejemplo «456-7890»). Los recordatorios usan la fecha y hora de acá: si la cambiás, los mensajes que todavía no salieron toman la nueva.</div>
        <div><button class="btn primary" type="submit">Guardar</button></div>
      </form>

      <div class="card stack"><h2>WhatsApp</h2>
        <div class="banner ${wa.mode === 'cloud' && wa.ready ? 'good' : wa.mode === 'cloud' ? 'bad' : 'warn'}"><div><b>${wa.mode === 'cloud' ? 'Conectado a WhatsApp Cloud API' : 'Modo simulación'}</b>${wa.message}${(wa.issues || []).map((i) => html`<div>• ${i}</div>`)}</div></div>
        <div class="stack-sm"><label class="f"><span>URL del webhook <small>(pegala en Meta → WhatsApp → Configuración)</small></span><div class="row" style="flex-wrap:nowrap"><input type="text" readonly value="${webhookUrl}" id="wh"><button class="btn" type="button" id="copy">Copiar</button></div></label>
          <div class="small muted">Meta te pide también un <b>token de verificación</b>: es el texto que pusiste en <code>WHATSAPP_VERIFY_TOKEN</code>. ${location.protocol === 'https:' ? '' : html`<b>Ojo:</b> Meta exige una dirección pública con HTTPS; en <code>localhost</code> no funciona (mirá el README).`}</div></div>
        <form id="tf" class="row" style="align-items:flex-end"><label class="f grow"><span>Enviar un mensaje de prueba a este número</span><input type="tel" name="phone" placeholder="223 456-7890" required></label><button class="btn" type="submit">${icon('send')} Probar</button></form>
        <div class="small muted">${wa.mode === 'cloud' ? 'Envía la plantilla «hello_world» que Meta incluye en toda cuenta. Si usás el número de prueba de Meta, el destinatario tiene que estar en la lista de permitidos.' : 'En simulación no se envía nada real.'}</div>
      </div>
    </div>`);

  view.querySelector('#evf').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await put('/api/settings', fd);
      await refreshMeta();
      toast('Ajustes guardados', 'good');
    } catch (err) { fail(err); }
  };
  view.querySelector('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(webhookUrl); toast('Copiado', 'good'); } catch { view.querySelector('#wh').select(); toast('Copialo con Ctrl+C'); }
  };
  view.querySelector('#tf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try { const r = await post('/api/whatsapp/test', { phone: e.target.phone.value }); toast(r.message, 'good'); } catch (err) { fail(err); }
    btn.disabled = false;
  };
}
