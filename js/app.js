import * as C from './crypto.js';
import { meta, entries as entryDB, files as fileDB, wipe } from './db.js';
import * as Drive from './drive.js';
import * as Bio from './bio.js';

const VERSION = '1.0.0';
const MIN_LEN = 10;
const MIN_BITS = 45;
const HIDDEN_GRACE = 30_000;
const MOODS = [
  ['🥰', 'Con amor'], ['😄', 'Feliz'], ['🙂', 'Bien'], ['😌', 'En paz'], ['😐', 'Normal'],
  ['😔', 'Triste'], ['😢', 'Muy triste'], ['😤', 'Enojo'], ['😴', 'Cansancio'], ['🤒', 'Enfermedad'],
];

const $app = document.getElementById('app');

const S = {
  dek: null,
  header: null,
  entries: new Map(),     // id → entrada descifrada (incluye borradas, con deleted: true)
  urls: new Map(),        // nombre de archivo → Promise<objectURL>
  remote: null,           // último listado de Drive
  view: 'calendar',
  month: firstOfMonth(new Date()),
  selected: ymd(new Date()),
  query: '',
  sync: { state: 'idle', msg: '' },
  sheet: null,            // editor abierto: { autosave, photos }
  syncing: false,
};

// ---------------------------------------------------------------- utilidades

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
const today = () => ymd(new Date());
const fmt = (o) => new Intl.DateTimeFormat('es', o);
const F = {
  month: fmt({ month: 'long', year: 'numeric' }),
  day: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
  full: fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const norm = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cls = (...a) => a.filter(Boolean).join(' ');
const live = () => [...S.entries.values()].filter((e) => !e.deleted);

// Crea elementos sin innerHTML: el texto del usuario siempre va como textContent.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const ICONS = {
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5z"/>',
  cloudCheck: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5z"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
  cloudOff: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5z"/><path d="M4 4l16 16"/>',
  cloudAlert: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5z"/><path d="M12 11v3M12 16.2v.01"/>',
  refresh: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1"/><path d="M18.5 3v4.5H14M5.5 21v-4.5H10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7M9 7V4.5h6V7"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 15.5a3.5 3.5 0 0 0 5 0"/>',
  fingerprint: '<path d="M6.5 7.5a7 7 0 0 1 12 4.5v1M5 11.5v1.5M9 20a10 10 0 0 0 .5-3v-5a2.5 2.5 0 0 1 5 0v1.5M12 12v3a9 9 0 0 1-1 4.2M17 16a13 13 0 0 1-.8 4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};

function icon(name) {
  const t = document.createElement('template');
  // Solo cadenas fijas de ICONS, nunca contenido del usuario.
  t.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

function toast(msg, kind = '') {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: cls('toast', kind), role: 'status' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6000 : 2600);
}

function busy(btn, text) {
  if (text) {
    btn._orig ??= [...btn.childNodes];
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner' }), text);
  } else if (btn._orig) {
    btn.disabled = false;
    btn.replaceChildren(...btn._orig);
    btn._orig = null;
  }
}

function swipe(el, cb) {
  let x0 = null, y0 = 0;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) cb(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function strength(p) {
  if (!p) return 0;
  let pool = 0;
  if (/[a-zñ]/.test(p)) pool += 27;
  if (/[A-ZÑ]/.test(p)) pool += 27;
  if (/\d/.test(p)) pool += 10;
  if (/[^a-zA-ZñÑ0-9]/.test(p)) pool += 33;
  let bits = p.length * Math.log2(pool || 1);
  if (/(.)\1{2,}/.test(p) || /^(123|abc|qwe|password|contrase)/i.test(p)) bits *= 0.6;
  return bits;
}

function level(bits) {
  if (bits < MIN_BITS) return { i: 1, label: 'Débil' };
  if (bits < 60) return { i: 2, label: 'Aceptable' };
  if (bits < 80) return { i: 3, label: 'Fuerte' };
  return { i: 4, label: 'Muy fuerte' };
}

function pwField(placeholder, autocomplete) {
  const input = h('input', { type: 'password', class: 'input', placeholder, autocomplete, autocapitalize: 'off', spellcheck: 'false', required: true });
  const toggle = h('button', { type: 'button', class: 'pw-eye', 'aria-label': 'Mostrar contraseña', onclick: () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  } }, icon('eye'));
  return { input, wrap: h('div', { class: 'pw' }, input, toggle) };
}

// Las fotos se descifran solo cuando están por aparecer en pantalla.
const io = new IntersectionObserver((list) => {
  for (const en of list) if (en.isIntersecting) { io.unobserve(en.target); en.target._load(); }
}, { rootMargin: '600px' });

function fileUrl(name) {
  if (!S.urls.has(name)) {
    S.urls.set(name, (async () => {
      try {
        const data = await fileDB.data(name);
        if (!data) { S.urls.delete(name); return null; }
        const bytes = await C.open(S.dek, data, name);
        return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      } catch (e) {
        S.urls.delete(name);
        throw e;
      }
    })());
  }
  return S.urls.get(name);
}

function img(name) {
  const el = h('img', { alt: '', decoding: 'async' });
  el._load = () => fileUrl(name).then((u) => (u ? (el.src = u) : el.classList.add('missing'))).catch(() => el.classList.add('missing'));
  io.observe(el);
  return el;
}

function setBg(el, name) {
  el._load = () => fileUrl(name).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; }).catch(() => {});
  io.observe(el);
}

function screen(node) { $app.replaceChildren(node); }

// ---------------------------------------------------------------- arranque

async function boot() {
  if (!window.isSecureContext || !crypto.subtle) {
    return screen(lockShell(h('div', { class: 'card stack' },
      h('h2', {}, 'Conexión no segura'),
      h('p', {}, 'Por seguridad, el navegador solo permite el cifrado si abres el diario con https:// o desde http://localhost.'),
      h('p', { class: 'muted' }, `Ahora lo estás abriendo desde ${location.origin}. Publícalo en GitHub Pages (https) o ábrelo en http://localhost en esta misma computadora.`))));
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const auth = Drive.consumeRedirect();
  S.header = await meta.get('header');

  if (!S.header) {
    if (auth?.ok && auth.intent === 'restore') return renderRestore();
    return renderSetup(auth && !auth.ok ? 'No se pudo conectar con Google: ' + auth.error : null);
  }

  // Renovación silenciosa del permiso de Drive antes de desbloquear (una vez por sesión).
  if (Drive.configured() && Drive.isConnected() && !Drive.token() && navigator.onLine && !auth
      && !sessionStorage.getItem('diario.silent')) {
    sessionStorage.setItem('diario.silent', '1');
    return Drive.authorize({ silent: true });
  }
  S.sync.state = Drive.isConnected() && !Drive.token() ? 'auth' : 'idle';
  renderUnlock(auth);
}

function lockShell(...content) {
  return h('div', { class: 'lock' }, h('div', { class: 'lock-inner' },
    h('div', { class: 'brand' },
      h('img', { src: 'icons/icon-192.png', alt: '', class: 'brand-icon' }),
      h('h1', {}, 'Diario'),
      h('p', { class: 'tagline' }, 'Tus recuerdos, solo para ti.')),
    content));
}

function renderSetup(note) {
  const p1 = pwField('Contraseña maestra', 'new-password');
  const p2 = pwField('Repite la contraseña', 'new-password');
  const bar = h('span');
  const meter = h('div', { class: 'meter' }, bar);
  const meterLabel = h('div', { class: 'meter-label' }, ' ');
  const ack = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Crear mi diario');

  p1.input.addEventListener('input', () => {
    const b = strength(p1.input.value);
    const lv = level(b);
    meter.dataset.level = p1.input.value ? lv.i : 0;
    bar.style.width = Math.min(100, (b / 90) * 100) + '%';
    meterLabel.textContent = p1.input.value ? lv.label : ' ';
  });

  const form = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const pw = p1.input.value;
    if (pw.length < MIN_LEN) return (err.textContent = `Usa al menos ${MIN_LEN} caracteres.`);
    if (strength(pw) < MIN_BITS) return (err.textContent = 'Es fácil de adivinar. Prueba una frase de 4 o 5 palabras.');
    if (pw !== p2.input.value) return (err.textContent = 'Las contraseñas no coinciden.');
    if (!ack.checked) return (err.textContent = 'Confirma que entiendes que no se puede recuperar.');
    busy(btn, 'Creando…');
    try {
      await createVault(pw);
      await enterApp();
    } catch (x) {
      console.error(x);
      err.textContent = 'Error: ' + x.message;
      busy(btn);
    }
  } },
  h('h2', {}, 'Crea tu diario'),
  h('p', { class: 'muted' }, 'Todo se cifra en este dispositivo con tu contraseña maestra antes de guardarse o subirse a Google Drive.'),
  p1.wrap, h('div', { class: 'meter-row' }, meter, meterLabel), p2.wrap,
  h('label', { class: 'check' }, ack, h('span', {}, 'Entiendo que si olvido esta contraseña nadie podrá recuperar mi diario: ni yo, ni Google.')),
  err, btn);

  const restore = Drive.configured()
    ? h('button', { class: 'btn ghost block', onclick: () => Drive.authorize({ intent: 'restore' }) }, icon('cloud'), 'Ya tengo un diario en Google Drive')
    : null;
  screen(lockShell(note ? h('p', { class: 'notice' }, note) : null, form, restore));
}

async function createVault(password) {
  const kdf = { ...C.KDF_DEFAULT, salt: C.toB64(C.rand(16)) };
  const kek = await C.passwordKey(password, kdf);
  const dek = await C.newDataKey();
  const vaultId = crypto.randomUUID();
  const header = {
    format: 'diario', v: 1, vaultId, kdf,
    wrapped: await C.wrap(dek, kek),
    check: C.toB64(await C.sealJSON(dek, { ok: true }, 'check:' + vaultId)),
    updatedAt: Date.now(),
  };
  await meta.set('header', header);
  await meta.set('headerDirty', true);
  navigator.storage?.persist?.();
  S.header = header;
  S.dek = dek;
}

async function renderUnlock(auth) {
  const bio = await meta.get('bio');
  const label = Bio.label();
  const pw = pwField('Contraseña maestra', 'current-password');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Desbloquear');
  let fails = 0;

  const form = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    if (!pw.input.value) return;
    err.textContent = '';
    busy(btn, 'Abriendo…');
    try {
      const kek = await C.passwordKey(pw.input.value, S.header.kdf);
      S.dek = await C.unwrap(S.header.wrapped, kek);
    } catch {
      fails++;
      await sleep(Math.min(fails, 5) * 700);
      busy(btn);
      err.textContent = 'Contraseña incorrecta.';
      pw.input.select();
      return;
    }
    await enterApp();
  } }, h('h2', {}, 'Hola de nuevo'), pw.wrap, err, btn);

  let bioBtn = null;
  if (bio) {
    bioBtn = h('button', { class: 'btn bio block', type: 'button', onclick: async () => {
      busy(bioBtn, `Esperando ${label}…`);
      err.textContent = '';
      try {
        const key = await Bio.unlockKey(bio);
        S.dek = await C.unwrap(bio.wrapped, key);
      } catch (x) {
        busy(bioBtn);
        err.textContent = x.name === 'NotAllowedError' ? 'Cancelado. También puedes usar tu contraseña.' : `No se pudo usar ${label}. Usa tu contraseña.`;
        return;
      }
      await enterApp();
    } }, icon(Bio.iconName()), `Desbloquear con ${label}`);
  }

  let note = null;
  if (auth?.ok) note = 'Google Drive conectado. Desbloquea para sincronizar.';
  else if (auth && !auth.silent) note = 'No se pudo conectar con Google: ' + auth.error;
  screen(lockShell(note ? h('p', { class: 'notice' }, note) : null, bioBtn, form));
  if (!bio) pw.input.focus();
}

async function renderRestore() {
  const status = h('p', { class: 'muted center' }, 'Buscando tu diario en Google Drive…');
  screen(lockShell(h('div', { class: 'card' }, status)));
  let header, rh;
  try {
    const remote = await Drive.list();
    rh = remote.get('vault.json');
    if (!rh) {
      Drive.disconnect();
      return renderSetup('No encontré ningún diario en esa cuenta de Google. Puedes crear uno nuevo.');
    }
    header = JSON.parse(new TextDecoder().decode(await Drive.download(rh.id)));
    if (header.format !== 'diario') throw new Error('El archivo en Drive no es un diario válido');
  } catch (x) {
    return renderSetup('No se pudo leer Google Drive: ' + x.message);
  }

  const pw = pwField('Contraseña maestra del diario', 'current-password');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Restaurar');
  const form = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    busy(btn, 'Descifrando…');
    try {
      const kek = await C.passwordKey(pw.input.value, header.kdf);
      S.dek = await C.unwrap(header.wrapped, kek);
    } catch {
      busy(btn);
      err.textContent = 'Contraseña incorrecta.';
      return;
    }
    await meta.set('header', header);
    await meta.set('headerMd5', rh.md5Checksum);
    await meta.set('headerDirty', false);
    navigator.storage?.persist?.();
    S.header = header;
    await enterApp();
  } }, h('h2', {}, 'Encontré tu diario'), h('p', { class: 'muted' }, 'Escribe tu contraseña maestra para descargarlo en este dispositivo.'), pw.wrap, err, btn);
  screen(lockShell(form));
  pw.input.focus();
}

async function enterApp() {
  for (const r of await entryDB.all()) {
    try {
      const e = await C.openJSON(S.dek, r.data, r.name);
      S.entries.set(e.id, e);
    } catch (x) {
      console.error('No se pudo descifrar', r.name, x);
    }
  }
  startAutoLock();
  renderApp();
  if (Drive.token()) syncNow(false);
  setInterval(() => { if (!document.hidden && Drive.token()) syncNow(false); }, 5 * 60_000);
  addEventListener('online', () => scheduleSync(1000));
}

// ---------------------------------------------------------------- bloqueo

const autolockMinutes = () => Number(localStorage.getItem('diario.autolock')) || 5;

function startAutoLock() {
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) addEventListener(ev, bump, { passive: true, capture: true });
  setInterval(() => { if (Date.now() - last > autolockMinutes() * 60_000) lock(); }, 10_000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      document.body.classList.add('privacy');
      S.sheet?.autosave?.();
    } else {
      document.body.classList.remove('privacy');
      if (Date.now() - hiddenAt > HIDDEN_GRACE) lock();
    }
  });
}

// Recargar la página es la forma más segura de borrar de memoria la llave y los textos.
async function lock() {
  if (S.locking) return;
  S.locking = true;
  try { await S.sheet?.autosave?.(); } catch (x) { console.error(x); }
  document.querySelectorAll('.sheet-backdrop, .lightbox').forEach((n) => n.remove());
  $app.replaceChildren(h('div', { class: 'lock' }, h('p', { class: 'muted center' }, 'Bloqueando…')));
  if (S.syncing) { S.lockAfterSync = true; return; }
  location.reload();
}

// ---------------------------------------------------------------- app

function renderApp() {
  const y = scrollY;
  const view = S.view === 'calendar' ? calendarView() : S.view === 'timeline' ? timelineView() : settingsView();
  screen(h('div', { class: 'shell' },
    topbar(),
    h('main', { class: 'view view-' + S.view }, view),
    tabbar(),
    S.view !== 'settings' ? h('button', { class: 'fab', 'aria-label': 'Nuevo recuerdo', onclick: () => openEditor(null) }, icon('plus')) : null));
  scrollTo(0, y);
}

function go(view) {
  S.view = view;
  scrollTo(0, 0);
  renderApp();
}

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand-sm' }, h('span', { class: 'dot' }), 'Diario'),
    h('div', { class: 'top-actions' },
      syncButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'Bloquear', title: 'Bloquear', onclick: lock }, icon('lock'))));
}

function syncButton() {
  if (!Drive.configured()) return h('span', { id: 'syncbtn' });
  const st = Drive.isConnected() ? S.sync.state : 'off';
  const [ic, label] = {
    off: ['cloudOff', 'Google Drive no conectado'],
    idle: ['cloud', 'Sincronizar'],
    syncing: ['refresh', 'Sincronizando…'],
    ok: ['cloudCheck', 'Todo sincronizado'],
    error: ['cloudAlert', S.sync.msg || 'Error al sincronizar'],
    auth: ['cloudAlert', 'Toca para reconectar con Google'],
  }[st];
  return h('button', { id: 'syncbtn', class: cls('icon-btn', 'sync', 'sync-' + st), 'aria-label': label, title: label,
    onclick: () => (st === 'off' ? go('settings') : syncNow(true)) }, icon(ic));
}

function setSync(state, msg = '') {
  S.sync = { state, msg };
  document.getElementById('syncbtn')?.replaceWith(syncButton());
  document.getElementById('drive-status')?.replaceWith(driveStatus());
}

function tabbar() {
  const tab = (v, ic, label) => h('button', { class: cls('tab', S.view === v && 'active'), 'aria-current': S.view === v ? 'page' : null, onclick: () => go(v) },
    icon(ic), h('span', {}, label));
  return h('nav', { class: 'tabbar' }, tab('calendar', 'calendar', 'Calendario'), tab('timeline', 'book', 'Recuerdos'), tab('settings', 'sliders', 'Ajustes'));
}

function groupByDay() {
  const map = new Map();
  for (const e of live()) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return map;
}

function shiftMonth(n) {
  S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1);
  renderApp();
}

function calendarView() {
  const y = S.month.getFullYear(), m = S.month.getMonth();
  const byDay = groupByDay();
  const t = today();
  const grid = h('div', { class: 'cal-grid' });
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // semana empieza en lunes
  for (let i = 0; i < offset; i++) grid.append(h('div', { class: 'cal-cell blank' }));
  const days = new Date(y, m + 1, 0).getDate();
  let monthCount = 0;
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d);
    const key = ymd(date);
    const list = byDay.get(key) || [];
    monthCount += list.length;
    const cell = h('button', {
      class: cls('cal-cell', list.length && 'has', key === t && 'today', key === S.selected && 'selected'),
      'aria-label': F.day.format(date) + (list.length ? `, ${list.length} recuerdo${list.length > 1 ? 's' : ''}` : ''),
      onclick: () => { S.selected = key; renderApp(); },
    }, h('span', { class: 'num' }, d), list.length > 1 ? h('span', { class: 'count' }, list.length) : null);
    const withPhoto = list.find((e) => e.photos?.length);
    if (withPhoto) {
      cell.classList.add('photo');
      setBg(cell, 't_' + withPhoto.photos[0]);
    } else if (list.length) {
      cell.append(h('span', { class: 'mood' }, list.find((e) => e.mood)?.mood || '•'));
    }
    grid.append(cell);
  }

  const now = new Date();
  const isCurrent = y === now.getFullYear() && m === now.getMonth();
  const cal = h('section', { class: 'card cal' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Mes anterior', onclick: () => shiftMonth(-1) }, icon('chevL')),
      h('div', { class: 'cal-title' },
        h('h2', {}, cap(F.month.format(S.month))),
        h('span', { class: 'muted' }, monthCount ? `${monthCount} recuerdo${monthCount > 1 ? 's' : ''}` : 'Sin recuerdos aún')),
      h('button', { class: 'icon-btn', 'aria-label': 'Mes siguiente', onclick: () => shiftMonth(1) }, icon('chevR'))),
    h('div', { class: 'cal-week' }, ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => h('span', {}, d))),
    grid);
  swipe(cal, shiftMonth);

  const dayList = byDay.get(S.selected) || [];
  const todayBtn = !isCurrent || S.selected !== t
    ? h('button', { class: 'pill', onclick: () => { S.month = firstOfMonth(new Date()); S.selected = t; renderApp(); } }, 'Hoy')
    : null;
  const day = h('section', { class: 'day' },
    h('div', { class: 'section-head' }, h('h3', {}, cap(F.day.format(parseYmd(S.selected)))), todayBtn),
    dayList.length
      ? h('div', { class: 'cards' }, dayList.map((e) => entryCard(e)))
      : h('button', { class: 'empty-day', onclick: () => openEditor(null) }, icon('pencil'), 'Escribe algo de este día'));

  const md = S.selected.slice(5);
  const past = live().filter((e) => e.date.slice(5) === md && e.date.slice(0, 4) !== S.selected.slice(0, 4))
    .sort((a, b) => b.date.localeCompare(a.date));
  const otd = past.length
    ? h('section', { class: 'otd' },
      h('div', { class: 'section-head' }, h('h3', {}, icon('sparkle'), 'Un día como hoy')),
      h('div', { class: 'cards' }, past.map((e) => {
        const yrs = Number(S.selected.slice(0, 4)) - Number(e.date.slice(0, 4));
        const when = yrs > 0 ? `Hace ${yrs} año${yrs > 1 ? 's' : ''} · ${e.date.slice(0, 4)}` : e.date.slice(0, 4);
        return entryCard(e, when);
      })))
    : null;

  return [cal, day, otd];
}

function entryCard(e, dateLabel) {
  const photos = e.photos || [];
  const open = () => openEntry(e.id);
  return h('article', { class: 'entry-card', tabindex: '0', onclick: open, onkeydown: (ev) => ev.key === 'Enter' && open() },
    photos.length
      ? h('div', { class: cls('thumbs', 'n' + Math.min(photos.length, 3)) }, photos.slice(0, 3).map((p, i) => h('div', { class: 'thumb' },
        img('t_' + p),
        i === 2 && photos.length > 3 ? h('span', { class: 'more' }, '+' + (photos.length - 3)) : null)))
      : null,
    h('div', { class: 'entry-body' },
      dateLabel || e.mood ? h('div', { class: 'entry-meta' }, e.mood ? h('span', { class: 'mood-sm' }, e.mood) : null, dateLabel ? h('span', {}, dateLabel) : null) : null,
      h('h4', {}, e.title || 'Sin título'),
      e.text ? h('p', { class: 'excerpt' }, e.text.slice(0, 300)) : null));
}

function timelineView() {
  const list = h('div', { class: 'timeline' });
  const fill = () => {
    const q = norm(S.query.trim());
    const items = live()
      .filter((e) => !q || norm(e.title + ' ' + e.text).includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    list.replaceChildren();
    if (!items.length) {
      list.append(h('div', { class: 'empty' }, q ? 'Nada coincide con tu búsqueda.' : 'Aún no hay recuerdos. Toca + para escribir el primero.'));
      return;
    }
    let cur = '';
    for (const e of items) {
      if (e.date.slice(0, 7) !== cur) {
        cur = e.date.slice(0, 7);
        list.append(h('h3', { class: 'month-label' }, cap(F.month.format(parseYmd(e.date)))));
      }
      list.append(entryCard(e, cap(F.day.format(parseYmd(e.date)))));
    }
  };
  fill();
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Buscar en tus recuerdos', value: S.query,
    oninput: (e) => { S.query = e.target.value; fill(); } });
  return [h('h2', { class: 'page-title' }, 'Recuerdos'), h('div', { class: 'search-wrap' }, icon('search'), search), list];
}

// ---------------------------------------------------------------- hojas (lector, editor)

function openSheet(build, { onEscape, onClose } = {}) {
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    onClose?.();
    backdrop.classList.remove('open');
    setTimeout(() => {
      backdrop.remove();
      if (!document.querySelector('.sheet-backdrop')) document.body.classList.remove('noscroll');
    }, 250);
  };
  const esc = () => (onEscape || close)();
  const onKey = (ev) => { if (ev.key === 'Escape') esc(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) esc(); });
  panel.append(...[build(close)].flat().filter(Boolean));
  document.body.append(backdrop);
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('open')));
  return close;
}

function openEntry(id) {
  const e = S.entries.get(id);
  if (!e || e.deleted) return;
  const photos = e.photos || [];
  openSheet((close) => [
    h('div', { class: 'sheet-bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Cerrar', onclick: close }, icon('x')),
      h('div', { class: 'grow' }),
      h('button', { class: 'icon-btn danger', 'aria-label': 'Eliminar', title: 'Eliminar', onclick: async () => {
        if (!confirm('¿Eliminar este recuerdo y sus fotos? No se puede deshacer.')) return;
        await deleteEntry(e);
        close();
        renderApp();
        toast('Recuerdo eliminado');
      } }, icon('trash')),
      h('button', { class: 'btn small', onclick: () => { close(); openEditor(e); } }, icon('pencil'), 'Editar')),
    h('article', { class: 'reader' },
      h('div', { class: 'reader-date' }, e.mood ? h('span', { class: 'mood-lg' }, e.mood) : null, cap(F.full.format(parseYmd(e.date)))),
      h('h1', { class: 'reader-title' }, e.title || 'Sin título'),
      photos.length
        ? h('div', { class: cls('gallery', photos.length === 1 && 'single') }, photos.map((p, i) => h('button', { class: 'gallery-item', 'aria-label': 'Ver foto', onclick: () => lightbox(photos, i) },
          img((photos.length === 1 ? 'p_' : 't_') + p))))
        : null,
      e.text ? h('div', { class: 'reader-text' }, e.text) : null),
  ]);
}

function openEditor(entry) {
  const draft = entry
    ? structuredClone(entry)
    : { id: crypto.randomUUID(), date: S.selected, title: '', text: '', mood: '', photos: [], createdAt: Date.now() };
  const original = new Set(entry?.photos || []);
  const added = new Set();
  let dirty = false;
  const touch = () => { dirty = true; };

  const date = h('input', { type: 'date', class: 'date-input', value: draft.date, 'aria-label': 'Fecha', oninput: touch });
  const title = h('input', { class: 'title-input', placeholder: 'Título', value: draft.title, maxlength: '200', 'aria-label': 'Título', oninput: touch });
  const text = h('textarea', { class: 'text-input', placeholder: '¿Qué pasó? ¿Cómo te sentiste?', rows: '8', 'aria-label': 'Texto', oninput: () => { touch(); grow(); } });
  text.value = draft.text;
  const grow = () => { text.style.height = 'auto'; text.style.height = text.scrollHeight + 'px'; };

  const moods = h('div', { class: 'moods', role: 'radiogroup', 'aria-label': 'Ánimo' });
  const paintMoods = () => moods.replaceChildren(...MOODS.map(([m, label]) => h('button', {
    type: 'button', class: cls('mood-chip', draft.mood === m && 'on'), title: label, 'aria-label': label,
    role: 'radio', 'aria-checked': String(draft.mood === m),
    onclick: () => { draft.mood = draft.mood === m ? '' : m; touch(); paintMoods(); },
  }, m)));
  paintMoods();

  const grid = h('div', { class: 'photo-grid' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
    const list = [...fileInput.files];
    fileInput.value = '';
    busy(addBtn, 'Cifrando…');
    try {
      for (const f of list) {
        const id = await storePhoto(f);
        draft.photos.push(id);
        added.add(id);
        touch();
        paintPhotos();
      }
    } catch (x) {
      toast('No se pudo agregar la foto: ' + x.message, 'error');
    } finally {
      busy(addBtn);
    }
  } });
  const addBtn = h('button', { type: 'button', class: 'photo-add', onclick: () => fileInput.click() }, icon('image'), h('span', {}, 'Añadir fotos'));
  const paintPhotos = () => grid.replaceChildren(
    ...draft.photos.map((p) => h('div', { class: 'photo-tile' }, img('t_' + p),
      h('button', { type: 'button', class: 'photo-del', 'aria-label': 'Quitar foto', onclick: async () => {
        draft.photos = draft.photos.filter((x) => x !== p);
        touch();
        if (added.delete(p)) await deletePhotoFiles(p);
        paintPhotos();
      } }, icon('x')))),
    addBtn, fileInput);
  paintPhotos();

  async function save(auto = false) {
    draft.date = date.value || draft.date;
    draft.title = title.value.trim();
    draft.text = text.value.replace(/\s+$/, '');
    if (!entry && !draft.title && !draft.text && !draft.photos.length) {
      if (!auto) close();
      return;
    }
    draft.updatedAt = Date.now();
    for (const p of original) if (!draft.photos.includes(p)) await deletePhotoFiles(p);
    await persistEntry(draft);
    dirty = false;
    entry = draft;
    original.clear();
    for (const p of draft.photos) original.add(p);
    added.clear();
    if (auto) return;
    close();
    S.selected = draft.date;
    S.month = firstOfMonth(parseYmd(draft.date));
    renderApp();
    toast('Recuerdo guardado');
    scheduleSync();
  }

  async function cancel() {
    if (dirty && !confirm('¿Descartar los cambios?')) return;
    for (const p of added) await deletePhotoFiles(p);
    close();
  }

  const saveBtn = h('button', { class: 'btn primary small', onclick: async () => { busy(saveBtn, 'Guardando…'); try { await save(); } finally { busy(saveBtn); } } }, 'Guardar');
  const close = openSheet(() => [
    h('div', { class: 'sheet-bar' }, h('button', { class: 'btn ghost small', onclick: cancel }, 'Cancelar'), h('div', { class: 'grow' }), saveBtn),
    h('div', { class: 'editor' }, date, moods, title, text, grid),
  ], { onEscape: cancel, onClose: () => { S.sheet = null; } });
  S.sheet = { autosave: () => (dirty ? save(true) : null), photos: () => draft.photos };
  requestAnimationFrame(grow);
}

function lightbox(photos, start) {
  let i = start;
  const im = h('img', { class: 'lb-img', alt: '' });
  const counter = h('span', { class: 'lb-count' });
  const show = () => {
    im.removeAttribute('src');
    fileUrl('p_' + photos[i]).then((u) => u || fileUrl('t_' + photos[i])).then((u) => { if (u) im.src = u; }).catch(() => {});
    counter.textContent = photos.length > 1 ? `${i + 1} / ${photos.length}` : '';
  };
  const step = (d) => { i = (i + d + photos.length) % photos.length; show(); };
  const box = h('div', { class: 'lightbox', onclick: (ev) => { if (ev.target === box) close(); } },
    im, counter,
    photos.length > 1 ? [
      h('button', { class: 'lb-nav prev', 'aria-label': 'Anterior', onclick: () => step(-1) }, icon('chevL')),
      h('button', { class: 'lb-nav next', 'aria-label': 'Siguiente', onclick: () => step(1) }, icon('chevR')),
    ] : null,
    h('button', { class: 'lb-close', 'aria-label': 'Cerrar', onclick: () => close() }, icon('x')));
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'ArrowLeft') step(-1);
    if (ev.key === 'ArrowRight') step(1);
  };
  function close() { document.removeEventListener('keydown', onKey, true); box.remove(); }
  document.addEventListener('keydown', onKey, true);
  if (photos.length > 1) swipe(box, step);
  document.body.append(box);
  show();
}

// ---------------------------------------------------------------- datos

async function persistEntry(e) {
  const name = 'e_' + e.id;
  const data = await C.sealJSON(S.dek, e, name);
  const prev = await entryDB.get(name);
  await entryDB.put({ name, data, dirty: true, rev: (prev?.rev || 0) + 1, remoteId: prev?.remoteId || null, md5: prev?.md5 || null });
  S.entries.set(e.id, e);
}

async function deleteEntry(e) {
  for (const p of e.photos || []) await deletePhotoFiles(p);
  await persistEntry({ id: e.id, deleted: true, createdAt: e.createdAt, updatedAt: Date.now() });
  scheduleSync();
}

async function processImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    try { await im.decode(); } catch { throw new Error('formato de imagen no compatible'); }
    return { full: await toJpeg(im, 2560, 0.86), thumb: await toJpeg(im, 640, 0.8) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Re-codificar a JPEG elimina los metadatos EXIF (incluida la ubicación GPS).
function toJpeg(im, max, quality) {
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * s);
  c.height = Math.round(im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => {
    c.width = c.height = 0;
    b ? resolve(b) : reject(new Error('no se pudo procesar la imagen'));
  }, 'image/jpeg', quality));
}

async function storePhoto(file) {
  const { full, thumb } = await processImage(file);
  const id = crypto.randomUUID();
  for (const [name, blob] of [['p_' + id, full], ['t_' + id, thumb]]) {
    const data = await C.seal(S.dek, new Uint8Array(await blob.arrayBuffer()), name);
    await fileDB.put({ name, dirty: true }, data);
  }
  S.urls.set('t_' + id, Promise.resolve(URL.createObjectURL(thumb)));
  return id;
}

async function deletePhotoFiles(id) {
  for (const name of ['p_' + id, 't_' + id]) {
    const rec = await fileDB.get(name);
    const remoteId = rec?.remoteId || S.remote?.get(name)?.id;
    if (remoteId) await fileDB.put({ name, deleted: true, dirty: true, remoteId }, null);
    else if (rec) await fileDB.del(name);
    const u = S.urls.get(name);
    if (u) {
      S.urls.delete(name);
      u.then((x) => x && URL.revokeObjectURL(x)).catch(() => {});
    }
  }
}

async function changePassword(current, next) {
  try {
    await C.unwrap(S.header.wrapped, await C.passwordKey(current, S.header.kdf));
  } catch {
    throw new Error('BAD');
  }
  const kdf = { ...C.KDF_DEFAULT, salt: C.toB64(C.rand(16)) };
  const header = { ...S.header, kdf, wrapped: await C.wrap(S.dek, await C.passwordKey(next, kdf)), updatedAt: Date.now() };
  await meta.set('header', header);
  await meta.set('headerDirty', true);
  S.header = header;
  scheduleSync();
}

// ---------------------------------------------------------------- sincronización

let syncTimer = null;

function scheduleSync(delay = 2500) {
  if (!Drive.token()) {
    if (Drive.isConnected()) setSync('auth');
    return;
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(false), delay);
}

async function syncNow(interactive) {
  if (!Drive.configured()) return;
  if (!Drive.token()) {
    if (!interactive) return setSync('auth');
    if (!confirm('Se abrirá Google un momento para dar permiso. Después tendrás que desbloquear el diario otra vez. ¿Continuar?')) return;
    try { await S.sheet?.autosave?.(); } catch {}
    return Drive.authorize({ intent: 'sync' });
  }
  if (S.syncing) { S.syncAgain = true; return; }
  S.syncing = true;
  setSync('syncing');
  try {
    await runSync();
    localStorage.setItem('diario.lastSync', String(Date.now()));
    setSync('ok');
  } catch (e) {
    console.error(e);
    if (e instanceof Drive.AuthError) setSync('auth');
    else if (e.message === 'VAULT_MISMATCH') setSync('error', 'Tu Google Drive ya tiene otro diario distinto a este');
    else if (e.message === 'HEADER_INVALID') setSync('error', 'El archivo del diario en Google Drive fue alterado; no se aceptó');
    else setSync('error', navigator.onLine ? e.message : 'Sin conexión');
  } finally {
    S.syncing = false;
    if (S.lockAfterSync) location.reload();
    else if (S.syncAgain) { S.syncAgain = false; scheduleSync(500); }
  }
}

async function pushHeader(remoteId) {
  const body = JSON.stringify(S.header);
  const r = remoteId ? await Drive.update(remoteId, body) : await Drive.create('vault.json', body);
  await meta.set('headerMd5', r.md5Checksum);
  await meta.set('headerDirty', false);
}

async function syncHeader(remote) {
  const rh = remote.get('vault.json');
  if (!rh) return pushHeader(null);
  if (rh.md5Checksum !== await meta.get('headerMd5')) {
    const theirs = JSON.parse(new TextDecoder().decode(await Drive.download(rh.id)));
    if (theirs.vaultId !== S.header.vaultId) throw new Error('VAULT_MISMATCH');
    // Solo quien tiene la llave de datos puede producir este "check": evita cabeceras falsas.
    try {
      await C.openJSON(S.dek, C.fromB64(theirs.check), 'check:' + theirs.vaultId);
    } catch {
      throw new Error('HEADER_INVALID');
    }
    if (theirs.updatedAt > S.header.updatedAt) {
      S.header = theirs;
      await meta.set('header', theirs);
      await meta.set('headerMd5', rh.md5Checksum);
      await meta.set('headerDirty', false);
      return;
    }
    if (theirs.updatedAt < S.header.updatedAt) return pushHeader(rh.id);
    await meta.set('headerMd5', rh.md5Checksum);
  }
  if (await meta.get('headerDirty')) await pushHeader(rh.id);
}

async function runSync() {
  const remote = await Drive.list();
  S.remote = remote;
  await syncHeader(remote);
  let changed = false;

  // 1. Entradas que cambiaron en Drive → local (gana la edición más reciente).
  for (const [name, r] of remote) {
    if (!name.startsWith('e_')) continue;
    const local = await entryDB.get(name);
    if (local && local.md5 === r.md5Checksum) continue;
    const data = await Drive.download(r.id);
    let incoming;
    try {
      incoming = await C.openJSON(S.dek, data, name);
      if ('e_' + incoming.id !== name) throw new Error('id');
    } catch {
      console.warn('Ignorando archivo ilegible en Drive', name);
      continue;
    }
    if (local?.dirty) {
      const mine = S.entries.get(incoming.id);
      if (mine && mine.updatedAt >= incoming.updatedAt) {
        await entryDB.put({ ...local, remoteId: r.id, md5: r.md5Checksum });
        continue;
      }
    }
    await entryDB.put({ name, data, dirty: false, rev: (local?.rev || 0) + 1, remoteId: r.id, md5: r.md5Checksum });
    S.entries.set(incoming.id, incoming);
    changed = true;
  }

  // 2. Fotos que se necesitan (las de entradas vivas y las del editor abierto).
  const needed = new Set();
  for (const e of live()) for (const p of e.photos || []) needed.add('p_' + p).add('t_' + p);
  const pinned = new Set();
  for (const p of S.sheet?.photos?.() || []) pinned.add('p_' + p).add('t_' + p);

  // 3. Subir fotos nuevas y borrar las eliminadas. Las fotos van antes que las
  //    entradas para que otro dispositivo nunca vea una entrada sin sus fotos.
  const fileMetas = await fileDB.all();
  const localNames = new Set();
  for (const f of fileMetas) {
    if (f.deleted) {
      const r = remote.get(f.name);
      if (r) await Drive.remove(r.id);
      await fileDB.del(f.name);
      continue;
    }
    localNames.add(f.name);
    const r = remote.get(f.name);
    if (r) {
      if (f.dirty || f.remoteId !== r.id) await fileDB.putMeta({ ...f, dirty: false, remoteId: r.id });
      continue;
    }
    if (f.dirty || needed.has(f.name) || pinned.has(f.name)) {
      const data = await fileDB.data(f.name);
      if (!data) { await fileDB.del(f.name); continue; }
      const res = await Drive.create(f.name, data);
      await fileDB.putMeta({ ...f, dirty: false, remoteId: res.id });
    }
  }

  // 4. Subir entradas modificadas (o que faltan en Drive).
  for (const rec of await entryDB.all()) {
    const r = remote.get(rec.name);
    if (!rec.dirty && r) continue;
    const res = r ? await Drive.update(r.id, rec.data) : await Drive.create(rec.name, rec.data);
    const after = await entryDB.get(rec.name);
    await entryDB.put({ ...after, remoteId: res.id, md5: res.md5Checksum, dirty: after.rev !== rec.rev });
  }

  // 5. Descargar fotos que faltan en este dispositivo (miniaturas primero).
  const missing = [...needed].filter((n) => !localNames.has(n) && remote.has(n)).sort((a, b) => b[0].localeCompare(a[0]));
  for (const name of missing) {
    const r = remote.get(name);
    await fileDB.put({ name, dirty: false, remoteId: r.id }, await Drive.download(r.id));
    changed = true;
  }

  // 6. Limpiar fotos locales que ya no usa ninguna entrada.
  for (const f of fileMetas) {
    if (!f.deleted && !f.dirty && !needed.has(f.name) && !pinned.has(f.name)) await fileDB.del(f.name);
  }

  if (changed && !S.locking) renderApp();
}

// ---------------------------------------------------------------- ajustes

const section = (title, ...rows) => h('section', { class: 'card settings' }, h('h3', {}, title), rows);

function settingsView() {
  return [
    h('h2', { class: 'page-title' }, 'Ajustes'),
    section('Seguridad', bioRow(), autolockRow(), passwordRow(),
      h('button', { class: 'btn block', onclick: lock }, icon('lock'), 'Bloquear ahora')),
    section('Google Drive', driveStatus()),
    section('Este dispositivo', deviceRow()),
    h('p', { class: 'about' }, `Diario ${VERSION} · AES-256-GCM · Argon2id (${S.header.kdf.m / 1024} MiB, ${S.header.kdf.t} pasadas)`),
  ];
}

function bioRow() {
  const row = h('div', { class: 'row' });
  (async () => {
    const label = Bio.label();
    const rec = await meta.get('bio');
    const note = h('p', { class: 'hint' }, Bio.fallbackNote());
    if (rec) {
      row.replaceChildren(
        h('div', { class: 'row-main' }, h('strong', {}, `${label} activado`), h('span', { class: 'muted' }, 'En este dispositivo')),
        h('button', { class: 'btn small', onclick: async () => {
          if (!confirm(`¿Desactivar ${label}? Tendrás que usar tu contraseña maestra.`)) return;
          await meta.del('bio');
          go('settings');
        } }, 'Desactivar'),
        note);
    } else if (!await Bio.supported()) {
      row.replaceChildren(h('div', { class: 'row-main' }, h('strong', {}, 'Desbloqueo biométrico'), h('span', { class: 'muted' }, 'Este navegador o dispositivo no lo ofrece.')));
    } else {
      const btn = h('button', { class: 'btn small primary', onclick: async () => {
        busy(btn, 'Configurando…');
        try {
          const r = await Bio.enroll();
          await meta.set('bio', { credId: r.credId, salt: r.salt, wrapped: await C.wrap(S.dek, r.key) });
          toast(`${label} activado`);
          go('settings');
        } catch (x) {
          busy(btn);
          toast(x.message === 'PRF_UNSUPPORTED'
            ? 'Tu navegador no soporta passkeys con cifrado (WebAuthn PRF). Necesitas iOS 18 / macOS 15 o Chrome/Edge recientes.'
            : x.name === 'NotAllowedError' ? 'Cancelado' : 'No se pudo activar: ' + x.message, 'error');
        }
      } }, 'Activar');
      row.replaceChildren(
        h('div', { class: 'row-main' }, h('strong', {}, `Desbloquear con ${label}`), h('span', { class: 'muted' }, 'Además de tu contraseña maestra')),
        btn, note);
    }
  })();
  return row;
}

function autolockRow() {
  const sel = h('select', { class: 'select', 'aria-label': 'Bloqueo automático', onchange: (e) => localStorage.setItem('diario.autolock', e.target.value) },
    [1, 5, 15, 30].map((n) => h('option', { value: String(n), selected: autolockMinutes() === n }, `${n} min`)));
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' }, h('strong', {}, 'Bloqueo automático'), h('span', { class: 'muted' }, 'Sin actividad, o 30 s después de salir de la app')),
    sel);
}

function passwordRow() {
  const cur = pwField('Contraseña actual', 'current-password');
  const n1 = pwField('Nueva contraseña', 'new-password');
  const n2 = pwField('Repite la nueva', 'new-password');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Cambiar contraseña');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const np = n1.input.value;
    if (np.length < MIN_LEN || strength(np) < MIN_BITS) return (err.textContent = `La nueva contraseña es débil (mínimo ${MIN_LEN} caracteres; mejor una frase).`);
    if (np !== n2.input.value) return (err.textContent = 'Las contraseñas nuevas no coinciden.');
    busy(btn, 'Cambiando…');
    try {
      await changePassword(cur.input.value, np);
      toast('Contraseña cambiada');
      go('settings');
    } catch (x) {
      busy(btn);
      err.textContent = x.message === 'BAD' ? 'La contraseña actual no es correcta.' : x.message;
    }
  } }, cur.wrap, n1.wrap, n2.wrap, err, btn);
  return h('details', { class: 'row-details' }, h('summary', {}, 'Cambiar contraseña maestra'), form);
}

function driveStatus() {
  const box = h('div', { id: 'drive-status', class: 'stack' });
  if (!Drive.configured()) {
    box.append(h('p', { class: 'muted' }, 'Falta poner el Client ID de Google en js/config.js. Las instrucciones están en el README.'));
    return box;
  }
  if (!Drive.isConnected()) {
    box.append(
      h('p', { class: 'muted' }, 'Tu diario se sube cifrado a una carpeta oculta de tu Google Drive. Google solo ve archivos ilegibles.'),
      h('button', { class: 'btn primary block', onclick: () => syncNow(true) }, icon('cloud'), 'Conectar con Google Drive'));
    return box;
  }
  const last = Number(localStorage.getItem('diario.lastSync'));
  const label = { idle: 'Conectado', syncing: 'Sincronizando…', ok: 'Todo sincronizado', error: 'Error: ' + S.sync.msg, auth: 'Hay que reconectar con Google' }[S.sync.state];
  box.append(
    h('div', {}, h('strong', {}, label), last ? h('p', { class: 'muted' }, 'Última sincronización: ' + new Date(last).toLocaleString('es')) : null),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', disabled: S.sync.state === 'syncing', onclick: () => syncNow(true) }, icon('refresh'), 'Sincronizar ahora'),
      h('button', { class: 'btn ghost', onclick: () => {
        if (!confirm('¿Desconectar Google Drive en este dispositivo? Tu copia en Drive no se borra.')) return;
        Drive.disconnect();
        setSync('idle');
        go('settings');
      } }, 'Desconectar')));
  return box;
}

async function pendingCount() {
  return (await entryDB.all()).filter((r) => r.dirty).length + (await fileDB.all()).filter((r) => r.dirty).length;
}

function deviceRow() {
  const info = h('p', { class: 'muted' }, '…');
  (async () => {
    const photos = (await fileDB.all()).filter((f) => !f.deleted && f.name.startsWith('p_')).length;
    let s = `${live().length} recuerdos · ${photos} fotos`;
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) s += ` · ${(est.usage / 1048576).toFixed(1)} MB`;
    const pending = await pendingCount();
    if (pending) s += ` · ${pending} cambios sin subir`;
    info.textContent = s;
  })();
  const wipeBtn = h('button', { class: 'btn danger-outline block', onclick: async () => {
    const pending = await pendingCount();
    const warn = pending && Drive.isConnected() ? `\n\n⚠️ Hay ${pending} cambios que aún no se subieron a Google Drive y se perderán.` : '';
    if (prompt(`Esto borra el diario de ESTE dispositivo.${warn}\n\nEscribe BORRAR para confirmar.`) !== 'BORRAR') return;
    await wipe();
    Drive.disconnect();
    location.reload();
  } }, icon('trash'), 'Borrar diario de este dispositivo');
  return [info, wipeBtn];
}

// ----------------------------------------------------------------

addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Error: ' + (e.reason?.message || e.reason), 'error');
});

boot();
