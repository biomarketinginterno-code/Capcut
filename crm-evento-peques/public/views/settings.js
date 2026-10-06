import { state, html, mount, get, put, post, toast, fail, icon, setToken, confirmBox } from '../lib.js';

export async function render(view, ctx) {
  const { refreshMeta } = ctx;
  await refreshMeta().catch(() => {}); // los avisos de WhatsApp (envíos en pausa, etc.) cambian solos: se muestran los de ahora
  const meta = state.meta;
  const s = meta.settings;
  const wa = meta.whatsapp;
  const editable = Boolean(meta.credentials_editable); // en la nube las credenciales se cargan acá; con servidor propio van en variables de entorno
  const cfg = editable ? await get('/api/whatsapp/config') : null;
  const webhookUrl = meta.webhook_url || `${location.origin}${meta.webhook_path}`;
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [s.timezone];
  const bannerClass = wa.mode === 'cloud' && wa.ready ? 'good' : wa.mode === 'cloud' ? 'bad' : 'warn';
  const paused = (wa.issues || []).some((i) => /en pausa/.test(i)); // la cola frena todo cuando WhatsApp rechaza la cuenta (token vencido, etc.)
  const waTitle = wa.mode !== 'cloud' ? 'Modo simulación' : wa.ready ? 'Conectado a WhatsApp Cloud API' : 'WhatsApp conectado, pero hay algo para revisar';

  mount(view, html`
    <div class="page-head"><div><h1>Ajustes</h1><p>Datos del evento (se usan en los mensajes), conexión con WhatsApp y tu cuenta.</p></div></div>
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
        <div class="banner ${bannerClass}"><div><b>${waTitle}</b>${paused ? '' : wa.message}${(wa.issues || []).map((i) => html`<div>• ${i}</div>`)}${paused && html`<div class="small">Los mensajes quedan en espera y se reintentan solos cada 10 minutos; el aviso se borra cuando WhatsApp vuelva a aceptar envíos.${editable ? ' Si el problema es el token, cargá uno nuevo acá abajo.' : ''}</div>`}</div></div>

        ${editable && html`<form id="wcf" class="stack-sm" autocomplete="off">
          <h3>Datos de tu cuenta de WhatsApp (Meta)</h3>
          ${cfg.from_env && html`<div class="banner info"><div>Estos datos están fijados por variables de la función en Supabase y tienen prioridad sobre lo que cargues acá.</div></div>`}
          <label class="f"><span>Token de acceso permanente</span><input type="password" name="token" autocomplete="new-password" placeholder="${cfg.token_set ? '•••••••• guardado (dejalo vacío para no cambiarlo)' : 'Pegá el token que te da Meta'}"></label>
          <div class="cols2"><label class="f"><span>ID del número de teléfono <small>(Phone number ID)</small></span><input type="text" name="phone_number_id" value="${cfg.phone_number_id}" inputmode="numeric" placeholder="1234567890"></label>
            <label class="f"><span>Clave secreta de la app <small>(App Secret)</small></span><input type="password" name="app_secret" autocomplete="new-password" placeholder="${cfg.app_secret_set ? '•••••••• guardada' : 'Pegá el App Secret'}"></label></div>
          <div class="small muted">Los secretos se guardan en tu base de datos de Supabase, que la API pública no puede leer, y este panel nunca los vuelve a mostrar. Dónde conseguirlos: README, sección «Conectar tu WhatsApp real».</div>
          <div class="row"><button class="btn primary" type="submit">Guardar datos de WhatsApp</button>${cfg.token_set && html`<button class="btn danger" type="button" id="wclear">Desconectar</button>`}</div>
        </form>`}

        <div class="stack-sm"><b class="small">Para registrar el webhook en Meta (WhatsApp → Configuración):</b>
          <label class="f"><span>URL de devolución de llamada <small>(Callback URL)</small></span><div class="row" style="flex-wrap:nowrap"><input type="text" readonly value="${webhookUrl}" id="wh"><button class="btn" type="button" data-copy="wh">Copiar</button></div></label>
          ${editable
            ? html`<label class="f"><span>Token de verificación <small>(Verify token)</small></span><div class="row" style="flex-wrap:nowrap"><input type="text" readonly value="${cfg.verify_token}" id="vt"><button class="btn" type="button" data-copy="vt">Copiar</button></div></label>`
            : html`<div class="small muted">Meta te pide también un <b>token de verificación</b>: es el texto que pusiste en <code>WHATSAPP_VERIFY_TOKEN</code>. ${location.protocol === 'https:' ? '' : html`<b>Ojo:</b> Meta exige una dirección pública con HTTPS; en <code>localhost</code> no funciona (mirá el README).`}</div>`}
          <div class="small muted">Después de verificar, suscribite al campo <b>messages</b>.</div></div>

        <form id="tf" class="row" style="align-items:flex-end"><label class="f grow"><span>Enviar un mensaje de prueba a este número</span><input type="tel" name="phone" placeholder="223 456-7890" required></label><button class="btn" type="submit">${icon('send')} Probar</button></form>
        <div class="small muted">${wa.mode === 'cloud' ? 'Envía la plantilla «hello_world» que Meta incluye en toda cuenta. Si usás el número de prueba de Meta, el destinatario tiene que estar en la lista de permitidos.' : 'En simulación no se envía nada real.'}</div>
      </div>

      ${editable && html`<form class="card stack-sm" id="pwf" autocomplete="off"><h2>Tu cuenta</h2>
        <div class="small muted">Cambiar la contraseña cierra las sesiones abiertas en otros dispositivos.</div>
        <div class="cols3"><label class="f"><span>Contraseña actual</span><input type="password" name="current" autocomplete="current-password" required></label>
          <label class="f"><span>Contraseña nueva <small>(8 o más)</small></span><input type="password" name="next" autocomplete="new-password" minlength="8" required></label>
          <label class="f"><span>Repetila</span><input type="password" name="again" autocomplete="new-password" minlength="8" required></label></div>
        <div><button class="btn" type="submit">Cambiar contraseña</button></div></form>`}
    </div>`);

  const again = () => render(view, ctx); // vuelve a pedir los datos y redibuja

  // Un formulario no se envía dos veces: mientras hay uno en vuelo se ignoran otros envíos (doble clic, Enter repetido)
  // y los botones quedan apagados. Si falla se reactivan; el error se avisa acá.
  const once = (fn) => async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.busy) return;
    form.dataset.busy = '1';
    const btns = [...form.querySelectorAll('button[type=submit]')];
    btns.forEach((b) => { b.disabled = true; });
    try { await fn(form.elements, form); } catch (err) { fail(err); } finally { delete form.dataset.busy; btns.forEach((b) => { b.disabled = false; }); }
  };

  view.querySelector('#evf').onsubmit = once(async (f, form) => {
    await put('/api/settings', Object.fromEntries(new FormData(form)));
    await refreshMeta();
    toast('Ajustes guardados', 'good');
  });

  view.onclick = async (e) => { // onclick (no addEventListener): al redibujar la pantalla se reemplaza, no se acumula
    const b = e.target.closest('[data-copy],#wclear');
    if (!b || b.disabled) return;
    if (b.id === 'wclear') {
      if (!(await confirmBox('¿Desconectar WhatsApp? Se borran el token, el ID del número y el App Secret, y el CRM vuelve al modo simulación.', 'Desconectar', true))) return;
      b.disabled = true;
      try { await put('/api/whatsapp/config', { clear: true }); toast('WhatsApp desconectado'); await again(); } catch (err) { fail(err); b.disabled = false; }
      return;
    }
    const input = view.querySelector(`#${b.dataset.copy}`);
    try { await navigator.clipboard.writeText(input.value); toast('Copiado', 'good'); } catch { input.select(); toast('Copialo con Ctrl+C'); }
  };

  view.querySelector('#tf').onsubmit = once(async (f) => {
    const r = await post('/api/whatsapp/test', { phone: f.phone.value });
    toast(r.message, 'good');
  });

  if (editable) {
    view.querySelector('#wcf').onsubmit = once(async (f) => {
      await put('/api/whatsapp/config', { token: f.token.value, phone_number_id: f.phone_number_id.value, app_secret: f.app_secret.value });
      toast('Datos de WhatsApp guardados', 'good');
      await again();
    });
    view.querySelector('#pwf').onsubmit = once(async (f, form) => {
      if (f.next.value !== f.again.value) return toast('Las contraseñas nuevas no coinciden', 'bad');
      const r = await put('/api/password', { current: f.current.value, next: f.next.value });
      if (r.token) setToken(r.token); // la sesión anterior quedó invalidada: seguimos con la nueva
      form.reset();
      toast('Contraseña cambiada', 'good');
    });
  }
}
