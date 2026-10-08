// Map engine: stars (nodes), constellation lines, pan/zoom/pinch, selection, undo, pen, minimap, layout.
import { openShapePicker, SHAPES } from './shapes.js';
import { ic } from './icons.js';
import { $, app, page, findNode, uid, clamp, save, toast, on, emit, sanitize, escapeHtml, storeBlob, mediaUrl, settings } from './core.js';

export const PALETTE = ['#e8c872', '#7fd6ff', '#ff8fa8', '#8be3a4', '#c4a6ff', '#ffb27a', '#f4f1e8'];
export const view = { x: 0, y: 0, z: 1 };
export const sel = new Set();           // selected node ids
export let selConn = null;
export const pen = { on: false, tool: 'pen', color: '#f4f1e8', w: 3 };
let color = PALETTE[0];
const NS = 'http://www.w3.org/2000/svg';
const viewport = $('viewport'), world = $('world'), svg = $('svg'), drawSvg = $('drawSvg');
const els = {};                         // node id -> element
let viewsByPage = {};
try { viewsByPage = JSON.parse(localStorage.getItem('spazio-teorie-views') || '{}') || {}; } catch {}

/* ---------- coordinates & view ---------- */
export const worldPos = (cx, cy) => { const r = viewport.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };
export const viewCenter = () => { const r = viewport.getBoundingClientRect(); return worldPos(r.left + r.width / 2, r.top + r.height / 2); };
export function applyView(persist = true) {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  $('zVal').textContent = Math.round(view.z * 100) + '%';
  drawMinimap();
  if (persist) { viewsByPage[page().id] = { ...view }; clearTimeout(applyView.t); applyView.t = setTimeout(() => { try { localStorage.setItem('spazio-teorie-views', JSON.stringify(viewsByPage)); } catch {} }, 400); }
}
export function zoomAt(cx, cy, f) {
  const r = viewport.getBoundingClientRect(), z = clamp(view.z * f, 0.1, 3), k = z / view.z;
  view.x = (cx - r.left) - ((cx - r.left) - view.x) * k; view.y = (cy - r.top) - ((cy - r.top) - view.y) * k; view.z = z; applyView();
}
export function fitAll(nodes = page().nodes) {
  if (!nodes.length) { Object.assign(view, { x: 0, y: 0, z: 1 }); return applyView(); }
  const r = viewport.getBoundingClientRect();
  const x0 = Math.min(...nodes.map((n) => n.x)), y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.w)), y1 = Math.max(...nodes.map((n) => n.y + n.h));
  const z = clamp(Math.min((r.width - 80) / (x1 - x0 || 1), (r.height - 160) / (y1 - y0 || 1)), 0.1, 1.5);
  view.z = z; view.x = (r.width - (x1 - x0) * z) / 2 - x0 * z; view.y = (r.height - (y1 - y0) * z) / 2 - y0 * z; applyView();
}
export function focusNode(id) {
  const n = findNode(id); if (!n) return;
  const r = viewport.getBoundingClientRect(); view.z = Math.max(view.z, 0.8);
  view.x = r.width / 2 - (n.x + n.w / 2) * view.z; view.y = r.height / 2 - (n.y + n.h / 2) * view.z; applyView(); select(id);
}

/* ---------- history (undo/redo) ---------- */
const hist = { u: [], r: [], cur: null, busy: false, t: 0 };
const snap = () => JSON.stringify({ n: page().nodes, c: page().connections, d: page().drawings });
function histCapture() {
  if (hist.busy) return;
  const s = snap();
  if (hist.cur === null) { hist.cur = s; return; }
  if (s === hist.cur) return;
  const now = Date.now();
  if (now - hist.t > 700) { hist.u.push(hist.cur); if (hist.u.length > 80) hist.u.shift(); }
  hist.t = now; hist.cur = s; hist.r = [];
}
function histApply(s) {
  const o = JSON.parse(s), p = page(); hist.busy = true;
  p.nodes = o.n; p.connections = o.c; p.drawings = o.d; hist.cur = s; sel.clear(); selConn = null;
  render(); hist.busy = false; save();
}
export const undo = () => { if (hist.u.length) { hist.r.push(hist.cur); histApply(hist.u.pop()); } else toast('Nothing to undo'); };
export const redo = () => { if (hist.r.length) { hist.u.push(hist.cur); histApply(hist.r.pop()); } else toast('Nothing to redo'); };
on('changed', histCapture);

/* ---------- nodes ---------- */
const serializeBody = (el) => { const c = el.cloneNode(true); c.querySelectorAll('[data-media-id]').forEach((m) => { m.removeAttribute('src'); m.removeAttribute('poster'); }); return sanitize(c.innerHTML); };
async function hydrate(root) {
  for (const m of root.querySelectorAll('[data-media-id]')) {
    m.contentEditable = 'false';
    const u = await mediaUrl(m.dataset.mediaId); if (u) m.src = u;
  }
}
function styleNode(el, n) {
  el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; el.style.width = n.w + 'px'; el.style.height = n.h + 'px';
  el.style.setProperty('--nc', n.color || PALETTE[0]); el.style.setProperty('--fs', (n.fs || 13) + 'px');
  el.classList.toggle('bare', !!n.bare); el.classList.toggle('locked', !!n.locked); el.classList.toggle('group', !!n.group);
  const lk = el.querySelector('.node-lock'); lk.replaceChildren(ic(n.locked ? 'lock' : 'unlock', 14)); lk.title = lk.ariaLabel = n.locked ? 'Unlock' : 'Lock'; lk.classList.toggle('on', !!n.locked);
  const shp = SHAPES.includes(n.shape) ? n.shape : 'rounded'; el.className = el.className.replace(/shp-\w+/g, '').trim() + ' shp-' + shp;
  const emoji = el.querySelector('.node-icon'); emoji.textContent = typeof n.icon === 'string' ? n.icon.slice(0, 8) : ''; emoji.hidden = !emoji.textContent; // (not named `ic`: that is the imported lock-icon function)
  const cn = (n.comments || []).length, bd = el.querySelector('.node-cmt i'); bd.textContent = cn || ''; el.classList.toggle('has-cmt', cn > 0);
}
function renderSource(el, n) {
  const s = n.source, box = el.querySelector('.node-src');
  if (!s) { box.style.display = 'none'; return; }
  box.style.display = 'flex'; box.textContent = '';
  const label = document.createElement('span');
  label.textContent = typeof s === 'string' ? 'Source: ' + s : `Source: ${s.volumeName || s.label || 'Volume'}${s.page ? ' · p.' + s.page : ''}${s.chapter ? ' · ' + s.chapter : ''}`;
  box.appendChild(label);
  if (typeof s !== 'string') {
    const b = document.createElement('button'); b.className = 'src-go'; b.textContent = 'Open';
    b.onclick = (e) => { e.stopPropagation(); emit('open-source', s); };
    box.appendChild(b);
  }
}
function makeNode(n) {
  const el = document.createElement('div');
  el.className = 'node'; el.dataset.id = n.id; els[n.id] = el;
  el.innerHTML = `<span class="node-shape" aria-hidden="true"></span><div class="node-head"><span class="node-grip" title="Drag" aria-label="Drag handle">⠿</span><span class="node-icon" aria-hidden="true"></span><span class="node-title" contenteditable="true" spellcheck="false" role="textbox" aria-label="Title"></span><span class="node-tools"><button class="node-cmt" aria-label="Comments" title="Comments"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/></svg><i></i></button><button class="node-lock" aria-label="Lock"></button><button class="node-del" aria-label="Delete star">✕</button></span></div><div class="node-body" contenteditable="true" spellcheck="false" role="textbox" aria-label="Content"></div><div class="node-src"></div><span class="node-link" title="Drag onto another star to link"></span><span class="node-resize" aria-hidden="true"></span>`;
  const title = el.querySelector('.node-title'), body = el.querySelector('.node-body');
  title.textContent = n.title || ''; body.innerHTML = sanitize(n.body); hydrate(body);
  renderSource(el, n); styleNode(el, n);
  if (sel.has(n.id)) el.classList.add('selected');
  title.addEventListener('input', () => { n.title = title.textContent; save(); });
  body.addEventListener('input', () => { n.body = serializeBody(body); save(); });
  body.addEventListener('paste', (e) => {
    const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image'));
    if (it) { e.preventDefault(); insertImage(n.id, it.getAsFile()); return; }
    e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  el.addEventListener('pointerdown', (e) => { if (e.button !== 1 && !e.target.closest('.node-grip,.node-link,.node-resize')) select(n.id, e.shiftKey || e.ctrlKey || e.metaKey, true); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); select(n.id); emit('node-menu', { n, x: e.clientX, y: e.clientY }); });
  el.querySelector('.node-cmt').onclick = (e) => { e.stopPropagation(); emit('comments', n.id); };
  el.querySelector('.node-lock').onclick = () => { n.locked = !n.locked; styleNode(el, n); save(); };
  el.querySelector('.node-del').onclick = () => removeNodes([n.id]);
  bindDrag(el, n); bindResize(el, n); bindLink(el, n);
  if (app.readonly) el.querySelectorAll('[contenteditable]').forEach((x) => x.setAttribute('contenteditable', 'false'));
  emit('node-rendered', { n, el }); // modules decorate stars here (reactions, shapes, badges…)
  return el;
}
export function render() {
  Object.keys(els).forEach((k) => { els[k].remove(); delete els[k]; });
  page().nodes.forEach((n) => world.appendChild(makeNode(n)));
  renderLinks(); renderDrawings(); renderTabs(); updateBar();
  $('empty').hidden = page().nodes.length > 0; drawMinimap();
}
export function refreshNode(id) { const n = findNode(id), old = els[id]; if (!n) return; const el = makeNode(n); if (old) old.replaceWith(el); else world.appendChild(el); renderLinks(); }
export function addNode(p = {}) {
  if (app.readonly) return toast('This canvas is read-only');
  const c = viewCenter();
  const n = { id: uid(), x: Math.round(p.x ?? c.x - 115 + Math.random() * 80 - 40), y: Math.round(p.y ?? c.y - 90 + Math.random() * 80 - 40), w: p.w || 240, h: p.h || 180, title: p.title || 'New star', body: sanitize(p.body || ''), source: p.source || '', color };
  page().nodes.push(n); sel.clear(); sel.add(n.id); selConn = null; render(); save();
  if (!p.body) setTimeout(() => { const t = els[n.id]?.querySelector('.node-title'); if (t) { t.focus(); document.getSelection().selectAllChildren(t); } }, 50);
  return n;
}
export function removeNodes(ids) {
  if (app.readonly) return;
  const p = page(), del = ids.filter((id) => !findNode(id)?.locked);
  if (del.length < ids.length) toast('Locked stars were kept');
  p.nodes = p.nodes.filter((n) => !del.includes(n.id)); p.connections = p.connections.filter((c) => !del.includes(c.from) && !del.includes(c.to));
  del.forEach((id) => sel.delete(id)); render(); save();
}
export async function insertImage(id, file) {
  const n = findNode(id); if (!n || !file) return;
  const mid = await storeBlob(file); const u = await mediaUrl(mid);
  const tag = file.type.startsWith('video') ? 'video controls' : 'img';
  n.body = sanitize((n.body || '') + `<${tag} data-media-id="${mid}" ${u ? `src="${u}"` : ''}></${tag.split(' ')[0]}>`);
  refreshNode(id); save();
}
export function embedVideo(id, url) {
  const n = findNode(id); if (!n) return;
  const m = String(url).match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
  if (!m) return toast('Only YouTube links are supported for embeds');
  n.body = sanitize((n.body || '') + `<iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" allowfullscreen></iframe>`);
  refreshNode(id); save();
}

/* ---------- selection ---------- */
export function select(id, additive = false, fromPointer = false) {
  if (!additive && !(fromPointer && sel.has(id) && sel.size > 1)) sel.clear();
  if (additive && sel.has(id)) sel.delete(id); else if (id) sel.add(id);
  selConn = null; for (const k in els) els[k].classList.toggle('selected', sel.has(k)); renderLinks(); updateBar();
}
export function clearSel() { sel.clear(); selConn = null; for (const k in els) els[k].classList.remove('selected'); renderLinks(); updateBar(); }
export const selNodes = () => page().nodes.filter((n) => sel.has(n.id));
export function setColor(c) { color = c; selNodes().forEach((n) => { n.color = c; if (els[n.id]) styleNode(els[n.id], n); }); if (selConn) { const c2 = page().connections.find((x) => x.id === selConn); if (c2) c2.color = c; } renderLinks(); save(); }

/* ---------- drag / resize / link ---------- */
function bindDrag(el, n) {
  const h = el.querySelector('.node-grip');
  h.addEventListener('pointerdown', (e) => {
    if (e.button || app.readonly) return; e.preventDefault(); e.stopPropagation();
    if (!sel.has(n.id)) select(n.id, e.shiftKey);
    const group = selNodes().filter((q) => !q.locked), st = Object.fromEntries(group.map((q) => [q.id, { x: q.x, y: q.y }]));
    // dragging a frame carries the stars inside it
    group.filter((g) => g.group).forEach((g) => page().nodes.forEach((q) => { if (!q.group && !q.locked && !st[q.id] && q.x >= g.x && q.y >= g.y && q.x + q.w <= g.x + g.w && q.y + q.h <= g.y + g.h) { group.push(q); st[q.id] = { x: q.x, y: q.y }; } }));
    const p0 = worldPos(e.clientX, e.clientY); h.setPointerCapture(e.pointerId);
    const snapG = settings.snap ? 20 : 0, sn = (v) => (snapG ? Math.round(v / snapG) * snapG : Math.round(v));
    const mv = (ev) => { const p = worldPos(ev.clientX, ev.clientY); group.forEach((q) => { q.x = sn(st[q.id].x + p.x - p0.x); q.y = sn(st[q.id].y + p.y - p0.y); styleNode(els[q.id], q); }); renderLinks(); drawMinimap(); emit('live'); };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); save(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
}
function bindResize(el, n) {
  const h = el.querySelector('.node-resize');
  h.addEventListener('pointerdown', (e) => {
    if (app.readonly) return;
    e.preventDefault(); e.stopPropagation(); const sx = e.clientX, sy = e.clientY, sw = n.w, sh = n.h; h.setPointerCapture(e.pointerId);
    const mv = (ev) => { n.w = Math.max(160, Math.round(sw + (ev.clientX - sx) / view.z)); n.h = Math.max(90, Math.round(sh + (ev.clientY - sy) / view.z)); styleNode(el, n); renderLinks(); emit('live'); };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); save(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
}
function bindLink(el, n) {
  const h = el.querySelector('.node-link');
  h.addEventListener('pointerdown', (e) => {
    if (app.readonly) return;
    e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId);
    const a = { x: n.x + n.w / 2, y: n.y + n.h / 2 }, ln = document.createElementNS(NS, 'line');
    ln.setAttribute('class', 'temp'); ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y); ln.setAttribute('x2', a.x); ln.setAttribute('y2', a.y); svg.appendChild(ln);
    const mv = (ev) => { const p = worldPos(ev.clientX, ev.clientY); ln.setAttribute('x2', p.x); ln.setAttribute('y2', p.y); };
    const up = (ev) => { ln.remove(); const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.node'); if (t && t.dataset.id !== n.id) addConnection(n.id, t.dataset.id); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
}

/* ---------- constellation lines ---------- */
function edge(n, tx, ty) { // point where the line from n's centre toward (tx,ty) leaves the card
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const k = Math.min(dx ? (n.w / 2) / Math.abs(dx) : Infinity, dy ? (n.h / 2) / Math.abs(dy) : Infinity, 1);
  return { x: cx + dx * k, y: cy + dy * k };
}
const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
export const KIND = {
  supports: { c: '#8be3a4', dash: '', g: '+', name: 'Supports' }, contradicts: { c: '#ff8fa8', dash: '7 5', g: '×', name: 'Contradicts' },
  depends: { c: '#7fd6ff', dash: '2 5', g: '→', name: 'Depends on' }, relates: { c: null, dash: '3 3', g: '~', name: 'Relates' },
};
export function setLinkKind(c, kind) { if (app.readonly) return; if (KIND[kind]) c.kind = kind; else delete c.kind; renderLinks(); updateBar(); save(); }
export function renderLinks() {
  svg.querySelectorAll('g.conn').forEach((g) => g.remove());
  page().connections.forEach((c) => {
    const a = findNode(c.from), b = findNode(c.to); if (!a || !b) return;
    const bx = c.bx || 0, by = c.by || 0, mx = (a.x + a.w / 2 + b.x + b.w / 2) / 2, my = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
    const cx = mx + 2 * bx, cy = my + 2 * by, p1 = edge(a, cx, cy), p2 = edge(b, cx, cy), px = mx + bx, py = my + by;
    const kd = KIND[c.kind], d = `M${p1.x} ${p1.y} Q${cx} ${cy} ${p2.x} ${p2.y}`, col = (kd && kd.c) || c.color || PALETTE[0];
    const g = mk('g', { class: 'conn' + (selConn === c.id ? ' selected' : '') }); g.dataset.id = c.id;
    const core = mk('path', { class: 'conn-core', d, stroke: col }); if (kd && kd.dash) core.setAttribute('stroke-dasharray', kd.dash);
    g.append(mk('path', { class: 'conn-glow', d, stroke: col }), core, mk('path', { class: 'conn-hit', d }),
      mk('circle', { class: 'conn-star', cx: p1.x, cy: p1.y, r: 3, fill: col }), mk('circle', { class: 'conn-star', cx: p2.x, cy: p2.y, r: 3, fill: col }));
    if (kd) { // glyph badge (also for colour-blind readers) + arrowhead toward the dependency
      const t = mk('text', { x: px, y: py + (c.label ? -22 : 0), class: 'conn-kind', fill: col }); t.textContent = kd.g;
      g.append(mk('circle', { cx: px, cy: py + (c.label ? -22 : 0), r: 9, class: 'conn-kind-bg', stroke: col }), t);
      if (c.kind === 'depends' || c.kind === 'supports') { const ang = Math.atan2(p2.y - cy, p2.x - cx), L = 11; g.append(mk('path', { class: 'conn-arrow', fill: col, d: `M${p2.x} ${p2.y} L${p2.x - L * Math.cos(ang - 0.4)} ${p2.y - L * Math.sin(ang - 0.4)} L${p2.x - L * Math.cos(ang + 0.4)} ${p2.y - L * Math.sin(ang + 0.4)}Z` })); }
    }
    if (c.label) {
      const w = Math.max(28, String(c.label).length * 6.6 + 16);
      const t = mk('text', { x: px, y: py, class: 'conn-lbl' }); t.textContent = c.label;
      g.append(mk('rect', { x: px - w / 2, y: py - 10, width: w, height: 20, rx: 10, class: 'conn-lbl-bg', stroke: col }), t);
    }
    if (selConn === c.id) {
      const hd = mk('circle', { cx: px, cy: py + (c.label ? 22 : 0), r: 8, class: 'conn-handle', stroke: col });
      hd.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const mv = (ev) => { const p = worldPos(ev.clientX, ev.clientY); c.bx = Math.round(p.x - mx); c.by = Math.round(p.y - (c.label ? 22 : 0) - my); renderLinks(); emit('live'); };
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); save(); };
        addEventListener('pointermove', mv); addEventListener('pointerup', up);
      });
      g.append(hd);
    }
    g.addEventListener('click', (e) => { e.stopPropagation(); selectConn(c.id); });
    g.addEventListener('dblclick', (e) => { e.stopPropagation(); selectConn(c.id); editLabel(c); });
    g.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); selectConn(c.id); emit('conn-menu', { c, x: e.clientX, y: e.clientY }); });
    svg.appendChild(g);
  });
}
export function addConnection(from, to, opts = {}) { // opts.kind: 'supports' | 'contradicts' | 'depends' (argument maps)
  if (app.readonly) return;
  const p = page(); if (p.connections.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from))) return;
  const c = { id: uid(), from, to, color: opts.color || color }; if (opts.kind) c.kind = opts.kind;
  p.connections.push(c); renderLinks(); save(); emit('link-created', { from, to, kind: opts.kind || null });
  return c;
}
export function removeConnection(id) { const p = page(); p.connections = p.connections.filter((c) => c.id !== id); selConn = null; renderLinks(); updateBar(); save(); }
export function selectConn(id) { selConn = id; sel.clear(); for (const k in els) els[k].classList.remove('selected'); renderLinks(); updateBar(); }
export function editLabel(c) { emit('prompt', { title: 'Relation label', value: c.label || '', ok: (v) => { c.label = v.trim(); renderLinks(); save(); } }); }

/* ---------- context bar ---------- */
function updateBar() {
  const bar = $('ctxbar'), ns = selNodes(), c = selConn && page().connections.find((x) => x.id === selConn);
  bar.hidden = pen.on || (!ns.length && !c); if (bar.hidden) return;
  bar.textContent = '';
  const btn = (t, fn, title) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = t; b.title = title || t; b.onclick = fn; bar.appendChild(b); return b; };
  PALETTE.forEach((p) => { const s = document.createElement('button'); s.className = 'sw'; s.style.background = p; s.setAttribute('aria-label', 'Color ' + p); s.onclick = () => setColor(p); bar.appendChild(s); });
  const pick = document.createElement('input'); pick.type = 'color'; pick.title = 'Custom colour'; pick.setAttribute('aria-label', 'Custom colour'); pick.value = /^#[0-9a-f]{6}$/i.test((ns[0] || c || {}).color || '') ? (ns[0] || c).color : '#e8c872'; pick.oninput = () => setColor(pick.value); bar.appendChild(pick);
  if (c) { Object.keys(KIND).forEach((k) => { const b = btn(KIND[k].g + ' ' + KIND[k].name, () => setLinkKind(c, c.kind === k ? null : k), 'Link type: ' + KIND[k].name); if (c.kind === k) b.classList.add('on'); }); btn('Label', () => editLabel(c)); btn('Straighten', () => { delete c.bx; delete c.by; renderLinks(); save(); }); btn('Delete', () => removeConnection(c.id)); return; }
  btn('A−', () => ns.forEach((n) => { n.fs = Math.max(9, (n.fs || 13) - 1); styleNode(els[n.id], n); save(); }), 'Smaller text');
  btn('A+', () => ns.forEach((n) => { n.fs = Math.min(30, (n.fs || 13) + 1); styleNode(els[n.id], n); save(); }), 'Larger text');
  btn('Media', () => emit('add-media', [...sel][0]), 'Add image or video to this star'); 
  btn('Transparent', () => ns.forEach((n) => { n.bare = !n.bare; styleNode(els[n.id], n); save(); }), 'Make the card transparent (title and drag handle stay visible)');
  const shpB = btn('Shape', () => openShapePicker(ns, shpB, () => { ns.forEach((n) => els[n.id] && styleNode(els[n.id], n)); renderLinks(); save(); }), 'Shape and icon');
  btn('Group', () => ns.forEach((n) => { n.group = !n.group; styleNode(els[n.id], n); save(); }), 'Turn into a group area');
  if (ns.length > 1) { btn('⇤', () => align('x'), 'Align left'); btn('⤒', () => align('y'), 'Align top'); btn('↔', () => distribute(), 'Distribute horizontally'); }
  btn('Delete', () => removeNodes([...sel]));
}
function align(ax) { const ns = selNodes().filter((n) => !n.locked), v = Math.min(...ns.map((n) => n[ax])); ns.forEach((n) => { n[ax] = v; styleNode(els[n.id], n); }); renderLinks(); save(); }
function distribute() { const ns = selNodes().filter((n) => !n.locked).sort((a, b) => a.x - b.x); if (ns.length < 3) return; const g = (ns.at(-1).x - ns[0].x) / (ns.length - 1); ns.forEach((n, i) => { n.x = Math.round(ns[0].x + g * i); styleNode(els[n.id], n); }); renderLinks(); save(); }

/* ---------- auto layout (force-directed) ---------- */
export function autoLayout() {
  const p = page(), ns = p.nodes; if (ns.length < 2) return;
  const pos = ns.map((n) => ({ n, x: n.x + n.w / 2, y: n.y + n.h / 2 })), by = Object.fromEntries(pos.map((q) => [q.n.id, q]));
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const a = pos[i], b = pos[j]; let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; const min = (a.n.w + b.n.w) / 2 + 60, f = d < min * 2 ? (min * 2 - d) * 0.05 : 0;
      dx /= d; dy /= d; if (!a.n.locked) { a.x -= dx * f; a.y -= dy * f; } if (!b.n.locked) { b.x += dx * f; b.y += dy * f; }
    }
    p.connections.forEach((c) => { const a = by[c.from], b = by[c.to]; if (!a || !b) return; const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 340) * 0.02; if (!a.n.locked) { a.x += dx / d * f; a.y += dy / d * f; } if (!b.n.locked) { b.x -= dx / d * f; b.y -= dy / d * f; } });
  }
  pos.forEach((q) => { if (!q.n.locked) { q.n.x = Math.round(q.x - q.n.w / 2); q.n.y = Math.round(q.y - q.n.h / 2); } });
  render(); fitAll(); save();
}

/* ---------- drawing ---------- */
const r1 = (v) => Math.round(v * 10) / 10;
const strokeD = (pts) => { const n = pts.length; if (!n) return ''; let d = `M${pts[0][0]} ${pts[0][1]}`; if (n === 1) return d + ' l0.01 0'; if (n === 2) return d + ` L${pts[1][0]} ${pts[1][1]}`; for (let i = 1; i < n - 1; i++) d += ` Q${pts[i][0]} ${pts[i][1]} ${r1((pts[i][0] + pts[i + 1][0]) / 2)} ${r1((pts[i][1] + pts[i + 1][1]) / 2)}`; return d + ` L${pts[n - 1][0]} ${pts[n - 1][1]}`; };
const strokeEl = (s) => mk('path', { d: strokeD(s.pts || []), stroke: s.color || '#fff', 'stroke-width': s.w || 3, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': s.op || 1 });
export function renderDrawings() { drawSvg.textContent = ''; page().drawings.forEach((s) => drawSvg.appendChild(strokeEl(s))); }
function rdp(pts, eps) {
  if (pts.length < 4) return pts; const keep = new Set([0, pts.length - 1]);
  (function r(a, b) { let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep.add(mi); r(a, mi); r(mi, b); } })(0, pts.length - 1);
  return pts.filter((_, i) => keep.has(i));
}
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
export function setPen(v) {
  if (v && app.readonly) return toast('This canvas is read-only'); pen.on = v; viewport.classList.toggle('pen-on', v); $('btnPen').setAttribute('aria-pressed', v); drawPenBar(); updateBar(); if (v) clearSel(); }
export function drawPenBar() {
  const bar = $('penbar'); bar.hidden = !pen.on; if (!pen.on) return; bar.textContent = '';
  const b = (t, on2, fn) => { const x = document.createElement('button'); x.className = 'btn' + (on2 ? ' on' : ''); x.textContent = t; x.onclick = fn; bar.appendChild(x); };
  b('Pen', pen.tool === 'pen' && pen.w < 8, () => { pen.tool = 'pen'; pen.w = 3; pen.op = 1; drawPenBar(); });
  b('Highlighter', pen.tool === 'hl', () => { pen.tool = 'hl'; pen.w = 14; drawPenBar(); });
  b('Eraser', pen.tool === 'eraser', () => { pen.tool = 'eraser'; drawPenBar(); });
  PALETTE.forEach((p) => { const s = document.createElement('button'); s.className = 'sw' + (pen.color === p ? ' on' : ''); s.style.background = p; s.setAttribute('aria-label', 'Ink ' + p); s.onclick = () => { pen.color = p; if (pen.tool === 'eraser') pen.tool = 'pen'; drawPenBar(); }; bar.appendChild(s); });
  b('Done', false, () => setPen(false));
}
function penDown(e) {
  const p0 = worldPos(e.clientX, e.clientY), d = page().drawings;
  if (pen.tool === 'eraser') {
    const er = (ev) => { const p = worldPos(ev.clientX, ev.clientY), rad = 10 / view.z; const keep = d.filter((s) => { const q = s.pts || [], th = (s.w || 3) / 2 + rad; return !(q.length === 1 ? Math.hypot(p.x - q[0][0], p.y - q[0][1]) <= th : q.some((_, i) => i < q.length - 1 && segDist(p.x, p.y, q[i][0], q[i][1], q[i + 1][0], q[i + 1][1]) <= th)); }); if (keep.length !== d.length) { page().drawings = keep; d.length = 0; d.push(...keep); renderDrawings(); } };
    const up = () => { removeEventListener('pointermove', er); removeEventListener('pointerup', up); save(); };
    er(e); addEventListener('pointermove', er); addEventListener('pointerup', up); return;
  }
  const s = { id: uid(), color: pen.color, w: pen.w, op: pen.tool === 'hl' ? 0.35 : 1, pts: [[r1(p0.x), r1(p0.y)]] }, el = strokeEl(s); drawSvg.appendChild(el);
  const mv = (ev) => { const p = worldPos(ev.clientX, ev.clientY); s.pts.push([r1(p.x), r1(p.y)]); el.setAttribute('d', strokeD(s.pts)); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); s.pts = rdp(s.pts, 0.8 / view.z); page().drawings.push(s); renderDrawings(); save(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

/* ---------- minimap ---------- */
const mm = $('minimap'), mctx = mm.getContext('2d');
export function drawMinimap() {
  const ns = page().nodes; mctx.clearRect(0, 0, mm.width, mm.height); if (!ns.length) return;
  const x0 = Math.min(...ns.map((n) => n.x)) - 60, y0 = Math.min(...ns.map((n) => n.y)) - 60, x1 = Math.max(...ns.map((n) => n.x + n.w)) + 60, y1 = Math.max(...ns.map((n) => n.y + n.h)) + 60;
  const k = Math.min(mm.width / (x1 - x0), mm.height / (y1 - y0)); drawMinimap.m = { x0, y0, k };
  const cs = getComputedStyle(document.documentElement), line = cs.getPropertyValue('--line2');
  mctx.strokeStyle = line; page().connections.forEach((c) => { const a = findNode(c.from), b = findNode(c.to); if (a && b) { mctx.beginPath(); mctx.moveTo((a.x + a.w / 2 - x0) * k, (a.y + a.h / 2 - y0) * k); mctx.lineTo((b.x + b.w / 2 - x0) * k, (b.y + b.h / 2 - y0) * k); mctx.stroke(); } });
  ns.forEach((n) => { mctx.fillStyle = n.color || PALETTE[0]; mctx.beginPath(); mctx.arc((n.x + n.w / 2 - x0) * k, (n.y + n.h / 2 - y0) * k, 3, 0, 7); mctx.fill(); });
  const r = viewport.getBoundingClientRect(); mctx.strokeStyle = cs.getPropertyValue('--gold'); mctx.strokeRect((-view.x / view.z - x0) * k, (-view.y / view.z - y0) * k, (r.width / view.z) * k, (r.height / view.z) * k);
}
mm.addEventListener('pointerdown', (e) => { const m = drawMinimap.m; if (!m) return; const b = mm.getBoundingClientRect(), r = viewport.getBoundingClientRect(); const go = (ev) => { const wx = (ev.clientX - b.left) * (mm.width / b.width) / m.k + m.x0, wy = (ev.clientY - b.top) * (mm.height / b.height) / m.k + m.y0; view.x = r.width / 2 - wx * view.z; view.y = r.height / 2 - wy * view.z; applyView(false); }; go(e); const up = () => { removeEventListener('pointermove', go); removeEventListener('pointerup', up); }; addEventListener('pointermove', go); addEventListener('pointerup', up); });

/* ---------- tabs ---------- */
export function renderTabs() {
  const box = $('tabs'); box.textContent = '';
  app.state.pages.forEach((p, i) => {
    const t = document.createElement('div'); t.className = 'tab' + (i === app.state.current ? ' active' : ''); t.setAttribute('role', 'tab'); t.tabIndex = 0;
    const nm = document.createElement('span'); nm.textContent = p.name; t.appendChild(nm);
    if (app.state.pages.length > 1) { const x = document.createElement('button'); x.className = 'tab-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Delete ' + p.name); x.onclick = (e) => { e.stopPropagation(); deletePage(i); }; t.appendChild(x); }
    t.onclick = () => switchPage(i); t.onkeydown = (e) => { if (e.key === 'Enter') switchPage(i); };
    t.oncontextmenu = (e) => { e.preventDefault(); emit('tab-menu', { i, x: e.clientX, y: e.clientY }); };
    t.ondblclick = () => emit('prompt', { title: 'Rename constellation', value: p.name, ok: (v) => { if (v.trim()) { p.name = v.trim(); renderTabs(); save(); } } });
    box.appendChild(t);
  });
  const add = document.createElement('button'); add.className = 'tab-add'; add.textContent = '+'; add.setAttribute('aria-label', 'New constellation'); add.onclick = addPage; box.appendChild(add);
}
export function addPage() { app.state.pages.push({ id: uid(), name: 'Constellation ' + (app.state.pages.length + 1), nodes: [], connections: [], drawings: [] }); switchPage(app.state.pages.length - 1, true); save(); }
export function deletePage(i) {
  const p = app.state.pages[i]; if (app.state.pages.length < 2 || p.nodes.some((n) => n.locked)) return toast(p.nodes.some((n) => n.locked) ? 'Unlock the locked stars first' : 'Keep at least one constellation');
  emit('confirm', { title: `Delete “${p.name}”?`, ok: () => { const cur = page().id; app.state.pages.splice(i, 1); app.state.current = Math.max(0, app.state.pages.findIndex((q) => q.id === cur)); loadView(); render(); save(); } });
}
export function switchPage(i, force) { if (i === app.state.current && !force) return; app.state.current = i; hist.cur = null; hist.u = []; hist.r = []; sel.clear(); selConn = null; loadView(); render(); hist.cur = snap(); save(); }
export function loadView() { const v = viewsByPage[page().id]; if (v) Object.assign(view, v); else { Object.assign(view, { x: 0, y: 0, z: 1 }); } applyView(false); if (!v && page().nodes.length) fitAll(); }

/* ---------- search ---------- */
let matchIdx = 0;
export function search(q, step = 0) {
  q = q.trim().toLowerCase();
  const hits = q ? page().nodes.filter((n) => (n.title + ' ' + n.body.replace(/<[^>]+>/g, ' ')).toLowerCase().includes(q)) : [];
  for (const k in els) { els[k].classList.toggle('match', hits.some((h) => h.id === k)); els[k].classList.toggle('dim', !!q && !hits.some((h) => h.id === k)); }
  if (step && hits.length) { matchIdx = (matchIdx + step + hits.length) % hits.length; focusNode(hits[matchIdx].id); }
  return hits;
}

/* ---------- viewport input: pan, pinch, wheel ---------- */
const ptrs = new Map(); let pinch = null, panning = null, moved = false;
viewport.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
/* middle-button pan: independent of the touch/pinch bookkeeping (a missed release can never leave it stuck), works from anywhere */
const smoothMs = () => (Math.max(0, Math.min(100, settings.panSmooth ?? 50)) / 100) * 140; // Settings → Pan smoothness; 0 = follow the mouse exactly
let panGen = 0; // a new drag cancels any glide still running from the previous one
function midPan(e) {
  const gen = ++panGen;
  e.preventDefault(); ptrs.clear(); pinch = panning = null; viewport.classList.add('panning');
  try { viewport.setPointerCapture(e.pointerId); } catch {}                       // keeps events coming even over embedded pages
  const sx = e.clientX, sy = e.clientY, DEAD = 4;                                  // a few px of wobble while pressing is a click, not a drag
  let ox = sx - view.x, oy = sy - view.y, tx = view.x, ty = view.y, started = false, held = true, raf = 0, last = 0;
  // The mouse only sets a TARGET. Once per frame the view eases toward it (exponential smoothing), so jitter and
  // micro-movements are averaged out instead of being drawn one by one, and the canvas coasts to a soft stop on release.
  const tick = (now) => {
    raf = 0; if (gen !== panGen) return; const tau = smoothMs(), dt = Math.min(64, last ? now - last : 16); last = now;
    const k = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    view.x += (tx - view.x) * k; view.y += (ty - view.y) * k;
    const done = Math.abs(tx - view.x) < 0.25 && Math.abs(ty - view.y) < 0.25; if (done) { view.x = tx; view.y = ty; }
    applyView(done && !held);                                                      // saved to storage only when it has settled
    if (!done || held) raf = requestAnimationFrame(tick); else last = 0;
  };
  const mv = (ev) => {
    if (!(ev.buttons & 4)) return stop();                                          // button no longer held (even if no release event arrived)
    if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DEAD) return; started = true; } // below DEAD it is just a click wobble; the reference stays at the press point, so no movement is lost
    tx = ev.clientX - ox; ty = ev.clientY - oy; if (!raf) raf = requestAnimationFrame(tick);
  };
  const stop = () => { held = false; for (const t of ['pointermove', 'pointerup', 'pointercancel']) removeEventListener(t, t === 'pointermove' ? mv : stop, true); removeEventListener('blur', stop); viewport.classList.remove('panning'); try { viewport.releasePointerCapture(e.pointerId); } catch {} if (started && !raf) raf = requestAnimationFrame(tick); };
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) addEventListener(t, t === 'pointermove' ? mv : stop, true); addEventListener('blur', stop);
}
viewport.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
viewport.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button === 1) return midPan(e);
  // read-only (published view, viewer role): nothing to select or edit, so a plain drag pans the map, even when it starts on a star's frame
  const grab = app.readonly && e.target.closest('.node') && !e.target.closest('.node-body,.node-title,.web-bar,.rx-row,.node-src,input,textarea,select,a,button,iframe,video,audio');
  if (!grab && e.target.closest('.node,.conn-handle,.conn-hit,.conn-lbl-bg')) return;
  const mouse = e.pointerType === 'mouse';
  if (mouse && e.button !== 0) return;                           // right button: context menu only (middle is handled by midPan)
  else if (mouse && !pen.on && !app.readonly) { marquee(e); return; } // left drag on empty space: multi-select (editors only)
  if (pen.on && mouse && e.button === 0) { penDown(e); return; }
  if (pen.on && ptrs.size === 0 && e.pointerType === 'touch') { penDown(e); return; }
  if (mouse) ptrs.clear();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
  if (ptrs.size === 1) panning = { x: e.clientX - view.x, y: e.clientY - view.y }; else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z }; panning = null; }
  viewport.setPointerCapture(e.pointerId); viewport.classList.add('panning');
});
viewport.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = true;
  if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), z = clamp(pinch.z * d / pinch.d, 0.1, 3); zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, z / view.z); }
  else if (panning) { view.x = e.clientX - panning.x; view.y = e.clientY - panning.y; applyView(); }
});
const endPtr = (e) => { if (ptrs.delete(e.pointerId) && !ptrs.size) { viewport.classList.remove('panning'); if (!moved && e.type === 'pointerup' && (e.button === 0 || e.pointerType !== 'mouse')) clearSel(); } pinch = null; panning = null; if (ptrs.size === 1) { const [p] = [...ptrs.values()]; panning = { x: p.x - view.x, y: p.y - view.y }; } };
viewport.addEventListener('pointerup', endPtr); viewport.addEventListener('pointercancel', endPtr); viewport.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) endPtr(e); });
addEventListener('blur', () => { ptrs.clear(); pinch = panning = null; viewport.classList.remove('panning'); });
viewport.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey || !e.shiftKey && Math.abs(e.deltaY) > 0 && !e.deltaX) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); } }, { passive: false });
viewport.addEventListener('dblclick', (e) => { if (e.target === viewport || e.target === world || e.target.closest('#empty')) { const p = worldPos(e.clientX, e.clientY); addNode({ x: Math.round(p.x - 120), y: Math.round(p.y - 60) }); } });
viewport.addEventListener('contextmenu', (e) => { if (!e.target.closest('.node')) { e.preventDefault(); const p = worldPos(e.clientX, e.clientY); emit('canvas-menu', { x: e.clientX, y: e.clientY, p }); } });
// safety net for browsers without `overflow: clip`: if anything ever scrolls the canvas container, put it straight back
for (const el of [viewport, $('stage')]) el.addEventListener('scroll', () => { if (el.scrollLeft || el.scrollTop) { el.scrollLeft = 0; el.scrollTop = 0; } });
$('zIn').onclick = () => { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); };
$('zOut').onclick = () => { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); };
$('zVal').onclick = () => fitAll();
addEventListener('resize', () => applyView(false));

/* left-drag on empty canvas = rubber-band multi-select (Shift/Ctrl adds to the selection) */
function marquee(e) {
  const add = e.shiftKey || e.ctrlKey || e.metaKey, r0 = viewport.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
  const box = document.createElement('div'); box.className = 'marquee'; viewport.appendChild(box);
  if (!add) clearSel();
  const base = new Set(sel); let dragged = false;
  const mv = (ev) => {
    const x0 = Math.min(sx, ev.clientX), y0 = Math.min(sy, ev.clientY), x1 = Math.max(sx, ev.clientX), y1 = Math.max(sy, ev.clientY);
    if (!dragged && x1 - x0 + y1 - y0 < 5) return; dragged = true;
    Object.assign(box.style, { display: 'block', left: x0 - r0.left + 'px', top: y0 - r0.top + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
    const a = worldPos(x0, y0), b = worldPos(x1, y1);
    sel.clear(); base.forEach((id) => sel.add(id));
    page().nodes.forEach((n) => { if (n.x < b.x && n.x + n.w > a.x && n.y < b.y && n.y + n.h > a.y) sel.add(n.id); });
    for (const k in els) els[k].classList.toggle('selected', sel.has(k));
  };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); box.remove(); if (dragged) { selConn = null; renderLinks(); updateBar(); } else if (!add) clearSel(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
