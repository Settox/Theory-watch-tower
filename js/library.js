// Library: folders + volumes (schema identical to v1), drag & drop, covers, notes, full-text search, PDF/EPUB hooks.
import { $, app, uid, save, toast, on, emit, escapeHtml, storeBlob, mediaUrl, idb, clamp } from './core.js';
import * as map from './map.js';
import { ingestPdf, openPdf, prog, bookmarks, peersOn, onPeer } from './pdf.js';
import { ingestEpub, openEpub } from './epub.js';
import { volParts, init as initEv } from './evidence.js';
import { ic } from './icons.js';
import { takeSnapshot } from './export.js';

let h, showMenu, pickFile, toggleLib, openModal;
const S = () => app.state, vol = (id) => S().volumes.find((v) => v.id === id);
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const COLL = 'spazio-teorie-collapsed';
const colV = ls(COLL, {}), colF = ls(COLL + '-folders', {});
let tab = 'main', query = '', drag = null, qTok = 0;
try { tab = localStorage.getItem('spazio-teorie-colltab') === 'tr' ? 'tr' : 'main'; } catch {}
const keep = () => { try { localStorage.setItem(COLL, JSON.stringify(colV)); localStorage.setItem(COLL + '-folders', JSON.stringify(colF)); localStorage.setItem('spazio-teorie-colltab', tab); } catch {} };
const lang = (c) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(c); } catch { return c; } };
const noteOpen = {};
const ico = (name, title, fn, cls = '') => h('button', { className: 'ico ' + cls, title, type: 'button', 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(e); } }, ic(name));
const wipe = (id) => Promise.all([['pdfs', id], ['pdfs', id + ':text'], ['epubs', id], ['epubs', id + ':text']].map(([s, k]) => idb.del(s, k).catch(() => {})));

/* ---------- volumes ---------- */
async function attach(v, f) {
  const epub = /\.epub$/i.test(f.name) || f.type === 'application/epub+zip';
  if (!epub && !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast('Choose a PDF or EPUB file.');
  toast('Reading ' + f.name + '…');
  try {
    await wipe(v.id);
    const r = await (epub ? ingestEpub : ingestPdf)(v.id, f);
    v.type = epub ? 'epub' : 'pdf'; v.pdf = { name: f.name, pageCount: r.count };
    if (r.cover && !v.coverId) v.coverId = await storeBlob(r.cover);
    render(); save(); toast('Loaded ' + f.name);
  } catch (e) { console.error(e); toast('Could not read ' + f.name); }
}
const open = (v, o) => (v.type === 'epub' ? openEpub(v, o) : v.pdf ? openPdf(v, o) : toast('No PDF or EPUB attached yet.'));
function addVolume(folderId) {
  if (tab === 'tr') { tab = 'main'; keep(); }
  const v = { id: uid(), name: 'New volume', text: '', type: 'text', pdf: null, folderId: folderId || null }; S().volumes.push(v); render(); save();
  setTimeout(() => { const n = document.querySelector(`.volume[data-id="${v.id}"] .volume-name`); n?.focus(); n?.select(); }, 60);
}
function addFolder() {
  const f = { id: uid(), name: 'New folder', expanded: true }; S().folders.push(f); render(); save();
  setTimeout(() => { const n = document.querySelector(`.folder[data-id="${f.id}"] .fname`); n?.focus(); n?.select(); }, 60);
}
const del = (o, kind) => {
  if (o.locked) return toast(`${kind} is locked: unlock it first.`);
  emit('confirm', { title: kind === 'Folder' ? 'Delete this folder? Its volumes move back to the main list.' : `Delete volume “${o.name}”?`, ok: () => {
    if (kind === 'Folder') { S().folders = S().folders.filter((f) => f.id !== o.id); S().volumes.forEach((v) => { if (v.folderId === o.id) v.folderId = null; }); }
    else { takeSnapshot('Before deleting “' + (o.name || 'volume') + '”').catch(() => {}); S().volumes = S().volumes.filter((v) => v.id !== o.id); setTimeout(() => { if (!vol(o.id)) wipe(o.id); }, 600000); } // restorable from Version history; files are purged 10 min later
    render(); save();
  } });
};
// the lock flips IN PLACE: no re-render, so the list never jumps and nothing moves under your cursor
const lock = (o, el) => {
  const b = ico(o.locked ? 'lock' : 'unlock', o.locked ? 'Unlock' : 'Lock', () => {
    o.locked = !o.locked; b.replaceChildren(ic(o.locked ? 'lock' : 'unlock')); b.title = b.ariaLabel = o.locked ? 'Unlock' : 'Lock';
    b.classList.toggle('on', !!o.locked); el.classList.toggle('is-locked', !!o.locked); save();
  }, o.locked ? 'on' : ''); return b;
};

/* ---------- drag & drop (HTML5; touch uses the ⋯ menu) ---------- */
const marks = () => document.querySelectorAll('#collection .drop-before,#collection .drop-after,#collection .drop-into,#collection .over').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into', 'over'));
const endDrag = () => { drag = null; $('collection').classList.remove('dragging-vol'); marks(); document.querySelectorAll('#collection .dragging').forEach((x) => x.classList.remove('dragging')); };
const after = (e, el) => { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
function grip(kind, id, box) {
  const g = h('span', { className: 'grip', title: 'Drag to reorder', draggable: true, onclick: (e) => e.stopPropagation() }, ic('grip', 14));
  g.ondragstart = (e) => { drag = { kind, id }; try { e.dataTransfer.setData('text/plain', kind + ':' + id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(box, 12, 12); } catch {} setTimeout(() => { box.classList.add('dragging'); if (kind === 'vol' && tab === 'main') $('collection').classList.add('dragging-vol'); }, 0); };
  g.ondragend = endDrag; return g;
}
function moveVolume(id, targetId, aft, folderId) {
  const v = vol(id); if (!v) return;
  const arr = S().volumes.filter((x) => x.id !== id), t = targetId && arr.find((x) => x.id === targetId);
  if (t) { if (!v.tr) v.folderId = t.folderId || null; const i = arr.indexOf(t); arr.splice(aft ? i + 1 : i, 0, v); }
  else {
    if (!v.tr) v.folderId = folderId || null;
    const same = (x) => !!x.tr === !!v.tr && (x.folderId || null) === (v.folderId || null);
    if (folderId === null && !v.tr) { const f = arr.findIndex((x) => !x.tr && !x.folderId); if (f >= 0) arr.splice(f, 0, v); else arr.push(v); }
    else { const l = arr.findLastIndex(same); l < 0 ? arr.push(v) : arr.splice(l + 1, 0, v); }
  }
  S().volumes = arr; render(); save();
}
function moveFolder(id, targetId, aft) {
  const f = S().folders.find((x) => x.id === id); if (!f || id === targetId) return;
  const arr = S().folders.filter((x) => x.id !== id), i = arr.findIndex((x) => x.id === targetId); if (i < 0) return;
  arr.splice(aft ? i + 1 : i, 0, f); S().folders = arr; render(); save();
}
function nudge(v, d) {
  const sib = S().volumes.filter((x) => !!x.tr === !!v.tr && (x.folderId || null) === (v.folderId || null)), j = sib.indexOf(v) + d;
  j < 0 || j >= sib.length ? toast(`Already at the ${d < 0 ? 'top' : 'bottom'}.`) : moveVolume(v.id, sib[j].id, d > 0);
}
function volumeMenu(v, x, y) {
  const it = [{ l: 'Read aloud', fn: () => emit('read-volume', v.id) }, { l: 'Translate…', fn: () => emit('translate-volume', v.id) }, { l: v.coverId ? 'Change cover…' : 'Add cover…', fn: () => pickFile('image/*', (f) => setCover(v, f)) },
    ...(v.pdf && !v.tr ? [{ l: 'Replace PDF / EPUB…', fn: () => pickFile('.pdf,.epub,application/pdf,application/epub+zip', (f) => attach(v, f)) }] : []),
    { sep: 1 }, { l: 'Move up', fn: () => nudge(v, -1) }, { l: 'Move down', fn: () => nudge(v, 1) }];
  if (!v.tr && S().folders.length) {
    it.push({ sep: 1 }); if (v.folderId) it.push({ l: 'Take out of folder', fn: () => moveVolume(v.id, null, false, null) });
    S().folders.filter((f) => f.id !== v.folderId).forEach((f) => it.push({ l: `Move to “${f.name || 'folder'}”`, fn: () => moveVolume(v.id, null, false, f.id) }));
  }
  it.push({ sep: 1 }, { l: 'Delete volume…', danger: true, fn: () => del(v, 'Volume') });
  showMenu(it, x, y);
}
function coverView(v) {
  openModal((card, close) => {
    const im = h('img', { alt: v.name || 'Cover', className: 'cover-big' }); mediaUrl(v.coverId).then((u) => u && (im.src = u));
    card.classList.add('cover-card');
    card.append(im, h('div', { className: 'cover-actions' },
      h('button', { className: 'btn', type: 'button', textContent: 'Change cover…', onclick: () => { close(); pickFile('image/*', (f) => setCover(v, f)); } }),
      h('button', { className: 'btn', type: 'button', textContent: 'Remove cover', onclick: () => { delete v.coverId; close(); render(); save(); } }),
      h('button', { className: 'btn primary', type: 'button', textContent: 'Close', onclick: close })));
  });
}
async function setCover(v, f) { v.coverId = await storeBlob(f); render(); save(); }

/* ---------- render ---------- */
function volumeEl(v) {
  const col = !!colV[v.id], box = h('div', { className: 'volume' + (col ? ' collapsed' : '') + (v.locked ? ' is-locked' : '') }); box.dataset.id = v.id;
  const name = h('input', { className: 'volume-name', value: v.name, spellcheck: false, title: 'Volume name', oninput: () => { v.name = name.value; save(); } });
  const head = h('div', { className: 'v-head' }, grip('vol', v.id, box),
    ico('chevron', col ? 'Expand' : 'Collapse', () => { col ? delete colV[v.id] : (colV[v.id] = 1); keep(); render(); }, 'tog'), name, lock(v, box), ico('more', 'More', (e) => volumeMenu(v, e.clientX, e.clientY)));
  head.oncontextmenu = (e) => { e.preventDefault(); volumeMenu(v, e.clientX, e.clientY); };
  box.append(head);
  box.addEventListener('dragover', (e) => { if (drag?.kind !== 'vol' || drag.id === v.id) return; e.preventDefault(); e.stopPropagation(); marks(); box.classList.add(after(e, box) ? 'drop-after' : 'drop-before'); });
  box.addEventListener('drop', (e) => { if (drag?.kind !== 'vol' || drag.id === v.id) return; e.preventDefault(); e.stopPropagation(); const a = after(e, box), id = drag.id; endDrag(); moveVolume(id, v.id, a); });
  if (col) return box;

  const pr = v.pdf && prog()[v.id], pct = pr ? clamp(Math.round(+pr.pct) || 0, 0, 100) : 0, bm = bookmarks(v), rd = peersOn(v.id), epub = v.type === 'epub';
  const resume = pr && (Number.isInteger(pr.page) ? { page: pr.page } : typeof pr.cfi === 'string' && pr.cfi.length < 600 ? { cfi: pr.cfi } : null);
  const kind = v.pdf ? (epub ? 'EPUB' : 'PDF') : v.tr ? 'Translation' : 'Text', len = (v.text || '').length;
  const size = v.pdf ? `${v.pdf.pageCount} ${epub ? 'ch.' : 'pp.'}` : len ? (len >= 1000 ? Math.round(len / 1000) + 'k' : len) + ' chars' : 'empty';
  const meta = [kind, size, pr ? pct + '% read' : '', bm.length ? bm.length + (bm.length === 1 ? ' bookmark' : ' bookmarks') : ''].filter(Boolean).join('  ·  ');

  /* cover thumbnail: whole image, never cropped */
  const thumb = h('button', { className: 'v-thumb', type: 'button', title: v.coverId ? 'View cover' : 'Add a cover', 'aria-label': v.coverId ? 'View cover' : 'Add a cover', onclick: () => (v.coverId ? coverView(v) : pickFile('image/*', (f) => setCover(v, f))) });
  if (v.coverId) { const im = h('img', { alt: '' }); if (app.mediaUrls[v.coverId]) im.src = app.mediaUrls[v.coverId]; else mediaUrl(v.coverId).then((u) => u && (im.src = u)); thumb.append(im); } else thumb.append(ic('book', 22));

  const info = h('div', { className: 'v-info' }, h('div', { className: 'v-meta mono', textContent: meta }));
  if (v.pdf && (pr || bm.length)) {
    const bar = h('div', { className: 'vprog', title: `${pct}% read` }, h('i')); bar.firstChild.style.width = pct + '%';
    bm.forEach((x) => { const p = x.page && v.pdf.pageCount ? (x.page / v.pdf.pageCount) * 100 : +x.pct; if (p >= 0 && p <= 100) { const t = h('b', { title: x.label }); t.style.left = p + '%'; bar.append(t); } });
    info.append(bar);
  }
  if (v.tr) { const so = vol(v.srcId); info.append(h('div', { className: 'v-sub', textContent: `Translated to ${lang(v.lang)}${so ? ` from “${so.name}”` : ''}` })); }
  if (typeof v.url === 'string' && /^https?:\/\//i.test(v.url)) { let host = ''; try { host = new URL(v.url).hostname; } catch {} if (host) info.append(h('a', { className: 'web-src', href: v.url, target: '_blank', rel: 'noopener noreferrer', title: v.url }, ic('globe', 12), host)); }
  if (rd.length) { const d = h('div', { className: 'peer-dot' }, h('i'), rd.slice(0, 2).map((p) => p.name).join(', ') + (rd.length > 2 ? ` +${rd.length - 2}` : '') + (rd.length === 1 ? ' is reading' : ' are reading')); d.firstChild.style.setProperty('--h', rd[0].hue); info.append(d); }

  /* actions: the two that matter as words, the rest as icons */
  const act = h('div', { className: 'v-actions' });
  const txt = (label, fn, cls = '') => h('button', { className: 'btn sm ' + cls, type: 'button', textContent: label, onclick: fn });
  const icb = (name, title, fn, on = false) => h('button', { className: 'btn sm icon' + (on ? ' on' : ''), type: 'button', title, 'aria-label': title, onclick: fn }, ic(name, 15));
  if (v.pdf) { act.append(txt('Open', () => open(v), 'primary')); if (resume) act.append(txt('Continue ' + (resume.page ? 'p. ' + resume.page : String(pr.label || 'reading').slice(0, 20)), () => open(v, resume))); }
  else if (!v.tr) act.append(txt('Add PDF', () => pickFile('.pdf,application/pdf', (f) => attach(v, f))), txt('Add EPUB', () => pickFile('.epub,application/epub+zip', (f) => attach(v, f))));
  act.append(icb('speaker', 'Read aloud', () => emit('read-volume', v.id)), icb('translate', 'Translate', () => emit('translate-volume', v.id)),
    icb('note', noteOpen[v.id] ? 'Hide the text' : 'Show / edit the text', () => { noteOpen[v.id] = !noteOpen[v.id]; if (noteOpen[v.id]) v.text ||= ''; render(); }, !!noteOpen[v.id]));
  box.append(h('div', { className: 'v-row' }, thumb, info), act);

  if (noteOpen[v.id]) {
    const ta = h('textarea', { className: 'volume-text', placeholder: 'Paste or write text…', value: v.text || '', oninput: () => { v.text = ta.value; save(); } });
    box.append(ta, h('button', { className: 'btn sm volume-cut', type: 'button', title: 'Creates a star and removes the selected text from this volume (Ctrl+Z in the text box puts it back)', onclick: () => {
      const s = ta.selectionStart, e = ta.selectionEnd, raw = ta.value.slice(s, e), txt = raw.trim(); if (!txt) return toast('Select a piece of text first.');
      map.addNode({ title: v.name, body: escapeHtml(txt), source: { type: 'text', volumeId: v.id, volumeName: v.name, label: v.name, phrase: txt, start: s + raw.indexOf(txt) } });
      ta.focus(); ta.setSelectionRange(s, e); document.execCommand('delete'); // keeps the browser's own undo; fires 'input' so it is saved
      toast('Star created and removed from the volume');
    } }, ic('star', 14), 'Make star from selection'));
  }
  return box;
}
function folderEl(f) {
  const box = h('div', { className: 'folder' + (colF[f.id] ? '' : ' open') + (f.locked ? ' is-locked' : '') }); box.dataset.id = f.id;
  const vs = S().volumes.filter((v) => !v.tr && v.folderId === f.id);
  const name = h('input', { className: 'fname', value: f.name, spellcheck: false, title: 'Folder name', oninput: () => { f.name = name.value; save(); }, onclick: (e) => e.stopPropagation() });
  const head = h('div', { className: 'folder-head', onclick: () => { colF[f.id] ? delete colF[f.id] : (colF[f.id] = 1); keep(); box.classList.toggle('open', !colF[f.id]); } },
    grip('folder', f.id, box), h('span', { className: 'tri' }, ic('chevron', 14)), ic('folder', 15), name, h('span', { className: 'count mono', textContent: String(vs.length) }),
    ico('plus', 'New volume in this folder', () => addVolume(f.id)), lock(f, box), ico('more', 'More', (e) => showMenu([{ l: 'Delete folder…', danger: true, fn: () => del(f, 'Folder') }], e.clientX, e.clientY)));
  const body = h('div', { className: 'folder-body' });
  vs.forEach((v) => body.append(volumeEl(v))); if (!vs.length) body.append(h('div', { className: 'hint', textContent: 'Empty folder: drag a volume here.' }));
  box.append(head, body);
  head.addEventListener('dragover', (e) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); marks(); if (drag.kind === 'vol') box.classList.add('drop-into'); else if (drag.id !== f.id) box.classList.add(after(e, box) ? 'drop-after' : 'drop-before'); });
  head.addEventListener('drop', (e) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); const { kind, id } = drag, a = after(e, box); endDrag(); if (kind === 'vol') { delete colF[f.id]; keep(); moveVolume(id, null, false, f.id); } else moveFolder(id, f.id, a); });
  body.addEventListener('dragover', (e) => { if (drag?.kind !== 'vol' || e.target.closest('.volume')) return; e.preventDefault(); marks(); box.classList.add('drop-into'); });
  body.addEventListener('drop', (e) => { if (drag?.kind !== 'vol' || e.target.closest('.volume')) return; e.preventDefault(); const id = drag.id; endDrag(); moveVolume(id, null, false, f.id); });
  return box;
}
export function render() {
  const box = $('collection'), sc = box.scrollTop; box.textContent = '';
  document.querySelectorAll('.lib-tabs .btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('addFolder').style.visibility = tab === 'tr' ? 'hidden' : '';
  const nTr = S().volumes.filter((v) => v.tr).length; document.querySelector('.lib-tabs [data-tab=tr]').textContent = 'Translated' + (nTr ? ` (${nTr})` : '');
  if (query) return runSearch(box);
  if (tab === 'tr') {
    const trs = S().volumes.filter((v) => v.tr); if (!trs.length) box.append(h('div', { className: 'hint', textContent: 'Translated books appear here. Use Translate on a volume: the result is saved here, apart from the originals.' }));
    [...new Set(trs.map((v) => v.lang || ''))].forEach((l) => { box.append(h('div', { className: 'lang-head', textContent: lang(l) || 'Other languages' })); trs.filter((v) => (v.lang || '') === l).forEach((v) => box.append(volumeEl(v))); });
  } else {
    const root = h('div', { className: 'drop-root', textContent: 'Drop here to take the volume out of its folder' });
    root.ondragover = (e) => { if (drag?.kind === 'vol') { e.preventDefault(); marks(); root.classList.add('over'); } };
    root.ondragleave = () => root.classList.remove('over');
    root.ondrop = (e) => { if (drag?.kind !== 'vol') return; e.preventDefault(); const id = drag.id; endDrag(); moveVolume(id, null, false, null); };
    box.append(root);
    const rv = S().volumes.filter((v) => !v.tr && !v.folderId); rv.forEach((v) => box.append(volumeEl(v))); S().folders.forEach((f) => box.append(folderEl(f)));
    if (!rv.length && !S().folders.length) box.append(h('div', { className: 'hint', textContent: 'Create folders to organise volumes, or add a volume right away. Drop a PDF or EPUB anywhere to create one.' }));
  }
  box.scrollTop = sc; requestAnimationFrame(() => { box.scrollTop = sc; }); // again after layout: the list must not jump
}

/* ---------- search across volume text + cached PDF/EPUB text ---------- */
async function runSearch(box) {
  const tok = ++qTok, q = query.toLowerCase(); box.append(h('div', { className: 'hint', textContent: 'Searching…' }));
  const groups = []; // per book: {v, n (passages with a hit), hits[<=6]}
  for (const v of S().volumes) {
    const g = { v, n: 0, hits: [] };
    for (const p of await volParts(v)) { const i = p.t.toLowerCase().indexOf(q); if (i >= 0) { g.n++; if (g.hits.length < 6) g.hits.push({ v, p, i }); } }
    if (g.n) groups.push(g);
  }
  if (tok !== qTok) return;
  box.textContent = ''; if (!groups.length) return box.append(h('div', { className: 'hint', textContent: 'No results (PDF and EPUB text is searchable once the file has been read).' }));
  groups.sort((a, b) => b.n - a.n); const max = groups[0].n;
  groups.forEach((g) => { const bar = h('i'); bar.style.width = (g.n / max) * 100 + '%'; box.append(h('div', { className: 'hit-grp' }, h('b', { textContent: g.v.name || 'Untitled' }), h('span', { className: 'mono', textContent: g.n + (g.n === 1 ? ' hit' : ' hits') }), h('span', { className: 'hit-bar' }, bar)), ...g.hits.map((x) => hitEl(x))); });
}
function hitEl({ v, p, i }) {
  const where = p.page ? `p.${p.page}` : p.chapter || (p.text ? 'note' : 'chapter');
  return h('button', { className: 'hit', onclick: () => {
    const phrase = p.t.substr(i, query.length);
    if (p.text) { query = ''; $('libSearch').value = ''; tab = v.tr ? 'tr' : 'main'; render(); focusVolume(v.id, phrase, i); } else open(v, { page: p.page, href: p.href, phrase });
  } }, h('b', { textContent: `${v.name} · ${where}` }), h('span', { className: 'snip' }, p.t.slice(Math.max(0, i - 40), i), h('mark', { textContent: p.t.substr(i, query.length) }), p.t.slice(i + query.length, i + query.length + 70)));
}
function focusVolume(id, phrase, start) {
  const v = vol(id); if (!v) return;
  if (!!v.tr !== (tab === 'tr')) { tab = v.tr ? 'tr' : 'main'; keep(); }
  if (colV[id]) { delete colV[id]; keep(); }
  if (phrase || !v.text) noteOpen[id] = true;
  render();
  const el = document.querySelector(`.volume[data-id="${id}"]`); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200);
  const ta = el.querySelector('.volume-text');
  if (ta && phrase) { const i = typeof start === 'number' && ta.value.substr(start, phrase.length) === phrase ? start : ta.value.indexOf(phrase); if (i >= 0) { ta.focus({ preventScroll: true }); ta.setSelectionRange(i, i + phrase.length); ta.scrollTop = Math.max(0, (i / Math.max(1, ta.value.length)) * ta.scrollHeight - ta.clientHeight / 2); } }
}

/* ---------- init ---------- */
export function init(helpers) {
  ({ h, showMenu, pickFile, toggleLib, openModal } = helpers);
  $('addVol').onclick = () => addVolume(); $('addVol').replaceChildren(ic('plus', 14), 'Volume');
  $('addFolder').onclick = addFolder; $('addFolder').replaceChildren(ic('folder', 14), 'Folder');
  document.querySelectorAll('.lib-tabs .btn').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; keep(); render(); }; });
  let t; $('libSearch').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); render(); }, 250); };
  $('collection').addEventListener('dragover', (e) => { if (drag) e.preventDefault(); });
  on('library-render', render);
  initEv(helpers);
  // "Maria is reading" dots: re-render only when who-reads-what changes, never while typing in the library
  const who = () => peersOn().map((p) => p.id + p.volumeId).sort().join(), idle = () => !document.activeElement?.closest?.('#collection');
  let wk = who(); const chk = () => { const k = who(); if (k !== wk && idle()) { wk = k; render(); } };
  onPeer(chk); setInterval(chk, 20000);
  on('file-drop', ({ file }) => {
    if (!/\.(pdf|epub)$/i.test(file.name) && !/^application\/(pdf|epub\+zip)$/.test(file.type)) return;
    const v = { id: uid(), name: file.name.replace(/\.\w+$/, ''), text: '', type: 'text', pdf: null, folderId: null }; S().volumes.push(v); tab = 'main'; query = ''; toggleLib(true); attach(v, file);
  });
  on('open-source', (s) => {
    if (s.type === 'web') return; // web-page stars are opened by webimport.js
    const v = vol(s.volumeId); if (!v) return toast('That volume no longer exists.');
    if (s.type === 'text') { toggleLib(true); focusVolume(v.id, s.phrase, s.start); } else if (s.type === 'epub') openEpub(v, s); else openPdf(v, s);
  });
  render();
}
