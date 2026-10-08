// Core: state, storage, Supabase sync, sanitizer, tiny event bus. Schema is identical to v1.
export const $ = (id) => document.getElementById(id);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- bus ---------- */
export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

/* ---------- toast ---------- */
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------- sanitizer (XSS fix: every body HTML goes through here) ---------- */
const YT = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//;
let hooked = false;
export function sanitize(html) {
  const P = window.DOMPurify;
  if (!P) return escapeHtml(html || ''); // fail closed
  if (!hooked) {
    hooked = true;
    P.addHook('uponSanitizeElement', (node, d) => {
      if (d.tagName === 'iframe' && !YT.test(node.getAttribute('src') || '')) node.remove();
    });
  }
  return P.sanitize(html || '', {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow', 'contenteditable', 'controls'],
    FORBID_ATTR: ['style', 'srcdoc'],
  });
}

/* ---------- settings (API keys live only in localStorage, never synced) ---------- */
const SETTINGS_KEY = 'spazio-teorie-settings';
export const settings = (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; }
})();
export const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

/* ---------- IndexedDB (same db/stores as v1 so local data carries over) ---------- */
let dbp;
const openDB = () => dbp || (dbp = new Promise((res, rej) => {
  const rq = indexedDB.open('spazio-teorie-db', 3);
  rq.onupgradeneeded = (e) => {
    const db = e.target.result;
    ['blobs', 'pdfs', 'tts', 'epubs', 'history'].forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
  };
  rq.onsuccess = () => res(rq.result);
  rq.onerror = () => rej(rq.error);
}));
const tx = (s, mode, fn) => openDB().then((db) => new Promise((res, rej) => {
  const t = db.transaction(s, mode), r = fn(t.objectStore(s));
  t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
}));
export const idb = {
  put: (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k)),
  get: (s, k) => tx(s, 'readonly', (o) => o.get(k)),
  del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)),
  keys: (s) => tx(s, 'readonly', (o) => o.getAllKeys()),
};

/* ---------- state ---------- */
const PERSONAL_KEY = 'spazio-teorie-v3';
const ROOM_PREFIX = 'spazio-teorie-room-v3:';
export const app = { state: null, room: null, supabase: null, serverReady: false, mediaUrls: {}, readonly: false, writeBlock: false, loadError: false, dirty: false, serverStars: 0 };
/* who am I: a stable id per browser (not an account) + display name */
if (!settings.uid) { settings.uid = uid(); saveSettings(); }
export const me = () => ({ id: settings.uid, name: (settings.name || '').trim() || 'Anonymous' });

export const defaultState = () => ({ pages: [{ id: uid(), name: 'Constellation 1', nodes: [], connections: [], drawings: [] }], folders: [], volumes: [], current: 0 });
export const cleanRoom = (r) => String(r || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'room';

export function normalizeState(s) {
  if (!s || !Array.isArray(s.pages) || !s.pages.length) return null;
  s.folders = Array.isArray(s.folders) ? s.folders : [];
  s.volumes = Array.isArray(s.volumes) ? s.volumes : [];
  if (typeof s.current !== 'number' || !s.pages[s.current]) s.current = 0;
  s.pages.forEach((p) => {
    p.nodes = Array.isArray(p.nodes) ? p.nodes : [];
    p.connections = Array.isArray(p.connections) ? p.connections : [];
    p.drawings = Array.isArray(p.drawings) ? p.drawings : [];
    p.nodes.forEach((n) => { n.body = sanitize(n.body); }); // sanitize on every entry point
  });
  return s;
}
const lsKey = (room) => (room ? ROOM_PREFIX + room : PERSONAL_KEY);
export function loadLocal(room) {
  try { const raw = localStorage.getItem(lsKey(room)); return raw ? normalizeState(JSON.parse(raw)) : null; } catch { return null; }
}
app.state = loadLocal(null) || defaultState();

export const page = () => app.state.pages[app.state.current] || app.state.pages[0];
export const findNode = (id) => page().nodes.find((n) => n.id === id) || null;

/* ---------- Supabase (same table/bucket as v1) ---------- */
try {
  const c = window.SUPABASE_CONFIG;
  if (window.supabase && c && c.url && c.key) { app.supabase = window.supabase.createClient(c.url, c.key); app.serverReady = true; }
} catch (e) { console.warn('Supabase off', e); }

let tLocal, tServer, busy = false, again = false;
const setStatus = (t) => { const el = $('statusText'); if (el) el.textContent = t; };
export const status = setStatus;

export function save(opts = {}) {
  if (app.readonly) return; // viewers / published canvases never persist or sync
  app.dirty = true;
  if (!opts.noSync) emit('changed');
  clearTimeout(tLocal);
  tLocal = setTimeout(() => {
    try { localStorage.setItem(lsKey(app.room), JSON.stringify(app.state)); }
    catch { toast('Browser storage full: export a copy.'); }
  }, 500);
  if (app.room && app.serverReady) { clearTimeout(tServer); tServer = setTimeout(persistRoom, 1200); }
  if (!app.room) setStatus('Personal · saved');
}
export async function persistRoom() {
  if (!app.room || !app.serverReady || app.readonly) return;
  if (app.writeBlock) return; // the room could not be loaded: never upload over it
  const stars = app.state.pages.reduce((n, p) => n + p.nodes.length, 0);
  if (app.serverStars > 3 && stars === 0 && !app.state.volumes.length) { setStatus('Not saved: this would empty the room'); return; } // safety net against wiping a room by accident
  if (busy) { again = true; return; }
  busy = true;
  const room = app.room;
  try {
    const clean = JSON.parse(JSON.stringify(app.state));
    delete clean.current;
    const r = await app.supabase.from('spazio_teorie_projects').upsert({ server_id: room, name: room, state: clean, updated_at: new Date().toISOString() }, { onConflict: 'server_id' });
    if (r.error) throw r.error;
    app.serverStars = stars;
    if (app.room === room) setStatus('Synced · ' + room);
  } catch (e) { console.warn(e); setStatus('Saved locally · server unreachable'); }
  finally { busy = false; if (again) { again = false; persistRoom(); } }
}
/* null = this room does not exist yet (safe to create). app.loadError = true means "could not read it": callers must NOT write. */
export async function loadRoomFromServer(room) {
  app.loadError = false;
  if (!app.serverReady) return null;
  try {
    const r = await app.supabase.from('spazio_teorie_projects').select('state').eq('server_id', room).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return null;
    const s = normalizeState(r.data.state);
    if (!s) throw new Error('The saved room is unreadable');
    return s;
  } catch (e) { console.warn(e); app.loadError = true; return null; }
}

/* ---------- room blobs (images/PDF/EPUB shared through the bucket) ---------- */
const BUCKET = 'spazio-teorie-files';
export async function uploadBlob(id, blob, kind, room = app.room) {
  if (!room || !app.serverReady) return;
  try {
    const r = await app.supabase.storage.from(BUCKET).upload(`${room}/${kind}/${id}`, blob, { contentType: blob.type || 'application/octet-stream', upsert: true });
    if (r.error) throw r.error;
  } catch (e) { toast('Server upload failed; file stays on this device.'); }
}
export async function downloadBlob(id, kind) {
  if (!app.room || !app.serverReady) return null;
  const base = `${app.room}/${kind}/${id}`;
  const paths = [base];
  if (kind === 'blob') paths.push(...['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'].map((x) => `${base}.${x}`));
  if (kind === 'pdf') paths.push(base + '.pdf');
  for (const p of paths) {
    try { const r = await app.supabase.storage.from(BUCKET).download(p); if (!r.error && r.data) return r.data; } catch {}
  }
  return null;
}
export async function storeBlob(b) {
  const id = uid();
  await idb.put('blobs', id, { blob: b, type: b.type });
  if (app.room && !/^video\//.test(b.type || '')) uploadBlob(id, b, 'blob');
  return id;
}
export async function mediaUrl(id) {
  if (app.mediaUrls[id]) return app.mediaUrls[id];
  let rec = await idb.get('blobs', id);
  let blob = rec && rec.blob;
  if (!blob) { blob = await downloadBlob(id, 'blob'); if (blob) await idb.put('blobs', id, { blob, type: blob.type }); }
  return blob ? (app.mediaUrls[id] = URL.createObjectURL(blob)) : null;
}
export const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
export function dataURLToBlob(d) {
  const m = String(d).match(/^data:(.*?);base64,(.*)$/);
  const bin = atob(m ? m[2] : ''), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: m ? m[1] : 'application/octet-stream' });
}

/* ---------- misc ---------- */
export const copyText = (t) => navigator.clipboard ? navigator.clipboard.writeText(t).catch(() => {}) : Promise.resolve();
export const download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

/* write a whole project state to a room row (used when copying a canvas into another room) */
export async function writeRoom(room, state) {
  if (!app.serverReady) return false;
  const clean = JSON.parse(JSON.stringify(state)); delete clean.current;
  const r = await app.supabase.from('spazio_teorie_projects').upsert({ server_id: room, name: room, state: clean, updated_at: new Date().toISOString() }, { onConflict: 'server_id' });
  return !r.error;
}
