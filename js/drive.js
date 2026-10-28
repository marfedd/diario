// Google Drive: usa la carpeta oculta "appDataFolder", que solo esta app puede ver.
// OAuth con redirección (sin scripts de terceros): Google devuelve un token de
// acceso de ~1 hora en el fragmento de la URL.
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const K_TOKEN = 'diario.gtoken';
const K_STATE = 'diario.oauth';
const K_CONN = 'diario.drive';

export class AuthError extends Error {}

export const configured = () => Boolean(GOOGLE_CLIENT_ID);
export const isConnected = () => localStorage.getItem(K_CONN) === '1';

export function disconnect() {
  localStorage.removeItem(K_CONN);
  localStorage.removeItem(K_TOKEN);
}

export function token() {
  try {
    const t = JSON.parse(localStorage.getItem(K_TOKEN));
    if (t && t.exp > Date.now() + 60_000) return t.v;
  } catch {}
  return null;
}

const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

export function authorize({ silent = false, intent = '' } = {}) {
  const state = crypto.randomUUID();
  localStorage.setItem(K_STATE, JSON.stringify({ state, intent, silent }));
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    state,
  });
  if (silent) p.set('prompt', 'none');
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
}

// Procesa la vuelta desde Google. Devuelve null si no venimos de ahí.
export function consumeRedirect() {
  if (!location.hash.includes('state=')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(K_STATE)); } catch {}
  localStorage.removeItem(K_STATE);
  if (!saved || saved.state !== p.get('state')) return { ok: false, error: 'state_mismatch' };
  if (p.get('access_token')) {
    const ttl = Number(p.get('expires_in')) || 3600;
    localStorage.setItem(K_TOKEN, JSON.stringify({ v: p.get('access_token'), exp: Date.now() + ttl * 1000 }));
    localStorage.setItem(K_CONN, '1');
    return { ok: true, intent: saved.intent };
  }
  return { ok: false, error: p.get('error') || 'unknown', intent: saved.intent, silent: saved.silent };
}

async function call(url, opts = {}) {
  const t = token();
  if (!t) throw new AuthError('Sin sesión de Google');
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
  if (r.status === 401) {
    localStorage.removeItem(K_TOKEN);
    throw new AuthError('La sesión de Google expiró');
  }
  if (!r.ok) {
    const err = new Error(`Google Drive respondió ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

// Map nombre → { id, md5Checksum }. Si hay duplicados gana el más antiguo.
export async function list() {
  const out = new Map();
  let pageToken = '';
  do {
    const p = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'nextPageToken,files(id,name,md5Checksum)',
      pageSize: '1000',
      orderBy: 'createdTime',
    });
    if (pageToken) p.set('pageToken', pageToken);
    const j = await (await call(`${API}?${p}`)).json();
    for (const f of j.files || []) if (!out.has(f.name)) out.set(f.name, f);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

export async function download(id) {
  return (await call(`${API}/${id}?alt=media`)).arrayBuffer();
}

export async function create(name, data) {
  const boundary = 'diario-' + crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name, parents: ['appDataFolder'] }),
    `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    data,
    `\r\n--${boundary}--`,
  ]);
  const r = await call(`${UPLOAD}?uploadType=multipart&fields=id,md5Checksum`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.json();
}

export async function update(id, data) {
  const r = await call(`${UPLOAD}/${id}?uploadType=media&fields=id,md5Checksum`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data,
  });
  return r.json();
}

export async function remove(id) {
  try {
    await call(`${API}/${id}`, { method: 'DELETE' });
  } catch (e) {
    if (e.status !== 404) throw e;
  }
}
