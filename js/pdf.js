// PDF viewer (pdf.js 3.11.174 from cdnjs): text layer, cut to star, area crop, phrase highlight, text cache.
// Also exports the small reader shell + byte loader that epub.js reuses.
import { $, app, uid, save, idb, toast, uploadBlob, downloadBlob, loadScript, storeBlob, copyText, clamp, escapeHtml, on, emit, me } from './core.js';
import * as map from './map.js';
import { ev, EVC, dock } from './evidence.js';
import { show as dictShow, hide as dictHide } from './dictionary.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
export const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
// toolbar button; pointerdown is cancelled so a text selection survives the tap
export const tb = (label, title, fn, icon = '') => h('button', { className: 'btn rd-btn', type: 'button', title, onclick: fn, onpointerdown: (e) => e.preventDefault() }, icon, h('span', { className: 'lbl', textContent: label }));

/* ---------- shared highlights UI (volume.hl: [{id, page|cfi, chapter, phrase, color}]; remote data is untrusted) ---------- */
export const HLC = ['#e8c872', '#7fd6ff', '#ff8fa8', '#8be3a4'];
export const vhl = (v) => (Array.isArray(v.hl) ? v.hl : []).filter((x) => x && typeof x.id === 'string' && typeof x.phrase === 'string' && HLC.includes(x.color)).slice(0, 500);
// returns {list(), btns} (caller puts btns in the bar); cb: {ok(x) type filter, make() -> {page|cfi, chapter?, phrase}|null, paint(), go(x), cut(x)}; returns {list()}
export function hlBar(v, sh, cb) {
  const V = () => app.state.volumes.find((x) => x.id === v.id) || v, list = () => vhl(V()).filter(cb.ok);
  let col = HLC[0]; try { const c = localStorage.getItem('st-hl-col'); if (HLC.includes(c)) col = c; } catch {}
  const panel = h('div', { className: 'hl-panel', hidden: true }), mk = () => sw.forEach((b, i) => b.classList.toggle('on', HLC[i] === col));
  const sw = HLC.map((c) => h('button', { type: 'button', className: 'hl-sw', title: 'Highlight colour', onpointerdown: (e) => e.preventDefault(), onclick: () => { col = c; try { localStorage.setItem('st-hl-col', c); } catch {} mk(); } }));
  sw.forEach((b, i) => { b.style.background = HLC[i]; }); mk();
  const set = (a) => { V().hl = a; save(); cb.paint(); render(); };
  const render = () => {
    panel.textContent = ''; const L = list(); if (!L.length) panel.append(h('p', { className: 'dim', textContent: 'No highlights yet.' }));
    L.forEach((x) => {
      const t = h('button', { type: 'button', className: 'hl-t', textContent: x.phrase.slice(0, 160), onclick: () => { panel.hidden = true; cb.go(x); } }); t.style.borderLeftColor = x.color;
      panel.append(h('div', { className: 'hl-row' }, t, h('button', { type: 'button', className: 'btn hl-b', title: 'Cut to star', textContent: '✦', onclick: () => cb.cut(x) }),
        h('button', { type: 'button', className: 'btn hl-b', title: 'Remove highlight', textContent: '✕', onclick: () => set(vhl(V()).filter((y) => y.id !== x.id)) })));
    });
  };
  const btns = [...sw, tb('Highlight', 'Highlight selected text', () => {
    const p = cb.make(); if (!p) return toast('Select some text first.');
    const a = vhl(V()); if (a.length >= 500) return toast('Highlight limit reached (500).');
    a.push({ id: uid(), ...p, phrase: p.phrase.slice(0, 600), color: col }); set(a); toast('Highlighted');
    emit('journey-event', { type: 'highlight', volumeId: v.id, volumeName: v.name, page: p.page, phrase: p.phrase.slice(0, 200) });
  }, '🖍'), tb('Highlights', 'All highlights of this book', () => { render(); panel.hidden = !panel.hidden; if (!panel.hidden) sh.bar.parentNode.querySelectorAll('.hl-panel').forEach((x) => x !== panel && (x.hidden = true)); }, '≣')];
  sh.bar.parentNode.append(panel);
  return { list, btns };
}

/* ---------- shared reader extras: progress, bookmarks, focus mode, reading together, dictionary, evidence ---------- */
const PK = 'st-prog'; // per user, never synced: {volumeId: {page|cfi, pct, label, t}}
export const prog = () => { try { const p = JSON.parse(localStorage.getItem(PK)); return p && typeof p === 'object' ? p : {}; } catch { return {}; } };
export const star = (p) => { const n = map.addNode(p); if (n) emit('journey-event', { type: 'star', nodeId: n.id, volumeId: p.source?.volumeId, volumeName: p.source?.volumeName }); return n; };
export const bookmarks = (v) => (Array.isArray(v.bm) ? v.bm : []).filter((b) => b && typeof b.id === 'string' && typeof b.label === 'string' && (Number.isInteger(b.page) || (typeof b.cfi === 'string' && b.cfi.length < 600))).slice(0, 200);
const peers = new Map(), peerSubs = new Set(), chg = new Set(); // peers: id -> record (untrusted remote data, validated)
on('peer-reader', (d) => {
  if (!d || typeof d.id !== 'string' || typeof d.volumeId !== 'string') return;
  const prev = peers.get(d.id.slice(0, 64));
  const p = { id: d.id.slice(0, 64), name: String(d.name || 'Someone').slice(0, 40), hue: clamp(+d.hue || 0, 0, 360), volumeId: d.volumeId.slice(0, 64), label: String(d.label || '').slice(0, 60), page: Number.isInteger(d.page) && d.page > 0 ? d.page : undefined, cfi: typeof d.cfi === 'string' && d.cfi.length < 600 ? d.cfi : undefined, seen: Date.now() };
  peers.set(p.id, p); peerSubs.forEach((f) => f(p, prev));
});
export const peersOn = (volId) => { const t = Date.now(); peers.forEach((p, k) => { if (t - p.seen > 60000) peers.delete(k); }); return [...peers.values()].filter((p) => p.id !== me().id && (!volId || p.volumeId === volId)); };
export const onPeer = (f) => peerSubs.add(f);
['changed', 'state-replaced', 'library-render'].forEach((n) => on(n, () => chg.forEach((f) => f())));
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

// a: {kind, pos() -> {page|cfi, label, pct}, go({page|cfi}), paint(), sig(), resize(), goEv(x)}; returns {look(text, rect, source), hide, report, dispose, btns}
export function rdx(v, sh, a) {
  const V = () => app.state.volumes.find((x) => x.id === v.id) || v, R = sh.bar.parentNode;
  let on_ = true, timer = 0, lastPos = null, lastJ = 0, sig = a.sig(), follow = null, lastF = null;
  emit('journey-event', { type: 'open-volume', volumeId: v.id, volumeName: v.name });
  // progress (throttled ~1s)
  const flush = () => {
    timer = 0; const p = lastPos; if (!p) return;
    const all = prog(); all[v.id] = { ...(p.page ? { page: p.page } : { cfi: p.cfi }), pct: clamp(+p.pct || 0, 0, 100), label: String(p.label || '').slice(0, 80), t: Date.now() };
    try { localStorage.setItem(PK, JSON.stringify(all)); } catch {}
    emit('reader-pos', { volumeId: v.id, label: p.label, page: p.page, cfi: p.cfi });
    if (Date.now() - lastJ > 5000) { lastJ = Date.now(); emit('journey-event', { type: 'page', volumeId: v.id, volumeName: v.name, label: p.label, page: p.page, cfi: p.cfi }); }
  };
  const report = () => { lastPos = a.pos(); if (lastPos) timer ||= setTimeout(flush, 1000); };
  // bookmarks
  const bmPanel = h('div', { className: 'hl-panel', hidden: true });
  const renderBm = () => {
    bmPanel.textContent = ''; const L = bookmarks(V()); if (!L.length) bmPanel.append(h('p', { className: 'dim', textContent: 'No bookmarks yet. Use ⚑ to add one.' }));
    L.forEach((b) => bmPanel.append(h('div', { className: 'hl-row' }, h('button', { type: 'button', className: 'hl-t', textContent: b.label.slice(0, 120), onclick: () => { bmPanel.hidden = true; a.go(b); } }),
      ...(app.readonly ? [] : [h('button', { type: 'button', className: 'btn hl-b', title: 'Remove bookmark', textContent: '✕', onclick: () => { V().bm = bookmarks(V()).filter((x) => x.id !== b.id); save(); renderBm(); } })]))));
  };
  const toggleBm = () => {
    const p = a.pos(); if (!p) return;
    const ex = bookmarks(V()).find((b) => (p.page ? b.page === p.page : b.cfi === p.cfi));
    if (ex) { V().bm = bookmarks(V()).filter((b) => b.id !== ex.id); save(); renderBm(); return toast('Bookmark removed'); }
    emit('prompt', { title: 'Bookmark label', value: p.page ? 'p. ' + p.page : p.label || 'Bookmark', ok: (t) => {
      V().bm = [...bookmarks(V()), { id: uid(), ...(p.page ? { page: p.page } : { cfi: p.cfi }), label: String(t || '').trim().slice(0, 80) || p.label || 'Bookmark', pct: clamp(+p.pct || 0, 0, 100), t: Date.now() }]; save(); renderBm(); toast('Bookmarked');
    } });
  };
  R.append(bmPanel);
  // focus mode
  let fxEl, fint, t0, fend = 0, time;
  const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); if (fend && Date.now() >= fend) { fend = 0; toast('Time is up. Well read!'); } time.textContent = fend ? fmt(Math.ceil((fend - Date.now()) / 1000)) : fmt(s); };
  const fk = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); focusOff(); } };
  const preset = (m) => { t0 = Date.now(); fend = m ? t0 + m * 60000 : 0; tick(); };
  const focusOn = () => {
    if (fxEl) return; document.body.classList.add('focus-mode'); time = h('span', { className: 'mono' });
    fxEl = h('div', { className: 'fx' }, h('button', { type: 'button', className: 'btn', textContent: 'Exit focus (Esc)', onclick: focusOff }),
      h('span', { className: 'fx-t' }, time, ...[[25, '25'], [45, '45'], [0, '∞']].map(([m, t]) => h('button', { type: 'button', className: 'fx-p', textContent: t, title: m ? m + ' minute countdown' : 'Count up', onclick: () => preset(m) }))));
    document.body.append(fxEl); addEventListener('keydown', fk, true); fint = setInterval(tick, 1000); preset(0); setTimeout(() => on_ && a.resize?.(), 50);
  };
  const focusOff = () => {
    if (!fxEl) return; document.body.classList.remove('focus-mode'); fxEl.remove(); fxEl = null; clearInterval(fint); removeEventListener('keydown', fk, true);
    if (on_) setTimeout(() => on_ && a.resize?.(), 50);
  };
  // reading together
  const pb = h('div', { className: 'rd-peers', hidden: true }); sh.bar.after(pb);
  const renderPeers = () => {
    const L = peersOn(v.id), was = pb.hidden; pb.hidden = !L.length; pb.textContent = '';
    L.forEach((p) => {
      const c = h('button', { type: 'button', className: 'rd-peer', textContent: `${p.name} · ${p.label || (p.page ? 'p. ' + p.page : '…')}`, title: 'Jump to their position', onclick: () => a.go(p) }), f = h('button', { type: 'button', className: 'rd-peer-f' + (follow === p.id ? ' on' : ''), textContent: follow === p.id ? 'Following' : 'Follow', title: 'Keep me on their page', onclick: () => { follow = follow === p.id ? null : p.id; if (follow) a.go(p); renderPeers(); } });
      const g = h('span', { className: 'rd-peerg' }, c, f); g.style.setProperty('--h', p.hue); pb.append(g);
    });
    if (was !== pb.hidden) evd.render();
  };
  const peerCb = (p) => { if (p.volumeId !== v.id) return; const k = p.page ?? p.cfi; if (follow === p.id && k !== lastF) { lastF = k; a.go(p); } renderPeers(); };
  const pi = setInterval(renderPeers, 15000);
  // live repaint when a remote change touches highlights / bookmarks
  const chgCb = () => { const s = a.sig(); if (s !== sig) { sig = s; a.paint(); } if (!bmPanel.hidden) renderBm(); };
  peerSubs.add(peerCb); chg.add(chgCb);
  const evd = dock(v, sh, a);
  const btns = [
    ...(app.readonly ? [] : [tb('Bookmark', 'Bookmark this spot', toggleBm, '⚑')]),
    tb('Bookmarks', 'Bookmarks list', () => { renderBm(); bmPanel.hidden = !bmPanel.hidden; if (!bmPanel.hidden) R.querySelectorAll('.hl-panel').forEach((x) => x !== bmPanel && (x.hidden = true)); }, '🔖'),
    tb('Focus', 'Focus mode (Esc exits)', focusOn, '◐'), evd.btn];
  renderPeers();
  return {
    btns, report, hide: dictHide, focusOff, focusOn,
    look: (text, rect, src) => dictShow(text, rect, { src: (w) => ({ ...src, phrase: w }), star }),
    dispose: () => { on_ = false; if (timer) { clearTimeout(timer); flush(); } peerSubs.delete(peerCb); chg.delete(chgCb); clearInterval(pi); focusOff(); dictHide(); evd.dispose(); emit('library-render'); },
  };
}

/* compact reader toolbar: only Cut + a full-screen icon (+ "⋯" for everything else), shared by the PDF and EPUB readers */
const noBlur = (e) => e.preventDefault(); // keeps the text selection alive when a toolbar button is pressed
export function compact(sh, cutBtn, fx, rest) {
  const R = $('reader'), icon = (txt, title, fn) => h('button', { className: 'btn rd-btn rd-ico', type: 'button', title, 'aria-label': title, textContent: txt, onclick: fn, onpointerdown: noBlur });
  const items = rest.filter((b) => !/^Focus mode/.test(b.title || '')), more = h('div', { className: 'rd-more', hidden: true }, ...items);
  const dots = icon('⋯', 'More tools: pages, zoom, highlights, bookmarks…', (e) => { e.stopPropagation(); more.hidden = !more.hidden; });
  sh.bar.append(cutBtn, icon('⛶', 'Full screen (Esc exits)', () => { more.hidden = true; fx.focusOn(); }), dots);
  R.append(more);
  // full-screen (focus) mode shows EVERY option inline in the bar; leaving it tucks them back into "⋯"
  const sync = () => {
    if (!sh.bar.isConnected) return mo.disconnect();
    const f = document.body.classList.contains('focus-mode');
    items.forEach((el) => (f ? sh.bar.insertBefore(el, cutBtn) : more.append(el))); dots.hidden = f; more.hidden = true;
  };
  const mo = new MutationObserver(sync); mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  R.addEventListener('pointerdown', (e) => { if (!more.hidden && !more.contains(e.target) && e.target !== dots) more.hidden = true; });
}

/* ---------- shared reader shell (#reader) ---------- */
let closeCur;
export function shell(title, onClose, cls = '') {
  closeCur?.();
  const r = $('reader'), body = h('div', { className: 'rd-body ' + cls }), bar = h('div', { className: 'rd-bar' });
  const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input')) close(); };
  const close = () => { removeEventListener('keydown', onKey); r.hidden = true; r.textContent = ''; closeCur = null; onClose?.(); };
  closeCur = close; addEventListener('keydown', onKey);
  bar.append(h('button', { className: 'btn rd-btn rd-ico', type: 'button', title: 'Close reader', 'aria-label': 'Close reader', textContent: '✕', onclick: close }), h('strong', { className: 'rd-title serif', textContent: title }));
  r.textContent = ''; r.append(bar, body); r.hidden = false;
  return { bar, body, close };
}

// file bytes: local idb first, then the room bucket (cached locally afterwards)
export async function bytes(store, kind, id) {
  let ab = await idb.get(store, id);
  if (!ab) { const b = await downloadBlob(id, kind); if (!b) return null; ab = await b.arrayBuffer(); await idb.put(store, id, ab); }
  return ab;
}

/* ---------- library side: ingest + text ---------- */
async function lib() {
  if (!window.pdfjsLib) await loadScript(CDN + 'pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + 'pdf.worker.min.js';
  return pdfjsLib;
}
const loadDoc = async (id) => { const ab = await bytes('pdfs', 'pdf', id); return ab && (await lib()).getDocument({ data: ab.slice(0) }).promise; }; // slice: pdf.js detaches the buffer

async function extract(doc, id) {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((t) => t.str + (t.hasEOL ? '\n' : '')).join('').replace(/(\w)-\n(\w)/g, '$1$2').replace(/[ \t]+/g, ' ').trim());
  }
  await idb.put('pdfs', id + ':text', out); return out;
}
export async function getPdfPages(id) {
  const c = await idb.get('pdfs', id + ':text'); if (c) return c;
  const d = await loadDoc(id); return d ? extract(d, id) : [];
}
export const getPdfText = async (id) => (await getPdfPages(id)).join('\n\n');

// store the file, return {count, cover} (cover = JPEG of page 1); text extraction continues in the background
export async function ingestPdf(id, file) {
  const ab = await file.arrayBuffer(); await idb.put('pdfs', id, ab);
  uploadBlob(id, new Blob([ab], { type: 'application/pdf' }), 'pdf');
  const doc = await (await lib()).getDocument({ data: ab.slice(0) }).promise;
  let cover = null;
  try {
    const p = await doc.getPage(1), vp = p.getViewport({ scale: 360 / p.getViewport({ scale: 1 }).width });
    const c = h('canvas', { width: Math.round(vp.width), height: Math.round(vp.height) });
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    cover = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  } catch {}
  extract(doc, id).catch(() => {});
  return { count: doc.numPages, cover };
}

/* ---------- viewer ---------- */
const mc = document.createElement('canvas').getContext('2d');
function textLayer(tc, vp, tl) {
  const fr = document.createDocumentFragment();
  tc.items.forEach((it) => {
    if (typeof it.str !== 'string') return;
    if (!it.str) { if (it.hasEOL) fr.append(h('br')); return; }
    const m = pdfjsLib.Util.transform(vp.transform, it.transform), fs = Math.hypot(m[2], m[3]); if (!fs) return;
    const fo = tc.styles[it.fontName] || {}, ff = fo.fontFamily || 'sans-serif';
    const asc = typeof fo.ascent === 'number' ? fo.ascent : typeof fo.descent === 'number' ? 1 + fo.descent : 0.85, ang = Math.atan2(m[1], m[0]);
    const sp = h('span', { textContent: it.str });
    sp.style.left = m[4] + 'px'; sp.style.top = m[5] - fs * asc + 'px'; sp.style.fontSize = fs + 'px'; sp.style.fontFamily = ff;
    mc.font = fs + 'px ' + ff; const w = mc.measureText(it.str).width, tw = it.width * vp.scale, sx = w > 0 && tw > 0 ? tw / w : 1;
    const tr = (ang ? `rotate(${ang}rad) ` : '') + (Math.abs(sx - 1) > 0.001 ? `scaleX(${sx})` : ''); if (tr) sp.style.transform = tr;
    fr.append(sp); if (it.hasEOL) fr.append(h('br'));
  });
  tl.append(fr);
}
// [from,to) of a range inside one span
function spanSel(r, sp) {
  let a = 0, b = sp.textContent.length, q;
  if (sp.contains(r.startContainer)) { q = document.createRange(); q.selectNodeContents(sp); q.setEnd(r.startContainer, r.startOffset); a = q.toString().length; }
  if (sp.contains(r.endContainer)) { q = document.createRange(); q.selectNodeContents(sp); q.setEnd(r.endContainer, r.endOffset); b = q.toString().length; }
  return [a, b];
}
// ivs: [[from, to, hl|null]] (null = search/jump mark); earlier wins on overlap
function wrap(sp, ivs) {
  const t = sp.textContent, kids = []; let pos = 0;
  ivs.map(([a, b, x]) => [Math.max(0, a), Math.min(t.length, b), x]).sort((m, n) => m[0] - n[0]).forEach(([a, b, x]) => {
    a = Math.max(a, pos); if (b <= a) return;
    const m = h('mark', { className: x ? 'uh' + (x.ev ? ' ev' : '') : 'hl', textContent: t.slice(a, b) }); if (x) { m.dataset.id = x.id; m.style.setProperty('--c', x.color); }
    kids.push(t.slice(pos, a), m); pos = b;
  });
  if (kids.length) { sp.textContent = ''; sp.append(...kids, t.slice(pos)); }
}
// find a phrase in a page's spans -> [[spanIdx, from, to]...] (whitespace/case-insensitive, rejoins hyphenated line ends)
function locate(spans, phrase) {
  const want = String(phrase || '').replace(/\s+/g, ' ').trim().toLowerCase(); if (!want) return null;
  let all = ''; const map_ = [];
  spans.forEach((sp, i) => {
    const t = sp.textContent;
    for (let j = 0; j < t.length; j++) {
      if (/\s/.test(t[j])) { if (all && all.at(-1) !== ' ') { all += ' '; map_.push([i, -1]); } }
      else { const c = t[j].toLowerCase(); for (const ch of c) { all += ch; map_.push([i, j]); } }
    }
    const nx = spans[i + 1];
    if (nx) {
      if (/\w-$/.test(t) && /^\w/.test(nx.textContent) && Math.abs(nx.offsetTop - sp.offsetTop) > (parseFloat(sp.style.fontSize) || 10) * 0.6) { all = all.slice(0, -1); map_.pop(); }
      else if (all && all.at(-1) !== ' ') { all += ' '; map_.push([i, -1]); }
    }
  });
  const p = all.indexOf(want); if (p < 0) return null;
  const segs = {};
  for (let q = p; q < p + want.length; q++) { const m = map_[q]; if (!m || m[1] < 0) continue; const g = segs[m[0]] ||= [m[0], m[1], m[1] + 1]; g[1] = Math.min(g[1], m[1]); g[2] = Math.max(g[2], m[1] + 1); }
  return Object.values(segs);
}
// draggable/resizable crop rectangle inside a page element
function cropBox(pg) {
  const W = pg.clientWidth, H = pg.clientHeight, b = h('div', { className: 'crop' }, h('i', { className: 'ch tl' }), h('i', { className: 'ch br' }));
  Object.assign(b.style, { left: W * 0.2 + 'px', top: H * 0.2 + 'px', width: W * 0.6 + 'px', height: H * 0.6 + 'px' });
  b.onpointerdown = (e) => {
    e.preventDefault(); b.setPointerCapture(e.pointerId);
    const m = e.target.classList.contains('tl') ? 'tl' : e.target.classList.contains('br') ? 'br' : 'mv', o = { x: e.clientX, y: e.clientY, l: b.offsetLeft, t: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight };
    b.onpointermove = (ev) => {
      const dx = ev.clientX - o.x, dy = ev.clientY - o.y; let { l, t, w, h: ht } = o;
      if (m === 'mv') { l = clamp(l + dx, 0, W - w); t = clamp(t + dy, 0, H - ht); }
      else if (m === 'br') { w = clamp(w + dx, 24, W - l); ht = clamp(ht + dy, 24, H - t); }
      else { l = clamp(l + dx, 0, l + w - 24); t = clamp(t + dy, 0, t + ht - 24); w = o.l + o.w - l; ht = o.t + o.h - t; }
      Object.assign(b.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: ht + 'px' });
    };
    b.onpointerup = () => { b.onpointermove = null; };
  };
  return b;
}

// v: volume {id,name}; o: {page, phrase, segs} from a node source
export async function openPdf(v, o = {}) {
  let doc, fx;
  try { doc = await loadDoc(v.id); if (!doc) return toast('PDF not found on this device or the server.'); }
  catch (e) { console.error(e); return toast('Could not open the PDF.'); }
  const rp = !o.page && !o.phrase && prog()[v.id]; if (rp && Number.isInteger(rp.page)) o = { ...o, page: clamp(rp.page, 1, doc.numPages) }; // resume where you left off
  const s = { tok: 0, zoom: 1, pgs: [], obs: null, crop: null, cropPg: null, focus: o.ei != null && ev.active ? 'ev:' + o.ei : null, hl: o.phrase ? { page: clamp(o.page || 1, 1, doc.numPages), phrase: o.phrase, segs: o.segs, done: false } : null };
  const sh = shell(v.name || 'PDF', () => { s.tok++; s.obs?.disconnect(); fx?.dispose(); doc.destroy(); }, 'pdf-scroll'), box = h('div', { className: 'pdf-pages' });
  sh.body.append(box);
  const go = h('input', { type: 'number', className: 'rd-go', min: 1, max: doc.numPages, value: 1, title: 'Page' }), zl = h('span', { className: 'mono rd-zl' });
  const cur = () => { const mid = sh.body.scrollTop + sh.body.clientHeight * 0.35; let c = 1; for (const p of s.pgs) { if (p.el.offsetTop <= mid) c = p.n; else break; } return c; };
  const info = () => { if (document.activeElement !== go) go.value = cur(); zl.textContent = Math.round(s.zoom * 100) + '%'; };
  const jump = (n) => { const p = s.pgs[clamp(n, 1, s.pgs.length) - 1]; if (p) sh.body.scrollTop = p.el.offsetTop - 8; };
  const cancelCrop = () => { s.crop?.remove(); s.crop = s.cropPg = null; };
  const unload = (p) => { if (p.done && !(s.crop && p.el.contains(s.crop))) { p.el.textContent = ''; p.done = false; } };

  function highlight(p) {
    const tl = p.el.querySelector('.pdf-tl'), sp = [...tl.querySelectorAll('span')]; if (!sp.length) return;
    const iv = {}, add = (segs, x) => segs?.forEach(([i, a, b]) => sp[i] && (iv[i] ||= []).push([a, b, x]));
    if (ev.active) ev.items.forEach((x) => x.volumeId === v.id && x.page === p.n && x.phrase && add(locate(sp, x.phrase), { id: 'ev:' + x.i, color: EVC, ev: 1 }));
    if (s.hl?.page === p.n) add(s.hl.segs?.length ? s.hl.segs : locate(sp, s.hl.phrase), null);
    ui.list().filter((x) => x.page === p.n).forEach((x) => add(locate(sp, x.phrase), x));
    for (const i in iv) wrap(sp[i], iv[i]);
    const f = tl.querySelector('.hl'); if (f && s.hl && !s.hl.done) { s.hl.done = true; f.scrollIntoView({ block: 'center' }); }
    if (s.focus) { const m = [...tl.querySelectorAll('.uh')].find((e) => e.dataset.id === s.focus); if (m) { s.focus = null; m.scrollIntoView({ block: 'center' }); } }
  }
  const paint = () => s.pgs.forEach((p) => { if (p.done) { p.el.querySelector('.pdf-tl')?.querySelectorAll('mark').forEach((m) => m.replaceWith(m.textContent)); highlight(p); } });
  async function draw(p, scale, tok) {
    if (p.done || p.busy) return; p.busy = true;
    try {
      const pg = await doc.getPage(p.n), vp = pg.getViewport({ scale }), dpr = Math.min(devicePixelRatio || 1, 2);
      const cv = h('canvas', { width: Math.round(vp.width * dpr), height: Math.round(vp.height * dpr) });
      cv.style.width = Math.round(vp.width) + 'px'; cv.style.height = Math.round(vp.height) + 'px';
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: pg.getViewport({ scale: scale * dpr }) }).promise;
      if (tok !== s.tok) return;
      const tl = h('div', { className: 'pdf-tl' }); tl.style.width = cv.style.width; tl.style.height = cv.style.height;
      p.el.style.width = cv.style.width; p.el.style.height = cv.style.height; p.el.textContent = ''; p.el.append(cv, tl);
      textLayer(await pg.getTextContent({ normalizeWhitespace: true }), vp, tl); p.done = true;
      highlight(p);
    } catch {} finally { p.busy = false; }
  }
  async function build(page) {
    cancelCrop(); s.obs?.disconnect(); box.textContent = ''; s.pgs = []; const tok = ++s.tok;
    const b0 = (await doc.getPage(1)).getViewport({ scale: 1 }), scale = ((Math.min(sh.body.clientWidth - 24, 1100) || 340) / b0.width) * s.zoom;
    s.obs = new IntersectionObserver((es) => es.forEach((e) => { const p = s.pgs[e.target.dataset.n - 1]; if (p) e.isIntersecting ? draw(p, scale, tok) : unload(p); }), { root: sh.body, rootMargin: '900px 0px' });
    for (let n = 1; n <= doc.numPages; n++) {
      const el = h('div', { className: 'pdf-pg' }); el.dataset.n = n; el.style.width = Math.round(b0.width * scale) + 'px'; el.style.height = Math.round(b0.height * scale) + 'px';
      box.append(el); s.pgs.push({ n, el, done: false, busy: false }); s.obs.observe(el);
    }
    if (page) jump(page); info();
  }

  function selText() {
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return '';
    const r = sel.getRangeAt(0); if (!box.contains(r.commonAncestorContainer)) return '';
    const out = []; let last = 0, lastPg = null;
    box.querySelectorAll('.pdf-tl span').forEach((sp) => {
      if (!r.intersectsNode(sp)) return;
      const [a, b] = spanSel(r, sp), t = sp.textContent.slice(a, b); if (!t) return;
      const pg = sp.parentNode.parentNode, top = sp.offsetTop;
      if (out.length) { if (pg !== lastPg) out.push('\n\n'); else if (Math.abs(top - last) >= (parseFloat(sp.style.fontSize) || 10) * 0.6) out.push('\n'); else if (!/\s$/.test(out.at(-1)) && !/^\s/.test(t)) out.push(' '); }
      out.push(t); last = top; lastPg = pg;
    });
    return out.join('').replace(/(\w)-\n(\w)/g, '$1$2').replace(/([^\n.!?:;])\n(?!\n)/g, '$1 ').replace(/[ \t]+/g, ' ').trim();
  }
  function picked() {
    const text = selText().replace(/\s+/g, ' ').trim(); if (!text) return null;
    const r = getSelection().getRangeAt(0);
    for (const p of s.pgs) {
      const tl = p.el.querySelector('.pdf-tl'); if (!tl) continue; const segs = [];
      tl.querySelectorAll('span').forEach((sp, i) => { if (!r.intersectsNode(sp)) return; const [a, b] = spanSel(r, sp); if (b > a) segs.push([i, a, b]); });
      if (segs.length) return { text, page: p.n, segs };
    }
    return null;
  }
  const src = (type, page, extra) => ({ type, volumeId: v.id, volumeName: v.name, page, ...extra });
  const cut = () => {
    const p = picked(); if (!p) return toast('Select some text on the page first.');
    star({ title: `${v.name} — p.${p.page}`, body: escapeHtml(p.text), source: src('pdf', p.page, { phrase: p.text, segs: p.segs }) }); toast('Added to the map');
  };
  const area = () => {
    if (!s.crop) {
      const p = s.pgs[cur() - 1]; if (!p?.done) return toast('Wait for the page to load.');
      s.cropPg = p; s.crop = cropBox(p.el); p.el.append(s.crop); return toast('Drag the box, then press Area again.');
    }
    const p = s.cropPg, cv = p.el.querySelector('canvas'), b = s.crop, k = cv.width / p.el.clientWidth;
    const c = h('canvas', { width: Math.round(b.offsetWidth * k), height: Math.round(b.offsetHeight * k) });
    c.getContext('2d').drawImage(cv, b.offsetLeft * k, b.offsetTop * k, b.offsetWidth * k, b.offsetHeight * k, 0, 0, c.width, c.height);
    c.toBlob(async (blob) => {
      const id = await storeBlob(blob);
      star({ title: `${v.name} — p.${p.n}`, body: `<img data-media-id="${id}">`, source: src('pdf-image', p.n) }); cancelCrop(); toast('Page image added');
    }, 'image/png');
  };
  const ui = hlBar(v, sh, {
    ok: (x) => Number.isInteger(x.page), paint,
    make: () => { const p = picked(); return p && { page: p.page, phrase: p.text }; },
    go: (x) => { s.focus = x.id; jump(x.page); paint(); },
    cut: (x) => { star({ title: `${v.name} — p.${x.page}`, body: escapeHtml(x.phrase), source: src('pdf', x.page, { phrase: x.phrase }) }); toast('Added to the map'); },
  });
  const zoom = (z) => { const c = cur(); s.zoom = clamp(z, 0.5, 3); build(c); };

  fx = rdx(v, sh, {
    pos: () => { const n = cur(); return { page: n, label: 'p. ' + n, pct: Math.round((n / doc.numPages) * 100) }; },
    go: (p) => { if (Number.isInteger(p.page) && p.page !== cur()) jump(p.page); },
    paint, sig: () => ui.list().map((x) => x.id + x.color).join(), resize: () => build(cur()),
    goEv: (x) => { s.focus = 'ev:' + x.i; jump(x.page); paint(); },
  });
  let dt; const look = () => { clearTimeout(dt); dt = setTimeout(() => { const p = picked(); if (!p) return fx.hide(); fx.look(p.text, getSelection().getRangeAt(0).getBoundingClientRect(), src('pdf', p.page)); }, 260); };
  ['pointerup', 'keyup', 'touchend'].forEach((n) => sh.body.addEventListener(n, look));
  go.onchange = () => jump(+go.value);
  let raf = 0; sh.body.addEventListener('scroll', () => { raf ||= requestAnimationFrame(() => { raf = 0; info(); fx.report(); }); fx.hide(); });
  sh.body.oncopy = (e) => { const t = selText(); if (t) { e.clipboardData.setData('text/plain', t); e.preventDefault(); } };
  compact(sh, tb('Cut', 'Selected text to a new star', cut, '✦'), fx, [
    tb('Prev', 'Previous page', () => jump(cur() - 1), '‹'), go, h('span', { className: 'mono', textContent: '/ ' + doc.numPages }), tb('Next', 'Next page', () => jump(cur() + 1), '›'),
    tb('Zoom out', 'Zoom out', () => zoom(s.zoom - 0.25), '−'), zl, tb('Zoom in', 'Zoom in', () => zoom(s.zoom + 0.25), '+'),
    tb('Copy', 'Copy selected text', () => { const t = selText(); t ? copyText(t).then(() => toast('Text copied')) : toast('Select some text first.'); }, '⧉'),
    tb('Area', 'Page area to a new star (press twice)', area, '▣'), ...ui.btns, ...fx.btns]);
  await build(o.page);
}
