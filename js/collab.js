// P2P collaboration (Trystero), wire-compatible with v1: per-field LWW ops, Lamport clock, tombstones, file transfer, cursors, watch party.
// Every inbound value is validated/clamped/sanitized before it touches app.state or the DOM.
import { $, app, page, uid, clamp, on, emit, save, toast, status, settings, sanitize, normalizeState, idb, uploadBlob, bus, me } from './core.js';
import * as map from './map.js';

const SOURCES = ['https://esm.sh/trystero@0.21/torrent', 'https://esm.sh/trystero@0.21/nostr', 'https://cdn.jsdelivr.net/npm/trystero@0.21/+esm'];
const MAX = 2e6, CHUNK = 192 * 1024;
const FIELDS = {
  node: ['x', 'y', 'w', 'h', 'title', 'body', 'source', 'fs', 'color', 'bare', 'locked', 'group', 'comments', 'shape', 'icon', 'react', 'web'],
  conn: ['from', 'to', 'color', 'label', 'bx', 'by', 'kind'], page: ['name', 'pubId'],
  vol: ['name', 'text', 'type', 'pdf', 'folderId', 'coverId', 'locked', 'tr', 'lang', 'srcId', 'hl', 'bm', 'url'],
  draw: ['color', 'w', 'op', 'pts'], folder: ['name', 'locked'],
};
const REQ = { node: ['x', 'y', 'w', 'h'], conn: ['from', 'to'], draw: ['pts'], page: ['name'], vol: ['name'], folder: ['name'] };

/* ---------- validators: return cleaned value or undefined (= reject) ---------- */
const ID = /^[\w.-]{1,64}$/, isId = (v) => typeof v === 'string' && ID.test(v);
const num = (a, b) => (v) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : undefined);
const str = (m) => (v) => (typeof v === 'string' ? v.slice(0, m) : undefined);
const bool = (v) => !!v, bs = (v) => (typeof v === 'string' ? v.slice(0, 64) : !!v);
const idv = (v) => (isId(v) ? v : undefined);
const col = (v) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|hsla?\([\d.,%\s]+\))$/i.test(v) ? v : undefined);
const src = (v) => {
  if (typeof v === 'string') return v.slice(0, 1000);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = {}; Object.keys(v).slice(0, 20).forEach((k) => { const x = v[k]; if (/^\w{1,30}$/.test(k) && k !== '__proto__') { if (typeof x === 'string') o[k] = x.slice(0, 500); else if (typeof x === 'number' && isFinite(x)) o[k] = x; else if (typeof x === 'boolean') o[k] = x; } });
  return o;
};
const tr = (v) => { try { const s = JSON.stringify(v); return s.length < MAX ? JSON.parse(s) : undefined; } catch { return undefined; } };
const pts = (v) => (Array.isArray(v) && v.length <= 20000 && v.every((p) => Array.isArray(p) && p.length >= 2) ? v.map((p) => [clamp(+p[0] || 0, -1e6, 1e6), clamp(+p[1] || 0, -1e6, 1e6)]) : undefined);
const rv = (v) => { // reactions {emoji:[userId,...]}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined; const o = {};
  Object.keys(v).slice(0, 16).forEach((k) => { if (k.length >= 1 && k.length <= 8 && k !== '__proto__' && Array.isArray(v[k])) { const a = [...new Set(v[k].filter(isId))].slice(0, 200); if (a.length) o[k] = a; } });
  return Object.keys(o).length ? o : null;
};
const roleV = (v) => (v === 'viewer' || v === 'editor' ? v : undefined);
export const cleanMeta = (m) => { // room metadata {owner, roles:{userId:role}, defaultRole}
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined; const roles = {};
  if (m.roles && typeof m.roles === 'object') Object.keys(m.roles).slice(0, 500).forEach((k) => { if (isId(k) && k !== '__proto__' && roleV(m.roles[k])) roles[k] = m.roles[k]; });
  return { owner: isId(m.owner) ? m.owner : null, roles, defaultRole: roleV(m.defaultRole) || 'editor' };
};
const order = (v) => (Array.isArray(v) && v.length <= 5000 ? v.filter(isId) : undefined);
const cmts = (v) => (Array.isArray(v) ? v.slice(-100).filter((c) => c && typeof c === 'object' && typeof c.text === 'string').map((c) => ({ id: String(c.id || '').slice(0, 40), by: String(c.by || '').slice(0, 60), t: Number.isFinite(c.t) ? c.t : 0, text: c.text.slice(0, 1000) })) : undefined);
const V = {
  node: { web: (v) => (v && typeof v.url === 'string' && /^https?:\/\/[^\s]{1,1990}$/i.test(v.url) ? { url: v.url } : undefined), comments: cmts, shape: str(20), icon: str(8), react: rv, x: num(-1e6, 1e6), y: num(-1e6, 1e6), w: num(60, 5000), h: num(40, 5000), title: str(2000), body: (v) => (typeof v === 'string' && v.length <= MAX ? sanitize(v) : undefined), source: src, fs: num(6, 96), color: col, bare: bool, locked: bool, group: bs },
  conn: { from: idv, to: idv, color: col, label: str(300), bx: num(-1e6, 1e6), by: num(-1e6, 1e6), kind: str(20) },
  page: { name: str(200), pubId: str(40) },
  vol: { name: str(500), text: str(MAX), type: str(20), pdf: bs, folderId: idv, coverId: idv, locked: bool, tr, lang: str(20), srcId: idv, hl: tr, bm: tr, url: (v) => (typeof v === 'string' && /^https?:\/\/[^\s]{1,990}$/i.test(v) ? v : undefined) },
  draw: { color: col, w: num(0.5, 80), op: num(0, 1), pts },
  folder: { name: str(200), locked: bool },
};
const BAD = undefined;
function clean(e, k, v) { // null = delete field (not allowed for required fields)
  if (v === null || v === undefined) return REQ[e] && REQ[e].includes(k) ? BAD : null;
  return V[e][k](v);
}
function build(e, raw, extras) { // whole entity from untrusted object
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) return null;
  const o = { id: raw.id };
  FIELDS[e].forEach((k) => { const v = clean(e, k, raw[k]); if (v !== BAD && v !== null) o[k] = v; });
  if (extras) Object.keys(raw).slice(0, 60).forEach((k) => { const x = raw[k]; if (!(k in o) && k !== '__proto__' && k !== 'expanded' && /^\w{1,30}$/.test(k) && (typeof x === 'number' && isFinite(x) || typeof x === 'boolean' || typeof x === 'string' && x.length < 1000)) o[k] = x; });
  if ((REQ[e] || []).some((k) => o[k] === undefined)) return null;
  return o;
}
const list = (a, e, max, extras) => (Array.isArray(a) ? a.slice(0, max).map((x) => build(e, x, extras)).filter(Boolean) : []);
function cleanState(s) {
  if (!s || !Array.isArray(s.pages)) return null;
  const pages = s.pages.slice(0, 500).map((p) => {
    const q = build('page', p); if (!q) return null;
    q.nodes = list(p.nodes, 'node', 20000); q.connections = list(p.connections, 'conn', 40000); q.drawings = list(p.drawings, 'draw', 20000); return q;
  }).filter(Boolean);
  if (!pages.length) return null;
  const rm = cleanMeta(s.room);
  return normalizeState({ ...(rm ? { room: rm } : {}), pages, folders: list(s.folders, 'folder', 5000, true), volumes: list(s.volumes, 'vol', 5000, true), current: 0 });
}

/* ---------- module state ---------- */
const C = { active: false, room: null, ro: null, send: {}, peers: {}, synced: false, joinedAt: 0, applying: false, backedUp: false, serverLoaded: false };
let join, selfId, lc = 0, clock = {}, tomb = {}, lastSnap = {}, flushT = null, missT = null, SITE = 0, MY_HUE = 0, MY_NAME = '', lastInputAt = 0, dragId = null, libDirty = false;
const hashStr = (s) => { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const hashHue = (id) => Math.floor(((hashStr(id) * 0.61803398875) % 1) * 360);
const hsl = (h, a = 1) => `hsla(${h},90%,62%,${a})`;
const myId = () => selfId || (myId._r = myId._r || uid());
const nextT = () => { const b = Math.max(Math.floor(lc / 1000) + 1, Date.now()); return (lc = b * 1000 + SITE); };
const pick = (o, ks) => { const f = {}; ks.forEach((k) => { f[k] = o[k] === undefined ? null : o[k]; }); return f; };
const ids = (a) => a.map((x) => x.id);
const el = (id) => document.querySelector(`#world .node[data-id="${CSS.escape(id)}"]`);

/* ---------- snapshot diffing (outgoing) ---------- */
function snapshot() {
  const m = {}, s = app.state;
  s.pages.forEach((p) => {
    m['page|' + p.id] = { e: 'page', id: p.id, f: pick(p, FIELDS.page) };
    p.nodes.forEach((n) => { m['node|' + n.id] = { e: 'node', id: n.id, pid: p.id, f: pick(n, FIELDS.node) }; });
    p.connections.forEach((c) => { m['conn|' + c.id] = { e: 'conn', id: c.id, pid: p.id, f: pick(c, FIELDS.conn) }; });
    (p.drawings || []).forEach((d) => { m['draw|' + d.id] = { e: 'draw', id: d.id, pid: p.id, f: pick(d, FIELDS.draw) }; });
  });
  s.folders.forEach((f) => { m['folder|' + f.id] = { e: 'folder', id: f.id, f: pick(f, FIELDS.folder) }; });
  s.volumes.forEach((v) => { m['vol|' + v.id] = { e: 'vol', id: v.id, f: pick(v, FIELDS.vol) }; });
  m['meta|pages'] = { e: 'meta', id: 'pages', f: { order: ids(s.pages) } };
  m['meta|folders'] = { e: 'meta', id: 'folders', f: { order: ids(s.folders) } };
  m['meta|room'] = { e: 'meta', id: 'room', f: { room: s.room || null } };
  m['meta|vols'] = { e: 'meta', id: 'vols', f: { order: ids(s.volumes) } };
  return m;
}
const toStr = (sn) => { const o = {}; for (const k in sn) { const f = {}; for (const j in sn[k].f) f[j] = JSON.stringify(sn[k].f[j]); o[k] = { e: sn[k].e, id: sn[k].id, pid: sn[k].pid, f }; } return o; };
const snapStr = () => toStr(snapshot());
const push = () => { if (!C.active || C.applying || flushT) return; flushT = setTimeout(() => { flushT = null; flush(); }, 70); };
function flush() {
  if (!C.active || !C.synced || C.applying || !C.send.ops || app.readonly) return;
  const cur = snapshot(), ops = [];
  for (const key in cur) {
    const c = cur[key], l = lastSnap[key], f = {}; let any = false;
    for (const k in c.f) if (!l || l.f[k] !== JSON.stringify(c.f[k])) { f[k] = c.f[k]; any = true; }
    if (any) { const t = nextT(); for (const k in f) clock[key + '|' + k] = t; ops.push({ e: c.e, id: c.id, pid: c.pid, f, t }); }
  }
  for (const key in lastSnap) if (!cur[key]) { const l = lastSnap[key]; tomb[key] = 1; ops.push({ e: l.e, id: l.id, pid: l.pid, del: 1, t: nextT() }); }
  lastSnap = toStr(cur);
  if (ops.length) { try { C.send.ops(ops); } catch (e) { console.warn(e); } }
}
const packState = () => { const st = JSON.parse(JSON.stringify(app.state)); delete st.current; (st.folders || []).forEach((f) => { delete f.expanded; }); return { from: myId(), state: st }; };
const sendState = (target) => { if (C.active && C.send.state) try { C.send.state(packState(), target); } catch (e) { console.warn(e); } };

/* ---------- incoming ops ---------- */
const pageById = (id) => app.state.pages.find((p) => p.id === id) || null;
const byId = (a, id) => a.find((x) => x.id === id) || null;
const reorder = (a, ord) => { const m = new Map(a.map((x) => [x.id, x])), out = []; ord.forEach((id) => { if (m.has(id)) { out.push(m.get(id)); m.delete(id); } }); a.forEach((x) => { if (m.has(x.id)) out.push(x); }); return out; };
const active = () => document.activeElement;
const typingIn = (id, field) => { const a = active(); if (!a || Date.now() - lastInputAt > 700 || !a.closest) return false; const nd = a.closest('.node'); return !!nd && nd.dataset.id === id && a.classList.contains(field === 'title' ? 'node-title' : 'node-body'); };
const libTyping = () => { const a = active(); return !!(a && a.closest && a.closest('#library') && (a.isContentEditable || /INPUT|TEXTAREA/.test(a.tagName))); };

function delEntity(op, ch) {
  const s = app.state, id = op.id;
  if (op.e === 'node') { (op.pid && pageById(op.pid) ? [pageById(op.pid)] : s.pages).forEach((pg) => { pg.nodes = pg.nodes.filter((n) => n.id !== id); pg.connections = pg.connections.filter((c) => c.from !== id && c.to !== id); }); map.sel.delete(id); ch.render = 1; }
  else if (op.e === 'conn') { s.pages.forEach((pg) => { pg.connections = pg.connections.filter((c) => c.id !== id); }); ch.conns = 1; }
  else if (op.e === 'draw') { s.pages.forEach((pg) => { pg.drawings = (pg.drawings || []).filter((d) => d.id !== id); }); ch.draw = 1; }
  else if (op.e === 'page') { if (s.pages.length > 1) s.pages = s.pages.filter((p) => p.id !== id); ch.tabs = 1; }
  else if (op.e === 'vol') { s.volumes = s.volumes.filter((v) => v.id !== id); ch.lib = 1; }
  else if (op.e === 'folder') { s.folders = s.folders.filter((f) => f.id !== id); s.volumes.forEach((v) => { if (v.folderId === id) v.folderId = null; }); ch.lib = 1; }
}
function applyEntity(op, key, ch, resend, curPid) {
  const f = op.f, t = op.t, e = op.e;
  const set = (obj, filter) => { // returns map of changed fields
    const changed = {};
    for (const k of FIELDS[e]) {
      if (!(k in f)) continue; const ck = key + '|' + k; if ((clock[ck] || 0) >= t) continue;
      const r = filter ? filter(k) : 0; if (r) { if (r === 2) resend.push({ key, field: k }); continue; }
      const v = clean(e, k, f[k]); if (v === BAD) continue;
      clock[ck] = t; if (v === null) delete obj[k]; else obj[k] = v; changed[k] = 1;
    }
    return changed;
  };
  if (e === 'meta' && op.id === 'room') { // only the current owner may change roles (soft, client-side)
    const v = cleanMeta(f.room), ck = key + '|room', cur = app.state.room; if (!v || (clock[ck] || 0) >= t) return;
    if (cur && cur.owner && curPeer != null && !(C.peers[curPeer] && C.peers[curPeer].uid === cur.owner)) return;
    clock[ck] = t; app.state.room = v; ch.room = 1; return;
  }
  if (e === 'meta') {
    const ord = order(f.order), ck = key + '|order'; if (!ord || (clock[ck] || 0) >= t) return; clock[ck] = t;
    const s = app.state;
    if (op.id === 'pages') { s.pages = reorder(s.pages, ord); ch.tabs = 1; } else if (op.id === 'folders') { s.folders = reorder(s.folders, ord); ch.lib = 1; } else if (op.id === 'vols') { s.volumes = reorder(s.volumes, ord); ch.lib = 1; }
    return;
  }
  if (e === 'node') {
    const pg = pageById(op.pid); if (!pg) return; let n = byId(pg.nodes, op.id), created = false;
    if (!n) { const x = clean('node', 'x', f.x), y = clean('node', 'y', f.y); if (typeof x !== 'number' || typeof y !== 'number') return; n = { id: op.id, x: 0, y: 0, w: 240, h: 180, title: '', body: '', source: '' }; pg.nodes.push(n); created = true; }
    const geo = (k) => 'xywh'.includes(k) && k.length === 1;
    const chg = set(n, (k) => (!created && dragId && (dragId === n.id || map.sel.has(n.id)) && geo(k) ? 1 : (k === 'title' || k === 'body') && typingIn(n.id, k) ? 2 : 0));
    if (op.pid !== curPid) return;
    ch.conns = 1;
    if (created) { ch.node = ch.node || new Set(); ch.node.add(n.id); return; }
    const keys = Object.keys(chg); if (!keys.length) return;
    if (keys.every(geo)) { const d = el(n.id); if (d) { d.style.left = n.x + 'px'; d.style.top = n.y + 'px'; d.style.width = n.w + 'px'; d.style.height = n.h + 'px'; } ch.mini = 1; }
    else { ch.node = ch.node || new Set(); ch.node.add(n.id); }
    return;
  }
  if (e === 'conn') {
    const pg = pageById(op.pid); if (!pg) return; let c = byId(pg.connections, op.id);
    if (!c) { if (!isId(f.from) || !isId(f.to)) return; c = { id: op.id, from: '', to: '', color: '#6ec1ff' }; pg.connections.push(c); }
    set(c); if (op.pid === curPid) ch.conns = 1; return;
  }
  if (e === 'draw') {
    const pg = pageById(op.pid); if (!pg) return; pg.drawings = pg.drawings || []; let d = byId(pg.drawings, op.id);
    if (!d) { if (!pts(f.pts)) return; d = { id: op.id, color: '#ffffff', w: 3, pts: [] }; pg.drawings.push(d); }
    set(d); if (op.pid === curPid) ch.draw = 1; return;
  }
  if (e === 'page') {
    let p = pageById(op.id);
    if (!p) { const nm = clean('page', 'name', f.name); if (nm === BAD || nm === null) return; p = { id: op.id, name: nm, nodes: [], connections: [], drawings: [] }; clock[key + '|name'] = t; app.state.pages.push(p); ch.tabs = 1; }
    else if (set(p).name) ch.tabs = 1;
    return;
  }
  if (e === 'vol' || e === 'folder') {
    const arr = e === 'vol' ? app.state.volumes : app.state.folders; let o = byId(arr, op.id);
    if (!o) { const nm = clean(e, 'name', f.name); if (nm === BAD || nm === null) return; o = { id: op.id }; arr.push(o); }
    set(o, (k) => ((k === 'text' || k === 'name') && libTyping() ? 2 : 0)); ch.lib = 1;
  }
}
let curPeer = null;
export function applyOps(listIn, peer = null) {
  if (!C.active || !C.synced || !Array.isArray(listIn) || !listIn.length || listIn.length > 5000) return;
  try { if (JSON.stringify(listIn).length > MAX) return; } catch { return; }
  flush(); // send my pending edits first
  curPeer = peer;
  const curPid = page().id, ch = {}, resend = [], horizon = (Date.now() + 864e5) * 1000 + 999;
  C.applying = true;
  try {
    listIn.forEach((op) => {
      if (!op || !Object.hasOwn(FIELDS, op.e) && op.e !== 'meta' || !isId(op.id) || (op.pid !== undefined && op.pid !== null && !isId(op.pid)) || typeof op.t !== 'number' || !isFinite(op.t) || op.t > horizon) return;
      if (op.pid === null) delete op.pid;
      if (op.t > lc) lc = op.t;
      const key = op.e + '|' + op.id;
      if (op.del) { tomb[key] = 1; delEntity(op, ch); return; }
      if (tomb[key] || !op.f || typeof op.f !== 'object') return;
      applyEntity(op, key, ch, resend, curPid);
    });
    const ix = app.state.pages.findIndex((p) => p.id === curPid);
    if (ix < 0) { app.state.current = 0; ch.reload = 1; } else app.state.current = ix;
    lastSnap = snapStr();
    resend.forEach((r) => { const l = lastSnap[r.key]; if (l) l.f[r.field] = '\u0000resend'; });
  } finally { C.applying = false; }
  curPeer = null; if (ch.room) emit('room-meta');
  if (ch.reload) emit('state-replaced');
  else {
    if (ch.render) { map.render(); }
    else {
      if (ch.node) ch.node.forEach((id) => { const d = el(id), a = active(); if (d && a && d.contains(a)) { (dirty.add(id)); } else map.refreshNode(id); });
      if (ch.conns) map.renderLinks();
      if (ch.draw) map.renderDrawings();
      if (ch.tabs) map.renderTabs();
      if (ch.mini || ch.node) map.drawMinimap();
    }
    $('empty').hidden = page().nodes.length > 0;
    if (ch.lib) { if (libTyping()) libDirty = true; else emit('library-render'); }
  }
  save({ noSync: true });
  clearTimeout(missT); missT = setTimeout(() => requestMissing(false), 400);
  if (resend.length) push();
}
const dirty = new Set();
document.addEventListener('focusout', () => setTimeout(() => {
  if (libDirty && !libTyping()) { libDirty = false; emit('library-render'); }
  if (dirty.size && !(active() && active().closest && active().closest('.node'))) { dirty.forEach((id) => map.refreshNode(id)); dirty.clear(); }
}, 300));

function adoptState(pack) {
  const s2 = pack && cleanState(pack.state); if (!s2) return;
  if (!C.backedUp) { C.backedUp = true; try { localStorage.setItem(`spazio-teorie-backup-${C.room}-${Date.now()}`, JSON.stringify(app.state)); } catch {} }
  const keep = page().id; C.applying = true;
  try {
    app.state = s2; const ix = s2.pages.findIndex((p) => p.id === keep); s2.current = ix >= 0 ? ix : 0;
    map.sel.clear(); clock = {}; tomb = {}; C.synced = true; lastSnap = snapStr();
    emit('state-replaced'); save({ noSync: true }); requestMissing(false);
  } finally { C.applying = false; }
}

/* ---------- peers ---------- */
const peerHue = (id) => { const p = C.peers[id]; return p && typeof p.hue === 'number' ? p.hue : hashHue(id); };
function updatePeers() {
  const box = $('peers'); if (!box) return; box.textContent = '';
  const pill = (name, h) => { const p = document.createElement('span'), i = document.createElement('i'); p.className = 'peer'; i.style.background = hsl(h); i.style.boxShadow = '0 0 6px ' + hsl(h, 0.8); p.append(i, document.createTextNode(name)); box.appendChild(p); };
  pill('You', MY_HUE);
  const arr = Object.keys(C.peers); arr.forEach((id) => pill(C.peers[id].name || 'user ' + id.slice(0, 4), peerHue(id)));
  status(`Online · ${C.room} · ${arr.length + 1} connected`); emit('peers-changed');
}

/* ---------- cursors ---------- */
const cursors = {}, cbox = () => $('cursors');
let curPos = null, curT = null;
const sendCur = () => { if (!curPos || !C.active || !C.send.cur) return; const p = map.worldPos(curPos.x, curPos.y); try { C.send.cur({ x: Math.round(p.x), y: Math.round(p.y), p: page().id, h: MY_HUE }); } catch {} };
function remoteCursor(pid, d) {
  if (!d || typeof d !== 'object') return; let c = cursors[pid];
  if (d.off) { if (c) c.vis = false; return; }
  if (typeof d.x !== 'number' || typeof d.y !== 'number' || !isFinite(d.x + d.y)) return;
  if (!c) { const e = document.createElement('div'), b = document.createElement('b'); e.className = 'cursor'; e.style.left = e.style.top = '0'; e.style.display = 'none'; e.appendChild(b); cbox().appendChild(e); c = cursors[pid] = { e, b, x: 0, y: 0, vis: true, page: null, name: null, hue: -1 }; }
  c.x = clamp(d.x, -1e6, 1e6); c.y = clamp(d.y, -1e6, 1e6); c.page = typeof d.p === 'string' ? d.p : null; c.vis = true;
  const h = typeof d.h === 'number' ? clamp(d.h, 0, 360) : hashHue(pid);
  if (C.peers[pid] && typeof d.h === 'number' && C.peers[pid].hue !== h) { C.peers[pid].hue = h; updatePeers(); }
  tickCursors.on || requestAnimationFrame(tickCursors);
}
const dropCursor = (pid) => { const c = cursors[pid]; if (c) { c.e.remove(); delete cursors[pid]; } };
function tickCursors() {
  tickCursors.on = Object.keys(cursors).length > 0; if (!tickCursors.on) return;
  const cp = page().id;
  for (const pid in cursors) {
    const c = cursors[pid], show = c.vis && c.page === cp;
    c.e.style.display = show ? 'block' : 'none'; if (!show) continue;
    const nm = (C.peers[pid] && C.peers[pid].name) || 'user ' + pid.slice(0, 4), h = peerHue(pid);
    if (c.name !== nm) { c.name = nm; c.b.textContent = nm; }
    if (c.hue !== h) { c.hue = h; c.e.style.setProperty('--cc', hsl(h)); }
    c.e.style.transform = `translate3d(${c.x * map.view.z + map.view.x}px,${c.y * map.view.z + map.view.y}px,0)`;
  }
  requestAnimationFrame(tickCursors);
}

/* ---------- file transfer ---------- */
const incoming = {}, lastAsk = {}, serving = {};
let askRound = 0;
const mediaIds = () => { const s = new Set(); app.state.pages.forEach((p) => p.nodes.forEach((n) => { for (const m of (n.body || '').matchAll(/data-media-id="([^"]+)"/g)) if (isId(m[1])) s.add(m[1]); })); app.state.volumes.forEach((v) => { if (isId(v.coverId)) s.add(v.coverId); }); return [...s]; };
async function missing() {
  const need = { blobs: [], pdfs: [], epubs: [] };
  for (const id of mediaIds()) { const r = await idb.get('blobs', id); if (!(r && r.blob)) need.blobs.push(id); }
  for (const v of app.state.volumes) {
    if (v.type === 'pdf' && v.pdf && !(await idb.get('pdfs', v.id))) need.pdfs.push(v.id);
    if (v.type === 'epub' && !(await idb.get('epubs', v.id))) need.epubs.push(v.id);
  }
  return need;
}
const stale = (id) => { const n = Date.now(), i = incoming[id]; if (i && n - i.last < 9000) return false; return !(lastAsk[id] && n - lastAsk[id] < 6500); };
async function requestMissing(force) {
  if (!C.active || !C.send.need) return; const peers = Object.keys(C.peers); if (!peers.length) return;
  const need = await missing(), f = (a) => a.filter((x) => force || stale(x));
  const req = { blobs: f(need.blobs), pdfs: f(need.pdfs), epubs: f(need.epubs) };
  if (!req.blobs.length && !req.pdfs.length && !req.epubs.length) return;
  askRound++; const t = Date.now(); [...req.blobs, ...req.pdfs, ...req.epubs].forEach((x) => { lastAsk[x] = t; });
  try { C.send.need(req, peers[askRound % peers.length]); } catch (e) { console.warn(e); }
}
async function sendFile(kind, id, type, u8, peer) {
  const k = peer + '|' + id; if (serving[k]) return; serving[k] = 1;
  try { const n = Math.max(1, Math.ceil(u8.length / CHUNK)); for (let i = 0; i < n && C.active; i++) await C.send.file(u8.slice(i * CHUNK, Math.min(u8.length, (i + 1) * CHUNK)), peer, { kind, id, type, i, n }); }
  finally { delete serving[k]; }
}
const toBuf = async (r) => (r instanceof ArrayBuffer ? r : r && r.blob ? r.blob.arrayBuffer() : r instanceof Blob ? r.arrayBuffer() : null);
async function serve(req, peer) {
  if (!req || typeof req !== 'object') return;
  const L = (a) => (Array.isArray(a) ? a.filter(isId).slice(0, 200) : []);
  for (const id of L(req.blobs)) try { const r = await idb.get('blobs', id); if (r && r.blob) await sendFile('blob', id, r.type || r.blob.type || 'application/octet-stream', new Uint8Array(await r.blob.arrayBuffer()), peer); } catch (e) { console.warn(e); }
  for (const [kind, store, type] of [['pdf', 'pdfs', 'application/pdf'], ['epub', 'epubs', 'application/epub+zip']]) {
    for (const id of L(req[store])) try { const b = await toBuf(await idb.get(store, id)); if (b) await sendFile(kind, id, type, new Uint8Array(b), peer); } catch (e) { console.warn(e); }
  }
}
async function receive(data, meta) {
  if (!data || !meta || !isId(meta.id) || !['blob', 'pdf', 'epub'].includes(meta.kind) || !Number.isInteger(meta.n) || meta.n < 1 || meta.n > 3000 || !Number.isInteger(meta.i) || meta.i < 0 || meta.i >= meta.n) return;
  const id = meta.id; if (!lastAsk[id]) return; // only files we asked for
  let inc = incoming[id]; if (!inc || inc.n !== meta.n) inc = incoming[id] = { n: meta.n, parts: new Array(meta.n), got: 0, last: 0, done: false };
  if (inc.done) return; inc.last = Date.now();
  if (!inc.parts[meta.i]) { inc.parts[meta.i] = data instanceof Uint8Array ? data : new Uint8Array(data); inc.got++; }
  if (inc.got < inc.n) return; inc.done = true;
  try {
    if (meta.kind === 'blob') {
      const mt = typeof meta.type === 'string' && /^(image|video)\/[\w.+-]{1,40}$/.test(meta.type) ? meta.type : null; if (!mt) return;
      const blob = new Blob(inc.parts, { type: mt }); await idb.put('blobs', id, { blob, type: mt }); uploadBlob(id, blob, 'blob');
      if (app.mediaUrls[id]) try { URL.revokeObjectURL(app.mediaUrls[id]); } catch {}
      const u = app.mediaUrls[id] = URL.createObjectURL(blob);
      document.querySelectorAll(`#world [data-media-id="${CSS.escape(id)}"]`).forEach((m) => { m.removeAttribute('poster'); m.src = u; });
    } else {
      const ab = await new Blob(inc.parts).arrayBuffer(); await idb.put(meta.kind + 's', id, ab);
      uploadBlob(id, new Blob([ab], { type: meta.kind === 'pdf' ? 'application/pdf' : 'application/epub+zip' }), meta.kind);
    }
    if (!libTyping()) emit('library-render');
  } catch (e) { console.warn(e); delete incoming[id]; } finally { inc.parts = null; }
}

/* ---------- watch party (v1 wire format: {k:'start'|'s'|'end', id, t, p}) ---------- */
const wpar = {}; let wpBar;
const wpSend = (m) => { if (C.active && C.send.wp) try { C.send.wp(m); } catch {} };
const wpVideo = (id) => document.querySelector(`#world video[data-media-id="${CSS.escape(id)}"]`);
function wpRefresh() {
  if (!wpBar) { wpBar = document.createElement('div'); wpBar.style.cssText = 'position:fixed;left:14px;bottom:76px;z-index:60;display:none;align-items:center;gap:10px;padding:8px 12px;background:var(--panel,#0b1030);border:1px solid var(--line,#456);border-radius:8px;color:var(--ink,#fff);font:13px var(--mono,monospace)'; document.body.appendChild(wpBar); }
  const id = Object.keys(wpar)[0]; if (!id) { wpBar.style.display = 'none'; return; }
  const w = wpar[id], t = document.createElement('span'), b = document.createElement('button'); b.className = 'btn';
  t.textContent = { lead: 'Watch party: you control', follow: 'Watch party: following the leader', free: 'Watch party running: watching freely' }[w.mode];
  b.textContent = { lead: 'End', follow: 'Watch freely', free: 'Join' }[w.mode];
  b.onclick = () => { if (w.mode === 'lead') { delete wpar[id]; wpSend({ k: 'end', id }); } else w.mode = w.mode === 'follow' ? 'free' : 'follow'; wpRefresh(); };
  wpBar.replaceChildren(t, b); wpBar.style.display = 'flex';
}
function wpRecv(m, peer) {
  if (!m || typeof m !== 'object' || !isId(m.id)) return; let w = wpar[m.id];
  if (m.k === 'end') { delete wpar[m.id]; toast('Watch party ended.'); wpRefresh(); return; }
  if (m.k !== 'start' && m.k !== 's') return;
  if (!w) { w = wpar[m.id] = { leader: peer, mode: 'free' }; wpRefresh(); }
  if (w.mode === 'follow' && typeof m.t === 'number' && isFinite(m.t)) {
    const v = wpVideo(m.id); if (!v) return;
    if (Math.abs(v.currentTime - m.t) > 1.2) try { v.currentTime = Math.max(0, m.t); } catch {}
    if (m.p && v.paused) v.play().catch(() => {}); else if (!m.p && !v.paused) v.pause();
  }
}

/* ---------- API for social.js ---------- */
const NET_ACTIONS = ['pres', 'rpos'], hnd = {};
export const net = {
  isId, selfName: () => MY_NAME,
  get active() { return C.active; }, get selfId() { return selfId; }, get hue() { return MY_HUE; },
  gate: null, // (peerId) => bool: social.js sets this; false drops that peer's ops (soft roles)
  send(action, data, target) { if (C.active && C.send[action]) try { C.send[action](data, target); } catch {} },
  onMessage(action, fn) { (hnd[action] = hnd[action] || []).push(fn); }, // actions: pres, rpos, ops (called before apply)
  peers: () => Object.keys(C.peers).map((id) => ({ id, name: C.peers[id].name || 'user ' + id.slice(0, 4), hue: peerHue(id), uid: C.peers[id].uid || null })),
};
const fire = (a, d, pid) => (hnd[a] || []).forEach((f) => { try { f(d, pid); } catch (e) { console.warn(e); } });

/* ---------- join ---------- */
async function loadTrystero() {
  for (const u of SOURCES) { try { const m = await import(u); if (m && m.joinRoom) { join = m.joinRoom; selfId = m.selfId; return true; } } catch (e) { console.warn('Trystero failed from', u, e); } }
  return false;
}
export async function init(helpers = {}) {
  if (!app.room) return;
  const room = app.room;
  if (!(await loadTrystero())) { status('Server · ' + room + ' (P2P unavailable)'); toast('Live collaboration unavailable right now. Changes still sync through the server.'); return; }
  SITE = hashStr(myId()) % 1000; { const hh = parseFloat(settings.hue); MY_HUE = isFinite(hh) ? clamp(hh, 0, 360) : hashHue(myId()); }
  MY_NAME = String(settings.name || '').trim().slice(0, 40) || 'User ' + (1000 + (hashStr(myId()) % 9000));
  let ro; try { ro = join({ appId: 'spazio-teorie-app-v1' }, 'room-' + room); } catch (e) { toast('Collaboration unavailable: ' + e.message); return; }
  const A = (n) => ro.makeAction(n), st = A('state'), nd = A('need'), fl = A('file'), hi = A('hello'), op = A('ops'), cu = A('cur'), sf = A('sfx'), wp = A('wparty');
  C.send = { state: st[0], need: nd[0], file: fl[0], hello: hi[0], ops: op[0], cur: cu[0], sfx: sf[0], wp: wp[0] };
  NET_ACTIONS.forEach((n) => { const a = A(n); C.send[n] = a[0]; a[1]((d, pid) => fire(n, d, pid)); }); // after the table above, or pres/rpos get wiped
  C.active = true; C.room = room; C.ro = ro; C.peers = {}; C.backedUp = false; C.joinedAt = Date.now();
  C.serverLoaded = !!app.serverReady; C.synced = C.serverLoaded; // boot already loaded (or pushed) the server state
  clock = {}; tomb = {}; lastSnap = snapStr();
  st[1]((pack) => { if (pack && !C.serverLoaded && !C.synced) { try { if (JSON.stringify(pack).length <= 20e6) adoptState(pack); } catch {} } });
  op[1]((l, pid) => { if (net.gate && !net.gate(pid)) return; fire('ops', l, pid); applyOps(l, pid); });
  cu[1]((d, pid) => remoteCursor(pid, d));
  sf[1](() => { if (settings.allowSfx) { const a = new Audio('sfx/sfx.mp3'); a.volume = 0.5; a.play().catch(() => {}); } });
  wp[1]((m, pid) => wpRecv(m, pid));
  nd[1]((req, pid) => serve(req, pid));
  fl[1]((data, pid, meta) => receive(data, meta));
  hi[1]((info, pid) => {
    const pr = C.peers[pid] || (C.peers[pid] = {});
    pr.name = info && typeof info.name === 'string' ? info.name.slice(0, 40) : null; pr.joinedAt = info && typeof info.joinedAt === 'number' ? info.joinedAt : 0;
    pr.uid = info && isId(info.uid) ? info.uid : null;
    if (info && typeof info.h === 'number') pr.hue = clamp(info.h, 0, 360);
    updatePeers();
    const theirs = pr.joinedAt || 0, mine = C.joinedAt, older = mine < theirs || (mine === theirs && String(myId()) < String(pid));
    if (!older) return;
    if (!C.synced) { if (Object.values(C.peers).some((p) => p.joinedAt != null && p.joinedAt < mine)) return; C.synced = true; lastSnap = snapStr(); } else flush();
    sendState(pid);
  });
  ro.onPeerJoin((pid) => { C.peers[pid] = C.peers[pid] || { name: null }; updatePeers(); try { C.send.hello({ name: MY_NAME, joinedAt: C.joinedAt, h: MY_HUE, uid: me().id }, pid); } catch {} toast('A friend joined the room'); setTimeout(() => requestMissing(false), 2500); });
  ro.onPeerLeave((pid) => { delete C.peers[pid]; dropCursor(pid); updatePeers(); fire('leave', null, pid); });
  // outgoing triggers + local input tracking
  on('changed', push); on('live', push);
  document.addEventListener('input', () => { lastInputAt = Date.now(); }, true);
  const vp = $('viewport');
  vp.addEventListener('pointerdown', (e) => { const n = e.target.closest && e.target.closest('.node'); dragId = n ? n.dataset.id : null; }, true);
  addEventListener('pointerup', () => { dragId = null; }, true); addEventListener('pointercancel', () => { dragId = null; }, true);
  vp.addEventListener('pointermove', (e) => { curPos = { x: e.clientX, y: e.clientY }; if (!curT) curT = setTimeout(() => { curT = null; sendCur(); }, 90); });
  vp.addEventListener('pointerleave', () => { curPos = null; try { C.send.cur({ off: 1 }); } catch {} });
  ['play', 'pause', 'seeked'].forEach((ev) => $('world').addEventListener(ev, (e) => { const v = e.target, id = v && v.dataset && v.dataset.mediaId, w = id && wpar[id]; if (w && w.mode === 'lead') wpSend({ k: 's', id, t: v.currentTime, p: !v.paused }); }, true));
  setInterval(() => { for (const id in wpar) { const w = wpar[id], v = w.mode === 'lead' && wpVideo(id); if (v) wpSend({ k: 's', id, t: v.currentTime, p: !v.paused }); } }, 3000);
  setInterval(() => requestMissing(false), 7000);
  $('world').addEventListener('contextmenu', (e) => {
    const v = e.target; if (!v || v.tagName !== 'VIDEO' || !v.dataset.mediaId || !helpers.showMenu) return; e.preventDefault(); e.stopPropagation();
    const id = v.dataset.mediaId, w = wpar[id], items = [];
    if (w && w.mode === 'lead') items.push({ l: 'End watch party', fn: () => { delete wpar[id]; wpSend({ k: 'end', id }); wpRefresh(); } });
    else if (w && w.mode === 'follow') items.push({ l: 'Stop following', fn: () => { w.mode = 'free'; wpRefresh(); } });
    else if (w) items.push({ l: 'Join watch party', fn: () => { w.mode = 'follow'; wpRefresh(); } });
    else items.push({ l: 'Start watch party (you control)', fn: () => { wpar[id] = { leader: null, mode: 'lead' }; wpSend({ k: 'start', id, t: v.currentTime, p: !v.paused }); toast('Watch party started.'); wpRefresh(); } });
    helpers.showMenu(items, e.clientX, e.clientY);
  }, true);
  addEventListener('pagehide', () => { try { ro.leave(); } catch {} });
  updatePeers(); setTimeout(() => requestMissing(false), 3500);
}

