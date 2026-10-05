import { state, html, mount, get, post, icon, fail, toast, setToken } from './lib.js';

const ROUTES = [
  { id: 'panel', label: 'Panel', icon: 'home', load: () => import('./views/dashboard.js') },
  { id: 'contactos', label: 'Contactos', icon: 'users', load: () => import('./views/contacts.js') },
  { id: 'conversaciones', label: 'Chats', icon: 'chat', load: () => import('./views/inbox.js'), badge: true },
  { id: 'campanas', label: 'Campañas', icon: 'send', load: () => import('./views/campaigns.js') },
  { id: 'automatizaciones', label: 'Automático', icon: 'zap', load: () => import('./views/automations.js') },
  { id: 'ajustes', label: 'Ajustes', icon: 'sliders', load: () => import('./views/settings.js') },
];

const app = document.getElementById('app');
let cleanup = null;
let unreadTimer = null;

function showLogin(message = '') {
  clearInterval(unreadTimer);
  cleanup?.();
  cleanup = null;
  mount(app, html`<div class="login"><form class="card" id="login">
    <div class="logo">🎈</div><h1>CRM Peques</h1>
    <p class="muted" style="margin:0">Entrá con la contraseña del equipo</p>
    ${message && html`<div class="banner warn">${message}</div>`}
    <label class="f"><span class="sr">Contraseña</span><input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" autofocus required></label>
    <button class="btn primary" type="submit">Entrar</button></form></div>`);
  app.querySelector('#login').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await post('/api/login', { password: e.target.password.value });
      if (r.token) setToken(r.token); // en la nube la sesión es un token; con servidor propio es una cookie
      boot();
    } catch (err) {
      btn.disabled = false;
      e.target.password.select();
      fail(err);
    }
  };
}

async function loadMeta() {
  state.meta = await get('/api/meta');
}

async function boot() {
  try {
    const { authenticated } = await get('/api/session');
    if (!authenticated) return showLogin();
    await loadMeta();
  } catch (e) {
    return showLogin(e.message);
  }
  mount(app, html`<div class="shell">
    <aside class="side">
      <div class="brand"><div class="logo">🎈</div><div>CRM Peques</div></div>
      <nav class="nav">${ROUTES.map((r) => html`<a href="#/${r.id}" data-route="${r.id}">${icon(r.icon)}<span class="lbl">${r.label}</span>${r.badge && html`<span class="count hidden" id="unread-badge"></span>`}</a>`)}</nav>
      <div class="foot"><button class="btn sm ghost" id="logout">Cerrar sesión</button></div>
    </aside>
    <main id="view" tabindex="-1"></main></div>`);
  app.querySelector('#logout').onclick = async () => { await post('/api/logout').catch(() => {}); setToken(''); showLogin(); };
  pollUnread();
  clearInterval(unreadTimer);
  unreadTimer = setInterval(pollUnread, 8000);
  route();
}

async function pollUnread() {
  try {
    const { unread } = await get('/api/stats');
    const b = document.getElementById('unread-badge');
    if (b) { b.textContent = unread > 99 ? '99+' : unread; b.classList.toggle('hidden', !unread); }
  } catch { /* la sesión vencida se maneja en api() */ }
}

let renderToken = 0;
async function route() {
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'panel';
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  const old = document.getElementById('view');
  if (!old) return;
  const view = old.cloneNode(false); // contenedor nuevo: así no se acumulan listeners entre pantallas
  old.replaceWith(view);
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === r.id));
  document.title = `${r.label} · CRM Peques`;
  cleanup?.();
  cleanup = null;
  const token = ++renderToken;
  mount(view, html`<div class="empty muted">Cargando…</div>`);
  try {
    const mod = await r.load();
    if (token !== renderToken) return; // el usuario ya navegó a otra pantalla
    mount(view, '');
    const out = await mod.render(view, { refreshMeta: loadMeta, pollUnread });
    if (token === renderToken) cleanup = typeof out === 'function' ? out : null;
    else if (typeof out === 'function') out();
  } catch (e) {
    if (token === renderToken) mount(view, html`<div class="banner bad"><div><b>No se pudo cargar esta pantalla</b>${e.message}</div></div>`);
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('crm:unauthorized', () => showLogin('Tu sesión venció. Volvé a entrar.'));
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) toast(e.reason.message, 'bad'); });
boot();
