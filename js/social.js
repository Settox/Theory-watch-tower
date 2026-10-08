// Social layer: presence + follow, soft roles, reactions + voting, activity feed, share links, public canvases, reading transport.
// Talks to collab.js only through its `net` API; all inbound data is validated.
import { $, app, page, on, emit, save, toast, me, idb, uploadBlob, mediaUrl, copyText, cleanRoom, clamp, normalizeState, defaultState } from './core.js';
import * as map from './map.js';
import { net, cleanMeta } from './collab.js';
import { clonePage } from './canvasops.js';

const T = 'spazio_teorie_projects', ME = me(), P = new URLSearchParams(location.search), VIEW = P.get('view'), GUEST = P.get('role') === 'viewer';
const KEY = app.room || 'personal', isId = (v) => typeof v === 'string' && /^[\w.-]{1,64}$/.test(v);
const str = (v, m) => (typeof v === 'string' ? v.slice(0, m) : '');
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let H;
const panels = {};

/* ---------- soft roles ---------- */
const meta = () => cleanMeta(app.state.room);
const roleOf = (u) => { const m = meta(); if (!m) return 'editor'; if (u === m.owner) return 'editor'; return Object.hasOwn(m.roles, u) ? m.roles[u] : m.defaultRole; };
const isOwner = () => { const m = meta(); return !!m && m.owner === ME.id; };
const selfRole = () => { const m = meta(), explicit = m && (m.owner === ME.id || Object.hasOwn(m.roles, ME.id)); return !explicit && GUEST ? 'viewer' : roleOf(ME.id); };
function applyRole() {
  if (VIEW || !app.room) return; const v = selfRole() === 'viewer'; if (v === app.readonly) return;
  app.readonly = v; document.body.classList.toggle('readonly', v); map.render(); renderPeers(); toast(v ? 'You are a viewer in this room.' : 'You can edit in this room.');
}
function commit(m) { app.state.room = cleanMeta(m); save(); applyRole(); emit('room-meta'); }
const seenKey = 'st-members:' + KEY;
function members() { // [{u, name}] from peers, roles, owner and local memory
  const mem = lsGet(seenKey, {}), m = meta(); mem[ME.id] = ME.name;
  net.peers().forEach((p) => { if (p.uid) mem[p.uid] = p.name; });
  lsSet(seenKey, mem); const set = new Set([ME.id, ...Object.keys(mem)]);
  if (m) { if (m.owner) set.add(m.owner); Object.keys(m.roles).forEach((k) => set.add(k)); }
  return [...set].map((u) => ({ u, name: mem[u] || 'Unknown' }));
}
const HELP = ['Roles are soft: only honest copies of this app obey them; a modified client can ignore them.',
  'Hard enforcement needs Supabase Auth, so every request carries a verified user identity.',
  'Plus Row Level Security policies on the project table and storage, so the database itself rejects writes from viewers.'];
function rolesModal() {
  if (!app.room) return toast('Join a room first (Room button).');
  H.openModal((card, close) => {
    const m = meta(), owner = isOwner(), list = H.h('div', { className: 'st-rows' });
    const help = H.h('div', { className: 'hint st-help', hidden: true }, ...HELP.map((t) => H.h('div', { textContent: t })));
    const sel = (val, fn, dis) => { const s = H.h('select', { disabled: dis }, ...['editor', 'viewer'].map((r) => H.h('option', { value: r, textContent: r, selected: r === val }))); s.onchange = () => fn(s.value); return s; };
    members().forEach(({ u, name }) => {
      const row = H.h('div', { className: 'st-row' }, H.h('span', { className: 'st-who', textContent: `${name}${u === ME.id ? ' (you)' : ''}` }), H.h('span', { className: 'mono st-id', textContent: '#' + u.slice(-4) + (m && m.owner === u ? ' · owner' : '') }));
      if (m && m.owner === u) row.append(H.h('span', { className: 'mono', textContent: 'editor' }));
      else {
        row.append(sel(roleOf(u), (r) => { const x = meta(); x.roles[u] = r; commit(x); }, !owner));
        if (owner && u !== ME.id) row.append(H.btn('Make owner', () => { const x = meta(); x.owner = u; x.roles[ME.id] = 'editor'; commit(x); close(); toast('Ownership transferred.'); }));
      }
      list.append(row);
    });
    const helpBtn = H.btn('? How strong are roles', () => { help.hidden = !help.hidden; }); helpBtn.title = HELP.join('\n');
    card.append(H.h('h2', { className: 'serif', textContent: 'Room members & roles' }),
      H.h('p', { className: 'hint', textContent: m ? (owner ? 'You are the owner. Roles are soft (see ?).' : 'Only the owner can change roles. Roles are soft (see ?).') : 'This room has no owner yet.' }), helpBtn, help, list);
    if (!m) card.append(H.btn('Claim ownership', () => { commit({ owner: ME.id, roles: {}, defaultRole: 'editor' }); close(); }, 'primary'));
    if (m && owner) card.append(H.h('label', { textContent: 'Role for newcomers' }, sel(m.defaultRole, (r) => { const x = meta(); x.defaultRole = r; commit(x); }, false)));
    card.append(H.h('div', { style: 'display:flex;justify-content:flex-end' }, H.btn('Close', close, 'primary')));
  });
}

/* ---------- presence + follow ---------- */
const pres = {};
let following = null, lastKey = '', lastSent = 0, rq = 0;
const chip = (name, hue, cls = '') => H.h('button', { type: 'button', className: 'st-chip ' + cls, style: `--h:${hue}`, textContent: ([...name.trim()][0] || '?').toUpperCase() });
function renderPeers() {
  const box = $('peers'); if (!box || VIEW) return; cancelAnimationFrame(rq);
  rq = requestAnimationFrame(() => {
    box.textContent = ''; const ps = net.peers();
    const me0 = chip(ME.name, net.hue, 'self'); me0.title = 'You'; me0.disabled = true; box.append(me0);
    ps.forEach((p) => {
      const d = pres[p.id], c = chip(p.name, p.hue, following === p.id ? 'on' : ''), cv = d ? d.n : '';
      c.title = `${p.name}${p.uid && roleOf(p.uid) === 'viewer' ? ' (viewer)' : ''}${cv ? ' · on ' + cv : ''}\n${following === p.id ? 'Click to stop following' : 'Click to follow'}`;
      c.onclick = () => { following = following === p.id ? null : p.id; toast(following ? 'Following ' + p.name : 'Stopped following'); if (following && d) follow(d); renderPeers(); };
      box.append(c); if (cv) box.append(H.h('span', { className: 'st-cv mono', textContent: cv }));
    });
    box.append(H.h('span', { className: 'st-here mono', textContent: `${ps.length + 1} here` }));
    if (app.readonly) box.append(H.h('span', { className: 'st-ro mono', textContent: 'view only' }));
  });
}
function follow(d) {
  const i = app.state.pages.findIndex((p) => p.id === d.c); if (i < 0) return;
  if (i !== app.state.current) map.switchPage(i);
  const r = $('viewport').getBoundingClientRect(); map.view.z = d.z; map.view.x = r.width / 2 - d.cx * d.z; map.view.y = r.height / 2 - d.cy * d.z; map.applyView(false);
}
export function onPres(d, pid) { // exported for tests
  if (!d || typeof d !== 'object' || !isId(d.c) || ![d.cx, d.cy, d.z].every((x) => typeof x === 'number' && isFinite(x))) return;
  pres[pid] = { c: d.c, n: str(d.n, 60), cx: clamp(d.cx, -1e6, 1e6), cy: clamp(d.cy, -1e6, 1e6), z: clamp(d.z, 0.1, 3) };
  if (following === pid) follow(pres[pid]);
  renderPeers();
}
function broadcastTick() {
  if (!net.active || !net.peers().length) return; const c = page().id, v = map.viewCenter(), z = map.view.z, k = `${c}|${Math.round(v.x)}|${Math.round(v.y)}|${z.toFixed(3)}`;
  if (k === lastKey && Date.now() - lastSent < 4000) return; lastKey = k; lastSent = Date.now();
  net.send('pres', { c, n: page().name, cx: Math.round(v.x), cy: Math.round(v.y), z: +z.toFixed(3) });
}

/* ---------- reactions + voting ---------- */
const DEF = ['👍', '❤️', '💡', '❓', '⚠️'], PICK = [...DEF, '🎉', '🔥', '👀'];
const rxOf = (n) => (n.react && typeof n.react === 'object' && !Array.isArray(n.react) ? n.react : {});
const rxList = (n, e) => (Array.isArray(rxOf(n)[e]) ? rxOf(n)[e] : []);
function toggleReact(n, e) {
  if (app.readonly) return; const rx = { ...rxOf(n) }, a = new Set(rxList(n, e)); if (a.has(ME.id)) a.delete(ME.id); else a.add(ME.id);
  if (a.size) rx[e] = [...a]; else delete rx[e];
  if (Object.keys(rx).length) n.react = rx; else delete n.react;
  save();
}
function decorate(n, el) { // existing reactions only (no add buttons on the star): to react, right-click a star
  el.querySelector(':scope > .rx-row')?.remove(); const have = Object.keys(rxOf(n)).filter((e) => rxList(n, e).length); if (!have.length) return;
  const row = H.h('div', { className: 'rx-row' }); row.onpointerdown = (e) => e.stopPropagation();
  have.forEach((e) => {
    const a = rxList(n, e), b = H.h('button', { type: 'button', className: 'rx' + (a.includes(ME.id) ? ' mine' : ''), textContent: e + ' ' + a.length, disabled: app.readonly, title: a.length + (a.length === 1 ? ' reaction' : ' reactions') });
    b.onclick = (ev) => { ev.stopPropagation(); toggleReact(n, e); decorate(n, el); }; row.append(b);
  });
  el.append(row);
}
// right-click menu entries (main.js emits 'node-menu-items' with a mutable list before showing the menu)
on('node-menu-items', ({ n, items }) => {
  if (app.readonly) return;
  PICK.forEach((e) => items.push({ l: `${rxList(n, e).includes(ME.id) ? '✓ ' : ''}${e}  React`, fn: () => { toggleReact(n, e); map.refreshNode(n.id); } }));
});
const votes = (n) => rxList(n, '👍').length;
function panel(id, title, render) {
  const box = H.h('div', { className: 'st-panel', hidden: true, id: 'st-' + id }), body = H.h('div', { className: 'st-pbody' });
  box.append(H.h('div', { className: 'st-phead' }, H.h('b', { className: 'serif', textContent: title }), H.h('button', { type: 'button', className: 'btn', textContent: '✕', 'aria-label': 'Close', onclick: () => { box.hidden = true; } })), body);
  document.body.append(box);
  return (panels[id] = { box, body, draw() { body.textContent = ''; render(body); }, toggle() { box.hidden = !box.hidden; if (!box.hidden) this.draw(); } });
}
function voteDraw(b) {
  const r = page().nodes.filter((n) => votes(n) > 0).sort((x, y) => votes(y) - votes(x)).slice(0, 20);
  b.append(H.h('p', { className: 'hint', textContent: 'Stars ranked by 👍 on this canvas. React on a star to vote.' }));
  if (!r.length) b.append(H.h('p', { className: 'hint', textContent: 'No votes yet.' }));
  r.forEach((n, i) => b.append(H.h('button', { type: 'button', className: 'st-item', textContent: `${i + 1}. ${n.title || 'Untitled'}  ·  👍 ${votes(n)}`, onclick: () => map.focusNode(n.id) })));
}

/* ---------- activity feed ---------- */
let acts = lsGet('st-activity:' + KEY, []), dT = 0, base = null;
const lastSeen = +localStorage.getItem('st-lastvisit:' + KEY) || 0;
let readAt = lastSeen;
if (!Array.isArray(acts)) acts = [];
const unread = () => acts.filter((a) => a.t > readAt && a.u !== ME.id).length;
function badge() { const b = $('btnCollab'); if (!b) return; let d = b.querySelector('.st-dot'); if (!d) { d = H.h('i', { className: 'st-dot' }); b.append(d); } d.hidden = !unread(); }
export function rec(kind, text, who, ref = {}, u = null) {
  const t = Date.now(), last = acts.slice(-5).reverse().find((a) => a.k === kind && a.who === who && a.nid === ref.nid && t - a.t < 60000);
  if (last && kind !== 'added' && kind !== 'deleted' && kind !== 'linked') { last.text = text; last.t = t; } else acts.push({ t, k: kind, who: str(who, 40) || 'Someone', text: str(text, 200), u, ...ref });
  acts = acts.slice(-200); lsSet('st-activity:' + KEY, acts); badge(); if (panels.act && !panels.act.box.hidden) panels.act.draw();
}
const hlCount = (h) => (Array.isArray(h) ? h.length : h && typeof h === 'object' ? Object.values(h).reduce((a, x) => a + (Array.isArray(x) ? x.length : 1), 0) : 0);
function lite() {
  const o = { n: {}, c: {}, p: {}, h: {} };
  app.state.pages.forEach((p) => {
    o.p[p.id] = p.name;
    p.nodes.forEach((n) => { o.n[n.id] = { t: n.title || '', p: p.id, c: (n.comments || []).length, r: Object.values(rxOf(n)).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0) }; });
    p.connections.forEach((c) => { o.c[c.id] = [c.from, c.to]; });
  });
  app.state.volumes.forEach((v) => { o.h[v.id] = { n: v.name || 'a volume', c: hlCount(v.hl) }; });
  return o;
}
export function diff(a, b, who, u) {
  const q = (s) => `“${str(s, 40) || 'Untitled'}”`, R = (k, t, ref) => rec(k, t, who, ref, u);
  for (const id in b.p) if (!(id in a.p)) R('canvas', `created canvas ${q(b.p[id])}`, { pid: id });
  for (const id in b.n) {
    const x = a.n[id], y = b.n[id];
    if (!x) R('added', `added a star ${q(y.t)}`, { nid: id, pid: y.p });
    else {
      if (y.c > x.c) R('commented', `commented on ${q(y.t)}`, { nid: id, pid: y.p });
      if (y.r !== x.r) R('reacted', `reacted on ${q(y.t)}`, { nid: id, pid: y.p });
      if (x.t && y.t && x.t !== y.t) R('renamed', `renamed ${q(x.t)} to ${q(y.t)}`, { nid: id, pid: y.p });
    }
  }
  for (const id in a.n) if (!(id in b.n) && b.p[a.n[id].p]) R('deleted', `deleted a star ${q(a.n[id].t)}`, {});
  for (const id in b.c) if (!(id in a.c)) { const f = b.n[b.c[id][0]], t = b.n[b.c[id][1]]; if (f && t) R('linked', `linked ${q(f.t)} to ${q(t.t)}`, { nid: b.c[id][0], pid: f.p }); }
  for (const id in b.h) if (a.h[id] && b.h[id].c > a.h[id].c) R('highlight', `highlighted in ${q(b.h[id].n)}`, {});
}
function localDiff() { clearTimeout(dT); const cur = lite(); if (base) diff(base, cur, ME.name, ME.id); base = cur; }
function goTo(a) {
  const i = app.state.pages.findIndex((p) => p.id === a.pid); if (i < 0) return toast('That canvas no longer exists.');
  if (i !== app.state.current) map.switchPage(i);
  if (a.nid && page().nodes.some((n) => n.id === a.nid)) map.focusNode(a.nid);
}
function actDraw(b) {
  badge(); if (!acts.length) b.append(H.h('p', { className: 'hint', textContent: 'Nothing yet. Adds, links, comments and reactions will show up here.' }));
  let div = false;
  [...acts].reverse().forEach((a) => {
    if (!div && lastSeen && a.t <= lastSeen) { div = true; b.append(H.h('div', { className: 'st-div mono', textContent: 'Since you were last here ↑' })); }
    b.append(H.h('button', { type: 'button', className: 'st-item' + (a.pid ? ' go' : ''), onclick: () => a.pid && goTo(a) }, H.h('b', { textContent: a.who }), ` ${a.text}`, H.h('time', { className: 'mono', textContent: new Date(a.t).toLocaleString() })));
  });
  if (!div && lastSeen && acts.length) b.append(H.h('div', { className: 'st-div mono', textContent: 'Since you were last here ↑' }));
}
function remoteOps(l, pid) { // called by collab just before it applies a peer's ops
  if (!Array.isArray(l)) return; localDiff();
  const p = net.peers().find((x) => x.id === pid), who = p ? p.name : 'A friend';
  setTimeout(() => { const cur = lite(); if (base) diff(base, cur, who, p && p.uid); base = cur; }, 0);
}

/* ---------- share links ---------- */
const copyRow = (label, url) => H.h('label', { textContent: label }, H.h('div', { style: 'display:flex;gap:6px' }, H.h('input', { value: url, readOnly: true, onfocus: (e) => e.target.select() }), H.btn('Copy', () => copyText(url).then(() => toast('Link copied')))));
function shareModal() {
  if (!app.room) return toast('Join a room first (Room button).');
  const base0 = `${location.origin}${location.pathname}?room=${encodeURIComponent(app.room)}`;
  H.openModal((card, close) => card.append(H.h('h2', { className: 'serif', textContent: 'Share links' }), copyRow('Invite link (can edit)', base0), copyRow('Guest link (opens as viewer)', base0 + '&role=viewer'),
    H.h('p', { className: 'hint', textContent: 'Both links are only as private as the room name: anyone who has the link, or guesses the name, gets in. The guest link just asks the app to open read-only; the owner’s roles win, and it is not a lock.' }),
    H.h('div', { style: 'display:flex;justify-content:flex-end' }, H.btn('Close', close, 'primary'))));
}

/* ---------- public canvases ---------- */
const rand = (n) => { const a = crypto.getRandomValues(new Uint8Array(n)), s = 'abcdefghijklmnopqrstuvwxyz0123456789'; return [...a].map((x) => s[x % 36]).join(''); };
const viewUrl = (id) => `${location.origin}${location.pathname}?view=${id}`;
const mediaOf = (p) => { const s = new Set(); p.nodes.forEach((n) => { for (const m of (n.body || '').matchAll(/data-media-id="([^"]+)"/g)) if (isId(m[1])) s.add(m[1]); }); return [...s]; };
export async function publish(update) {
  const p = page(), id = update && isId(p.pubId) ? p.pubId : rand(20), c = clonePage(p, { detach: true, name: p.name });
  delete c.pubId; c.nodes.forEach((n) => { delete n.comments; delete n.react; });
  const r = await app.supabase.from(T).upsert({ server_id: 'pub-' + id, name: 'pub-' + id, state: { pages: [c], folders: [], volumes: [], journeys: [] }, updated_at: new Date().toISOString() }, { onConflict: 'server_id' });
  if (r.error) throw r.error;
  p.pubId = id; save();
  for (const m of mediaOf(c)) { const rc = await idb.get('blobs', m); if (rc && rc.blob && rc.blob.size < 25e6) await uploadBlob(m, rc.blob, 'blob', 'pub-' + id); }
  return id;
}
export async function unpublish() {
  const p = page(), id = p.pubId; if (!isId(id)) return false;
  const r = await app.supabase.from(T).delete().eq('server_id', 'pub-' + id).select();
  if (r.error || (Array.isArray(r.data) && !r.data.length)) return false;
  delete p.pubId; save(); return true;
}
function publishModal() {
  if (app.readonly) return toast('Viewers cannot publish.');
  if (!app.serverReady) return toast('Publishing needs the server connection, which is unavailable.');
  H.openModal((card, close) => {
    const out = H.h('div'), body = H.h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }), note = H.h('p', { className: 'hint' });
    const draw = (msg = '') => {
      const id = page().pubId; out.textContent = ''; body.textContent = ''; note.textContent = msg;
      if (isId(id)) out.append(copyRow('Public link', viewUrl(id)));
      body.append(H.btn(isId(id) ? 'Update published copy' : 'Publish canvas', async () => { note.textContent = 'Publishing…'; try { await publish(true); toast('Published'); draw(); } catch (e) { draw('Publishing failed: ' + (e.message || e)); } }, 'primary'));
      if (isId(id)) body.append(H.btn('Unpublish', async () => { note.textContent = 'Removing…'; const ok = await unpublish().catch(() => false); draw(ok ? 'Unpublished.' : 'The server did not allow deleting it, so the link may still work.'); }));
    };
    card.append(H.h('h2', { className: 'serif', textContent: 'Publish this canvas' }), H.h('p', { className: 'hint', textContent: `Makes a public read-only snapshot of “${page().name}” that anyone with the link can see. Comments and reactions are left out; library links become plain text. Update it to refresh.` }), out, body, note, H.h('div', { style: 'display:flex;justify-content:flex-end' }, H.btn('Close', close)));
    draw();
  });
}
async function viewMode() {
  const id = cleanRoom(VIEW), ids = []; app.state.pages.forEach((p) => ids.push(...mediaOf(p)));
  const bar = H.h('div', { className: 'st-banner' }, H.h('span', { textContent: 'Viewing a published canvas (read-only)' }),
    H.btn('Make my own copy', () => {
      const c = clonePage(page(), { detach: true, name: page().name + ' (copy)' });
      let st = null; try { st = normalizeState(JSON.parse(localStorage.getItem('spazio-teorie-v3') || 'null')); } catch {}
      st = st || defaultState(); if (st.pages.length === 1 && !st.pages[0].nodes.length) st.pages = []; st.pages.push(c);
      try { localStorage.setItem('spazio-teorie-v3', JSON.stringify(st)); toast('Copied to your canvases'); setTimeout(() => { location.href = 'app.html'; }, 600); } catch { toast('Browser storage full.'); }
    }), H.btn('Home', () => { location.href = './'; }));
  document.body.append(bar);
  // ponytail: app.room is patched only while hydrating pub-<id> media; save() stays a no-op (readonly) and collab is not loaded
  if (ids.length && app.serverReady) { app.room = 'pub-' + id; try { await Promise.all(ids.map((m) => mediaUrl(m).catch(() => null))); } finally { app.room = null; } map.render(); }
}

/* ---------- reading transport ---------- */
export function readerIn(d, pid) {
  if (!d || typeof d !== 'object' || !isId(d.v) || !app.state.volumes.some((v) => v.id === d.v)) return;
  const p = net.peers().find((x) => x.id === pid), o = { id: pid, name: p ? p.name : 'A friend', hue: p ? p.hue : 200, volumeId: d.v, label: str(d.l, 200) };
  if (typeof d.p === 'number' && isFinite(d.p)) o.page = clamp(Math.round(d.p), 0, 1e6);
  if (typeof d.c === 'string') o.cfi = d.c.slice(0, 400);
  emit('peer-reader', o);
}

/* ---------- init ---------- */
export function init(helpers) {
  H = helpers; panel('vote', 'Vote ranking', voteDraw); panel('act', 'Activity', actDraw);
  if (VIEW) { viewMode(); return; }
  const tool = (label, fn) => emit('register-tool', { label, fn });
  tool('Room members & roles', rolesModal); tool('Share links', shareModal); tool('Vote on stars (ranking)', () => panels.vote.toggle());
  tool('Activity', () => { panels.act.toggle(); if (!panels.act.box.hidden) { readAt = Date.now(); badge(); } }); tool('Publish canvas', publishModal);
  on('node-rendered', ({ n, el }) => decorate(n, el));
  on('changed', () => { clearTimeout(dT); dT = setTimeout(localDiff, 900); if (!panels.vote.box.hidden) panels.vote.draw(); });
  on('state-replaced', () => { base = lite(); });
  on('activity', (d) => { if (d && typeof d.text === 'string') rec(str(d.kind, 20) || 'note', d.text, str(d.who, 40) || ME.name, {}, d.who ? null : ME.id); });
  on('reader-pos', (d) => { if (d && isId(d.volumeId)) net.send('rpos', { v: d.volumeId, l: str(d.label, 200), p: d.page, c: d.cfi }); });
  on('room-meta', () => { applyRole(); renderPeers(); });
  on('peers-changed', renderPeers);
  base = lite(); badge();
  const seen = () => { try { localStorage.setItem('st-lastvisit:' + KEY, String(Date.now())); } catch {} };
  addEventListener('pagehide', seen); document.addEventListener('visibilitychange', () => { if (document.hidden) seen(); });
  if (!app.room) return;
  net.gate = (pid) => { const p = net.peers().find((x) => x.id === pid); return !p || !p.uid || roleOf(p.uid) !== 'viewer'; };
  net.onMessage('ops', remoteOps); net.onMessage('pres', onPres); net.onMessage('rpos', readerIn);
  net.onMessage('leave', (_, pid) => { delete pres[pid]; if (following === pid) following = null; renderPeers(); });
  setInterval(broadcastTick, 150); applyRole(); renderPeers();
  // soft: the first one in a room with no metadata becomes owner
  setTimeout(() => { if (net.active && !app.state.room && !GUEST && !app.readonly) commit({ owner: ME.id, roles: {}, defaultRole: 'editor' }); }, 6000);
}
